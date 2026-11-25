import type { Platform } from "./ref.ts";

/**
 * Sizes of a screen wireframe that both the validator and the layout read, so a board that
 * validates never needs more room than the layout gives it.
 */

/** Default content width of a screen frame by platform; `screen.width` overrides it. */
export const SCREEN_WIDTH: Record<Platform, number> = { web: 960, mobile: 360 };
/** Bounds of `screen.width` by platform, inclusive. */
export const SCREEN_WIDTH_BOUNDS: Record<Platform, { min: number; max: number }> = {
  web: { min: 320, max: 1920 },
  mobile: { min: 280, max: 600 },
};
/** Upper bound of `width` on any node. */
export const MAX_NODE_WIDTH = 4000;
/** Space between a frame or container edge and its children. */
export const WIREFRAME_PADDING = 12;
/** Space between siblings. */
export const WIREFRAME_GAP = 8;
/** Narrowest width a label is wrapped to; a flexible child of a row gets at least this much. */
export const MIN_WRAP_WIDTH = 8;

/**
 * Splits the inner width of a row among its children: a child with a fixed width gets it, and
 * the rest, minus the gaps, is shared evenly by the children without one. Returns each child's
 * left offset and width; children with fixed widths only are left-aligned.
 */
export function rowCells(
  inner: number,
  widths: ReadonlyArray<number | undefined>,
): Array<{ x: number; width: number }> {
  const n = widths.length;
  if (n === 0) return [];
  let fixed = 0;
  let flexible = 0;
  for (const width of widths) {
    if (width === undefined) flexible++;
    else fixed += width;
  }
  const share =
    flexible === 0 ? 0 : Math.max(0, (inner - WIREFRAME_GAP * (n - 1) - fixed) / flexible);
  const cells: Array<{ x: number; width: number }> = [];
  let x = 0;
  for (const width of widths) {
    const cell = width ?? share;
    cells.push({ x, width: cell });
    x += cell + WIREFRAME_GAP;
  }
  return cells;
}
