import { afterEach, describe, expect, it } from "vitest";
import { readFlag, saveFlag } from "../src/prefs.ts";
import {
  historyKeyWins,
  isHistoryKey,
  isPageKey,
  isPaletteKey,
  isViewerKey,
  paletteKeyLabel,
} from "../src/shortcuts.ts";

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

  it("reads Alt ← and Alt → as Back and Forward, on the canvas too", () => {
    document.body.innerHTML =
      '<button id="b"></button><div class="excalidraw"><div id="c"></div></div>';
    const at = (id: string) => document.getElementById(id) as Element;
    expect(isHistoryKey(press("ArrowLeft", at("b"), { altKey: true }))).toBe("back");
    expect(isHistoryKey(press("ArrowRight", at("c"), { altKey: true }))).toBe("forward");
    expect(isHistoryKey(press("ArrowLeft", at("b")))).toBeNull();
    expect(isHistoryKey(press("ArrowUp", at("b"), { altKey: true }))).toBeNull();
  });

  it("leaves Alt and an arrow alone with another modifier, in a field, or once handled", () => {
    document.body.innerHTML =
      '<button id="b"></button><input id="i"><textarea id="t"></textarea><div id="e" contenteditable="true"></div>';
    const at = (id: string) => document.getElementById(id) as Element;
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(isHistoryKey(press("ArrowLeft", at("b"), { altKey: true, ...extra }))).toBeNull();
    }
    for (const id of ["i", "t"]) {
      expect(isHistoryKey(press("ArrowLeft", at(id), { altKey: true }))).toBeNull();
    }
    const editable = at("e") as HTMLElement;
    // jsdom does not compute isContentEditable from the attribute.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isHistoryKey(press("ArrowLeft", editable, { altKey: true }))).toBeNull();
    at("b").addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    const handled = press("ArrowLeft", at("b"), { altKey: true, cancelable: true });
    expect(isHistoryKey(handled)).toBeNull();
  });

  it("takes a history key only while nothing is selected on the canvas", () => {
    document.body.innerHTML = '<div class="excalidraw"><div id="c"></div></div>';
    const event = press("ArrowLeft", document.getElementById("c") as Element, { altKey: true });
    expect(historyKeyWins(event, 0)).toBe(true);
    expect(historyKeyWins(event, 2)).toBe(false);
    expect(historyKeyWins(press("ArrowLeft", document.body), 0)).toBe(false);
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
