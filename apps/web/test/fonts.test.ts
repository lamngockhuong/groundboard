import { afterEach, describe, expect, it } from "vitest";
import {
  familyFor,
  originalFamilies,
  readFontPreference,
  saveFontPreference,
  withFontFamily,
} from "../src/fonts.ts";

const elements = [
  { id: "t1", type: "text", fontFamily: 5, text: "Cart" },
  { id: "t2", type: "text", fontFamily: 3, text: "cart.ts" },
  { id: "r1", type: "rectangle" },
];

describe("withFontFamily", () => {
  it("switches every text element and leaves shapes alone", () => {
    const out = withFontFamily(elements, 6, originalFamilies(elements));
    expect(out.map((e) => (e as { fontFamily?: number }).fontFamily)).toEqual([6, 6, undefined]);
    expect(out[2]).toBe(elements[2]);
  });

  it("puts back the drawn font when the family is null", () => {
    const originals = originalFamilies(elements);
    const switched = withFontFamily(elements, 2, originals);
    const restored = withFontFamily(switched, null, originals);
    expect(restored.map((e) => (e as { fontFamily?: number }).fontFamily)).toEqual([
      5,
      3,
      undefined,
    ]);
  });

  it("keeps the same object when the font already matches", () => {
    const out = withFontFamily(elements, 5, originalFamilies(elements));
    expect(out[0]).toBe(elements[0]);
    expect(out[1]).not.toBe(elements[1]);
  });
});

describe("font preference", () => {
  afterEach(() => localStorage.clear());

  it("defaults to the plain sans font", () => {
    expect(readFontPreference()).toBe("sans");
    expect(familyFor("sans")).toBe(6);
    expect(familyFor("board")).toBeNull();
  });

  it("remembers 'As drawn' and forgets the default", () => {
    saveFontPreference("board");
    expect(readFontPreference()).toBe("board");
    saveFontPreference("sans");
    expect(localStorage.getItem("groundboard.font")).toBeNull();
  });

  it("ignores an unknown stored value", () => {
    localStorage.setItem("groundboard.font", "comic");
    expect(readFontPreference()).toBe("sans");
  });
});
