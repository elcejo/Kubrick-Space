"""Private, offline portrait thumbnail. Never changes the source image."""
import sys
import cv2
from PIL import Image, ImageOps


def square(width, height, box=None):
    if box is None:
        side = min(width, height)
        return ((width - side) // 2, 0, side)
    x, y, w, h = box
    side = min(width, height, int(max(w, h) * 1.5 + 0.999))
    return (max(0, min(width - side, int(x + w / 2 - side / 2))),
            max(0, min(height - side, int(y + h / 2 - side / 2))), side)


def crop(source, target):
    import numpy as np
    with Image.open(source) as raw:
        image = ImageOps.exif_transpose(raw).convert("RGB")
        scale = min(1, 1600 / max(image.size))
        sample = image.resize(tuple(max(1, round(v * scale)) for v in image.size))
        gray = cv2.cvtColor(np.array(sample), cv2.COLOR_RGB2GRAY)
        box = None
        try:
            detector = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
            faces = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24))
            if len(faces):
                box = [v / scale for v in max(faces, key=lambda b: b[2] * b[3])]
        except (cv2.error, AttributeError):
            pass  # Detection unavailable still yields the specified top-centered square.
        x, y, side = square(*image.size, box)
        result = image.crop((x, y, x + side, y + side))
        size = min(768, side)
        result.resize((size, size), Image.Resampling.LANCZOS).save(target, format="PNG")


if __name__ == "__main__":
    crop(sys.argv[1], sys.argv[2])
