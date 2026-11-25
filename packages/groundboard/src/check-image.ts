import type { Box } from "./figma-metadata.ts";
import type { RgbaImage } from "./png.ts";

/**
 * The check image `groundboard figma entry` writes for the agent to read: the frame image with
 * the frame's outline and every cited layer's box drawn on it, each box labelled with the ids of
 * the elements citing it. A misplaced origin or box shows at a glance.
 */

type Rgb = readonly [number, number, number];
const FRAME_COLOUR: Rgb = [224, 49, 49];
const BOX_COLOUR: Rgb = [25, 113, 194];
const LABEL_TEXT: Rgb = [255, 255, 255];

// A 5×7 bitmap font: rows top to bottom, `#` is ink. Lower case is drawn as upper case.
const GLYPHS: Record<string, string> = {
  A: ".###. #...# #...# ##### #...# #...# #...#",
  B: "####. #...# #...# ####. #...# #...# ####.",
  C: ".###. #...# #.... #.... #.... #...# .###.",
  D: "####. #...# #...# #...# #...# #...# ####.",
  E: "##### #.... #.... ####. #.... #.... #####",
  F: "##### #.... #.... ####. #.... #.... #....",
  G: ".###. #...# #.... #.### #...# #...# .####",
  H: "#...# #...# #...# ##### #...# #...# #...#",
  I: ".###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.",
  J: "..### ...#. ...#. ...#. ...#. #..#. .##..",
  K: "#...# #..#. #.#.. ##... #.#.. #..#. #...#",
  L: "#.... #.... #.... #.... #.... #.... #####",
  M: "#...# ##.## #.#.# #.#.# #...# #...# #...#",
  N: "#...# #...# ##..# #.#.# #..## #...# #...#",
  O: ".###. #...# #...# #...# #...# #...# .###.",
  P: "####. #...# #...# ####. #.... #.... #....",
  Q: ".###. #...# #...# #...# #.#.# #..#. .##.#",
  R: "####. #...# #...# ####. #.#.. #..#. #...#",
  S: ".#### #.... #.... .###. ....# ....# ####.",
  T: "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
  U: "#...# #...# #...# #...# #...# #...# .###.",
  V: "#...# #...# #...# #...# #...# .#.#. ..#..",
  W: "#...# #...# #...# #.#.# #.#.# #.#.# .#.#.",
  X: "#...# #...# .#.#. ..#.. .#.#. #...# #...#",
  Y: "#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..",
  Z: "##### ....# ...#. ..#.. .#... #.... #####",
  "0": ".###. #...# #..## #.#.# ##..# #...# .###.",
  "1": "..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.",
  "2": ".###. #...# ....# ...#. ..#.. .#... #####",
  "3": "##### ...#. ..#.. ...#. ....# #...# .###.",
  "4": "...#. ..##. .#.#. #..#. ##### ...#. ...#.",
  "5": "##### #.... ####. ....# ....# #...# .###.",
  "6": "..##. .#... #.... ####. #...# #...# .###.",
  "7": "##### ....# ...#. ..#.. .#... .#... .#...",
  "8": ".###. #...# #...# .###. #...# #...# .###.",
  "9": ".###. #...# #...# .#### ....# ...#. .##..",
  "-": "..... ..... ..... ##### ..... ..... .....",
  _: "..... ..... ..... ..... ..... ..... #####",
  ".": "..... ..... ..... ..... ..... .##.. .##..",
  ":": "..... .##.. .##.. ..... .##.. .##.. .....",
  ",": "..... ..... ..... ..... .##.. ..#.. .#...",
  " ": "..... ..... ..... ..... ..... ..... .....",
  "?": ".###. #...# ....# ...#. ..#.. ..... ..#..",
};
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const SCALE = 2;
const PAD = 2;

function setPixel(image: RgbaImage, x: number, y: number, colour: Rgb): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const at = (y * image.width + x) * 4;
  image.data[at] = colour[0];
  image.data[at + 1] = colour[1];
  image.data[at + 2] = colour[2];
  image.data[at + 3] = 255;
}

function fillRect(image: RgbaImage, x: number, y: number, w: number, h: number, colour: Rgb) {
  for (let row = Math.max(0, y); row < Math.min(image.height, y + h); row++)
    for (let column = Math.max(0, x); column < Math.min(image.width, x + w); column++)
      setPixel(image, column, row, colour);
}

function strokeRect(image: RgbaImage, box: Box, colour: Rgb, thickness: number): void {
  const [x, y, w, h] = box.map(Math.round) as Box;
  fillRect(image, x, y, w, thickness, colour);
  fillRect(image, x, y + h - thickness, w, thickness, colour);
  fillRect(image, x, y, thickness, h, colour);
  fillRect(image, x + w - thickness, y, thickness, h, colour);
}

/** Width in pixels of `text` drawn by `drawLabel`, padding included. */
export function labelWidth(text: string): number {
  return text.length * (GLYPH_WIDTH + 1) * SCALE - SCALE + 2 * PAD;
}

function drawLabel(image: RgbaImage, x: number, y: number, text: string, background: Rgb): void {
  const height = GLYPH_HEIGHT * SCALE + 2 * PAD;
  fillRect(image, x, y, labelWidth(text), height, background);
  [...text].forEach((character, index) => {
    const glyph = GLYPHS[character.toUpperCase()] ?? GLYPHS["?"] ?? "";
    const rows = glyph.split(" ");
    const left = x + PAD + index * (GLYPH_WIDTH + 1) * SCALE;
    rows.forEach((row, r) => {
      [...row].forEach((cell, c) => {
        if (cell === "#")
          fillRect(image, left + c * SCALE, y + PAD + r * SCALE, SCALE, SCALE, LABEL_TEXT);
      });
    });
  });
}

/**
 * A copy of `image` with the frame outline (red) at `origin` and each cited layer's box (blue)
 * at `origin + box`, labelled with the element ids citing it, separated by commas.
 */
export function drawCheckImage(
  image: RgbaImage,
  frame: { width: number; height: number },
  origin: { x: number; y: number },
  boxes: ReadonlyArray<{ box: Box; label: string }>,
): RgbaImage {
  const out: RgbaImage = { width: image.width, height: image.height, data: image.data.slice() };
  strokeRect(out, [origin.x, origin.y, frame.width, frame.height], FRAME_COLOUR, 2);
  for (const { box } of boxes) {
    strokeRect(out, [origin.x + box[0], origin.y + box[1], box[2], box[3]], BOX_COLOUR, 2);
  }
  // labels after every box, so no box is drawn over a label
  for (const { box, label } of boxes) {
    drawLabel(out, Math.round(origin.x + box[0]), Math.round(origin.y + box[1]), label, BOX_COLOUR);
  }
  return out;
}
