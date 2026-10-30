# Models folder

Kubrick Space reads AI model weights from this folder. **No weights are included in the repository**: download them
and save them with exactly the names below (the folder names contain spaces and must be kept as written).
The full table with sources, licenses and SHA-256 digests is in the "Models" section of the main README.

```
models/
├── llm/
│   ├── Qwen 3.5 4B/model.safetensors               (default local text/vision model)
│   └── Qwen 3.5 9B/model.safetensors               (optional)
├── image/flux3 klein/
│   ├── model.safetensors
│   ├── text encoder/qwen3vl_4b_int8_convrot.safetensors
│   ├── vae/model.safetensors
│   └── lora/turbo.safetensors
└── video/h3/
    ├── model.safetensors
    ├── lora/turbo.safetensors
    ├── text encoder/model.safetensors
    ├── vae/video vae.safetensors
    ├── vae/audio vae.safetensors
    └── lup/model.safetensors
```
