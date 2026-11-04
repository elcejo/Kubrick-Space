"""The last frames of a clip as an image batch, to guide the clip that continues it (MiniMax H3 guide clips)."""

import os

import av
import folder_paths
import numpy as np
import torch
from comfy_api.latest import io


def tail_frames(path, count):
    frames = []
    with av.open(path) as container:
        for decoded in container.decode(container.streams.video[0]):
            frames.append(decoded.to_ndarray(format="rgb24"))
            if len(frames) > count:
                frames.pop(0)
    if not frames:
        raise ValueError("El video no tiene fotogramas.")
    return torch.from_numpy(np.stack(frames).astype(np.float32) / 255.0)


class KubrickH3Tail(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="KubrickH3Tail",
            display_name="Kubrick · H3 Tail Frames",
            category="Kubrick Space/video",
            description="The last frames of a video of the input folder, as an image batch.",
            inputs=[
                io.String.Input("filename", default=""),
                io.Int.Input("count", default=22, min=1, max=100),
            ],
            outputs=[io.Image.Output()],
        )

    @classmethod
    def execute(cls, filename, count):
        # The name is untrusted: it must be a plain file of the input folder.
        path = folder_paths.get_annotated_filepath(os.path.basename(filename))
        if os.path.basename(filename) != filename or not os.path.isfile(path):
            raise ValueError("El video de continuidad no existe.")
        return io.NodeOutput(tail_frames(path, count))
