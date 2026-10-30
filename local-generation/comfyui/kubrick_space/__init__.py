"""Kubrick's explicitly whitelisted, backend-only ComfyUI extension."""

from .nodes import KubrickExtension

__version__ = "0.1.0"


async def comfy_entrypoint():
    return KubrickExtension()
