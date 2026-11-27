import { parseHTML } from "linkedom";

type Global = Record<string, unknown>;

let installed: Window | undefined;

/**
 * Gives Excalidraw's export code the browser globals it reaches, on top of linkedom's DOM:
 * `window`, `document`, `navigator`, a canvas whose `measureText` returns a fixed advance, a
 * `FontFace` that loads nothing and an empty `document.fonts`. Excalidraw must be imported only
 * after this runs, because its modules read `window` when they load.
 *
 * The fake measurement is enough because a groundboard scene already carries its wrapped text and
 * the widths of every element; export never re-measures text it does not wrap. Fonts are given
 * to the rasteriser by name instead (see fonts.ts), so `FontFace` and `document.fonts` only need
 * to exist.
 */
export function installDom(): Window {
  if (installed) return installed;
  const w = parseHTML(
    "<!doctype html><html><head></head><body></body></html>",
  ) as unknown as Global;
  const g = globalThis as unknown as Global;
  if (!w.HTMLCanvasElement) w.HTMLCanvasElement = class {};
  if (!w.location) w.location = new URL("http://localhost/");
  if (!w.XMLSerializer) {
    w.XMLSerializer = class {
      serializeToString(node: { outerHTML: string }) {
        return node.outerHTML;
      }
    };
  }
  const names = [
    ...Object.getOwnPropertyNames(w),
    "Element",
    "Node",
    "HTMLElement",
    "SVGElement",
    "Document",
    "DocumentFragment",
    "Text",
    "Event",
    "CustomEvent",
    "EventTarget",
    "HTMLCanvasElement",
    "HTMLImageElement",
    "Image",
    "DOMParser",
    "XMLSerializer",
    "MutationObserver",
    "getComputedStyle",
  ];
  for (const key of names) {
    if (key in g) continue;
    try {
      g[key] = w[key];
    } catch {
      // A read-only global Node already has; Excalidraw uses Node's own.
    }
  }
  g.window = w;
  g.document = w.document;
  Object.defineProperty(g, "navigator", { value: w.navigator, configurable: true });
  g.devicePixelRatio = 1;
  (w.HTMLCanvasElement as { prototype: Global }).prototype.getContext = () => ({
    measureText: (s: string) => ({
      width: s.length * 8,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
    }),
    font: "",
  });
  g.FontFace = class {
    status = "loaded";
    constructor(family: string, source: unknown, descriptors?: object) {
      Object.assign(this, { family, source, ...descriptors });
    }
    load() {
      return Promise.resolve(this);
    }
  };
  Object.defineProperty(w.document, "fonts", {
    value: {
      add() {},
      delete() {},
      has: () => false,
      check: () => true,
      load: () => Promise.resolve([]),
      ready: Promise.resolve(),
      *[Symbol.iterator]() {},
      forEach() {},
      status: "loaded",
    },
  });
  installed = w as unknown as Window;
  return installed;
}
