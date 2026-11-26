import type { Route } from "./route.ts";

/**
 * The viewer's own history of places: every board opened and every node followed by a link is
 * one entry, with where the canvas stood when the reader left it. Pure functions over an
 * immutable stack; the browser's session history is kept in step by `use-atlas.ts`.
 */

/** Where the canvas stood: its scroll, its zoom, and the elements selected. */
export interface ViewState {
  scrollX: number;
  scrollY: number;
  zoom: number;
  selected: string[];
}

export interface NavEntry {
  id: string;
  route: Route;
  /** Saved when the reader left this entry; absent until then. */
  view?: ViewState;
}

export interface NavStack {
  entries: readonly NavEntry[];
  index: number;
}

/** Entries kept; pushing past it drops the oldest. */
export const NAV_LIMIT = 100;

export function startStack(entry: NavEntry): NavStack {
  return { entries: [entry], index: 0 };
}

export function currentEntry(stack: NavStack): NavEntry | undefined {
  return stack.entries[stack.index];
}

export function indexOf(stack: NavStack, id: string): number {
  return stack.entries.findIndex((e) => e.id === id);
}

export const canBack = (stack: NavStack): boolean => stack.index > 0;
export const canForward = (stack: NavStack): boolean => stack.index < stack.entries.length - 1;

/** A new place: the entries ahead of the current one are dropped, then the oldest past the limit. */
export function push(stack: NavStack, entry: NavEntry, limit: number = NAV_LIMIT): NavStack {
  const entries = [...stack.entries.slice(0, stack.index + 1), entry];
  const dropped = Math.max(0, entries.length - limit);
  return { entries: entries.slice(dropped), index: entries.length - 1 - dropped };
}

/** Moves by `delta` entries, never past either end. */
export function go(stack: NavStack, delta: number): NavStack {
  const index = Math.min(Math.max(stack.index + delta, 0), stack.entries.length - 1);
  return index === stack.index ? stack : { ...stack, index };
}

/** Moves to the entry of that id; an unknown id leaves the stack as it is. */
export function goTo(stack: NavStack, id: string): NavStack {
  const index = indexOf(stack, id);
  return index < 0 || index === stack.index ? stack : { ...stack, index };
}

/** Records where the canvas stood on the entry of that id. */
export function saveView(stack: NavStack, id: string, view: ViewState): NavStack {
  const index = indexOf(stack, id);
  if (index < 0) return stack;
  const entries = stack.entries.map((e, i) => (i === index ? { ...e, view } : e));
  return { ...stack, entries };
}

/** The current entry names another route without becoming a new place (an address replaced). */
export function replaceRoute(stack: NavStack, route: Route): NavStack {
  const entries = stack.entries.map((e, i) => (i === stack.index ? { id: e.id, route } : e));
  return { ...stack, entries };
}

/** The entry id the viewer keeps in `history.state`, or null when the state is not the viewer's. */
export function stateId(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const id = (state as { gb?: unknown }).gb;
  return typeof id === "string" ? id : null;
}
