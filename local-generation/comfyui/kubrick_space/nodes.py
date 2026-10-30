"""Native ComfyUI generation plus a validated, non-executing tool protocol."""

from comfy_api.latest import ComfyExtension, io
from comfy_extras.nodes_textgen import TextGenerate
from comfy.text_encoders.qwen35 import Qwen35TEModel

from .tool_protocol import build_prompt, dump, parse_response


class KubrickToolGenerate(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="KubrickToolGenerate",
            display_name="Kubrick · Generate Text + Tools",
            category="Kubrick Space/text",
            is_output_node=True,
            description="Qwen3.5 conversation and tool proposals. Kubrick validates and executes tools outside this node.",
            inputs=[
                io.Clip.Input("clip"),
                io.String.Input("prompt", multiline=True, default="", dynamic_prompts=False),
                io.String.Input("system_prompt", multiline=True, default="You are Kubrick Space's creative assistant."),
                io.String.Input("tools_json", multiline=True, default="[]"),
                io.String.Input("messages_json", multiline=True, default="[]"),
                io.Combo.Input("tool_choice", options=["auto", "required", "none"], default="auto"),
                io.Int.Input("max_calls", default=4, min=1, max=8),
                io.Int.Input("max_new_tokens", default=2048, min=1, max=32768),
                io.Float.Input("temperature", default=0.3, min=0.0, max=2.0, step=0.01),
                io.Int.Input("seed", default=0, min=0, max=0xffffffffffffffff),
                io.Boolean.Input("thinking", default=False),
                io.Int.Input("max_context_tokens", default=32768, min=1024, max=32768, optional=True),
                io.String.Input("forced_tool", default="", optional=True, tooltip="Optional declared function name required in this response."),
                io.Image.Input("image", optional=True, tooltip="Batch of up to eight references for the most recent user message; supply the same images on subsequent tool rounds."),
            ],
            outputs=[
                io.String.Output(display_name="status"),
                io.String.Output(display_name="text"),
                io.String.Output(display_name="tool_calls_json"),
                io.String.Output(display_name="assistant_message_json"),
                io.String.Output(display_name="thinking"),
                io.String.Output(display_name="error"),
            ],
        )

    @classmethod
    def execute(cls, clip, prompt, system_prompt, tools_json, messages_json, tool_choice="auto", max_calls=4, max_new_tokens=2048, temperature=0.3, seed=0, thinking=False, image=None, forced_tool="", max_context_tokens=32768):
        if type(max_calls) is not int or not 1 <= max_calls <= 8 or type(max_new_tokens) is not int or not 1 <= max_new_tokens <= 32768:
            raise ValueError("Límites de generación inválidos.")
        if type(temperature) not in (int, float) or not 0 <= temperature <= 2 or type(seed) is not int or not 0 <= seed <= 0xffffffffffffffff or type(thinking) is not bool:
            raise ValueError("Controles de muestreo inválidos.")
        if not isinstance(getattr(clip, "cond_stage_model", None), Qwen35TEModel):
            raise ValueError("KubrickToolGenerate requiere un Qwen3.5 completo cargado por CLIPLoader.")
        image_count = int(image.shape[0]) if image is not None else 0
        rendered, catalog = build_prompt(system_prompt, prompt, tools_json, messages_json, tool_choice, thinking, image_count, max_calls, forced_tool)
        if type(max_context_tokens) is not int or not 1024 <= max_context_tokens <= 32768:
            raise ValueError("Límite de contexto inválido.")
        class BoundedClip:
            truncated = False
            def __getattr__(self, name):
                return getattr(clip, name)

            def tokenize(self, *args, **kwargs):
                tokens = clip.tokenize(*args, **kwargs)
                # Conservative reserve for patch expansion from visual references.
                size = max((sum(len(row) for row in rows) for rows in tokens.values()), default=0)
                if size + max_new_tokens + image_count * 1024 > max_context_tokens:
                    raise ValueError("El contexto supera la capacidad configurada del modelo local. Reduce el contenido o utiliza API.")
                return tokens

            def generate(self, *args, **kwargs):
                generated = clip.generate(*args, **kwargs)
                self.truncated = len(generated) >= max_new_tokens and generated[-1] not in (248044, 248046)
                return generated
        sampling = {"sampling_mode": "off" if temperature == 0 else "on", "temperature": max(0.01, temperature), "top_k": 40, "top_p": 0.95, "min_p": 0.0, "repetition_penalty": 1.05, "seed": seed}
        bounded_clip = BoundedClip()
        generated = TextGenerate.execute(clip=bounded_clip, prompt=rendered, max_length=max_new_tokens, sampling_mode=sampling, image=image, thinking=thinking, use_default_template=False, mtp="auto")
        text, reasoning = generated.args
        if bounded_clip.truncated:
            return cls._output("invalid", text, [], None, reasoning, "La respuesta local agotó el límite de tokens. No se aplicaron acciones.")
        try:
            message = parse_response(text, catalog, tool_choice, max_calls, forced_tool)
        except ValueError as error:
            # No retry and no partial action: consumers must not append this as an assistant message.
            return cls._output("invalid", text, [], None, reasoning, str(error))
        calls = message.get("tool_calls", [])
        return cls._output("tool_calls" if calls else "final", message.get("content") or "", calls, message, reasoning, "")

    @classmethod
    def _output(cls, status, text, calls, message, reasoning, error):
        # Output-node metadata is exposed by ComfyUI /history for headless consumers.
        payload = {"status": status, "text": text, "tool_calls": calls,
                   "assistant_message": message, "thinking": reasoning, "error": error}
        return io.NodeOutput(status, text, dump(calls), dump(message), reasoning, error,
                             ui={"kubrick": [payload]})


class KubrickReferenceImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="KubrickReferenceImage", display_name="Kubrick · Reference Fit",
                         category="Kubrick Space/image", inputs=[io.Image.Input("image")],
                         outputs=[io.Image.Output()])

    @classmethod
    def execute(cls, image):
        # Equal tensor sizes for ImageBatch, preserving every reference without cropping/stretching.
        import torch.nn.functional as functional
        width, height = image.shape[2], image.shape[1]
        ratio = min(768 / width, 768 / height)
        new_width, new_height = max(1, round(width * ratio)), max(1, round(height * ratio))
        pixels = functional.interpolate(image.movedim(-1, 1), size=(new_height, new_width),
                                        mode="bilinear", align_corners=False)
        left, top = (768 - new_width) // 2, (768 - new_height) // 2
        pixels = functional.pad(pixels, (left, 768-new_width-left, top, 768-new_height-top), value=1)
        return io.NodeOutput(pixels.movedim(1, -1))


class KubrickModelControl(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="KubrickModelControl", display_name="Kubrick · Model Residency",
                         category="Kubrick Space/text", is_output_node=True,
                         inputs=[io.Combo.Input("operation", options=["load", "unload"]),
                                 io.String.Input("nonce", default=""), io.Clip.Input("clip", optional=True)],
                         outputs=[io.String.Output(display_name="status")])

    @classmethod
    def execute(cls, operation, nonce="", clip=None):
        import comfy.model_management as management
        if operation == "load":
            if not isinstance(getattr(clip, "cond_stage_model", None), Qwen35TEModel):
                raise ValueError("Se requiere un Qwen3.5 válido.")
            clip.load_model()
            # Dynamic VRAM loading stages weights until the first forward pass.
            # A single private warm-up token populates the GPU cache without a user task.
            TextGenerate.execute(clip=clip, prompt="Ready", max_length=1, sampling_mode={"sampling_mode": "off"}, thinking=False,
                                 use_default_template=True, mtp="off")
        elif operation == "unload":
            management.unload_all_models()
            management.soft_empty_cache()
        else:
            raise ValueError("Control local inválido.")
        return io.NodeOutput(operation, ui={"kubrick_model": [{"ok": True, "operation": operation}]})


class KubrickExtension(ComfyExtension):
    async def get_node_list(self):
        from .flux3_pdd import KubrickFlux3Turbo
        from .h3 import KubrickH3Conditioning, KubrickLoadConditioning, KubrickSaveConditioning
        from .h3_optimization import KubrickH3Optimization
        from .h3_upscale import KubrickH3LatentUpscaler
        return [KubrickToolGenerate, KubrickReferenceImage, KubrickModelControl, KubrickFlux3Turbo,
                KubrickH3Conditioning, KubrickSaveConditioning, KubrickLoadConditioning, KubrickH3Optimization,
                KubrickH3LatentUpscaler]
