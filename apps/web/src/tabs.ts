import {
  currentEntry,
  goTo,
  type NavEntry,
  type NavStack,
  push,
  saveView,
  startStack,
  type ViewState,
} from "./nav-history.ts";
import type { Route } from "./route.ts";
import type { ViewPrefs } from "./view-prefs.ts";

/**
 * The viewer's tabs: boards kept open side by side in one pane, each with its own history of
 * places. One tab at most is a preview: an ordinary click shows its board there, replacing the
 * last one, until the tab is pinned (opened as a new tab, edited, or its title double-clicked).
 * A board pasted or opened from a file is pinned from the start: it cannot be shown again.
 * Pure functions over an immutable state; `use-atlas.ts` keeps it and the browser in step.
 */

export interface Tab {
  id: string;
  /** The board shown, or null for a board pasted or opened from a file, which has no slug. */
  slug: string | null;
  /** Replaced by the next board opened with an ordinary click. */
  preview: boolean;
  history: NavStack;
  /** When the tab was last on screen, for closing the one used longest ago. */
  lastUsed: number;
  /** Why its board cannot be shown: missing from the atlas, or invalid. */
  error?: string;
  /** How its board is shown; absent until `fillPrefs` gives it the choices made last. */
  prefs?: ViewPrefs;
}

export interface TabsState {
  tabs: readonly Tab[];
  /** Null on the atlas home: tabs stay open, none is on screen. */
  activeId: string | null;
}

/** Tabs kept open; opening one more closes the unpinned tab used longest ago. */
export const TAB_LIMIT = 10;
/** Tabs whose rendered board stays in memory, the one on screen included. */
export const CACHE_KEEP = 3;

export const emptyTabs = (): TabsState => ({ tabs: [], activeId: null });

/** Where a board was opened: the tab that shows it, and whether every tab was pinned already. */
export interface Opened {
  state: TabsState;
  tabId: string;
  /** All tabs were pinned and at the limit: the board went into the tab on screen instead. */
  full: boolean;
}

const slugOf = (route: Route): string | null => (route.view === "board" ? route.slug : null);

const sameRoute = (a: Route, b: Route): boolean =>
  a.view === b.view &&
  (a.view === "home" || (b.view === "board" && a.slug === b.slug && a.node === b.node));

export function activeTab(state: TabsState): Tab | undefined {
  return state.tabs.find((tab) => tab.id === state.activeId);
}

export function tabById(state: TabsState, id: string): Tab | undefined {
  return state.tabs.find((tab) => tab.id === id);
}

/** The tab showing that board, if one does. */
export function tabForSlug(state: TabsState, slug: string): Tab | undefined {
  return state.tabs.find((tab) => tab.slug === slug);
}

/** The place a tab shows now. */
export function tabRoute(tab: Tab): Route {
  return currentEntry(tab.history)?.route ?? { view: "home" };
}

function update(state: TabsState, id: string, change: (tab: Tab) => Tab): TabsState {
  return { ...state, tabs: state.tabs.map((tab) => (tab.id === id ? change(tab) : tab)) };
}

/** Puts a tab on screen. */
export function activate(state: TabsState, id: string, now: number): TabsState {
  if (!tabById(state, id)) return state;
  return { ...update(state, id, (tab) => ({ ...tab, lastUsed: now })), activeId: id };
}

/** The 1-based tab of `Alt+n`; 9 is the last tab, as in browsers. Null when there is none. */
export function tabAtIndex(state: TabsState, n: number): string | null {
  if (n < 1 || n > 9 || state.tabs.length === 0) return null;
  const tab = n === 9 ? state.tabs[state.tabs.length - 1] : state.tabs[n - 1];
  return tab?.id ?? null;
}

/** A new place in a tab: pushed onto its history; its board becomes the entry's. */
export function navigateInTab(state: TabsState, id: string, entry: NavEntry): TabsState {
  return update(state, id, (tab) => {
    const { error: _error, ...rest } = tab;
    return { ...rest, slug: slugOf(entry.route), history: push(tab.history, entry) };
  });
}

/** Back or Forward inside a tab, to the entry of that id. */
export function traverseTab(state: TabsState, id: string, entryId: string): TabsState {
  return update(state, id, (tab) => {
    const history = goTo(tab.history, entryId);
    const { error: _error, ...rest } = tab;
    return { ...rest, history, slug: slugOf(currentEntry(history)?.route ?? { view: "home" }) };
  });
}

/** Keeps where the canvas stood on a tab's current entry. */
export function saveTabView(state: TabsState, id: string, view: ViewState): TabsState {
  return update(state, id, (tab) => {
    const entry = currentEntry(tab.history);
    return entry ? { ...tab, history: saveView(tab.history, entry.id, view) } : tab;
  });
}

export function setTabError(state: TabsState, id: string, error: string | undefined): TabsState {
  return update(state, id, (tab) => {
    const { error: _error, ...rest } = tab;
    return error === undefined ? rest : { ...rest, error };
  });
}

/** Keeps a tab's toolbar choices; the same state when they are the ones it has. */
export function setTabPrefs(state: TabsState, id: string, prefs: ViewPrefs): TabsState {
  if (tabById(state, id)?.prefs === prefs) return state;
  return update(state, id, (tab) => ({ ...tab, prefs }));
}

/** Gives every tab that has no choices of its own these: a new tab starts with the last made. */
export function fillPrefs(state: TabsState, prefs: ViewPrefs): TabsState {
  if (state.tabs.every((tab) => tab.prefs)) return state;
  return { ...state, tabs: state.tabs.map((tab) => (tab.prefs ? tab : { ...tab, prefs })) };
}

export function pin(state: TabsState, id: string): TabsState {
  return update(state, id, (tab) => (tab.preview ? { ...tab, preview: false } : tab));
}

/**
 * Closes a tab. Closing the tab on screen puts the one to its right there, else the one to its
 * left, else none.
 */
export function close(state: TabsState, id: string): TabsState {
  const at = state.tabs.findIndex((tab) => tab.id === id);
  if (at < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (state.activeId !== id) return { ...state, tabs };
  const next = tabs[at] ?? tabs[at - 1];
  return { tabs, activeId: next?.id ?? null };
}

/** Inserts a tab after the one on screen, or last when none is. */
function insert(state: TabsState, tab: Tab): TabsState {
  const at = state.tabs.findIndex((t) => t.id === state.activeId);
  const tabs = [...state.tabs];
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
  return { tabs, activeId: tab.id };
}

/**
 * Makes room for one more tab: closes the unpinned tab used longest ago, never the one on
 * screen. Null when every tab is pinned.
 */
function makeRoom(state: TabsState): TabsState | null {
  if (state.tabs.length < TAB_LIMIT) return state;
  const candidates = state.tabs.filter((tab) => tab.preview && tab.id !== state.activeId);
  if (candidates.length === 0) return null;
  const oldest = candidates.reduce((a, b) => (b.lastUsed < a.lastUsed ? b : a));
  return { ...state, tabs: state.tabs.filter((tab) => tab.id !== oldest.id) };
}

/** Shows the place in a tab that already has its board, adding the place when it differs. */
function reuse(state: TabsState, tab: Tab, entry: NavEntry, now: number): TabsState {
  const moved = sameRoute(tabRoute(tab), entry.route) ? state : navigateInTab(state, tab.id, entry);
  return activate(moved, tab.id, now);
}

/**
 * Every tab pinned and at the limit: the board goes into the tab on screen (or used last). A
 * tab holding a pasted board starts a new history: that board cannot be shown again.
 */
function intoCurrent(state: TabsState, entry: NavEntry, now: number): Opened {
  const target = activeTab(state) ?? state.tabs.reduce((a, b) => (b.lastUsed > a.lastUsed ? b : a));
  const moved =
    target.slug === null
      ? update(state, target.id, (tab) => restart(tab, entry, now))
      : navigateInTab(state, target.id, entry);
  return {
    state: activate(moved, target.id, now),
    tabId: target.id,
    // A preview tab on screen was simply replaced: only pinned tabs make the bar full.
    full: !target.preview,
  };
}

function newTab(id: string, entry: NavEntry, preview: boolean, now: number): Tab {
  return { id, slug: slugOf(entry.route), preview, history: startStack(entry), lastUsed: now };
}

/** The same tab, with a history that starts at the entry; its pin and choices stay. */
function restart(tab: Tab, entry: NavEntry, now: number): Tab {
  return {
    ...newTab(tab.id, entry, tab.preview, now),
    ...(tab.prefs ? { prefs: tab.prefs } : {}),
  };
}

/**
 * An ordinary click on a board: the tab showing it already, else the preview tab (its history
 * goes on, so Back returns to the board it showed), else a new preview tab.
 */
export function openPreview(state: TabsState, entry: NavEntry, tabId: string, now: number): Opened {
  const slug = slugOf(entry.route);
  const existing = slug === null ? undefined : tabForSlug(state, slug);
  if (existing)
    return { state: reuse(state, existing, entry, now), tabId: existing.id, full: false };
  const preview = state.tabs.find((tab) => tab.preview);
  if (preview) {
    const replaced = navigateInTab(state, preview.id, entry);
    return { state: activate(replaced, preview.id, now), tabId: preview.id, full: false };
  }
  const room = makeRoom(state);
  if (!room) return intoCurrent(state, entry, now);
  return { state: insert(room, newTab(tabId, entry, true, now)), tabId, full: false };
}

/** A link followed into a new tab: the tab showing its board already, else a new pinned tab. */
export function openNew(state: TabsState, entry: NavEntry, tabId: string, now: number): Opened {
  const slug = slugOf(entry.route);
  const existing = slug === null ? undefined : tabForSlug(state, slug);
  if (existing)
    return { state: reuse(state, existing, entry, now), tabId: existing.id, full: false };
  const room = makeRoom(state);
  if (!room) return intoCurrent(state, entry, now);
  return { state: insert(room, newTab(tabId, entry, false, now)), tabId, full: false };
}

/**
 * A board pasted or opened from a file: a new pinned tab, so no ordinary click replaces it.
 * Its history holds that one entry, since it has no address to come back to. With every tab
 * pinned and at the limit it takes the place of the board on screen.
 */
export function openPasted(state: TabsState, entry: NavEntry, tabId: string, now: number): Opened {
  const room = makeRoom(state);
  if (!room) {
    const target =
      activeTab(state) ?? state.tabs.reduce((a, b) => (b.lastUsed > a.lastUsed ? b : a));
    const replaced = update(state, target.id, (tab) => ({
      ...restart(tab, entry, now),
      slug: null,
      preview: false,
    }));
    // A preview tab on screen was simply replaced: only pinned tabs make the bar full.
    return { state: activate(replaced, target.id, now), tabId: target.id, full: !target.preview };
  }
  return {
    state: insert(room, { ...newTab(tabId, entry, false, now), slug: null }),
    tabId,
    full: false,
  };
}

/**
 * The tabs whose rendered board stays in memory: the one on screen, every pasted board (it
 * cannot be loaded again), then the most recently used up to `keep` in all.
 */
export function cachePlan(state: TabsState, keep: number = CACHE_KEEP): Set<string> {
  const kept = new Set<string>();
  if (state.activeId !== null && tabById(state, state.activeId)) kept.add(state.activeId);
  for (const tab of state.tabs) if (tab.slug === null) kept.add(tab.id);
  const recent = [...state.tabs].sort((a, b) => b.lastUsed - a.lastUsed);
  for (const tab of recent) {
    if (kept.size >= keep) break;
    kept.add(tab.id);
  }
  return kept;
}
