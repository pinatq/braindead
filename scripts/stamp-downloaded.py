#!/usr/bin/env python3
"""Ustawia macOS-owy „downloaded date" (Spotlight/Finder) na podanych plikach.

macOS trzyma tę datę w rozszerzonym atrybucie `com.apple.metadata:kMDItemDownloadedDate`
— binarny plist z tablicą dat. Finder pokazuje ją w Get Info, `mdls` w kMDItemDownloadedDate.
Bez argumentu daty bierze „teraz".

    python3 scripts/stamp-downloaded.py /Applications/BrainDead.app release/*.dmg
"""
import plistlib
import subprocess
import sys
from datetime import datetime, timezone

ATTR = "com.apple.metadata:kMDItemDownloadedDate"


def stamp(path: str, when: datetime) -> None:
    # Binarny plist liczy daty od 2001-01-01 UTC, a plistlib przyjmuje tu datę *naiwną* —
    # stąd konwersja na UTC i zdjęcie strefy (inaczej TypeError na Pythonie 3.12+).
    utc = when.astimezone(timezone.utc).replace(tzinfo=None)
    blob = plistlib.dumps([utc], fmt=plistlib.FMT_BINARY)
    subprocess.run(["xattr", "-wx", ATTR, blob.hex(), path], check=True)
    # Data modyfikacji też na teraz — Finder sortuje po niej w widoku „ostatnie".
    subprocess.run(["touch", "-t", when.strftime("%Y%m%d%H%M.%S"), path], check=True)
    print(f"{path}: {when.isoformat(timespec='seconds')}")


def main() -> None:
    paths = sys.argv[1:]
    if not paths:
        sys.exit("użycie: stamp-downloaded.py <ścieżka> [ścieżka…]")
    now = datetime.now().astimezone()
    for p in paths:
        stamp(p, now)


if __name__ == "__main__":
    main()
