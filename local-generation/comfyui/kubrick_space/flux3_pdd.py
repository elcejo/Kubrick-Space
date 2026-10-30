"""Kubrick's fixed FLUX3 Turbo PDD recipe; upstream engine stays unchanged."""
import json
import torch
import torch.nn.functional as functional
import comfy.sd
import comfy.utils
import comfy.model_base
import folder_paths
from comfy_api.latest import io
from .pdd_math import prepare_eight_steps


class JumpProjection(torch.nn.Module):
    def __init__(self, weights):
        super().__init__()
        self.weights_cpu = weights.cpu()
        self.selected = 0
        self.cached = None

    def forward(self, pixels):
        if self.cached is None or self.cached.device != pixels.device or self.cached.dtype != pixels.dtype:
            self.cached = self.weights_cpu.to(device=pixels.device, dtype=pixels.dtype)
        return functional.linear(pixels, self.cached[self.selected])


class KubrickFlux3Turbo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="KubrickFlux3Turbo", display_name="Kubrick · FLUX3 Turbo PDD · 8 steps",
                         category="Kubrick Space/image", inputs=[io.Model.Input("model")],
                         outputs=[io.Model.Output(), io.Sigmas.Output()])

    @classmethod
    def execute(cls, model):
        if not isinstance(model.model, comfy.model_base.Flux3) or model.model.diffusion_model.flow_map:
            raise ValueError("Turbo PDD requiere FLUX 3 Image Klein Base.")
        filename = folder_paths.get_full_path_or_raise("loras", "turbo.safetensors")
        state, metadata = comfy.utils.load_torch_file(filename, safe_load=True, return_metadata=True)
        if "pdd.heads" not in state or not metadata or "pdd_config" not in metadata:
            raise ValueError("Faltan los cabezales o la configuración del Turbo PDD instalado.")
        fused, sigmas = prepare_eight_steps(json.loads(metadata["pdd_config"]), state.pop("pdd.heads"))
        target = "diffusion_model.final_layer.image.linear"
        if tuple(model.get_model_object(target).weight.shape) != tuple(fused.shape[1:]):
            raise ValueError("El cabezal Turbo PDD no coincide con el modelo base.")
        patched, _ = comfy.sd.load_lora_for_models(model, None, state, 1.0, 0.0)
        if len(patched.patches) <= len(model.patches):
            raise ValueError("No se aplicaron los pesos del Turbo LoRA.")
        projection = JumpProjection(fused)
        patched.add_object_patch(target, projection)
        previous = patched.model_options.get("model_function_wrapper")
        starts = sigmas[:-1]

        def select_projection(apply, arguments):
            sigma = float(arguments["timestep"].flatten()[0])
            projection.selected = int(torch.argmin(torch.abs(starts - sigma)))
            if previous is not None:
                return previous(apply, arguments)
            return apply(arguments["input"], arguments["timestep"], **arguments["c"])

        patched.set_model_unet_function_wrapper(select_projection)
        return io.NodeOutput(patched, sigmas)
