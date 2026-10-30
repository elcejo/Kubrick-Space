# Third-party software and licenses

Kubrick Space itself is released under the [MIT License](LICENSE) (one file is the exception, see section 5).
It uses the software below. Nothing in this section is the work of the Kubrick Space author unless stated.

Summary of what this repository redistributes and what it only references:

| Category | Redistributed in this repository? |
|---|---|
| Node.js packages (section 1) | No. Installed by `npm install`. License texts are kept in `licenses/node/`. |
| Browser libraries in `public/vendor` (section 2) | **Yes** (d3 and face-api.js). |
| Fonts (section 3) | Unica One is included; the others are loaded from Google Fonts at run time. |
| ComfyUI and Python packages (section 4) | No. Downloaded and installed by `scripts/install-engine.ps1`. |
| Code adapted from other projects (section 5) | **Yes**, inside `local-generation/comfyui/kubrick_space`. |
| AI model weights (section 6) | **No.** The user downloads them; see the Models section of the README. |

## 1. Runtime Node.js packages (86)

Direct dependencies: `express` (MIT), `sanitize-html` (MIT), `dompurify` (MPL-2.0 OR Apache-2.0; used under Apache-2.0).
The complete tree of production dependencies, with the license declared by each package:

| Package | Version | License | License text |
|---|---|---|---|
| @types/trusted-types | 2.0.7 | MIT | [types_trusted-types@2.0.7.txt](licenses/node/types_trusted-types@2.0.7.txt) |
| accepts | 1.3.8 | MIT | [accepts@1.3.8.txt](licenses/node/accepts@1.3.8.txt) |
| array-flatten | 1.1.1 | MIT | [array-flatten@1.1.1.txt](licenses/node/array-flatten@1.1.1.txt) |
| body-parser | 1.20.9 | MIT | [body-parser@1.20.9.txt](licenses/node/body-parser@1.20.9.txt) |
| bytes | 3.1.2 | MIT | [bytes@3.1.2.txt](licenses/node/bytes@3.1.2.txt) |
| call-bind-apply-helpers | 1.0.2 | MIT | [call-bind-apply-helpers@1.0.2.txt](licenses/node/call-bind-apply-helpers@1.0.2.txt) |
| call-bound | 1.0.4 | MIT | [call-bound@1.0.4.txt](licenses/node/call-bound@1.0.4.txt) |
| content-disposition | 0.5.4 | MIT | [content-disposition@0.5.4.txt](licenses/node/content-disposition@0.5.4.txt) |
| content-type | 1.0.5 | MIT | [content-type@1.0.5.txt](licenses/node/content-type@1.0.5.txt) |
| cookie | 0.7.2 | MIT | [cookie@0.7.2.txt](licenses/node/cookie@0.7.2.txt) |
| cookie-signature | 1.0.7 | MIT | declared in package.json |
| dayjs | 1.11.23 | MIT | [dayjs@1.11.23.txt](licenses/node/dayjs@1.11.23.txt) |
| debug | 2.6.9 | MIT | [debug@2.6.9.txt](licenses/node/debug@2.6.9.txt) |
| depd | 2.0.0 | MIT | [depd@2.0.0.txt](licenses/node/depd@2.0.0.txt) |
| destroy | 1.2.0 | MIT | [destroy@1.2.0.txt](licenses/node/destroy@1.2.0.txt) |
| dom-serializer | 3.1.1 | MIT | [dom-serializer@3.1.1.txt](licenses/node/dom-serializer@3.1.1.txt) |
| domelementtype | 3.0.0 | BSD-2-Clause | [domelementtype@3.0.0.txt](licenses/node/domelementtype@3.0.0.txt) |
| domhandler | 6.0.1 | BSD-2-Clause | [domhandler@6.0.1.txt](licenses/node/domhandler@6.0.1.txt) |
| dompurify | 3.4.17 | (MPL-2.0 OR Apache-2.0) | [dompurify@3.4.17.txt](licenses/node/dompurify@3.4.17.txt) |
| domutils | 4.0.2 | BSD-2-Clause | [domutils@4.0.2.txt](licenses/node/domutils@4.0.2.txt) |
| dunder-proto | 1.0.1 | MIT | [dunder-proto@1.0.1.txt](licenses/node/dunder-proto@1.0.1.txt) |
| ee-first | 1.1.1 | MIT | [ee-first@1.1.1.txt](licenses/node/ee-first@1.1.1.txt) |
| encodeurl | 2.0.1 | MIT | [encodeurl@2.0.1.txt](licenses/node/encodeurl@2.0.1.txt) |
| entities | 8.1.0 | BSD-2-Clause | [entities@8.1.0.txt](licenses/node/entities@8.1.0.txt) |
| es-define-property | 1.0.1 | MIT | [es-define-property@1.0.1.txt](licenses/node/es-define-property@1.0.1.txt) |
| es-errors | 1.3.0 | MIT | [es-errors@1.3.0.txt](licenses/node/es-errors@1.3.0.txt) |
| es-object-atoms | 1.1.2 | MIT | [es-object-atoms@1.1.2.txt](licenses/node/es-object-atoms@1.1.2.txt) |
| escape-html | 1.0.3 | MIT | [escape-html@1.0.3.txt](licenses/node/escape-html@1.0.3.txt) |
| escape-string-regexp | 4.0.0 | MIT | [escape-string-regexp@4.0.0.txt](licenses/node/escape-string-regexp@4.0.0.txt) |
| etag | 1.8.1 | MIT | [etag@1.8.1.txt](licenses/node/etag@1.8.1.txt) |
| express | 4.22.3 | MIT | [express@4.22.3.txt](licenses/node/express@4.22.3.txt) |
| finalhandler | 1.3.2 | MIT | [finalhandler@1.3.2.txt](licenses/node/finalhandler@1.3.2.txt) |
| forwarded | 0.2.0 | MIT | [forwarded@0.2.0.txt](licenses/node/forwarded@0.2.0.txt) |
| fresh | 0.5.2 | MIT | [fresh@0.5.2.txt](licenses/node/fresh@0.5.2.txt) |
| function-bind | 1.1.2 | MIT | [function-bind@1.1.2.txt](licenses/node/function-bind@1.1.2.txt) |
| get-intrinsic | 1.3.0 | MIT | [get-intrinsic@1.3.0.txt](licenses/node/get-intrinsic@1.3.0.txt) |
| get-proto | 1.0.1 | MIT | [get-proto@1.0.1.txt](licenses/node/get-proto@1.0.1.txt) |
| gopd | 1.2.0 | MIT | [gopd@1.2.0.txt](licenses/node/gopd@1.2.0.txt) |
| has-symbols | 1.1.0 | MIT | [has-symbols@1.1.0.txt](licenses/node/has-symbols@1.1.0.txt) |
| hasown | 2.0.4 | MIT | [hasown@2.0.4.txt](licenses/node/hasown@2.0.4.txt) |
| htmlparser2 | 12.0.0 | MIT | [htmlparser2@12.0.0.txt](licenses/node/htmlparser2@12.0.0.txt) |
| http-errors | 2.0.1 | MIT | [http-errors@2.0.1.txt](licenses/node/http-errors@2.0.1.txt) |
| iconv-lite | 0.4.24 | MIT | [iconv-lite@0.4.24.txt](licenses/node/iconv-lite@0.4.24.txt) |
| inherits | 2.0.4 | ISC | [inherits@2.0.4.txt](licenses/node/inherits@2.0.4.txt) |
| ipaddr.js | 1.9.1 | MIT | [ipaddr.js@1.9.1.txt](licenses/node/ipaddr.js@1.9.1.txt) |
| is-plain-object | 5.1.0 | MIT | [is-plain-object@5.1.0.txt](licenses/node/is-plain-object@5.1.0.txt) |
| launder | 1.7.2 | MIT | [launder@1.7.2.txt](licenses/node/launder@1.7.2.txt) |
| math-intrinsics | 1.1.0 | MIT | [math-intrinsics@1.1.0.txt](licenses/node/math-intrinsics@1.1.0.txt) |
| media-typer | 0.3.0 | MIT | [media-typer@0.3.0.txt](licenses/node/media-typer@0.3.0.txt) |
| merge-descriptors | 1.0.3 | MIT | [merge-descriptors@1.0.3.txt](licenses/node/merge-descriptors@1.0.3.txt) |
| methods | 1.1.2 | MIT | [methods@1.1.2.txt](licenses/node/methods@1.1.2.txt) |
| mime | 1.6.0 | MIT | [mime@1.6.0.txt](licenses/node/mime@1.6.0.txt) |
| mime-db | 1.52.0 | MIT | [mime-db@1.52.0.txt](licenses/node/mime-db@1.52.0.txt) |
| mime-types | 2.1.35 | MIT | [mime-types@2.1.35.txt](licenses/node/mime-types@2.1.35.txt) |
| ms | 2.0.0 | MIT | [ms@2.0.0.txt](licenses/node/ms@2.0.0.txt) |
| ms | 2.1.3 | MIT | [ms@2.1.3.txt](licenses/node/ms@2.1.3.txt) |
| nanoid | 3.3.20 | MIT | [nanoid@3.3.20.txt](licenses/node/nanoid@3.3.20.txt) |
| negotiator | 0.6.3 | MIT | [negotiator@0.6.3.txt](licenses/node/negotiator@0.6.3.txt) |
| object-inspect | 1.13.4 | MIT | [object-inspect@1.13.4.txt](licenses/node/object-inspect@1.13.4.txt) |
| on-finished | 2.4.2 | MIT | [on-finished@2.4.2.txt](licenses/node/on-finished@2.4.2.txt) |
| parse-srcset | 1.0.2 | MIT | [parse-srcset@1.0.2.txt](licenses/node/parse-srcset@1.0.2.txt) |
| parseurl | 1.3.3 | MIT | [parseurl@1.3.3.txt](licenses/node/parseurl@1.3.3.txt) |
| path-to-regexp | 0.1.13 | MIT | [path-to-regexp@0.1.13.txt](licenses/node/path-to-regexp@0.1.13.txt) |
| picocolors | 1.1.1 | ISC | [picocolors@1.1.1.txt](licenses/node/picocolors@1.1.1.txt) |
| postcss | 8.5.32 | MIT | [postcss@8.5.32.txt](licenses/node/postcss@8.5.32.txt) |
| proxy-addr | 2.0.8 | MIT | [proxy-addr@2.0.8.txt](licenses/node/proxy-addr@2.0.8.txt) |
| qs | 6.17.1 | BSD-3-Clause | [qs@6.17.1.txt](licenses/node/qs@6.17.1.txt) |
| range-parser | 1.2.1 | MIT | [range-parser@1.2.1.txt](licenses/node/range-parser@1.2.1.txt) |
| raw-body | 2.5.3 | MIT | [raw-body@2.5.3.txt](licenses/node/raw-body@2.5.3.txt) |
| safe-buffer | 5.2.1 | MIT | [safe-buffer@5.2.1.txt](licenses/node/safe-buffer@5.2.1.txt) |
| safer-buffer | 2.1.2 | MIT | [safer-buffer@2.1.2.txt](licenses/node/safer-buffer@2.1.2.txt) |
| sanitize-html | 2.18.1 | MIT | [sanitize-html@2.18.1.txt](licenses/node/sanitize-html@2.18.1.txt) |
| send | 0.19.2 | MIT | [send@0.19.2.txt](licenses/node/send@0.19.2.txt) |
| serve-static | 1.16.3 | MIT | [serve-static@1.16.3.txt](licenses/node/serve-static@1.16.3.txt) |
| setprototypeof | 1.2.0 | ISC | [setprototypeof@1.2.0.txt](licenses/node/setprototypeof@1.2.0.txt) |
| side-channel | 1.1.1 | MIT | [side-channel@1.1.1.txt](licenses/node/side-channel@1.1.1.txt) |
| side-channel-list | 1.0.1 | MIT | [side-channel-list@1.0.1.txt](licenses/node/side-channel-list@1.0.1.txt) |
| side-channel-map | 1.0.1 | MIT | [side-channel-map@1.0.1.txt](licenses/node/side-channel-map@1.0.1.txt) |
| side-channel-weakmap | 1.0.2 | MIT | [side-channel-weakmap@1.0.2.txt](licenses/node/side-channel-weakmap@1.0.2.txt) |
| source-map-js | 1.2.2 | BSD-3-Clause | [source-map-js@1.2.2.txt](licenses/node/source-map-js@1.2.2.txt) |
| statuses | 2.0.2 | MIT | [statuses@2.0.2.txt](licenses/node/statuses@2.0.2.txt) |
| toidentifier | 1.0.1 | MIT | [toidentifier@1.0.1.txt](licenses/node/toidentifier@1.0.1.txt) |
| type-is | 1.6.18 | MIT | [type-is@1.6.18.txt](licenses/node/type-is@1.6.18.txt) |
| unpipe | 1.0.0 | MIT | [unpipe@1.0.0.txt](licenses/node/unpipe@1.0.0.txt) |
| utils-merge | 1.0.1 | MIT | [utils-merge@1.0.1.txt](licenses/node/utils-merge@1.0.1.txt) |
| vary | 1.1.2 | MIT | [vary@1.1.2.txt](licenses/node/vary@1.1.2.txt) |

Development-only tools (ESLint, Prettier, Stylelint, html-validate, jsdom, Tailwind CSS 3.4.17, acorn, globals) are not part of this repository.
The shipped `public/css/tailwind.css` was generated with Tailwind CSS (MIT, Copyright Tailwind Labs, Inc.; [license](licenses/MIT-tailwindcss.txt)).

## 2. Browser libraries included in `public/vendor`

| Library | Version | License | Notes |
|---|---|---|---|
| [d3](https://d3js.org) | 7.9.0 | ISC, Copyright 2010-2023 Mike Bostock | [license](licenses/ISC-d3.txt) |
| [@vladmandic/face-api](https://github.com/vladmandic/face-api) | 1.7.15 | MIT, Copyright (c) Vladimir Mandic | [license](licenses/MIT-face-api.txt). One line is patched (an alert is routed to the worker's log); see `public/vendor/manifest.json`. |

The face detector weights (`tiny_face_detector_model`, from the face-api project, MIT) are **not** stored here: the server downloads them at start-up
from the URLs and with the SHA-256 digests listed in `server/modules/media/model-assets.json`.

## 3. Fonts

* **Unica One** (Regular), SIL Open Font License 1.1 — included in `public/fonts/unica-one`; [license](licenses/OFL-1.1-unica-one.txt).
* **Google Fonts** loaded from `fonts.googleapis.com` when the page opens (this contacts Google): Inter, Bodoni Moda, Cinzel, Cormorant Garamond, DM Serif Display, EB Garamond, Libre Baskerville, Libre Franklin, Lora, Montserrat, Playfair Display, Abril Fatface, Bebas Neue, Oswald, Raleway, Merriweather, Spectral, Vollkorn, Crimson Pro, Prata, Marcellus, Great Vibes, Josefin Sans. All of these families are published under the SIL Open Font License 1.1.
  They are not redistributed in this repository.

## 4. Local generation engine (installed by `scripts/install-engine.ps1`, not redistributed)

* **ComfyUI 0.43.0** — [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI), **GPL-3.0**. The installer downloads the exact source archive pinned in
  `local-generation/comfyui/source.json` and verifies its SHA-256 before extracting it to `local-generation/comfyui/engine`, where its own `LICENSE` stays.
  Kubrick Space talks to it over HTTP on 127.0.0.1:8189 and adds a custom node package to it (section 5). The GPL-3.0 text is in [licenses/GPL-3.0.txt](licenses/GPL-3.0.txt).
* **Python 3.12** (PSF License) and **Node.js 24** (MIT) are prerequisites installed by the user.
* **PyTorch** (BSD-3-Clause and others), installed from the index pinned in `source.json`, plus the packages in `requirements-engine.txt`.
  Licenses declared by the packages of the engine's virtual environment (checked with the versions that were tested):

| Package | Version | License (as declared) |
|---|---|---|
| aiohappyeyeballs | 2.7.1 | PSF-2.0 |
| aiohttp | 3.14.5 | Apache-2.0 AND MIT |
| aiosignal | 1.4.0 | Apache 2.0 |
| alembic | 1.20.1 | MIT |
| annotated-doc | 0.0.5 | MIT |
| annotated-types | 0.8.0 | MIT |
| anyio | 4.15.1 | MIT |
| attrs | 26.1.0 | MIT |
| av | 19.0.2 | BSD-3-Clause |
| blake3 | 1.0.11 | CC0-1.0 OR Apache-2.0 |
| certifi | 2026.10.23 | MPL-2.0 |
| charset-normalizer | 3.5.2 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| colorama | 0.4.6 | BSD License |
| comfy-aimdo | 0.6.0 | GPL-3.0 (license file in package) |
| comfy-angle | 0.1.1 | BSD-3-Clause |
| comfy-kitchen | 0.2.40 | Apache-2.0 |
| einops | 0.8.2 | MIT |
| filelock | 3.32.3 | MIT |
| frozenlist | 1.8.0 | Apache-2.0 |
| fsspec | 2026.7.0 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| hf-xet | 1.7.0 | Apache-2.0 |
| httpcore2 | 2.16.0 | BSD-3-Clause |
| httpx2 | 2.16.0 | BSD-3-Clause |
| huggingface_hub | 2.3.0 | Apache-2.0 |
| idna | 3.20 | BSD-3-Clause |
| Jinja2 | 3.1.6 | BSD License |
| jsonschema | 4.26.0 | MIT |
| jsonschema-specifications | 2025.9.1 | MIT |
| kornia | 0.9.0 | Apache-2.0 |
| kornia_rs | 0.2.0 | Apache Software License |
| Mako | 1.4.3 | MIT |
| markdown-it-py | 4.2.0 | MIT License |
| MarkupSafe | 3.0.3 | BSD-3-Clause |
| mdurl | 0.1.2 | MIT License |
| mpmath | 1.3.0 | BSD |
| multidict | 7.2.1 | Apache-2.0 |
| networkx | 3.6.1 | BSD-3-Clause |
| numpy | 2.5.2 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| opencv-python-headless | 4.13.0.92 | Apache 2.0 |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| pillow | 12.3.0 | MIT-CMU |
| pip | 26.2.2 | MIT |
| propcache | 0.5.4 | Apache-2.0 |
| psutil | 7.2.2 | BSD-3-Clause |
| pydantic | 2.14.1 | MIT |
| pydantic-settings | 2.16.1 | MIT |
| pydantic_core | 2.50.1 | MIT |
| Pygments | 2.21.0 | BSD-2-Clause |
| PyOpenGL | 3.1.10 | BSD License |
| python-dotenv | 1.2.4 | BSD-3-Clause |
| PyYAML | 6.0.3 | MIT |
| referencing | 0.37.0 | MIT |
| regex | 2026.9.29 | Apache-2.0 AND CNRI-Python |
| requests | 2.34.2 | Apache-2.0 |
| rich | 15.0.0 | MIT |
| rpds-py | 2026.9.1 | MIT |
| safetensors | 0.8.0 | Apache Software License |
| scipy | 1.18.1 | BSD License |
| sentencepiece | 0.2.2 | Apache-2.0 |
| setuptools | 78.1.0 | MIT License |
| shellingham | 1.5.4 | ISC License |
| simpleeval | 1.0.8 | MIT |
| spandrel | 0.4.2 | MIT |
| SQLAlchemy | 2.1.6 | MIT |
| sympy | 1.14.0 | BSD |
| tokenizers | 0.23.3 | Apache Software License |
| torch | 2.14.1+cu130 | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT |
| torchsde | 0.2.6 | Apache Software License |
| torchvision | 0.29.1+cu130 | BSD |
| tqdm | 4.70.1 | MPL-2.0 AND MIT |
| trampoline | 0.1.2 | MIT |
| transformers | 5.21.0 | Apache 2.0 License |
| truststore | 0.10.5 | MIT |
| typer | 0.27.3 | MIT |
| typing-inspection | 0.4.4 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| urllib3 | 2.8.0 | MIT |
| yarl | 1.25.1 | Apache-2.0 |

`comfy-aimdo` declares no SPDX expression in its metadata; its package license file states GPL-3.0.

## 5. Code adapted from other projects (included in `local-generation/comfyui/kubrick_space`)

| File | Derived from | License |
|---|---|---|
| `h3.py` | The author's own ComfyUI package *Skalibur* (tokenizer layout, reference labels, saved conditioning). | MIT here (same author as Skalibur, which is published under GPL-3.0) |
| `h3_upscale.py` | [LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler](https://github.com/LBH-123-AI) latent upscaler (MIT), through *Skalibur*. | MIT |
| `h3_optimization.py` | Low-memory block/attention layout of [KJNodes](https://github.com/kijai/ComfyUI-KJNodes) by kijai, through *Skalibur*. | **GPL-3.0** ([text](licenses/GPL-3.0.txt)). This file stays under the GPL; it can be replaced by an MIT rewrite without touching anything else. |
| `flux3_pdd.py`, `pdd_math.py`, `tool_protocol.py`, `nodes.py` | Written for Kubrick Space. | MIT |

Because these nodes run inside ComfyUI (GPL-3.0), distributing ComfyUI together with this package is subject to the GPL for the combined work.
This repository does not distribute ComfyUI.

## 6. AI models (not redistributed)

No model weights are included. See the **Models** section of the [README](README.md) for each file, its license and where to obtain it.
Model licenses apply to whoever downloads and uses the weights; some restrict commercial use, redistribution or territory.
