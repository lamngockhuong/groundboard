import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The fonts the rasteriser is given: the Excalidraw fonts the viewer ships, decompressed to
 * TrueType at build time (resvg reads no woff2), kept as Excalidraw's unicode-range subsets, plus
 * one merged copy of Nunito (scripts/build-fonts.mjs).
 *
 * Subsets stay as shipped: resvg finds a glyph missing from the chosen face in any other loaded
 * face, so Vietnamese and CJK text is drawn from the other Excalifont, Nunito and Xiaolai
 * subsets. Merging Excalifont into one file lost Vietnamese and Japanese glyphs. Nunito is the
 * exception: its subsets name themselves "Nunito ExtraLight Medium", while the SVG asks for
 * "Nunito", so a merged copy carrying that name is added beside them.
 */
export const FONT_DIR = fileURLToPath(new URL("./fonts/", import.meta.url));

/**
 * The order fonts are loaded in, which is the order resvg searches when the face it picked lacks
 * a glyph. Each Excalifont subset holds a few dozen glyphs, so Excalifont text is drawn through
 * that search: the Excalifont subsets must come first, or the text is drawn in whichever other
 * font comes first (Assistant or Cascadia, in alphabetical order). Families not listed follow.
 */
const FAMILY_ORDER = ["Excalifont", "Nunito", "Xiaolai", "Nunito-merged"];

/** Used when a text names no family the rasteriser has. */
export const DEFAULT_FONT_FAMILY = "Excalifont";

let cached: string[] | undefined;

export function fontFiles(dir = FONT_DIR): string[] {
  if (cached && dir === FONT_DIR) return cached;
  const rank = (file: string) => {
    const i = FAMILY_ORDER.indexOf(file.split(path.sep)[0] ?? "");
    return i === -1 ? FAMILY_ORDER.length : i;
  };
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ttf"))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((f) => path.join(dir, f));
  if (files.length === 0) throw new Error(`no fonts in ${dir}; the package is incomplete`);
  if (dir === FONT_DIR) cached = files;
  return files;
}
