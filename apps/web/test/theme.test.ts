import { afterEach, describe, expect, it } from "vitest";
import {
  applyStyle,
  applyTheme,
  isThemeStyle,
  readStylePreference,
  readThemePreference,
  resolveTheme,
  saveStylePreference,
  saveThemePreference,
  THEME_STYLES,
} from "../src/theme.ts";

describe("theme", () => {
  afterEach(() => localStorage.clear());

  it("follows the system until a theme is picked", () => {
    expect(readThemePreference()).toBe("system");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("remembers a fixed theme and forgets 'system'", () => {
    saveThemePreference("dark");
    expect(readThemePreference()).toBe("dark");
    saveThemePreference("system");
    expect(localStorage.getItem("groundboard.theme")).toBeNull();
  });

  it("ignores an unknown stored value", () => {
    localStorage.setItem("groundboard.theme", "sepia");
    expect(readThemePreference()).toBe("system");
  });

  it("marks the document with the theme", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("theme style", () => {
  afterEach(() => localStorage.clear());

  it("starts on the classic style", () => {
    expect(readStylePreference()).toBe("classic");
  });

  it("remembers a picked style and forgets the default", () => {
    saveStylePreference("blueprint");
    expect(readStylePreference()).toBe("blueprint");
    saveStylePreference("classic");
    expect(localStorage.getItem("groundboard.style")).toBeNull();
  });

  it("ignores an unknown stored style", () => {
    localStorage.setItem("groundboard.style", "neon");
    expect(readStylePreference()).toBe("classic");
    expect(isThemeStyle("neon")).toBe(false);
  });

  it("offers each style once, with swatches for both themes", () => {
    const ids = THEME_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const style of THEME_STYLES) {
      expect(Object.keys(style.swatches).sort()).toEqual(["dark", "light"]);
    }
  });

  it("marks the document with the style", () => {
    applyStyle("signal");
    expect(document.documentElement.dataset.style).toBe("signal");
  });
});
