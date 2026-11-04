"""Live preview and timing of the MiniMax H3 sampling, ported from the author's Skalibur H3 Model Preview.

The node wraps the model so that, while it samples, the engine reports to the client that submitted the prompt: the stage
it is in (model loading, sampling, preview...), the time of every step and a short preview video decoded with the tiny
H3 decoder (TAEH3). Nothing here changes what is generated: the model keeps its identity and the sampler its inputs.
"""

import base64
import io as pyio
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from fractions import Fraction

import av
import comfy.model_management
import comfy.model_prefetch
import comfy.patcher_extension
import folder_paths
import latent_preview
import torch
from comfy_api.latest import io
from comfy_extras import nodes_minimax_h3 as h3
from PIL import Image
from server import PromptServer

from .h3_tiny_preview import TinyDecoder

STAGE_EVENT = "kubrick_h3_stage"
STEP_EVENT = "kubrick_h3_step"
PREVIEW_EVENT = "kubrick_h3_preview"


def send(event, payload):
    try:
        PromptServer.instance.send_sync(event, payload, PromptServer.instance.client_id)
    except (OSError, ValueError, RuntimeError) as error:
        logging.warning("Kubrick H3 Preview: %s", error)


class StepTiming:
    """Milliseconds the model spends predicting between two steps, measured with the device synchronized."""

    def __init__(self):
        self.elapsed = 0.0
        self.calls = 0

    def predict(self, executor, x, *args, **kwargs):
        def synchronize():
            if x.device.type == "cuda":
                torch.cuda.synchronize(x.device)
            elif x.device.type == "mps":
                torch.mps.synchronize()
            elif x.device.type != "cpu":
                comfy.model_management.synchronize()

        synchronize()
        started = time.perf_counter()
        result = executor(x, *args, **kwargs)
        synchronize()
        self.elapsed += (time.perf_counter() - started) * 1000
        self.calls += 1
        return result

    def take(self):
        elapsed = self.elapsed if self.calls else None
        self.elapsed = 0.0
        self.calls = 0
        return elapsed


def video_latent(value, shapes):
    if value.ndim == 5:
        return value
    shape = shapes[0]
    size = math.prod(shape[1:])
    return value.reshape(value.shape[0], -1)[:, :size].reshape(value.shape[0], *shape[1:])


def rgb_frames(video, latent_format, count):
    factors = video.new_tensor(latent_format.latent_rgb_factors).transpose(0, 1)
    bias = latent_format.latent_rgb_factors_bias
    bias = video.new_tensor(bias) if bias is not None else None
    timeline = [token for token in range(video.shape[2]) for _ in range(h3.FRAME_PER_TOKEN[token % len(h3.FRAME_PER_TOKEN)])]
    count = min(count, len(timeline))
    last_token, frame = None, None
    for index in range(count):
        token = timeline[round(index * (len(timeline) - 1) / max(1, count - 1))]
        if token != last_token:
            rgb = torch.nn.functional.linear(video[0, :, token].movedim(0, -1), factors, bias)
            frame = rgb.add(1).mul(127.5).clamp(0, 255).to(device="cpu", dtype=torch.uint8).numpy()
            last_token = token
        yield frame


def encode_preview(frames, fps):
    output = pyio.BytesIO()
    if len(frames) == 1:
        Image.fromarray(frames[0]).save(output, format="JPEG", quality=90)
        return "image/jpeg", output.getvalue()
    with av.open(output, mode="w", format="mp4") as container:
        stream = container.add_stream("libx264", rate=Fraction(fps))
        stream.width, stream.height = frames[0].shape[1], frames[0].shape[0]
        stream.pix_fmt = "yuv420p"
        stream.options = {"crf": "23", "preset": "ultrafast", "movflags": "frag_keyframe+empty_moov"}
        for index, pixels in enumerate(frames):
            frame = av.VideoFrame.from_ndarray(pixels, format="rgb24")
            frame.pts, frame.time_base = index, Fraction(1, fps)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)
    return "video/mp4", output.getvalue()


def send_preview(frames, fps, step, total):
    try:
        mime, content = encode_preview(frames, fps)
        send(PREVIEW_EVENT, {"mime": mime, "image": base64.b64encode(content).decode("ascii"), "step": step, "total": total,
                             "w": frames[0].shape[1], "h": frames[0].shape[0]})
    except (OSError, ValueError, RuntimeError, av.error.FFmpegError) as error:
        logging.warning("Kubrick H3 Preview: %s", error)


def sample_preview(executor, noise, latent_image, sampler, sigmas, denoise_mask, callback, disable_pbar, seed, latent_shapes,
                   *, preview_frames, preview_fps, tiny_vae, step_timing):
    decoder = None
    if tiny_vae != "none":
        try:
            decoder = TinyDecoder(tiny_vae)
        except (OSError, ValueError, RuntimeError) as error:
            logging.warning("Kubrick H3 Preview: Tiny VAE unavailable; using RGB. %s", error)
    latent_format = executor.class_obj.model_patcher.model.latent_format

    def decode(video, count):
        with comfy.model_prefetch.malloc_graph_scope(video.device):
            return list(decoder.frames(video, count) if decoder is not None else rgb_frames(video, latent_format, count))

    pending = None
    failed = False
    total_time = 0.0
    total_count = 0
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="kubrick-preview") as encoder:
        def display(step, x0, total):
            nonlocal pending, failed
            if failed or pending is not None and not pending.done() and step + 1 < total:
                return
            if pending is not None:
                pending.result()
            try:
                video = video_latent(x0, latent_shapes)
                available = sum(h3.FRAME_PER_TOKEN[index % len(h3.FRAME_PER_TOKEN)] for index in range(video.shape[2]))
                frames = decode(video, max(1, min(int(preview_frames), available)))
                if frames:
                    pending = encoder.submit(send_preview, frames, preview_fps, step + 1, total)
            except comfy.model_management.InterruptProcessingException:
                raise
            except (OSError, ValueError, RuntimeError, TypeError) as error:
                failed = True
                logging.warning("Kubrick H3 Preview disabled for this inference: %s", error)

        def show(step, x0, x, total):
            nonlocal total_time, total_count
            elapsed = step_timing.take()
            if elapsed is not None:
                total_time += elapsed
                total_count += 1
            send(STEP_EVENT, {"step": step + 1, "total": total, "step_ms": elapsed,
                              "avg_step_ms": total_time / total_count if total_count else None})
            if callback is not None:
                # The engine's own preview is replaced by this one: it must not decode the latent a second time.
                original = latent_preview.LatentPreviewer.decode_latent_to_preview_image
                latent_preview.LatentPreviewer.decode_latent_to_preview_image = lambda *args: None
                try:
                    callback(step, x0, x, total)
                finally:
                    latent_preview.LatentPreviewer.decode_latent_to_preview_image = original
            send(STAGE_EVENT, {"stage": "Preview"})
            display(step, x0, total)
            send(STAGE_EVENT, {"stage": "Sampling"})

        send(STAGE_EVENT, {"stage": "Model Preparation"})
        return executor(noise, latent_image, sampler, sigmas, denoise_mask, show, disable_pbar, seed, latent_shapes=latent_shapes)


class KubrickH3Preview(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="KubrickH3Preview",
            display_name="Kubrick · H3 Preview",
            category="Kubrick Space/video",
            description="Reports the stage, the time of every step and a short preview of the sampling (TAEH3) to the client that "
                        "submitted the prompt. It does not change what is generated.",
            inputs=[
                io.Model.Input("model", tooltip="MiniMax H3 model after its optimizations and LoRAs."),
                io.Int.Input("preview_frames", display_name="Frames", default=16, min=1, max=240, step=1),
                io.Int.Input("preview_fps", display_name="FPS", default=12, min=1, max=60, step=1,
                             tooltip="Playback rate of the preview only; the video keeps its 24 fps."),
                io.Combo.Input("tiny_vae", display_name="Tiny VAE", options=["none"] + folder_paths.get_filename_list("vae_approx"),
                               default="none", tooltip="H3 tiny decoder from the vae_approx folders. none uses the approximate RGB preview."),
            ],
            outputs=[io.Model.Output()],
        )

    @classmethod
    def execute(cls, model, preview_frames=16, preview_fps=12, tiny_vae="none"):
        active_timing = ContextVar("kubrick_preview_timing", default=None)

        def preview(executor, *args, **kwargs):
            timing = StepTiming()
            token = active_timing.set(timing)
            try:
                return sample_preview(executor, *args, **kwargs, preview_frames=preview_frames, preview_fps=preview_fps,
                                      tiny_vae=tiny_vae, step_timing=timing)
            finally:
                active_timing.reset(token)

        def predict(executor, x, *args, **kwargs):
            timing = active_timing.get()
            if timing is None:
                return executor(x, *args, **kwargs)
            send(STAGE_EVENT, {"stage": "Sampling"})
            return timing.predict(executor, x, *args, **kwargs)

        def prepare(executor, *args, **kwargs):
            send(STAGE_EVENT, {"stage": "Model Loading"})
            try:
                return executor(*args, **kwargs)
            finally:
                send(STAGE_EVENT, {"stage": "Model Preparation"})

        def sample(executor, *args, **kwargs):
            send(STAGE_EVENT, {"stage": "Pre-Sampling"})
            try:
                return executor(*args, **kwargs)
            finally:
                send(STAGE_EVENT, {"stage": "Postprocessing"})

        patched = model.clone()
        patched.remove_wrappers_with_key(comfy.patcher_extension.WrappersMP.OUTER_SAMPLE, "kj_preview_override")
        for kind, wrapper in ((comfy.patcher_extension.WrappersMP.OUTER_SAMPLE, preview),
                              (comfy.patcher_extension.WrappersMP.PREDICT_NOISE, predict),
                              (comfy.patcher_extension.WrappersMP.PREPARE_SAMPLING, prepare),
                              (comfy.patcher_extension.WrappersMP.SAMPLER_SAMPLE, sample)):
            patched.remove_wrappers_with_key(kind, "kubrick_preview")
            patched.add_wrapper_with_key(kind, "kubrick_preview", wrapper)
        return io.NodeOutput(patched)
