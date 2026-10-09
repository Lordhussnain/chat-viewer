"""Generate build/icon.png (512x512) for the desktop app. Standard library only.

Run once after changing the design: python3 scripts/make-icon.py
"""
import struct
import zlib
from pathlib import Path

SIZE = 512
BG = (59, 111, 224)
WHITE = (255, 255, 255)
PALE = (207, 224, 255)


def in_rounded_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def in_triangle(x, y, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    p = (x, y)
    d1, d2, d3 = sign(p, a, b), sign(p, b, c), sign(p, c, a)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def pixel(x, y):
    # Rounded background tile.
    if not in_rounded_rect(x, y, 0, 0, SIZE - 1, SIZE - 1, 96):
        return (0, 0, 0, 0)
    # Two speech bubbles with tails.
    if in_rounded_rect(x, y, 110, 130, 340, 280, 40) or in_triangle(x, y, (140, 270), (140, 330), (210, 270)):
        return WHITE + (255,)
    if in_rounded_rect(x, y, 190, 250, 410, 390, 40) or in_triangle(x, y, (370, 380), (370, 440), (300, 380)):
        return PALE + (255,)
    return BG + (255,)


def png_bytes(width, height, rows):
    raw = b''.join(b'\x00' + bytes(c for px in row for c in px) for row in rows)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


if __name__ == '__main__':
    rows = [[pixel(x, y) for x in range(SIZE)] for y in range(SIZE)]
    out = Path(__file__).resolve().parent.parent / 'build' / 'icon.png'
    out.write_bytes(png_bytes(SIZE, SIZE, rows))
    print('wrote', out)
