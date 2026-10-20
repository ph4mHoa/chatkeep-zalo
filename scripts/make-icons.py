#!/usr/bin/env python3
"""Draws the extension icon (chat bubble with a download arrow) at 16/32/48/128 px.

Same drawing as ChatKeep for Messenger (fb-tools), in teal, so the two are told apart in the
toolbar. It deliberately looks nothing like Zalo's own logo.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'extension' / 'icons'
S = 1024  # draw large, downsample for clean edges


def draw(canvas_pad):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    # vertical gradient tile
    grad = Image.new('RGBA', (S, S))
    top, bottom = (0, 176, 150), (0, 112, 170)
    for y in range(S):
        t = y / (S - 1)
        c = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,)
        ImageDraw.Draw(grad).line([(0, y), (S, y)], fill=c)
    mask = Image.new('L', (S, S), 0)
    p = canvas_pad
    ImageDraw.Draw(mask).rounded_rectangle([p, p, S - p, S - p], radius=(S - 2 * p) * 0.23, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    # speech bubble
    inner = S - 2 * p
    bx0, by0 = p + inner * 0.18, p + inner * 0.2
    bx1, by1 = p + inner * 0.82, p + inner * 0.72
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=inner * 0.14, fill='white')
    d.polygon([(bx0 + inner * 0.12, by1 - 2), (bx0 + inner * 0.06, p + inner * 0.84), (bx0 + inner * 0.3, by1 - 2)], fill='white')
    # download arrow inside the bubble
    cx = (bx0 + bx1) / 2
    col = (0, 132, 150, 255)
    w = inner * 0.075
    d.rectangle([cx - w / 2, by0 + inner * 0.09, cx + w / 2, by0 + inner * 0.3], fill=col)
    d.polygon([(cx - inner * 0.14, by0 + inner * 0.25), (cx + inner * 0.14, by0 + inner * 0.25), (cx, by0 + inner * 0.4)], fill=col)
    d.rectangle([cx - inner * 0.17, by0 + inner * 0.43, cx + inner * 0.17, by0 + inner * 0.43 + w * 0.8], fill=col)
    return img


OUT.mkdir(parents=True, exist_ok=True)
# Store guidance: 128px icon with ~16px transparent padding; small sizes use the full canvas.
for size, pad in ((16, 0), (32, 0), (48, 0.02), (128, 0.125)):
    draw(int(S * pad)).resize((size, size), Image.LANCZOS).save(OUT / f'icon{size}.png')
print('icons written to', OUT)
