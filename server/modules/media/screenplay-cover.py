"""Deterministic screenplay artwork; CPU only, no inference or remote fonts."""
import json
import sys
from PIL import Image, ImageDraw, ImageFont, PngImagePlugin

name = json.load(sys.stdin)["name"]
font_path, output = sys.argv[1:]
image = Image.new("RGB", (1280, 1920), "white")
draw = ImageDraw.Draw(image)
draw.rectangle((72, 72, 1207, 1847), outline="black", width=8)

def wrap(text, font):
    lines = []
    line = ""
    for word in text.split():
        candidate = (line + " " + word).strip()
        if draw.textlength(candidate, font=font) <= 1000:
            line = candidate
            continue
        if line:
            lines.append(line)
        line = ""
        for char in word:
            if line and draw.textlength(line + char, font=font) > 1000:
                lines.append(line)
                line = ""
            line += char
    if line:
        lines.append(line)
    return lines

for size in range(136, 15, -2):
    font = ImageFont.truetype(font_path, size)
    lines = wrap(name, font)
    line_height = round(size * 1.22)
    if len(lines) * line_height <= 1040:
        break
label_font = ImageFont.truetype(font_path, 64)
height = len(lines) * line_height + 160
start = (1920 - height) // 2
for index, line in enumerate(lines):
    draw.text((640, start + index * line_height), line, font=font, fill="black", anchor="mt")
draw.text((640, start + len(lines) * line_height + 82), "SCREENPLAY", font=label_font, fill="black", anchor="mt")
metadata = PngImagePlugin.PngInfo()
metadata.add_text("Title", name)
metadata.add_text("Software", "Kubrick Space deterministic screenplay cover v1")
image.save(output, format="PNG", pnginfo=metadata)
