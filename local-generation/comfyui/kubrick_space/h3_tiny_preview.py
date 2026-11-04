# Flat decoder reconstruction adapted from KJNodes (GPL-3.0) through the author's Skalibur package.
# Changes: native H3 temporal decoder (TAEH3) and execution-scoped model lifetime.
import comfy.model_management
import comfy.utils
import folder_paths
import torch
import torch.nn as nn
from comfy.taesd.taesd import Block, Clamp, conv
from comfy.taesd.taehv import TAEHV


def build_tae_decoder(sd):
    by_index = {}
    for k, v in sd.items():
        head, _, rest = k.partition(".")
        if not head.isdigit():
            raise ValueError(f"not a flat TAE decoder state dict (unexpected key '{k}')")
        by_index.setdefault(int(head), {})[rest] = v

    modules = []
    for i in range(max(by_index) + 1):
        entry = by_index.get(i)
        if entry is None:
            # index 0 is the input Clamp, 2 the ReLU after the input conv, the rest are upsamples
            modules.append(Clamp() if i == 0 else nn.ReLU() if i == 2 else nn.Upsample(scale_factor=2))
        elif "conv.0.weight" in entry:
            w = entry["conv.0.weight"]
            modules.append(Block(w.shape[1], w.shape[0], use_midblock_gn="pool.0.weight" in entry))
        elif "weight" in entry:
            w = entry["weight"]
            modules.append(conv(w.shape[1], w.shape[0], bias="bias" in entry))
        else:
            raise ValueError(f"unrecognized TAE decoder module at index {i}: {sorted(entry)}")
    return nn.Sequential(*modules)


class TinyDecoder:
    def __init__(self, name):
        path = folder_paths.get_full_path_or_raise("vae_approx", name)
        state = comfy.utils.load_torch_file(path, safe_load=True)
        self.temporal = "decoder.22.bias" in state and "decoder.1.weight" in state
        self.device = comfy.model_management.get_torch_device()
        self.dtype = comfy.model_management.vae_dtype(self.device, [torch.float16, torch.bfloat16, torch.float32])
        if self.device.type == "cpu":
            self.dtype = torch.float32
        if self.temporal:
            if state["decoder.1.weight"].shape[1] != 24 or state["decoder.22.bias"].shape[0] != 12:
                raise ValueError("Select an H3-compatible Tiny VAE (24 channels).")
            self.model = TAEHV(latent_channels=24)
            del self.model.encoder
            state = {key: value for key, value in state.items() if key.startswith("decoder.")}
        else:
            for prefix in ("taesd_decoder.", "decoder."):
                if any(key.startswith(prefix) for key in state):
                    state = {key.removeprefix(prefix): value for key, value in state.items() if key.startswith(prefix)}
                    break
            self.model = build_tae_decoder(state)
            if state["1.weight"].shape[1] != 24:
                raise ValueError("Select an H3-compatible Tiny VAE (24 channels).")
        self.model.load_state_dict(state, strict=True)
        self.model.to(device=self.device, dtype=self.dtype)

    def frames(self, video, count):
        if self.temporal:
            decoded = self.model.decode(video[:1].to(device=self.device, dtype=self.dtype))[0].movedim(0, 1)
            total = decoded.shape[0]
            for index in range(min(count, total)):
                position = round(index * (total - 1) / max(1, count - 1))
                yield decoded[position].clamp(0, 1).mul(255).to(device="cpu", dtype=torch.uint8).movedim(0, -1).numpy()
        else:
            pattern = (1, 4, 4, 4, 4)
            timeline = [token for token in range(video.shape[2]) for _ in range(pattern[token % 5])]
            count = min(count, len(timeline))
            last_token, frame = None, None
            for index in range(count):
                token = timeline[round(index * (len(timeline) - 1) / max(1, count - 1))]
                if token != last_token:
                    value = self.model(video[:1, :, token].to(device=self.device, dtype=self.dtype))[0]
                    frame = value.clamp(0, 1).mul(255).to(device="cpu", dtype=torch.uint8).movedim(0, -1).numpy()
                    last_token = token
                yield frame
