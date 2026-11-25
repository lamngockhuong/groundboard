import type { Board, BoardNode } from "./board.ts";

/**
 * The root of each state screen, by state id: a screen whose `stateOf` names another screen on
 * the board that is not itself a state. Screens with an invalid `stateOf` are left out, so
 * callers see them as ordinary screens; validation reports them.
 */
export function stateRoots(board: Pick<Board, "nodes">): Map<string, string> {
  const byId = new Map<string, BoardNode>();
  for (const node of board.nodes) if (!byId.has(node.id)) byId.set(node.id, node);
  const roots = new Map<string, string>();
  for (const node of board.nodes) {
    if (node.kind !== "screen" || node.stateOf === undefined || node.stateOf === node.id) continue;
    const root = byId.get(node.stateOf);
    if (root?.kind === "screen" && root.stateOf === undefined) roots.set(node.id, root.id);
  }
  return roots;
}

/**
 * Screens that have states, each with its states in board order. A screen without states is
 * not listed.
 */
export function screenFamilies(board: Pick<Board, "nodes">): Map<string, string[]> {
  const families = new Map<string, string[]>();
  for (const [state, root] of stateRoots(board)) {
    const list = families.get(root);
    if (list) list.push(state);
    else families.set(root, [state]);
  }
  return families;
}

/**
 * Whether a screen is drawn as a plain labelled box rather than a frame: it has no elements and
 * is not part of a state family. Only such a screen may sit in a group, since a frame cannot be
 * nested in a group's frame.
 */
export function isCompactScreen(board: Pick<Board, "nodes">, node: BoardNode): boolean {
  if (node.kind !== "screen") return false;
  if (board.nodes.some((n) => n.kind === "element" && n.parentId === node.id)) return false;
  if (node.stateOf !== undefined) return false;
  return !board.nodes.some((n) => n.kind === "screen" && n.stateOf === node.id);
}

/**
 * The screen at the top of an element's parentId chain, or the node itself for a screen;
 * undefined for any other node or a broken chain.
 */
export function owningScreen(
  nodeId: string,
  byId: ReadonlyMap<string, BoardNode>,
): BoardNode | undefined {
  const seen = new Set<string>();
  let current = byId.get(nodeId);
  while (current?.kind === "element" && !seen.has(current.id)) {
    seen.add(current.id);
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return current?.kind === "screen" ? current : undefined;
}

/**
 * The family a screen, element or state belongs to: the id of its root screen (itself for a
 * screen that is not a state). Undefined for nodes outside any screen.
 */
export function familyOf(
  nodeId: string,
  byId: ReadonlyMap<string, BoardNode>,
  roots: ReadonlyMap<string, string>,
): string | undefined {
  const screen = owningScreen(nodeId, byId);
  if (screen === undefined) return undefined;
  return roots.get(screen.id) ?? screen.id;
}

/**
 * Copies the root's platform, layoutFrom and width onto states that omit them, so layout, rendering
 * and the atlas read one value for every frame.
 */
export function inheritStateFields<T extends Pick<Board, "nodes">>(board: T): T {
  const roots = stateRoots(board);
  if (roots.size === 0) return board;
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  for (const [stateId, rootId] of roots) {
    const state = byId.get(stateId) as BoardNode;
    const root = byId.get(rootId) as BoardNode;
    if (state.platform === undefined && root.platform !== undefined) state.platform = root.platform;
    if (state.layoutFrom === undefined && root.layoutFrom !== undefined) {
      state.layoutFrom = root.layoutFrom;
    }
    if (state.width === undefined && root.width !== undefined) state.width = root.width;
  }
  return board;
}
