#!/usr/bin/env python3
"""Draws resources/images/wallpaper.png: the tiled chat background.

Two colours only (so it packs as a tiny 1-bit bitmap): a fine checker of
MayGreen and MintGreen reads as a soft mid-green on the watch, and the doodles
are drawn in solid MintGreen so they show as a light, subtle pattern.
Run: python3 tools/make-wallpaper.py
"""
import math
from PIL import Image, ImageDraw

A = (85, 170, 85)     # GColorMayGreen
B = (170, 255, 170)   # GColorMintGreen
SIZE = 80

img = Image.new('RGB', (SIZE, SIZE))
px = img.load()
for y in range(SIZE):
    for x in range(SIZE):
        px[x, y] = A if (x + y) % 2 == 0 else B
d = ImageDraw.Draw(img)
L = B
# paper plane
d.line([(8, 20), (26, 12), (18, 28), (16, 21), (8, 20)], fill=L)
d.line([(16, 21), (26, 12)], fill=L)
# heart
d.arc([46, 8, 54, 16], 180, 360, fill=L)
d.arc([53, 8, 61, 16], 180, 360, fill=L)
d.line([(46, 12), (53, 21), (61, 12)], fill=L)
# star
cx, cy, r = 62, 50, 7
pts = [(cx + (r if i % 2 == 0 else r * 0.45) * math.sin(i * math.pi / 5),
        cy - (r if i % 2 == 0 else r * 0.45) * math.cos(i * math.pi / 5)) for i in range(10)]
d.polygon(pts, outline=L)
# ring, dots, squiggle, speech bubble, music note
d.ellipse([12, 48, 24, 60], outline=L)
d.point([(36, 40), (40, 66), (70, 30), (30, 74), (74, 72)], fill=L)
d.line([(34, 58), (38, 54), (42, 58), (46, 54), (50, 58)], fill=L)
d.rounded_rectangle([28, 30, 44, 40], 3, outline=L)
d.line([(31, 40), (30, 44), (35, 40)], fill=L)
d.line([(62, 66), (62, 76)], fill=L)
d.line([(62, 66), (68, 64)], fill=L)
d.ellipse([58, 74, 62, 78], outline=L)
img.quantize(colors=2).save('resources/images/wallpaper.png', optimize=True)
