/**
 * Edit mode locks every element a person may not drag (the nodes inside a screen, resource or
 * table, the arrows), and Excalidraw never picks a locked element under the pointer. These
 * elements must still be selectable, to edit or remove them from the panel, so the viewer finds
 * what is under the pointer itself.
 */

interface ElementLike {
  id?: unknown;
  type?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  points?: unknown;
  isDeleted?: boolean;
  locked?: boolean;
  containerId?: unknown;
  customData?: unknown;
}

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

const dataOf = (el: ElementLike): Record<string, unknown> | null => {
  const data = (el.customData as { groundboard?: unknown } | null | undefined)?.groundboard;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
};

/**
 * Whether an element stands for a node, an edge or a fragment operand of the board, rather than
 * a note or chrome.
 */
const isBoardItem = (el: ElementLike): boolean => {
  const data = dataOf(el);
  return (
    data !== null &&
    data.overlay !== true &&
    (typeof data.nodeId === "string" ||
      typeof data.edgeId === "string" ||
      typeof data.operandId === "string")
  );
};

/** A fragment's frame on a sequence board: hit on its outline only, so its inside stays free. */
const isFragmentFrame = (el: ElementLike): boolean =>
  el.type === "rectangle" && typeof el.id === "string" && el.id.startsWith("fragment/");

function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * How closely the point hits the element: 0 on a line, the area of a box that holds it (the
 * smallest box is the most precise hit), null for a miss.
 */
function hitScore(el: ElementLike, p: { x: number; y: number }, tolerance: number): number | null {
  const x = num(el.x);
  const y = num(el.y);
  if ((el.type === "arrow" || el.type === "line") && Array.isArray(el.points)) {
    const points = (el.points as unknown[]).map((pt) => {
      const [px, py] = Array.isArray(pt) ? pt : [0, 0];
      return { x: x + num(px), y: y + num(py) };
    });
    for (let i = 1; i < points.length; i++) {
      if (distanceToSegment(p, points[i - 1] as never, points[i] as never) <= tolerance) return 0;
    }
    return null;
  }
  const left = Math.min(x, x + num(el.width));
  const top = Math.min(y, y + num(el.height));
  const width = Math.abs(num(el.width));
  const height = Math.abs(num(el.height));
  const inside = p.x >= left && p.x <= left + width && p.y >= top && p.y <= top + height;
  if (inside && isFragmentFrame(el)) {
    const edge = Math.min(p.x - left, left + width - p.x, p.y - top, top + height - p.y);
    return edge <= tolerance ? 0 : null;
  }
  return inside ? width * height : null;
}

/**
 * The id of the locked board element under a scene point, for the viewer to select; null when
 * what is under the point is not locked (Excalidraw picks it then) or is not a node or an edge.
 * A label inside a box or on an arrow stands for that box or arrow. `tolerance` is how far from
 * a line still hits it, in scene units.
 */
export function lockedItemAt(
  elements: readonly unknown[],
  point: { x: number; y: number },
  tolerance: number,
): string | null {
  const live = (elements as ElementLike[]).filter((el) => el.isDeleted !== true);
  const byId = new Map(live.map((el) => [el.id, el]));
  let best: { el: ElementLike; score: number } | null = null;
  // Later elements are drawn on top, so on a tie the later one wins.
  for (const el of live) {
    // A locked element that stands for nothing (a lifeline, the legend) never hides what is
    // under it.
    if (el.locked === true && dataOf(el) === null && typeof el.containerId !== "string") continue;
    const score = hitScore(el, point, tolerance);
    if (score === null) continue;
    if (best === null || score <= best.score) best = { el, score };
  }
  if (best === null || best.el.locked !== true) return null;
  const container =
    typeof best.el.containerId === "string" ? byId.get(best.el.containerId) : undefined;
  const item = isBoardItem(best.el)
    ? best.el
    : container && isBoardItem(container)
      ? container
      : null;
  return item && typeof item.id === "string" ? item.id : null;
}
