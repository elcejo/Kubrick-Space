# Local generation engine

Kubrick Space drives a pinned copy of [ComfyUI](https://github.com/Comfy-Org/ComfyUI) 0.43.0 on `127.0.0.1:8189` for local text, vision, image and video generation.
The engine itself is **not** part of this repository: `scripts/install-engine.ps1` downloads it (verifying the SHA-256 in `source.json`), creates `.venv/` and installs the packages.

* `source.json` — exact ComfyUI version, commit, archive digest and PyTorch index.
* `requirements-engine.txt` — Python packages installed after PyTorch.
* `models.json` — local text/vision model profiles (Qwen3.5 4B and 9B).
* `extra-model-paths.yaml` — maps the `models/` folders of this project into ComfyUI without copying any weights.
* `kubrick_space/` — the custom nodes Kubrick adds to the engine (the launcher copies them to `data/custom_nodes`, and only this package is allowed to load):
  text with tool proposals, FLUX 3 Klein Turbo sampling, and MiniMax H3 conditioning (named references, saved to a file), optimization and latent upscaling.

The engine starts on demand from `scripts/start-comfyui.ps1`. It listens on localhost only, loads no other custom nodes and runs offline.
