"""Memory and speed optimizations for MiniMax H3, ported from the author's Skalibur package.

Skalibur itself adapts the low-memory block/attention layout of KJNodes (GPL-3.0). Differences here: SageAttention is
optional (it falls back to Comfy Kitchen INT8), and the model identity bookkeeping of Skalibur is not needed.
"""

import types

import comfy.model_management as mm
import comfy.ops
import comfy.quant_ops
import torch
from comfy.ldm.minimax.model import _mod_gate, _mod_scale_shift
from comfy.ldm.modules.attention import AttentionTensorContainer, get_attention_function, optimized_attention
from comfy.patcher_extension import CallbacksMP
from comfy_api.latest import io
from comfy_extras.nodes_minimax_h3 import MiniMaxH3SigmaShift
from comfy_extras.nodes_sparse_attention import apply_block_sparse_attention, parse_block_list

FEEDFORWARD_MIN_TOKENS = 4096


def memory_efficient_attention(dense_attention, container_attention):
    def attention(*args, **kwargs):
        return dense_attention(*args, **kwargs)

    attention.container_function = container_attention
    return attention


def attention_forward(self, x, rope_freqs=None, transformer_options={}):
    if isinstance(x, list):
        x = x.pop()
    s = x.shape[0]
    device = x.device
    dtype = x.dtype
    q, k, v = self.qkv_proj(x).split(self.heads * self.head_dim, dim=-1)
    del x
    v = v.view(s, self.heads, self.head_dim)
    if rope_freqs is not None:
        q = q.view(1, s, self.heads, self.head_dim)
        k = k.view(1, s, self.heads, self.head_dim)
        qw = mm.cast_to(self.q_norm.weight, device=device)
        kw = mm.cast_to(self.k_norm.weight, device=device)
        rot = rope_freqs.shape[-3] * 2
        if mm.in_training:
            q, k = comfy.quant_ops.ck.rms_rope_split_half(q, k, rope_freqs, qw, kw, epsilon=self.q_norm.eps, rot_dim=rot)
        else:
            comfy.quant_ops.ck.rms_rope_split_half_(q, k, rope_freqs, qw, kw, epsilon=self.q_norm.eps, rot_dim=rot)
        q = q[0]
        k = k[0]
    else:
        q = self.q_norm(q.view(s, self.heads, self.head_dim))
        k = self.k_norm(k.view(s, self.heads, self.head_dim))
    q = q.transpose(0, 1).unsqueeze(0)
    k = k.transpose(0, 1).unsqueeze(0)
    v = v.transpose(0, 1).unsqueeze(0)
    n = min(transformer_options.get("minimax_head_chunks", 1), self.heads) if isinstance(transformer_options, dict) else 1
    if n <= 1:
        q, k, v = AttentionTensorContainer(q), AttentionTensorContainer(k), AttentionTensorContainer(v)
        out = optimized_attention(
            q, k, v, self.heads, preferred_attention=self.comfy_attention, mask=None, skip_reshape=True,
            transformer_options=transformer_options,
        ).squeeze(0)
    else:
        out = torch.empty((s, self.heads * self.head_dim), dtype=dtype, device=device)
        hs = 0
        for size in [self.heads // n + (1 if i < self.heads % n else 0) for i in range(n)]:
            he = hs + size
            inputs = (
                AttentionTensorContainer(q[:, hs:he]),
                AttentionTensorContainer(k[:, hs:he]),
                AttentionTensorContainer(v[:, hs:he]),
            )
            if he == self.heads:
                del q, k, v
            o = optimized_attention(
                *inputs, size, preferred_attention=self.comfy_attention, mask=None, skip_reshape=True,
                transformer_options=transformer_options,
            )
            out[:, hs * self.head_dim : he * self.head_dim] = o.squeeze(0)
            hs = he
    return self.out_proj(out)


def block_forward(self, x, t_emb, mod_segments, rope_freqs, transformer_options={}, attention=None):
    shift_msa, scale_msa, gate_msa, shift_mlp, scale_mlp, gate_mlp = self.adaln_proj(t_emb)
    h = _mod_scale_shift(self.norm1(x), shift_msa, scale_msa, mod_segments)
    if attention is None:
        attention = self.attn
        h = [h]
    x = _mod_gate(x, gate_msa, attention(h, rope_freqs=rope_freqs, transformer_options=transformer_options), mod_segments)
    h = _mod_scale_shift(self.norm2(x), shift_mlp, scale_mlp, mod_segments)
    return _mod_gate(x, gate_mlp, self.mlp(h), mod_segments)


def chunk_mlp(module, x, chunks):
    if x.shape[0] <= FEEDFORWARD_MIN_TOKENS or chunks <= 1:
        return comfy.ops.linear_input_act(module.fc2, module.fc1(x), "swiglu")
    out = torch.empty_like(x)
    offset = 0
    for part in torch.chunk(x, chunks, dim=0):
        out[offset : offset + part.shape[0]] = comfy.ops.linear_input_act(module.fc2, module.fc1(part), "swiglu")
        offset += part.shape[0]
    return out


class KubrickH3Optimization(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="KubrickH3Optimization",
            display_name="Kubrick · H3 Optimization",
            category="Kubrick Space/video",
            description="Memory and speed optimizations for MiniMax H3 (ported from Skalibur).",
            inputs=[
                io.Model.Input("model"),
                io.Boolean.Input("optimized_attention", default=True),
                io.Boolean.Input("low_vram", default=True, display_name="Split attention"),
                io.Boolean.Input("feedforward", default=True, display_name="Chunk feedforward"),
                io.Boolean.Input("fp16_accumulation", default=True),
                io.Boolean.Input("sparse_attention", default=False),
                io.Int.Input("low_vram_chunks", default=56, min=1, max=56, step=1),
                io.Int.Input("feedforward_chunks", default=4, min=1, max=64, step=1),
                io.Float.Input("shift_video", default=12.0, min=0.0, max=1000.0, step=0.1),
                io.Float.Input("shift_audio", default=3.0, min=0.0, max=1000.0, step=0.1),
            ],
            outputs=[io.Model.Output()],
        )

    @classmethod
    def execute(
        cls, model, optimized_attention=True, low_vram=True, feedforward=True, fp16_accumulation=True,
        sparse_attention=False, low_vram_chunks=56, feedforward_chunks=4, shift_video=12.0, shift_audio=3.0,
    ):
        patched = model.clone()
        if optimized_attention:
            name = "comfy_kitchen_int8" if model.load_device.type == "cuda" else "pytorch"
            backend = get_attention_function(name, None) or get_attention_function("pytorch")
            patched.set_model_optimized_attention(backend)
        patched, = MiniMaxH3SigmaShift.execute(model=patched, shift_video=shift_video, shift_audio=shift_audio).result
        if optimized_attention:
            # SageAttention handles the dense calls when it is installed; Comfy Kitchen INT8 handles the containers.
            dense = backend
            if model.load_device.type == "cuda" and torch.version.hip is None:
                dense = get_attention_function("sage", None) or backend
                patched.set_model_optimized_attention(dense)
            patched.set_model_optimized_attention(memory_efficient_attention(dense, backend))
        diffusion = patched.get_model_object("diffusion_model")
        if optimized_attention:
            for index, block in enumerate(diffusion.blocks):
                patched.add_object_patch(f"diffusion_model.blocks.{index}.attn.forward", types.MethodType(attention_forward, block.attn))
        if low_vram:
            patched.model_options["transformer_options"]["minimax_head_chunks"] = low_vram_chunks
            for index, block in enumerate(diffusion.blocks):
                patched.add_object_patch(f"diffusion_model.blocks.{index}.forward", types.MethodType(block_forward, block))
                path = f"diffusion_model.blocks.{index}.attn.forward"
                if path not in patched.object_patches:
                    patched.add_object_patch(path, types.MethodType(attention_forward, block.attn))
        if fp16_accumulation:
            state = {}

            def start(patcher):
                state["previous"] = torch.backends.cuda.matmul.allow_fp16_accumulation
                torch.backends.cuda.matmul.allow_fp16_accumulation = True

            def cleanup(patcher):
                previous = state.pop("previous", None)
                if previous is not None:
                    torch.backends.cuda.matmul.allow_fp16_accumulation = previous

            for key_type in (CallbacksMP.ON_PRE_RUN, CallbacksMP.ON_CLEANUP):
                patched.remove_callbacks_with_key(key_type, "kubrick_fp16_accumulation")
            patched.add_callback_with_key(CallbacksMP.ON_PRE_RUN, "kubrick_fp16_accumulation", start)
            patched.add_callback_with_key(CallbacksMP.ON_CLEANUP, "kubrick_fp16_accumulation", cleanup)
        if sparse_attention:
            patched = apply_block_sparse_attention(
                patched, tau=1.3, topk_ratio=0.0, vsa=False, start_percent=0.0, end_percent=1.0, min_tokens=12288,
                dense_blocks=parse_block_list("33-35,39-42"), sink_conditioning="exact_kv_and_rows", extra_tokens=256,
                verbose=False,
            )
        if feedforward and feedforward_chunks > 1:
            for index, block in enumerate(diffusion.blocks):
                def mlp_forward(module, x):
                    return chunk_mlp(module, x, feedforward_chunks)

                patched.add_object_patch(f"diffusion_model.blocks.{index}.mlp.forward", types.MethodType(mlp_forward, block.mlp))
        return io.NodeOutput(patched)
