#!/usr/bin/env python3
"""Draws the themed doodle wallpapers resources/images/doodles_<name>.png.

Same format as tools/make-wallpaper.py: 80x80, 1-bit, tiles seamlessly. Index 0
is the background and index 1 the thin line art (the watch recolours them with
the theme's chat_bg and wall_hi). Every icon is drawn at all 9 wrap-around offsets so nothing
is cut at the tile edge.
Run: python3 tools/make-doodle-themes.py [preview_dir]
"""
import math
import os
import sys
from PIL import Image, ImageDraw

SIZE = 80


class Pen:
    def __init__(self, d, cx, cy, ang=0.0, sc=1.0, ox=0, oy=0):
        self.d, self.cx, self.cy, self.sc = d, cx + ox, cy + oy, sc
        self.c, self.s = math.cos(math.radians(ang)), math.sin(math.radians(ang))

    def t(self, p):
        x, y = p[0] * self.sc, p[1] * self.sc
        return (int(math.floor(self.cx + x * self.c - y * self.s + 0.5)),
                int(math.floor(self.cy + x * self.s + y * self.c + 0.5)))

    def line(self, pts, closed=False):
        q = [self.t(p) for p in pts]
        if closed:
            q.append(q[0])
        self.d.line(q, fill=1)

    def circle(self, x, y, r, a0=0, a1=360):
        self.ellipse(x, y, r, r, a0, a1)

    def ellipse(self, x, y, rx, ry, a0=0, a1=360, rot=0):
        n = max(16, int(max(rx, ry) * 6))
        pts = []
        for i in range(n + 1):
            a = math.radians(a0 + (a1 - a0) * i / n)
            ex, ey = rx * math.cos(a), ry * math.sin(a)
            r = math.radians(rot)
            pts.append((x + ex * math.cos(r) - ey * math.sin(r), y + ex * math.sin(r) + ey * math.cos(r)))
        self.line(pts)

    def pts(self, ps):
        for p in ps:
            self.d.point(self.t(p), fill=1)

    def curve(self, p0, p1, p2, n=14):
        pts = []
        for i in range(n + 1):
            u = i / n
            pts.append(((1 - u) ** 2 * p0[0] + 2 * u * (1 - u) * p1[0] + u * u * p2[0],
                        (1 - u) ** 2 * p0[1] + 2 * u * (1 - u) * p1[1] + u * u * p2[1]))
        self.line(pts)


def star(p, x, y, r, ri=None):
    ri = ri or r * 0.45
    pts = [(x + (r if i % 2 == 0 else ri) * math.sin(i * math.pi / 5),
            y - (r if i % 2 == 0 else ri) * math.cos(i * math.pi / 5)) for i in range(10)]
    p.line(pts, True)


def sparkle(p, x, y, r):
    k = r * 0.25
    p.line([(x, y - r), (x + k, y - k), (x + r, y), (x + k, y + k), (x, y + r),
            (x - k, y + k), (x - r, y), (x - k, y - k)], True)


def plus(p, x, y, r):
    p.line([(x - r, y), (x + r, y)])
    p.line([(x, y - r), (x, y + r)])


def heart(p, x, y, r):
    pts = []
    for i in range(36):
        t = 2 * math.pi * i / 36
        pts.append((x + r * 16 * math.sin(t) ** 3 / 16.0 * 1.0,
                    y - r * (13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) / 16.0 + r * 0.1))
    p.line(pts, True)


# ---- SPACE ---------------------------------------------------------------
def planet(p):
    p.circle(0, 0, 5)
    seg = []
    for i in range(0, 361, 6):
        a = math.radians(i)
        ex, ey = 12 * math.cos(a), 4 * math.sin(a)
        r = math.radians(-20)
        x, y = ex * math.cos(r) - ey * math.sin(r), ex * math.sin(r) + ey * math.cos(r)
        if math.sin(a) > 0 or math.hypot(x, y) > 6:   # back half hides behind the planet
            seg.append((x, y))
        elif len(seg) > 1:
            p.line(seg)
            seg = []
        else:
            seg = []
    if len(seg) > 1:
        p.line(seg)


def rocket(p):
    p.curve((-4, -3), (0, -15), (4, -3), 14)
    p.line([(4, -3), (4, 6), (-4, 6), (-4, -3)])
    p.circle(0, -2, 1.6)
    p.line([(4, 1), (8, 8), (4, 6)])
    p.line([(-4, 1), (-8, 8), (-4, 6)])
    p.line([(-2, 8), (0, 12), (2, 8)])


def moon(p):
    # crescent: outer circle r7, inner circle r6 shifted right, meeting at +-5.99
    p.ellipse(0, 0, 7, 7, 58.8, 301.2)
    p.ellipse(4, 0, 6, 6, 266.4, 93.6)
    p.pts([(5, -2)])


def planet2(p):
    p.circle(0, 0, 7)
    p.circle(-2, -2, 1.5)
    p.circle(3, 3, 1.5)
    p.pts([(3, -3)])


def comet(p):
    p.circle(5, 5, 4)
    p.line([(2, 2), (-9, -9)])
    p.line([(5, 0), (-1, -6)])
    p.line([(0, 5), (-6, -1)])


def ufo(p):
    p.ellipse(0, 2, 10, 3)
    p.circle(0, 0, 5, 180, 360)
    p.pts([(-5, 2), (0, 3), (5, 2)])
    p.line([(-6, 6), (-8, 9)])
    p.line([(6, 6), (8, 9)])


def sat(p):
    p.line([(-2, -2), (2, -2), (2, 2), (-2, 2)], True)
    p.line([(-3, -1), (-10, -1), (-10, 1), (-3, 1)], True)
    p.line([(3, -1), (10, -1), (10, 1), (3, 1)], True)
    p.line([(0, -2), (0, -5)])
    p.circle(0, -6, 1)



# ---- PETS ----------------------------------------------------------------
def cat(p):
    p.ellipse(0, 1, 8, 7)
    p.line([(-7, -3), (-7, -10), (-2, -6)])
    p.line([(7, -3), (7, -10), (2, -6)])
    p.pts([(-3, 0), (3, 0), (0, 3)])


def paw(p):
    p.ellipse(0, 4, 5.5, 4.5)
    for x, y in ((-7, -2), (-3, -7), (3, -7), (7, -2)):
        p.ellipse(x, y, 1.8, 2.3)


def bone(p):
    p.line([(-5, -2), (5, -2)])
    p.line([(-5, 2), (5, 2)])
    p.circle(-6, -2, 2.2, 90, 360 + 0)
    p.circle(-6, 2, 2.2, 0, 270)
    p.circle(6, -2, 2.2, 180, 450)
    p.circle(6, 2, 2.2, 270, 540)
    p.line([(-8, -2), (-8, -2)])


def fish(p):
    p.curve((-8, 0), (0, -9), (7, 0), 16)
    p.curve((-8, 0), (0, 9), (7, 0), 16)
    p.line([(7, 0), (11, -4), (11, 4)], True)
    p.pts([(-4, -1)])
    p.line([(-1, -3), (0, 3)])


def yarn(p):
    p.circle(0, 0, 7)
    p.curve((-6, -3), (0, 1), (6, -3), 10)
    p.curve((-7, 2), (0, 6), (6, 3), 10)
    p.curve((6, 6), (10, 11), (13, 6), 10)


def bowl(p):
    p.ellipse(0, -2, 9, 2.5)
    p.ellipse(0, -2, 9, 8, 0, 180)
    p.pts([(-3, -5), (1, -6), (4, -4)])


def mouse(p):
    p.ellipse(0, 1, 7, 5)
    p.circle(4, -4, 2.5)
    p.circle(-1, -4, 2.5)
    p.pts([(5, 0), (7, 1)])
    p.curve((-7, 2), (-12, 6), (-12, 0), 10)



# ---- FOOD ----------------------------------------------------------------
def pizza(p):
    p.line([(-8, -8), (0, 10), (8, -8)], True)
    p.curve((-8, -8), (0, -11), (8, -8), 12)
    p.circle(0, -4, 1.6)
    p.circle(-2, 2, 1.4)
    p.circle(3, 1, 1.2)


def coffee(p):
    p.line([(-6, -2), (-5, 7), (4, 7), (5, -2)], True)
    p.curve((5, 0), (11, 0), (5, 5), 8)
    p.curve((-2, -4), (-4, -6), (-2, -9), 6)
    p.curve((2, -4), (0, -6), (2, -9), 6)
    p.line([(-8, 8), (7, 8)])


def donut(p):
    p.circle(0, 0, 8)
    p.circle(0, 0, 2.5)
    p.curve((-7, -3), (-6, -6), (-3, -6), 6)
    p.pts([(-5, -2), (4, -5), (5, 3), (-2, 5), (-5, 3), (2, -3)])
    p.line([(1, 5), (3, 6)])


def icecream(p):
    p.line([(-5, 0), (0, 12), (5, 0)], True)
    p.line([(-3, 4), (3, 4)])
    p.circle(0, -2, 6, 180, 360)
    p.curve((-6, -2), (-3, 1), (0, -2), 6)
    p.curve((0, -2), (3, 1), (6, -2), 6)
    p.circle(0, -9, 1)


def cherries(p):
    p.circle(-4, 5, 3.5)
    p.circle(5, 6, 3.5)
    p.curve((-4, 1.5), (-3, -5), (2, -9), 10)
    p.curve((5, 2.5), (5, -4), (2, -9), 10)
    p.line([(2, -9), (7, -10), (6, -6), (2, -9)])


def cupcake(p):
    p.line([(-6, 0), (-4, 8), (4, 8), (6, 0)])
    p.line([(-2, 1), (-1, 8)])
    p.line([(2, 1), (1, 8)])
    p.circle(0, -2, 7, 180, 360)
    p.curve((-7, -2), (0, 3), (7, -2), 10)
    p.circle(0, -11, 1.5)


def apple(p):
    p.circle(-3, 1, 5, 90, 330)
    p.circle(3, 1, 5, 210, 450)
    p.curve((-3, 6), (0, 8), (3, 6), 4)
    p.line([(0, -3), (1, -7)])
    p.line([(1, -6), (5, -9), (6, -6), (1, -6)])


def fries(p):
    p.line([(-5, 0), (-4, 9), (4, 9), (5, 0)])
    p.line([(-5, 0), (5, 0)])
    for x, t in ((-3, -6), (-1, -8), (1, -7), (3, -5)):
        p.line([(x, 0), (x + (0.5 if x < 0 else -0.5), t)])
    p.pts([(0, 5)])



# ---- TRAVEL --------------------------------------------------------------
def plane(p):
    p.line([(0, -11), (1.5, -6), (1.5, -2), (11, 3), (11, 5), (1.5, 3), (1.5, 7), (4, 9),
            (4, 10), (0, 9), (-4, 10), (-4, 9), (-1.5, 7), (-1.5, 3), (-11, 5), (-11, 3),
            (-1.5, -2), (-1.5, -6)], True)


def suitcase(p):
    p.line([(-8, -5), (8, -5), (8, 8), (-8, 8)], True)
    p.line([(-3, -5), (-3, -8), (3, -8), (3, -5)])
    p.line([(-4, -5), (-4, 8)])
    p.line([(4, -5), (4, 8)])
    p.pts([(0, 0)])


def palm(p):
    p.curve((0, 10), (2, 2), (1, -3), 10)
    p.curve((1, -3), (-4, -8), (-9, -4), 8)
    p.curve((1, -3), (6, -9), (11, -4), 8)
    p.curve((1, -3), (-3, -5), (-6, 1), 8)
    p.curve((1, -3), (5, -5), (8, 1), 8)
    p.line([(1, -3), (1, -9)])
    p.line([(-5, 10), (6, 10)])
    p.pts([(0, -2), (2, -2)])


def compass(p):
    p.circle(0, 0, 8)
    p.line([(0, -9), (0, -11)])
    p.line([(0, -5), (2.2, 0), (0, 5), (-2.2, 0)], True)
    p.pts([(0, 0)])


def mountains(p):
    p.line([(-11, 8), (-4, -5), (0, 2), (4, -8), (11, 8)])
    p.line([(-11, 8), (11, 8)])
    p.line([(4, -8), (2, -4), (4, -2), (6, -4), (4, -8)])
    p.circle(-9, -7, 2)


def camera(p):
    p.line([(-9, -4), (-4, -4), (-3, -7), (3, -7), (4, -4), (9, -4), (9, 7), (-9, 7)], True)
    p.circle(0, 1.5, 4)
    p.circle(0, 1.5, 1.5)
    p.pts([(6, -1)])


def pin(p):
    p.circle(0, -3, 6, 145, 395)
    p.line([(-4.9, 0.4), (0, 10), (4.9, 0.4)])
    p.circle(0, -3, 2)


def globe(p):
    p.circle(0, 0, 8)
    p.ellipse(0, 0, 3.5, 8)
    p.line([(-8, 0), (8, 0)])
    p.curve((-7, -4), (0, -2), (7, -4), 8)
    p.curve((-7, 4), (0, 2), (7, 4), 8)



# ---- MUSIC & PARTY -------------------------------------------------------
def note(p):
    p.ellipse(-3, 7, 3.5, 2.5, rot=-20)
    p.line([(0.3, 6.5), (0.3, -8), (6, -4)])
    p.line([(0.3, -5), (6, -1)])


def notes2(p):
    p.ellipse(-6, 6, 3, 2.2, rot=-20)
    p.ellipse(5, 4, 3, 2.2, rot=-20)
    p.line([(-3, 5.5), (-3, -6), (8, -8), (8, 3.5)])
    p.line([(-3, -2.5), (8, -4.5)])


def phones(p):
    p.curve((-8, 2), (0, -20), (8, 2), 20)
    p.line([(-10, -1), (-6, -1), (-6, 8), (-10, 8)], True)
    p.line([(10, -1), (6, -1), (6, 8), (10, 8)], True)


def balloon(p):
    p.ellipse(0, -3, 6, 7.5)
    p.line([(-1.5, 4.5), (0, 6.5), (1.5, 4.5)])
    p.curve((0, 6.5), (3, 9), (-2, 12), 8)
    p.curve((-3.5, -7), (-4.5, -6), (-4.5, -4), 4)


def gift(p):
    p.line([(-7, -2), (7, -2), (7, 8), (-7, 8)], True)
    p.line([(-8, -5), (8, -5), (8, -2), (-8, -2)], True)
    p.line([(0, -5), (0, 8)])
    p.ellipse(-3.5, -8, 3.5, 2.2, rot=-35)
    p.ellipse(3.5, -8, 3.5, 2.2, rot=35)


def hat(p):
    p.line([(0, -9), (-7, 8), (7, 8)], True)
    p.line([(-3, 0), (3, 0)])
    p.line([(-5, 4), (5, 4)])
    p.circle(0, -10, 1.5)


def confetti(p):
    p.line([(-6, -5), (-3, -7)])
    p.line([(4, -4), (7, -2)])
    p.circle(0, 3, 1.2)
    p.line([(-6, 5), (-4, 7), (-8, 7)], True)
    p.curve((3, 6), (5, 3), (7, 6), 6)
    plus(p, 0, -1, 1.5)


def speaker(p):
    p.line([(-5, -8), (5, -8), (5, 8), (-5, 8)], True)
    p.circle(0, 3, 3)
    p.circle(0, -4, 1.3)



def f_star(p):
    star(p, 0, 0, 5)


def f_sparkle(p):
    sparkle(p, 0, 0, 5)


def f_plus(p):
    plus(p, 0, 0, 3)


def f_heart(p):
    heart(p, 0, 0, 5)


# Nine slots in a staggered grid (the middle row is shifted half a cell).
GLOBAL_SCALE = 1.15
TILT = 0.5   # small tilts only: 1px lines rotate badly
SLOTS = [(13, 12), (40, 16), (67, 11), (26, 41), (53, 37), (0, 43), (13, 66), (40, 70), (67, 64)]
# (drawing function, angle, scale) per slot.
THEMES = {
    'space': ([(planet, -20, 1.0), (rocket, 40, 1.0), (f_star, 10, 1.0),
               (moon, -35, 1.1), (comet, 0, 1.0), (f_sparkle, 0, 1.0),
               (planet2, 0, 1.0), (ufo, 8, 1.0), (f_plus, 0, 1.0)],
              [(27, 24), (54, 26), (3, 20), (30, 56), (60, 58), (76, 52), (4, 60), (53, 4)]),
    'pets': ([(cat, -6, 1.1), (paw, 20, 1.1), (f_heart, 0, 1.0),
              (bone, -40, 1.0), (yarn, 0, 1.0), (paw, -25, 0.9),
              (fish, -15, 1.0), (bowl, 0, 1.0), (f_plus, 0, 1.0)],
             [(27, 24), (54, 26), (3, 20), (30, 56), (60, 58), (76, 52), (4, 60), (53, 4)]),
    'food': ([(pizza, 15, 1.1), (coffee, -10, 1.0), (f_heart, 0, 1.0),
              (donut, 0, 1.05), (cherries, 15, 1.1), (f_plus, 0, 1.0),
              (icecream, -20, 1.0), (cupcake, 10, 1.0), (apple, -12, 1.0)],
             [(27, 24), (54, 26), (3, 20), (30, 56), (60, 58), (76, 52), (4, 60), (53, 4)]),
    'travel': ([(plane, 40, 1.0), (suitcase, -8, 1.0), (f_star, 0, 1.0),
                (compass, 0, 1.05), (mountains, 0, 1.0), (palm, 8, 1.0),
                (camera, -8, 1.0), (pin, 15, 1.0), (f_sparkle, 0, 1.0)],
               [(27, 24), (54, 26), (3, 20), (30, 56), (60, 58), (76, 52), (4, 60), (53, 4)]),
    'party': ([(note, -10, 1.1), (balloon, 15, 1.05), (f_star, 0, 1.0),
               (phones, 0, 1.05), (gift, -8, 1.05), (f_sparkle, 0, 1.0),
               (hat, 15, 1.0), (notes2, 8, 1.0), (confetti, 0, 1.1)],
              [(27, 24), (54, 26), (3, 20), (30, 56), (60, 58), (76, 52), (4, 60), (53, 4)]),
}


def draw_theme(name):
    icons, dotpts = THEMES[name]
    mask = Image.new('1', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask)
    for ox in (-SIZE, 0, SIZE):
        for oy in (-SIZE, 0, SIZE):
            for (fn, ang, sc), (cx, cy) in zip(icons, SLOTS):
                ang = ang if abs(ang) >= 30 else ang * TILT
                fn(Pen(d, cx, cy, ang, sc * GLOBAL_SCALE, ox, oy))
            Pen(d, 0, 0, 0, 1, ox, oy).pts(dotpts)
    # Index 0 = background, index 1 = line colour (the watch swaps in the theme
    # colours); png palette shows them as MayGreen / MintGreen.
    img = Image.new('P', (SIZE, SIZE), 0)
    img.putdata([1 if v == 0 else 0 for v in mask.getdata()] if False else [0] * (SIZE * SIZE))
    px = img.load()
    m = mask.load()
    for y in range(SIZE):
        for x in range(SIZE):
            px[x, y] = 1 if m[x, y] == 255 or m[x, y] == 1 else 0
    img.putpalette([85, 170, 85, 170, 255, 170])
    return img


def preview(img, path, bg, hi):
    tile = Image.new('RGB', (SIZE, SIZE))
    t = tile.load()
    for y in range(SIZE):
        for x in range(SIZE):
            t[x, y] = hi if img.getpixel((x, y)) else bg
    big = Image.new('RGB', (SIZE * 3, SIZE * 3))
    for i in range(3):
        for j in range(3):
            big.paste(tile, (i * SIZE, j * SIZE))
    big.resize((SIZE * 9, SIZE * 9), Image.NEAREST).save(path)


if __name__ == '__main__':
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources', 'images')
    pv = sys.argv[1] if len(sys.argv) > 1 else None
    for name in THEMES:
        im = draw_theme(name)
        if pv:
            os.makedirs(pv, exist_ok=True)
            preview(im, os.path.join(pv, name + '_green.png'), (0x55, 0xAA, 0x55), (0xAA, 0xFF, 0xAA))
            preview(im, os.path.join(pv, name + '_navy.png'), (0, 0, 0x55), (0, 0, 0xAA))
        else:
            im.save(os.path.join(outdir, 'doodles_%s.png' % name), optimize=True)
