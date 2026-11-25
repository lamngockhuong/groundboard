// Minimal typings for the part of fontkit the metrics script uses.
declare module "fontkit" {
  export interface Glyph {
    id: number;
    advanceWidth: number;
  }
  export interface Font {
    unitsPerEm: number;
    characterSet: number[];
    glyphForCodePoint(codePoint: number): Glyph;
  }
  export function openSync(path: string): Font | { fonts: Font[] };
}
