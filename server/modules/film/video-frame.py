"""Takes the last frame of a video as a PNG. Used by the film for the continuity between clips: it reads one file of the
project and writes one PNG, with no shell and no network."""

import sys

import av
from PIL import Image


def last_frame(source):
    with av.open(source) as container:
        stream = container.streams.video[0]
        frame = None
        for decoded in container.decode(stream):
            frame = decoded
        if frame is None:
            raise ValueError("El video no tiene fotogramas.")
        return frame.to_image()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("uso: video-frame.py origen.mp4 destino.png")
    image = last_frame(sys.argv[1])
    image.save(sys.argv[2], format="PNG")
