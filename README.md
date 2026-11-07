# Kubrick Space

> A local, AI-assisted studio to write stories and screenplays, design characters and places, and turn a script into a film, scene by scene.

Kubrick Space runs on your computer (a Node.js server on `127.0.0.1`, a browser interface, and an optional local generation engine).
Your projects stay in a folder on your disk. Text, image and video generation can run **fully locally** or through an API, and you choose per project.
The interface is currently in Spanish.

---

## Installation guide

### Requirements

| What | Notes |
|---|---|
| Windows 10 or 11 | The launchers are PowerShell scripts. The web app is plain Node.js, but the local engine installer and launchers are Windows-only for now. |
| [Node.js 24 LTS](https://nodejs.org) | Required (`engines` in `package.json`). |
| [Git](https://git-scm.com) | To clone the repository. |
| [Python 3.12](https://www.python.org/downloads/) | Only for the local generation engine. Must be 3.12 (the installer looks for it). |
| NVIDIA GPU with a current driver | Only for local generation. Developed and tested on an RTX 3060 (12 GB) with 32 GB of RAM. The PyTorch build is CUDA 13 (`cu130`). |
| Disk space | About 59 GB for the model files (68 GB with the optional 9B model), plus about 10 GB for the engine and its Python environment. |
| An [OpenRouter](https://openrouter.ai) API key | Optional. Only if you want cloud text models. Entered in the app, never stored in the repository. |

You can use the app with an API key only and skip steps 3 and 4: the engine and the models are needed just for **Local** mode.

### 1. Get the code

```powershell
git clone https://github.com/elcejo/Kubrick-Space.git
cd Kubrick-Space
```

### 2. Install the Node.js dependencies

```powershell
npm install
```

### 3. Install the local generation engine (Local mode)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-engine.ps1
```

This downloads **ComfyUI 0.43.0** (GPL-3.0) from the exact commit pinned in `local-generation/comfyui/source.json`, verifies its SHA-256,
creates a Python 3.12 virtual environment in `local-generation/comfyui/.venv`, and installs PyTorch (CUDA 13) and the engine's packages.
It downloads several gigabytes and does **not** download any model. Add `-PythonPath C:\path\to\python.exe` if Python 3.12 is not found automatically.

### 4. Download the models (Local mode)

Model weights are not included in this repository. Download each file from its source and save it **with the exact name and in the exact folder** shown below.
Folder names contain spaces and must be kept as written. The table lists the SHA-256 of the files the project was developed with; if yours differs, the file is a different build and may not work.

| Role | Save it as (relative to the project folder) | Original file name | Where to get it | License | Size | SHA-256 of the file used |
|---|---|---|---|---|---|---|
| Text and vision LLM (default, Local mode) | `models/llm/Qwen 3.5 4B/model.safetensors` | `Qwen3.5-4B_int8_convrot.safetensors` | [beycanai/Qwen-LM](https://huggingface.co/beycanai/Qwen-LM) | Apache-2.0 | 4.82 GB | `f5c9a4e45fbd4b20956b830456e781804821e2b04500b598ce3473fd0aca43a9` |
| Text and vision LLM (optional, larger) | `models/llm/Qwen 3.5 9B/model.safetensors` | `Qwen3.5-9B_int8_convrot.safetensors` | [beycanai/Qwen-LM](https://huggingface.co/beycanai/Qwen-LM) | Apache-2.0 | 9.96 GB | `82223af1de7410466cd0383f25b42251ab58723371b8bffdc781bd10d59777f5` |
| Image generation: base model (FLUX 3 Klein) | `models/image/flux3 klein/model.safetensors` | `flux3-image-klein-base-int8-convrot.safetensors` in `diffusion_models/` | [black-forest-labs/flux-3-image-klein-comfy](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy) (gated: accept the terms first) | FLUX Kommunity License (`flux-kommunity-license`) | 5.81 GB | `8949ecfc1bf3871b08be02cf43ec7276a4914e1a86eade6b5eb8f4204426bc92` |
| Image generation: text encoder | `models/image/flux3 klein/text encoder/qwen3vl_4b_int8_convrot.safetensors` | `qwen3vl_4b_int8_convrot.safetensors` in `text_encoders/` | [black-forest-labs/flux-3-image-klein-comfy](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy) (gated: accept the terms first) | FLUX Kommunity License (`flux-kommunity-license`); the encoder is derived from Qwen3-VL (Apache-2.0) | 4.86 GB | `32de113cbf8282b02cbff0794b637b9d6676da09314a1db5a30bcea9bf4ee01c` |
| Image generation: VAE | `models/image/flux3 klein/vae/model.safetensors` | `flux2-vae.safetensors` in `split_files/vae/` | [Comfy-Org/flux2-dev](https://huggingface.co/Comfy-Org/flux2-dev) | As declared by that repository: `flux-1-dev-non-commercial-license` | 0.34 GB | `d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5` |
| Image generation: Turbo LoRA (8 steps) | `models/image/flux3 klein/lora/turbo.safetensors` | `Flux-3-Klein-turbo-pdd-4_8-steps-comfy.safetensors` | [NoiseToNova/Flux-3-Klein-turbo-pdd-4_8-steps](https://huggingface.co/NoiseToNova/Flux-3-Klein-turbo-pdd-4_8-steps/blob/main/Flux-3-Klein-turbo-pdd-4_8-steps-comfy.safetensors) | FLUX Kommunity License (`flux-kommunity-license`) | 0.70 GB | `430b58fdda438f49976cb66368c56a8cde4f58b45f792f0825f678c5983d85a0` |
| Video: MiniMax H3 base model (INT8 ConvRot, pruned) | `models/video/h3/model.safetensors` | `10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors` | [TenStrip/10Eros-Max](https://huggingface.co/TenStrip/10Eros-Max) (see the note below the table) | MiniMax H3 Community License, plus the notes on the model card | 20.97 GB | `4dd965496e5b1b83cd13c65cbe7a535b8a4d94ae768a7646b4e336d52c4781cf` |
| Video: Turbo LoRA (3 steps, TaoMate MAXQUALITY bf16) | `models/video/h3/lora/turbo.safetensors` | `taomate_h3_3step_MAXQUALITY_bf16.safetensors` | [Asirus/TaoMate_H3_3_Step_LoRA](https://huggingface.co/Asirus/TaoMate_H3_3_Step_LoRA) (gated: accept the terms first) | MiniMax H3 Community License | 1.24 GB | `1e87ff8a61a794d96ab995949bf0bf1b9914b41eb1b6fdb0700bf8d260c6d00a` |
| Video: text encoder (Qwen3-VL 32B) | `models/video/h3/text encoder/model.safetensors` | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` in `text_encoders/` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) | MiniMax H3 Community License | 15.69 GB | `35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6` |
| Video: video VAE | `models/video/h3/vae/video vae.safetensors` | `minimax_h3_video_vae_int8_convrot.safetensors` in `vae/` | [FastVideo/FastVideo-FastH3-Comfy](https://huggingface.co/FastVideo/FastVideo-FastH3-Comfy) | MiniMax H3 Community License | 2.81 GB | `52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e` |
| Video: audio VAE | `models/video/h3/vae/audio vae.safetensors` | `minimax_h3_audio_vae_fp32.safetensors` in `vae/` | [FastVideo/FastVideo-FastH3-Comfy](https://huggingface.co/FastVideo/FastVideo-FastH3-Comfy) | MiniMax H3 Community License | 0.61 GB | `8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48` |
| Video: latent upscaler (for the upcoming 1 MP stage) | `models/video/h3/lup/model.safetensors` | `minimax_h3_latent_upscaler_3d_conv_v1_fp16.safetensors` in `minimax_h3_latent_upscaler_3d_conv_v1/` | [LBH-123-AI/Minimax_h3_latent_Upscaler](https://huggingface.co/LBH-123-AI/Minimax_h3_latent_Upscaler) | Apache-2.0 | 0.69 GB | `043e5a48e161610ef6c3ea974645220354d06fa618abca15f76d084812eb55c2` |

Resulting folder layout:

```
Kubrick-Space/
└── models/
    ├── llm/
    │   ├── Qwen 3.5 4B/model.safetensors
    │   └── Qwen 3.5 9B/model.safetensors                      (optional)
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

Which files do I need?

* **Local text and vision** (chat assistant, character and scenario design, screenplay tools): `Qwen 3.5 4B` (the 9B model is optional and larger).
* **Local images** (covers, portraits, outfits, scenarios): the four files in `image/flux3 klein`.
* **Local film previews**: everything in `video/h3`. The `lup` model is only needed for the upscaling stage that is still being built.

**About the video base model.** The project is developed and tested with **10Eros-Max beta5** (`10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors`), a community fine-tune of MiniMax H3
by TenStrip, in INT8 ConvRot form. It is used because it gave the best visual quality in the author's tests with the 3-step TaoMate LoRA. The model is general purpose:
its name and part of its training relate to adult content, but Kubrick Space does not require, promote or ship any such content, and nothing in this repository depends on it.
Other MiniMax H3 INT8 ConvRot builds may work in the same file name and folder, but they have not been tested here. Read the model card and its license before using it.

All of the files above were checked against the hosts: the SHA-256 digests of the TenStrip checkpoint, the H3 text encoder, both H3 VAEs, the Turbo LoRA for FLUX 3 Klein and the Qwen 3.5 models
match the digests published by the hosting repositories; the other files match the published size to the byte (the host does not display their digest).

**Model licenses are not those of this project.** Read each license before downloading or using a model. In particular, the MiniMax H3 community license
has attribution and revenue conditions, and its territory has been reported to exclude the United States, the European Union, the United Kingdom and South Korea
(check the license text on the model page; some of these files are also gated and require accepting terms on Hugging Face).
Some models cannot be used commercially. Kubrick Space does not grant you any rights to them.

### 5. Start

```powershell
.\start-kubrick-space.ps1
```

(or `npm start`). Open <http://127.0.0.1:3001>. The local engine starts by itself the first time a local generation is requested; the first request is slow because the models load.

### 6. Configure

* **Home → Configuración** (Settings): enter API keys if you want cloud models, and review the read-only system prompts.
* In each workspace’s lower-left model bar, choose **API** or **Local**, then select the text, image and (for films) video models. Selections are saved per asset. The play/stop control loads or unloads the local language model.
* Your data lives in `projects/` and `api_keys.json` inside the project folder (both are ignored by Git). Set `KUBRICK_SPACE_DATA_DIR` to keep them elsewhere.

### Troubleshooting

* *"Faltan los pesos locales…"* — a model file is missing or misnamed. Compare it with the layout above.
* *Local generation fails with out-of-memory errors* — close other GPU applications. The H3 video model streams from disk and needs plenty of RAM and VRAM; a 12 GB GPU is about the minimum.
* *The engine does not start* — run `powershell -File scripts\start-comfyui.ps1` and read the logs written to `.system_generated/reports`.

---

## What it does

* **Home and profile** — direct creation shortcuts, an asset library and project folders. The community galleries are interface previews; sign-in and online publishing are not implemented.
* **Story Book** — chapters, topics, paragraphs, timeline, versions and visual reordering. Drag a paragraph, topic or chapter into the assistant to scope the next edit.
* **Screenplay** — scenes containing shots, action, dialogues, parentheticals and voices. Links to character/place ingredients, shot framing, camera movement, duration and DOCX export. A white SCREENPLAY cover is generated automatically.
* **Characters** — creation from a description or photograph, photo gallery, narrative sheet and an outfit library of traits, clothing and props, with reusable pieces and independent trash. Options/ingredients creation remain marked Coming soon.
* **Scenarios** — a place sheet with panorama, camera angles and recoverable images.
* **Film** — one video clip per screenplay shot, grouped by scene. Custom cinema player, per-scene camera/lens/aperture/palette controls, previews and final-video workflow. Shot duration, framing and movement are inherited from a linked screenplay. Preview resolution: 0.1–0.6 MP; final: 0.5–2 MP. Final assembly and soundtrack generation are not yet implemented.
* **Ingredients and versions** — link assets using saved versions, detect updates, autosave drafts and manage recoverable trash.
* **Assistant** — structured, iterative edits of the open asset, progress reporting and saved chats scoped to assets or shared with a project folder.
* **Inference** — local ComfyUI models or connected API providers, selected per asset; no silent fallback from local to cloud. Supported local files and optional text models are listed in `local-generation/comfyui/models.json`.
* **Background jobs** — generations run on the server with progress, cancellation and a persistent task history. No model weights, keys, assets or chats are bundled.

## About security scanners

Automated scanners can flag this project because it legitimately does things that look suspicious out of context: it launches a local ComfyUI process and PowerShell setup scripts (`scripts/`, `start-kubrick-space.ps1`), downloads model weights and the engine from pinned URLs with checksum verification, decodes base64 images to send them to the local engine, and keeps your own API keys in a local file that never leaves your machine (`server/modules/security/api-key-vault.cjs`). It contains no wallet access, no telemetry and no hidden network calls; every host it can contact is listed by the scanners themselves (OpenRouter, Replicate, Google, OpenAI, Hugging Face, GitHub). Please read the code, and open an issue if something looks wrong.

## License

Kubrick Space is released under the [MIT License](LICENSE), with one exception: `local-generation/comfyui/kubrick_space/h3_optimization.py` is derived from KJNodes and stays under the GPL-3.0.
Third-party software, its licenses, and the code adapted from other projects are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); the license texts are in [licenses/](licenses/).
AI model weights are **not** covered by this license (see the Models table above).
