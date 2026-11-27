# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools==4.60.1"]
# ///
"""Merges the Nunito subsets Excalidraw ships into fonts/Nunito.ttf, one face named "Nunito".

The SVG export asks for "Nunito", the name in Excalidraw's @font-face rule, but the subset files
call themselves "Nunito ExtraLight Medium"; resvg matches the name inside the file, so text set in
Nunito would fall back to another font. The merged face carries the @font-face name. The subsets
stay loaded beside it (see src/fonts.ts).

Run again after upgrading @excalidraw/excalidraw, and commit the result:

    node scripts/build-fonts.mjs
    uv run scripts/merge-nunito.py dist/fonts/Nunito fonts/Nunito.ttf

test/fonts.test.ts checks that the merged face still covers every subset.
"""
import sys
from pathlib import Path

from fontTools.merge import Merger

FAMILY = "Nunito"

src, out = Path(sys.argv[1]), Path(sys.argv[2])
files = sorted(src.glob("*.ttf"))
if not files:
    sys.exit(f"no .ttf files in {src}")
# The subsets share unitsPerEm; Merger renames glyph names that repeat across them.
merged = Merger().merge([str(f) for f in files])
for record in merged["name"].names:
    if record.nameID in (1, 16):
        record.string = FAMILY
    elif record.nameID == 4:
        record.string = f"{FAMILY} Regular"
    elif record.nameID in (2, 17):
        record.string = "Regular"
    elif record.nameID == 6:
        record.string = f"{FAMILY}-Regular"
merged.save(out)
print(f"{len(files)} subsets -> {out}, {out.stat().st_size // 1024} KiB")
