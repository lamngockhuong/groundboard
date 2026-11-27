"""Merges the unicode-range subset files of one Excalidraw font family into a single TTF.

resvg picks one face per family name, so a family split into subsets (as Excalidraw ships
them, for the browser's unicode-range loading) loses every glyph outside the face it picked.
A real build would run this once at package time; the CLI would ship the merged files.

    python merge-subsets.py <ttf-dir-of-one-family> <out.ttf> [family-name]

The browser finds these fonts by the name in Excalidraw's @font-face rule, not by the name inside
the file, and the two differ (Nunito's file calls itself "Nunito ExtraLight Medium"); resvg reads
the name inside the file, so the merged file is renamed to the @font-face name.
"""
import sys
from pathlib import Path

from fontTools.merge import Merger
from fontTools.ttLib import TTFont

src, out = Path(sys.argv[1]), Path(sys.argv[2])
files = sorted(src.glob("*.ttf"))
# Merger needs the same unitsPerEm everywhere (true for these subsets) and dislikes duplicate
# glyph names across inputs; it renames them, which is fine for rendering.
merged = Merger().merge([str(f) for f in files])
family = sys.argv[3] if len(sys.argv) > 3 else src.name
for rec in merged["name"].names:
    if rec.nameID in (1, 16):
        rec.string = family
    elif rec.nameID in (4,):
        rec.string = f"{family} Regular"
    elif rec.nameID == 17:
        rec.string = "Regular"
merged.save(out)
font = TTFont(out)
cmap = font.getBestCmap()
print(f"{src.name}: {len(files)} subsets -> {out.name}, {len(cmap)} code points, {out.stat().st_size // 1024} KiB;"
      f" a={0x61 in cmap} o-dot-below={0x1ECD in cmap} arrow={0x2192 in cmap}")
