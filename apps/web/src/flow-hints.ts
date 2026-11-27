import { missingFlowRefs } from "@groundboard/schema";
import type { AtlasIndex } from "./api.ts";
import { t } from "./i18n.ts";

/**
 * Which elements call an API or change state with no flow drawn for them yet. The source panel,
 * the marks on the canvas and the atlas home all read the same set, so their counts agree, and
 * the set is the one `atlas check` warns about.
 */

const EMPTY: ReadonlySet<string> = new Set();

/** The refs of the atlas that need a flow and have none; empty with no atlas (a pasted board). */
export function missingFlowSet(atlas: AtlasIndex | null): ReadonlySet<string> {
  if (atlas === null) return EMPTY;
  // An invalid board was never read: it neither defines a ref nor covers one.
  const kinds = new Map(
    atlas.boards.filter((b) => b.status !== "invalid").map((b) => [b.slug, b.kind]),
  );
  const missing = missingFlowRefs(atlas.refs, (slug) => kinds.get(slug));
  return missing.length === 0 ? EMPTY : new Set(missing);
}

/** Longest label a prompt quotes; a longer one is cut with an ellipsis. */
const MAX_LABEL = 120;

/** One line of text with no backticks, so it reads cleanly inside the prompt. */
function tidy(text: string): string {
  const flat = text.replace(/`/g, "").replace(/\s+/g, " ").trim();
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
}

/**
 * The line a reader copies to ask for the missing flow, in the interface language: the board
 * skill, the element's label, the screen it is on and its ref. Always a single line.
 */
export function flowPrompt({
  label,
  screen,
  ref,
}: {
  label?: string;
  screen?: string;
  ref: string;
}): string {
  const name = tidy(label ?? "") || ref;
  const on = tidy(screen ?? "") || ref.split("/")[0] || ref;
  return t("flowHint.prompt", { label: name, screen: on, ref: tidy(ref) });
}

/** Copies text to the clipboard; false when the browser refuses (as a sandboxed frame may). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Where a mark goes: the box of an element that has no flow yet, in scene coordinates. */
export interface FlowHintBox {
  nodeId: string;
  ref: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SceneElementLike {
  id?: unknown;
  isDeleted?: boolean;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  customData?: unknown;
}

/**
 * The boxes of the elements whose ref has no flow yet, one per board node: the node's own
 * element (`node/<id>`, or `node-<id>` in older scenes), not its marks or labels. Deleted
 * elements are skipped.
 */
export function flowHintBoxes(
  elements: readonly unknown[],
  missing: ReadonlySet<string>,
): FlowHintBox[] {
  if (missing.size === 0) return [];
  const boxes = new Map<string, FlowHintBox & { main: boolean }>();
  for (const item of elements) {
    if (typeof item !== "object" || item === null) continue;
    const el = item as SceneElementLike;
    if (el.isDeleted === true) continue;
    const data = (el.customData as { groundboard?: Record<string, unknown> } | null | undefined)
      ?.groundboard;
    if (data?.kind !== "element" || typeof data.nodeId !== "string") continue;
    if (typeof data.ref !== "string" || !missing.has(data.ref)) continue;
    if (typeof el.x !== "number" || typeof el.y !== "number") continue;
    const nodeId = data.nodeId;
    const main = el.id === `node/${nodeId}` || el.id === `node-${nodeId}`;
    const known = boxes.get(nodeId);
    // The node's own element wins over any other element that carries its data.
    if (known && (known.main || !main)) continue;
    boxes.set(nodeId, {
      nodeId,
      ref: data.ref,
      x: el.x,
      y: el.y,
      width: typeof el.width === "number" ? el.width : 0,
      height: typeof el.height === "number" ? el.height : 0,
      main,
    });
  }
  return [...boxes.values()].map(({ main: _main, ...box }) => box);
}
