import metrics from "./font-metrics.json" with { type: "json" };

/** Excalifont line height, as Excalidraw uses it. */
export const LINE_HEIGHT = 1.25;

/** Measured widths are widened by this factor so a label never overflows its shape. */
export const WIDTH_SAFETY = 1.05;

const widths = metrics.widths as Record<string, number>;
const unitsPerEm = metrics.unitsPerEm;

/** Advance width in font units; code points the font lacks (CJK and others) count as 1 em. */
function advance(codePoint: number): number {
  return widths[codePoint] ?? unitsPerEm;
}

/** Raw width of one line in pixels, without the safety margin. */
export function lineWidth(line: string, fontSize: number): number {
  let units = 0;
  for (const char of line) units += advance(char.codePointAt(0) as number);
  return (units * fontSize) / unitsPerEm;
}

export interface TextSize {
  width: number;
  height: number;
}

/** Size of a (possibly multi-line) text block as Excalidraw lays it out. */
export function measureText(text: string, fontSize: number): TextSize {
  const lines = text.split("\n");
  const widest = Math.max(0, ...lines.map((line) => lineWidth(line, fontSize)));
  return {
    width: Math.ceil(widest * WIDTH_SAFETY),
    height: Math.ceil(lines.length * fontSize * LINE_HEIGHT),
  };
}

const CJK_RANGES =
  "\\u1100-\\u11ff\\u2e80-\\u2fdf\\u3000-\\u30ff\\u3100-\\u31ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uac00-\\ud7af\\uf900-\\ufaff\\uff00-\\uffef";
/** Breakable units: whitespace runs, single CJK characters, and words. */
const TOKEN = new RegExp(`\\s+|[${CJK_RANGES}]|[^\\s${CJK_RANGES}]+`, "gu");

function breakByChars(token: string, maxWidth: number, fontSize: number): string[] {
  const parts: string[] = [];
  let current = "";
  for (const char of token) {
    if (current && lineWidth(current + char, fontSize) * WIDTH_SAFETY > maxWidth) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Breaks a word wider than `maxWidth`: after `/` where possible (paths), else per character. */
function breakLongToken(token: string, maxWidth: number, fontSize: number): string[] {
  const fits = (s: string) => lineWidth(s, fontSize) * WIDTH_SAFETY <= maxWidth;
  const parts: string[] = [];
  let current = "";
  for (const piece of token.match(/[^/]*\/|[^/]+$/g) ?? [token]) {
    if (fits(current + piece)) {
      current += piece;
      continue;
    }
    if (current) parts.push(current);
    if (fits(piece)) {
      current = piece;
    } else {
      const chars = breakByChars(piece, maxWidth, fontSize);
      parts.push(...chars.slice(0, -1));
      current = chars.at(-1) ?? "";
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Wraps text so no line is wider than `maxWidth` pixels: on word boundaries, per character
 * for CJK text, and inside a single word only when that word alone is too wide.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number): string {
  const fits = (line: string) => lineWidth(line, fontSize) * WIDTH_SAFETY <= maxWidth;
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const token of paragraph.match(TOKEN) ?? []) {
      const isSpace = /^\s+$/u.test(token);
      if (isSpace) {
        line += line ? token : "";
        continue;
      }
      if (fits(line + token)) {
        line += token;
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = "";
      if (fits(token)) {
        line = token;
      } else {
        const parts = breakLongToken(token, maxWidth, fontSize);
        out.push(...parts.slice(0, -1));
        line = parts.at(-1) ?? "";
      }
    }
    out.push(line.trimEnd());
  }
  return out.join("\n");
}
