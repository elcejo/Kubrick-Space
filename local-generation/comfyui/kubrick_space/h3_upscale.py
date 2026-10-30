"""MiniMax H3 latent upscaler and refinement pass, ported from the author's Skalibur package.

Skalibur adapts LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler (MIT): native ComfyUI operations and loading. Differences
here: the upscaler weights are resolved from the diffusion model folders (models/video/h3/lup), and the node builds
its sampling graph with the native nodes directly.
"""

import math
import re

import comfy.model_management
import comfy.model_patcher
import comfy.model_prefetch
import comfy.ops
import comfy.samplers
import comfy.utils
import folder_paths
import nodes
import torch
import torch.nn as nn
import torch.nn.functional as F
from comfy_api.latest import io

ops = comfy.ops.manual_cast

# Fixed refinement schedules of the latent upscaler. The base pass uses the "simple" scheduler instead.
SIGMA_PRESETS = {
    3: (0.9035, 0.6316, 0.3158, 0.0),
    4: (0.9035, 0.8000, 0.6316, 0.3158, 0.0),
    5: (0.9231, 0.8780, 0.8000, 0.6316, 0.3158, 0.0),
}

LATENTS_MEAN = [
    0.858090341091156, -0.9606591463088989, 1.0661640167236328, -0.5090325474739075,
    -0.2727581858634949, -1.3675414323806763, -0.2553254961967468, -0.26907554268836975,
    -0.5376840829849243, -0.0464097298681736, 0.6657370328903198, 0.19690127670764923,
    -0.5460608005523682, -0.4035342037677765, -0.23683024942874908, 0.25928452610969543,
    -0.30133944749832153, 0.211341992020607, -1.1206848621368408, 0.3581933379173279,
    -0.04225143790245056, 0.2604829967021942, 0.22864092886447906, 0.7056031823158264,
]
LATENTS_STD = [
    1.2223774194717407, 1.2767263650894165, 1.6831774711608887, 1.7549455165863037,
    1.5636216402053833, 2.194143533706665, 0.9653137922286987, 1.0569885969161987,
    0.841948926448822, 0.7729952931404114, 1.8955937623977661, 0.946841835975647,
    0.7996809482574463, 0.44988900423049927, 0.7197399735450745, 0.6936293244361877,
    2.961095094680786, 2.7694199085235596, 3.0496184825897217, 2.1088054180145264,
    3.276226282119751, 3.1627357006073, 2.2816812992095947, 2.6127843856811523,
]


class ResBlockEmb3D(nn.Module):
    def __init__(self, channels, emb_channels):
        super().__init__()
        self.in_layers = nn.Sequential(ops.GroupNorm(32, channels), nn.SiLU(), ops.Conv3d(channels, channels, 3, padding=1))
        self.emb_layers = nn.Sequential(nn.SiLU(), ops.Linear(emb_channels, 2 * channels))
        self.out_norm = ops.GroupNorm(32, channels)
        self.out_layers = nn.Sequential(nn.SiLU(), nn.Identity(), ops.Conv3d(channels, channels, 3, padding=1))

    def forward(self, x, emb):
        h = self.in_layers(x)
        emb_out = self.emb_layers(emb)
        while len(emb_out.shape) < len(h.shape):
            emb_out = emb_out[..., None]
        scale, shift = torch.chunk(emb_out, 2, dim=1)
        h = self.out_norm(h) * (1 + scale) + shift
        return x + self.out_layers(h)


class TemporalConv(nn.Module):
    def __init__(self, channels, kernel_size=5):
        super().__init__()
        self.norm = ops.GroupNorm(32, channels)
        self.dwconv = ops.Conv3d(channels, channels, kernel_size=(kernel_size, 1, 1), padding=(kernel_size // 2, 0, 0), groups=channels)
        self.pwconv = ops.Conv3d(channels, channels, kernel_size=1)

    def forward(self, x):
        h = self.pwconv(self.dwconv(F.silu(self.norm(x))))
        return x + h


class LatentResizer3D(nn.Module):
    def __init__(self, in_channels=24, in_blocks=12, out_blocks=12, channels=512, temporal_every=2, temporal_kernel=5):
        super().__init__()
        self.conv_in = ops.Conv3d(in_channels, channels, 3, padding=1)
        embed_dim = 64
        self.embed = nn.Sequential(ops.Linear(1, embed_dim), nn.SiLU(), ops.Linear(embed_dim, embed_dim))
        self.in_blocks = nn.ModuleList()
        for b in range(in_blocks):
            self.in_blocks.append(ResBlockEmb3D(channels, embed_dim))
            if temporal_every > 0 and b % temporal_every == 0:
                self.in_blocks.append(TemporalConv(channels, temporal_kernel))
        self.out_blocks = nn.ModuleList()
        for b in range(out_blocks):
            self.out_blocks.append(ResBlockEmb3D(channels, embed_dim))
            if temporal_every > 0 and b % temporal_every == 0:
                self.out_blocks.append(TemporalConv(channels, temporal_kernel))
        self.norm_out = ops.GroupNorm(32, channels)
        self.conv_out = ops.Conv3d(channels, in_channels, 3, padding=1)

    def forward(self, x, scale, target_size):
        size = target_size
        if size == x.shape[-3:]:
            return x
        B, C, T, H, W = x.shape
        tk = 0
        for b in self.in_blocks:
            if isinstance(b, TemporalConv):
                tk = b.dwconv.weight.shape[2]
                break
        overlap = tk
        chunk = 32
        if T <= chunk:
            return self._forward_seg(x, scale, size)
        x_padded = F.pad(x, (0, 0, 0, 0, overlap, overlap), mode="replicate")
        out_full = torch.zeros(B, C, T, size[-2], size[-1], device=x.device, dtype=x.dtype)
        weight_full = torch.zeros(1, 1, T, 1, 1, device=x.device, dtype=x.dtype)
        start = 0
        while start < T:
            seg_start = start
            seg_end = min(T, start + chunk)
            out_start = max(0, seg_start - overlap)
            out_end = min(T, seg_end + overlap)
            lo = max(0, out_start - overlap)
            hi = min(T + 2 * overlap, out_end + overlap)
            seg = x_padded[:, :, lo:hi].contiguous()
            seg_out = self._forward_seg(seg, scale, (hi - lo, size[-2], size[-1]))
            s0 = (out_start + overlap) - lo
            valid_out = seg_out[:, :, s0 : s0 + (out_end - out_start)]
            n_valid = out_end - out_start
            weight = torch.ones(n_valid, device=x.device, dtype=x.dtype)
            if seg_start > out_start:
                blend = seg_start - out_start
                weight[:blend] = torch.arange(1, blend + 1, device=x.device, dtype=x.dtype) / (blend + 1)
            if out_end > seg_end:
                blend = out_end - seg_end
                weight[-blend:] = torch.arange(blend, 0, -1, device=x.device, dtype=x.dtype) / (blend + 1)
            out_full[:, :, out_start:out_end] += valid_out * weight.view(1, 1, n_valid, 1, 1)
            weight_full[:, :, out_start:out_end] += weight.view(1, 1, n_valid, 1, 1)
            start += chunk
            del seg, seg_out, valid_out
        return out_full / weight_full.clamp(min=1e-8)

    def _run(self, blocks, x, emb):
        queue = comfy.model_prefetch.make_prefetch_queue(list(blocks), x.device, {})
        for b in blocks:
            comfy.model_prefetch.prefetch_queue_pop(queue, x.device, b)
            x = b(x, emb.expand(x.shape[0], -1)) if isinstance(b, ResBlockEmb3D) else b(x)
        comfy.model_prefetch.prefetch_queue_pop(queue, x.device, None)
        return x

    def _forward_seg(self, x, scale, size):
        emb = self.embed(torch.tensor([scale - 1], dtype=x.dtype, device=x.device).unsqueeze(0))
        x = self._run(self.in_blocks, self.conv_in(x), emb)
        x = F.interpolate(x, size=size, mode="trilinear", align_corners=False)
        x = self._run(self.out_blocks, x, emb)
        return self.conv_out(F.silu(self.norm_out(x)))


def upscaler_names():
    return [name for name in folder_paths.get_filename_list("diffusion_models") if re.search(r"(^|[\\/])lup[\\/]", name)]


def load_upscale_model(name):
    path = folder_paths.get_full_path_or_raise("diffusion_models", name)
    state = comfy.utils.load_torch_file(path, safe_load=True)
    if "model" in state:
        state = state["model"]
    if any(key.startswith("upscaler.") for key in state):
        state = {key.removeprefix("upscaler."): value for key, value in state.items() if key.startswith("upscaler.")}
    if "conv_in.weight" not in state or state["conv_in.weight"].ndim != 5:
        raise ValueError("Selecciona un modelo compatible de H3 Latent Upscaler 3D.")
    blocks = [len({int(match[1]) for key in state if (match := re.match(rf"{group}\.(\d+)\.in_layers\.", key))}) for group in ("in_blocks", "out_blocks")]
    temporal = [value.shape[2] for key, value in state.items() if key.endswith("dwconv.weight")]
    device = comfy.model_management.get_torch_device()
    dtype = comfy.model_management.vae_dtype(device, [torch.float16, torch.bfloat16, torch.float32])
    if device.type == "cpu":
        dtype = torch.float32
    with torch.device("meta"):
        model = LatentResizer3D(
            in_channels=state["conv_in.weight"].shape[1], channels=state["conv_in.weight"].shape[0],
            in_blocks=blocks[0], out_blocks=blocks[1], temporal_every=2 if temporal else 0,
            temporal_kernel=temporal[0] if temporal else 5,
        )
    model.load_state_dict(state, strict=True, assign=True)
    model.to(dtype=dtype)
    return comfy.model_patcher.ModelPatcher(model, device, comfy.model_management.unet_offload_device())


def upscale_latent(latent, name, megapixels):
    """Enlarges the video latent to `megapixels` (1 MP = 1024 x 1024) keeping its aspect ratio, 32 pixel grid."""
    source = latent["samples"]
    h, w = source.shape[-2:]
    height = math.sqrt(megapixels * 1024 * 1024 * h / w)
    width = height * w / h
    scale = (width / (w * 16) + height / (h * 16)) / 2
    target_h, target_w = max(1, round(height / 32) * 2), max(1, round(width / 32) * 2)
    if (target_h, target_w) == (h, w):
        return latent
    if scale < 1.0 and (target_h < h or target_w < w):
        raise ValueError("El escalado solo agranda: elige una resolución final mayor que la de la previsualización.")
    patcher = load_upscale_model(name)
    dtype = next(patcher.model.parameters()).dtype
    device = patcher.load_device
    channels = patcher.model.conv_in.out_channels
    frames = min(source.shape[2] if source.ndim == 5 else 1, 52)
    comfy.model_management.load_models_gpu([patcher], memory_required=frames * target_h * target_w * channels * dtype.itemsize * 8)
    try:
        value = source.to(device=device, dtype=dtype)
        if value.ndim == 4:
            value = value.unsqueeze(2)
        mean = value.new_tensor(LATENTS_MEAN).view(1, -1, 1, 1, 1)
        std = value.new_tensor(LATENTS_STD).view(1, -1, 1, 1, 1)
        output = patcher.model((value - mean) / std, scale=scale, target_size=(value.shape[2], target_h, target_w)) * std + mean
        if source.ndim == 4:
            output = output.squeeze(2)
        return {"samples": output.to(device="cpu", dtype=source.dtype)}
    finally:
        comfy.model_management.unload_model_and_clones(patcher, unload_additional_models=False, all_devices=True)


class KubrickH3LatentUpscaler(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="KubrickH3LatentUpscaler",
            display_name="Kubrick · H3 LUp Sampler",
            category="Kubrick Space/video",
            description="Enlarges the audio/video latent of a base pass and refines it with the fixed upscaler sigma schedule.",
            inputs=[
                io.Model.Input("model"),
                io.Noise.Input("noise"),
                io.Latent.Input("denoised_input", display_name="denoised input"),
                io.Conditioning.Input("conditioning"),
                io.Vae.Input("video_vae"),
                io.Vae.Input("audio_vae"),
                io.Combo.Input("upscale_model", options=upscaler_names()),
                io.Float.Input("target_megapixels", default=1.0, min=0.1, max=16.0, step=0.1),
                io.Int.Input("steps", default=4, min=3, max=5, step=1),
            ],
            outputs=[io.Video.Output(), io.Latent.Output("denoised_output")],
        )

    @classmethod
    def validate_inputs(cls, upscale_model, steps):
        return True

    @classmethod
    def execute(cls, model, noise, denoised_input, conditioning, video_vae, audio_vae, upscale_model, target_megapixels=1.0, steps=4):
        steps = min(SIGMA_PRESETS, key=lambda preset: abs(steps - preset))
        sampler = comfy.samplers.sampler_object("euler")
        video_latent, audio_latent = nodes.NODE_CLASS_MAPPINGS["LTXVSeparateAVLatent"].execute(av_latent=denoised_input).result
        upscaled = upscale_latent(video_latent, upscale_model, target_megapixels)
        combined, = nodes.NODE_CLASS_MAPPINGS["LTXVConcatAVLatent"].execute(video_latent=upscaled, audio_latent=audio_latent).result
        sigmas, = nodes.NODE_CLASS_MAPPINGS["ManualSigmas"].execute(sigmas=", ".join(f"{value:.4f}" for value in SIGMA_PRESETS[steps])).result
        guider, = nodes.NODE_CLASS_MAPPINGS["BasicGuider"].execute(model=model, conditioning=conditioning).result
        output, denoised = nodes.NODE_CLASS_MAPPINGS["SamplerCustomAdvanced"].execute(noise=noise, guider=guider, sampler=sampler, sigmas=sigmas, latent_image=combined).result
        images, = nodes.VAEDecode().decode(vae=video_vae, samples=output)
        audio, = nodes.NODE_CLASS_MAPPINGS["VAEDecodeAudio"].execute(samples=output, vae=audio_vae).result
        video, = nodes.NODE_CLASS_MAPPINGS["CreateVideo"].execute(images=images, audio=audio, fps=24.0, bit_depth="auto", color_space="sRGB", codec="none").result
        return io.NodeOutput(video, denoised)
