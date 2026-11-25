import type { ReferenceCount } from "./api.ts";
import { tn } from "./i18n.ts";

/**
 * Reference images: the Figma frame a screen was drawn from, placed beside its wireframe with
 * the wireframe's marks over it. Every element they add has an id starting with this prefix.
 */
export const REFERENCE_PREFIX = "refimg/";
/** The prefix of scenes rendered before element ids were `/`-separated. */
const LEGACY_REFERENCE_PREFIX = "refimg-";

interface ElementLike {
  id?: unknown;
  isDeleted?: boolean;
  version?: number;
}

export function isReferenceElement(element: unknown): boolean {
  if (typeof element !== "object" || element === null) return false;
  const id = (element as ElementLike).id;
  return (
    typeof id === "string" &&
    (id.startsWith(REFERENCE_PREFIX) || id.startsWith(LEGACY_REFERENCE_PREFIX))
  );
}

/** Whether a scene holds a reference image, so the toolbar offers to hide it. */
export function hasReferences(elements: readonly unknown[]): boolean {
  return elements.some(isReferenceElement);
}

/**
 * The elements with every reference element shown or hidden (marked deleted, which Excalidraw
 * neither draws nor exports). Elements already in that state are returned as they are.
 */
export function withReferencesShown<T>(elements: readonly T[], shown: boolean): T[] {
  return elements.map((element) => {
    if (!isReferenceElement(element)) return element;
    const el = element as T & ElementLike;
    if ((el.isDeleted === true) === !shown) return element;
    return { ...el, isDeleted: !shown, version: (el.version ?? 1) + 1 };
  });
}

/**
 * The status line of a board that cites Figma frames but has no image of any of them cached,
 * with how to fetch them; null otherwise.
 */
export function missingReferencesNote(count: ReferenceCount | undefined): string | null {
  if (count === undefined || count.frames === 0 || count.cached > 0) return null;
  return tn("references.missing", count.frames);
}
