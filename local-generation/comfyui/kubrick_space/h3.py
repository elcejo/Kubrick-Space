"""MiniMax H3 conditioning with named references, saved to disk and reloaded per video.

The reference labelling (`<Picture 1> / <Name>`) and the saved-conditioning idea come from the author's
Skalibur package; only what Kubrick needs is ported (image references, no video or audio references).
"""

import math
import os
import re
import uuid

import torch
import folder_paths
from comfy_api.latest import io
from comfy_extras import nodes_minimax_h3 as h3

VISION_START = 151652
VISION_END = 151653
MAX_REFERENCES = 4
NAME = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
CANVAS = h3.CANVAS_MULTIPLE if hasattr(h3, "CANVAS_MULTIPLE") else 32
# References are encoded independently of the generation size (as in Skalibur): at most 1 MP (1024 x 1024 pixels).
REFERENCE_PIXELS = 1024 * 1024


def normalize_tag(value):
    if not isinstance(value, str):
        raise ValueError("La etiqueta debe ser texto.")
    return " ".join(value.replace("<", "").replace(">", "").split())[:60]


def reference_label(label, tag):
    tag = normalize_tag(tag)
    return f"{label} / <{tag}>" if tag and f"<{tag}>" != label else label


def tokenize(clip, text, references):
    """Native H3 layout; every image reference is introduced as `<Picture N> / <Name>: `."""
    words = clip.tokenizer.qwen3vl_32b
    entries = []

    def add_text(segment):
        if not segment:
            return
        batches = words.tokenize_with_weights(segment, return_word_ids=False, disable_weights=True)
        if len(batches) != 1:
            raise ValueError("El prompt de H3 supera la longitud admitida.")
        entries.extend(batches[0])

    for number, item in enumerate(references, 1):
        add_text(reference_label(f"<Picture {number}>", item["tag"]) + ": ")
        embed = {"type": "image", "data": item["data"], "original_type": "image"}
        entries.extend(((VISION_START, 1.0), (embed, 1.0), (VISION_END, 1.0)))
    add_text(text)
    if not entries:
        entries.append((151643, 1.0))
    return {"qwen3vl_32b": [entries]}


def reference_size(width, height):
    return max(CANVAS, math.ceil(width / CANVAS) * CANVAS), max(CANVAS, math.ceil(height / CANVAS) * CANVAS)


def cpu(value):
    if isinstance(value, torch.Tensor):
        return value.detach().to("cpu")
    if isinstance(value, dict):
        return {key: cpu(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return type(value)(cpu(item) for item in value) if not hasattr(value, "_fields") else value
    return value


def conditioning_path(name):
    if not isinstance(name, str) or not NAME.match(name):
        raise ValueError("Nombre de conditioning inválido.")
    directory = os.path.join(folder_paths.get_output_directory(), "kubrick-conditioning")
    os.makedirs(directory, exist_ok=True)
    return os.path.join(directory, name + ".pt")


class KubrickH3Conditioning(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="KubrickH3Conditioning",
            display_name="Kubrick · H3 Conditioning",
            category="Kubrick Space/video",
            description="Prompt and named image references for MiniMax H3. The prompt cites each reference as <Name>.",
            inputs=[
                io.Clip.Input("clip"),
                io.String.Input("prompt", multiline=True, dynamic_prompts=False),
                io.Vae.Input("vae", optional=True, display_name="VAE Video"),
                io.String.Input("tags_json", default="[]", tooltip="JSON list with one name per reference image, in order."),
                io.Autogrow.Input(
                    "ref_images",
                    optional=True,
                    template=io.Autogrow.TemplatePrefix(
                        input=io.Image.Input("ref_image"), prefix="ref_image_", min=0, max=MAX_REFERENCES
                    ),
                ),
            ],
            outputs=[io.Conditioning.Output(display_name="positive")],
        )

    @classmethod
    def execute(cls, clip, prompt, tags_json="[]", vae=None, ref_images=None):
        import json

        tags = json.loads(tags_json)
        images = [image for _, image in sorted((ref_images or {}).items(), key=lambda pair: int(pair[0].rsplit("_", 1)[-1])) if image is not None]
        if not isinstance(tags, list) or len(tags) != len(images) or not all(isinstance(tag, str) for tag in tags):
            raise ValueError("Cada imagen de referencia necesita su nombre.")
        if len({normalize_tag(tag) for tag in tags}) != len(tags) or not all(normalize_tag(tag) for tag in tags):
            raise ValueError("Los nombres de las referencias deben ser únicos y no estar vacíos.")
        items, blocks = [], []
        for tag, image in zip(tags, images):
            ih, iw = image.shape[1], image.shape[2]
            scale = min(1.0, math.sqrt(REFERENCE_PIXELS / (iw * ih)))
            tw, th = reference_size(round(iw * scale), round(ih * scale))
            resized = h3._resize(image[:1], tw, th, "disabled")
            items.append({"data": resized, "tag": tag})
            if vae is not None:
                blocks.append({"kind": "image", "latent_h": th // 16, "latent_w": tw // 16, "latent": vae.encode(resized)})
        conditioning = clip.encode_from_tokens_scheduled(tokenize(clip, prompt, items))
        if blocks:
            import node_helpers

            conditioning = node_helpers.conditioning_set_values(conditioning, {"minimax_refs": blocks})
        return io.NodeOutput(conditioning)


class KubrickSaveConditioning(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="KubrickSaveConditioning",
            display_name="Kubrick · Save Conditioning",
            category="Kubrick Space/video",
            is_output_node=True,
            inputs=[io.Conditioning.Input("conditioning"), io.String.Input("name", default="")],
            outputs=[],
        )

    @classmethod
    def execute(cls, conditioning, name):
        path = conditioning_path(name)
        temporary = f"{path}.{uuid.uuid4().hex}.partial"
        try:
            torch.save(cpu(conditioning), temporary)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.remove(temporary)
        return io.NodeOutput(ui={"kubrick_conditioning": [{"name": name, "bytes": os.path.getsize(path)}]})


class KubrickLoadConditioning(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="KubrickLoadConditioning",
            display_name="Kubrick · Load Conditioning",
            category="Kubrick Space/video",
            inputs=[io.String.Input("name", default="")],
            outputs=[io.Conditioning.Output(display_name="positive")],
        )

    @classmethod
    def fingerprint_inputs(cls, name):
        path = conditioning_path(name)
        return os.path.getmtime(path) if os.path.exists(path) else float("nan")

    @classmethod
    def execute(cls, name):
        path = conditioning_path(name)
        if not os.path.exists(path):
            raise ValueError("El conditioning guardado ya no existe; genera el conditioning de la escena otra vez.")
        value = torch.load(path, map_location="cpu", weights_only=True)
        if not isinstance(value, list) or not value:
            raise ValueError("El conditioning guardado está dañado.")
        return io.NodeOutput(value)
