#!/usr/bin/env python3
"""Robi z build/icon-source.png ikonę w stylu macOS: squircle + marginesy siatki Apple.

Apple (Big Sur+): płótno 1024, korpus 824 wyśrodkowany, narożnik ~185 — ale nie zwykły
rounded-rect, tylko superelipsa (stąd „squircle"), inaczej ikona odstaje od reszty Docku.

    python3 scripts/make-icon.py
"""
from math import cos, pi, sin

from PIL import Image, ImageDraw

SIZE = 1024  # płótno
BODY = 824  # korpus ikony (reszta to marginesy siatki Apple)
N = 5.0  # wykładnik superelipsy: 2 = elipsa, ∞ = kwadrat; ~5 ≈ kształt Apple
SS = 4  # supersampling maski (wygładzenie krawędzi)
SRC = "build/icon-source.png"
OUT = "build/icon.png"


def squircle_mask(size: int) -> Image.Image:
    """Maska superelipsy |x|^N + |y|^N = 1, rysowana w powiększeniu i zmniejszana (AA)."""
    big = size * SS
    r = big / 2
    pts = []
    for i in range(2048):
        t = 2 * pi * i / 2048
        c, s = cos(t), sin(t)
        # znak trzymamy osobno — potęgowanie liczymy na wartości bezwzględnej
        x = (abs(c) ** (2 / N)) * (1 if c >= 0 else -1)
        y = (abs(s) ** (2 / N)) * (1 if s >= 0 else -1)
        pts.append((r + x * r, r + y * r))
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    body = src.resize((BODY, BODY), Image.LANCZOS)
    body.putalpha(squircle_mask(BODY))
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(body, ((SIZE - BODY) // 2, (SIZE - BODY) // 2), body)
    out.save(OUT)
    print(f"{OUT}: {SIZE}x{SIZE}, korpus {BODY}, squircle N={N}")


if __name__ == "__main__":
    main()
