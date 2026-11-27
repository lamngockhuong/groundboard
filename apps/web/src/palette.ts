import type { AtlasBoard, AtlasIndex, AtlasRef } from "./api.ts";
import { orderedBoards } from "./atlas-nav.ts";
import { t } from "./i18n.ts";
import type { BoardNode } from "./sources.ts";

/** At most this many results per group. */
export const PALETTE_LIMIT = 8;

/** Something the viewer does, rather than a place to go. */
export interface PaletteCommand {
  id: "openBeside";
  title: string;
  /** Other words it is found by. */
  keywords: string[];
}

export type PaletteItem =
  | { type: "board"; board: AtlasBoard }
  | { type: "node"; node: BoardNode }
  | { type: "ref"; ref: AtlasRef }
  | { type: "command"; command: PaletteCommand };

export interface PaletteGroup {
  title: string;
  items: PaletteItem[];
}

/**
 * How well `fields` match the needle: 0 when one starts with it, 1 when one contains it,
 * null when none does. A blank needle matches everything equally.
 */
function rank(needle: string, fields: readonly string[]): number | null {
  if (needle === "") return 0;
  let best: number | null = null;
  for (const field of fields) {
    const text = field.toLowerCase();
    if (text.startsWith(needle)) return 0;
    if (best === null && text.includes(needle)) best = 1;
  }
  return best;
}

/** Items that match, prefix matches first, each kept in its source order, at most the limit. */
function pick<T>(items: readonly T[], needle: string, fields: (item: T) => string[]): T[] {
  return items
    .map((item, index) => ({ item, index, score: rank(needle, fields(item)) }))
    .filter((r): r is { item: T; index: number; score: number } => r.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, PALETTE_LIMIT)
    .map((r) => r.item);
}

/**
 * The commands the palette offers now. Opening the board on screen beside it needs an atlas
 * of more than one board, an atlas board on screen, and a screen wide enough for two panes.
 */
export function paletteCommands(context: {
  boardCount: number;
  /** An atlas board is on screen (a pasted board has no address to open again). */
  boardOnScreen: boolean;
  twoPanes: boolean;
}): PaletteCommand[] {
  if (context.boardCount < 2 || !context.boardOnScreen || !context.twoPanes) return [];
  return [
    {
      id: "openBeside",
      title: t("palette.openBeside"),
      keywords: [t("split.openBeside"), "split", "side"],
    },
  ];
}

/** The palette results for a query: boards, nodes of the board on screen, refs, commands. */
export function searchPalette(
  query: string,
  sources: {
    atlas: AtlasIndex | null;
    nodes: readonly BoardNode[];
    commands?: readonly PaletteCommand[];
  },
): PaletteGroup[] {
  const needle = query.trim().toLowerCase();
  const groups: PaletteGroup[] = [];
  const { atlas, nodes, commands = [] } = sources;
  if (atlas) {
    const boards = pick(orderedBoards(atlas), needle, (b) => [b.title, b.slug]);
    if (boards.length > 0) {
      groups.push({
        title: t("palette.boards"),
        items: boards.map((board) => ({ type: "board", board })),
      });
    }
  }
  const found = pick(nodes, needle, (n) => [n.nodeId, n.label, n.kind]);
  if (found.length > 0) {
    groups.push({
      title: t("palette.nodes"),
      items: found.map((node) => ({ type: "node", node })),
    });
  }
  if (atlas) {
    const refs = pick(atlas.refs, needle, (r) => [r.ref]);
    if (refs.length > 0) {
      groups.push({ title: t("palette.refs"), items: refs.map((ref) => ({ type: "ref", ref })) });
    }
  }
  const actions = pick(commands, needle, (c) => [c.title, ...c.keywords]);
  if (actions.length > 0) {
    groups.push({
      title: t("palette.commands"),
      items: actions.map((command) => ({ type: "command", command })),
    });
  }
  return groups;
}
