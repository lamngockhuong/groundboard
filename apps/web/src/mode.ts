/**
 * Static mode: the page was written by `groundboard export` and reads its atlas from `data/`
 * next to it, with no server behind it. The export marks the page with
 * `<meta name="groundboard:mode" content="static">`.
 */

export const STATIC_MODE_SELECTOR = 'meta[name="groundboard:mode"][content="static"]';

let cached: boolean | undefined;

/** Whether `doc` carries the static-mode flag; the page's own answer is read once. */
export function isStaticMode(doc?: Document): boolean {
  if (doc) return doc.querySelector(STATIC_MODE_SELECTOR) !== null;
  if (cached === undefined) {
    cached =
      typeof document !== "undefined" && document.querySelector(STATIC_MODE_SELECTOR) !== null;
  }
  return cached;
}
