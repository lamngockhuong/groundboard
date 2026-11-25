/**
 * Reading fonts the viewer can switch board text to. Every family here is either shipped
 * with the viewer (see font-licenses/fonts.json) or a local system font, so switching never
 * contacts a CDN. The numbers are Excalidraw's `fontFamily` ids.
 */
export const READING_FONTS = [
  { id: "board", family: null },
  { id: "hand", family: 5 },
  { id: "sans", family: 6 },
  { id: "system", family: 2 },
  { id: "mono", family: 3 },
] as const;

export type ReadingFontId = (typeof READING_FONTS)[number]["id"];

const FONT_KEY = "groundboard.font";

export function isReadingFontId(value: unknown): value is ReadingFontId {
  return READING_FONTS.some((f) => f.id === value);
}

export function familyFor(id: ReadingFontId): number | null {
  return READING_FONTS.find((f) => f.id === id)?.family ?? null;
}

/** Plain sans by default: the hand-drawn font is hard to read in dense boards. */
export const DEFAULT_READING_FONT: ReadingFontId = "sans";

/** The font the viewer last picked, or the default when none is stored or storage is blocked. */
export function readFontPreference(): ReadingFontId {
  try {
    const stored = localStorage.getItem(FONT_KEY);
    return isReadingFontId(stored) ? stored : DEFAULT_READING_FONT;
  } catch {
    return DEFAULT_READING_FONT;
  }
}

export function saveFontPreference(id: ReadingFontId): void {
  try {
    if (id === DEFAULT_READING_FONT) localStorage.removeItem(FONT_KEY);
    else localStorage.setItem(FONT_KEY, id);
  } catch {
    // Storage is blocked; the choice lasts for this page load.
  }
}

interface TextLike {
  id: string;
  type: string;
  fontFamily?: number;
}

const isText = (el: unknown): el is TextLike =>
  typeof el === "object" &&
  el !== null &&
  (el as TextLike).type === "text" &&
  typeof (el as TextLike).id === "string";

/** The font each text element was drawn with, so "As drawn" can put it back. */
export function originalFamilies(elements: readonly unknown[]): Map<string, number> {
  const families = new Map<string, number>();
  for (const el of elements) {
    if (isText(el) && typeof el.fontFamily === "number") families.set(el.id, el.fontFamily);
  }
  return families;
}

/**
 * Text elements switched to `family`, or back to their drawn font when `family` is null.
 * Other elements, and text elements that already use the target font, are returned as-is.
 */
export function withFontFamily<T>(
  elements: readonly T[],
  family: number | null,
  originals: ReadonlyMap<string, number>,
): T[] {
  return elements.map((el) => {
    if (!isText(el)) return el;
    const target = family ?? originals.get(el.id);
    if (target === undefined || el.fontFamily === target) return el;
    return { ...el, fontFamily: target };
  });
}
