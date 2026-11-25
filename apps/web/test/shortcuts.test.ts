import { afterEach, describe, expect, it } from "vitest";
import { readFlag, saveFlag } from "../src/prefs.ts";
import { isPageKey, isPaletteKey, isViewerKey, paletteKeyLabel } from "../src/shortcuts.ts";

function press(key: string, target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  let seen: KeyboardEvent | null = null;
  const listener = (event: Event) => {
    seen = event as KeyboardEvent;
  };
  document.addEventListener("keydown", listener);
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  document.removeEventListener("keydown", listener);
  if (!seen) throw new Error("no event");
  return seen;
}

describe("shortcuts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("takes a page key from the page, not from a field or the canvas", () => {
    document.body.innerHTML =
      '<button id="b"></button><input id="i"><div class="excalidraw"><div id="c"></div></div>';
    const at = (id: string) => document.getElementById(id) as Element;
    expect(isPageKey(press("/", at("b")), "/")).toBe(true);
    expect(isPageKey(press("/", at("i")), "/")).toBe(false);
    expect(isPageKey(press("/", at("c")), "/")).toBe(false);
    expect(isPageKey(press("/", at("b"), { ctrlKey: true }), "/")).toBe(false);
  });

  it("takes a viewer key on the canvas, but not while text is typed", () => {
    document.body.innerHTML =
      '<div class="excalidraw"><div id="c"></div><textarea id="t"></textarea></div>';
    expect(isViewerKey(press("]", document.getElementById("c") as Element), "]")).toBe(true);
    expect(isViewerKey(press("]", document.getElementById("t") as Element), "]")).toBe(false);
  });

  it("opens the palette with Ctrl K, or Cmd K on Apple platforms", () => {
    document.body.innerHTML = '<div id="x"></div>';
    const x = document.getElementById("x") as Element;
    expect(isPaletteKey(press("k", x, { ctrlKey: true }), false)).toBe(true);
    expect(isPaletteKey(press("K", x, { metaKey: true }), false)).toBe(false);
    expect(isPaletteKey(press("K", x, { metaKey: true }), true)).toBe(true);
    expect(isPaletteKey(press("k", x, { ctrlKey: true }), true)).toBe(false);
    expect(isPaletteKey(press("k", x), false)).toBe(false);
    expect(isPaletteKey(press("k", x, { ctrlKey: true, shiftKey: true }), false)).toBe(false);
  });
});

describe("paletteKeyLabel", () => {
  it("writes Cmd on Apple platforms and Ctrl elsewhere", () => {
    expect(paletteKeyLabel("MacIntel")).toBe("⌘K");
    expect(paletteKeyLabel("Win32")).toBe("Ctrl K");
    expect(paletteKeyLabel("Linux x86_64")).toBe("Ctrl K");
  });
});

describe("prefs", () => {
  afterEach(() => localStorage.clear());

  it("keeps an on/off choice and falls back when none is stored", () => {
    expect(readFlag("k", true)).toBe(true);
    saveFlag("k", false);
    expect(readFlag("k", true)).toBe(false);
    localStorage.setItem("k", "junk");
    expect(readFlag("k", false)).toBe(false);
  });
});
