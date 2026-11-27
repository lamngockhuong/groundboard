import { type ElementRole, missingFlowRefs, parseRef } from "@groundboard/schema";
import type { AtlasIndex, AtlasPlace } from "./api.ts";
import { orderedBoards } from "./atlas-nav.ts";
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

/** The elements with no flow yet on one screen board, in ref order. */
export interface MissingFlowGroup {
  slug: string;
  title: string;
  items: MissingFlowItem[];
}

/** One element with no flow yet, as the atlas home lists it. */
export interface MissingFlowItem {
  ref: string;
  nodeId: string;
  /**
   * The ref without the screen part the group already names (`import` for `web:upload/import`
   * under `web--upload`), or the full ref when it belongs to another screen.
   */
  shortRef: string;
  /** The text the element shows, when the index carries it. */
  label?: string;
  /** What the element is drawn as, when the index carries it. */
  role?: ElementRole;
}

/** The screen ref a screen board defines (`web:upload` on `web--upload`), when it has one. */
function screenRefOn(atlas: AtlasIndex, slug: string): string | undefined {
  for (const entry of atlas.refs) {
    const parsed = parseRef(entry.ref);
    if (parsed === null || !("screen" in parsed) || parsed.element !== undefined) continue;
    if (entry.definedIn.some((p) => p.slug === slug)) return entry.ref;
  }
  return undefined;
}

/**
 * The screen part the refs of a group share: the screen ref its board defines, or else the one
 * screen every listed ref belongs to; undefined when the refs belong to several screens.
 */
function groupPrefix(
  atlas: AtlasIndex,
  slug: string,
  items: ReadonlyArray<{ ref: string }>,
): string | undefined {
  const own = screenRefOn(atlas, slug);
  if (own !== undefined) return own;
  const screens = new Set(
    items.map((item) => {
      const parsed = parseRef(item.ref);
      return parsed !== null && "screenRef" in parsed ? parsed.screenRef : item.ref;
    }),
  );
  return screens.size === 1 ? [...screens][0] : undefined;
}

/**
 * Where the elements with no flow yet are, grouped by the screen board that defines each one,
 * the boards in sidebar order. Reads the same set as the source panel and the canvas marks.
 */
export function missingFlowPlaces(atlas: AtlasIndex | null): MissingFlowGroup[] {
  const missing = missingFlowSet(atlas);
  if (atlas === null || missing.size === 0) return [];
  const screens = new Set(
    atlas.boards.filter((b) => b.kind === "screen" && b.status !== "invalid").map((b) => b.slug),
  );
  const bySlug = new Map<string, Array<{ ref: string; place: AtlasPlace }>>();
  for (const entry of atlas.refs) {
    if (!missing.has(entry.ref)) continue;
    const place = entry.definedIn.find((p) => screens.has(p.slug));
    if (place === undefined) continue;
    const items = bySlug.get(place.slug) ?? [];
    items.push({ ref: entry.ref, place });
    bySlug.set(place.slug, items);
  }
  return orderedBoards(atlas).flatMap((board) => {
    const items = bySlug.get(board.slug);
    if (!items) return [];
    const prefix = groupPrefix(atlas, board.slug, items);
    const listed = items.map(({ ref, place }): MissingFlowItem => {
      const label = place.label?.replace(/\s+/g, " ").trim();
      return {
        ref,
        nodeId: place.nodeId,
        shortRef:
          prefix !== undefined && ref.startsWith(`${prefix}/`) ? ref.slice(prefix.length + 1) : ref,
        ...(label ? { label } : {}),
        ...(place.role !== undefined ? { role: place.role } : {}),
      };
    });
    return [{ slug: board.slug, title: board.title, items: listed }];
  });
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
