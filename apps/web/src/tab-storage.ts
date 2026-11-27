import { currentEntry, NAV_LIMIT, type NavEntry, type ViewState } from "./nav-history.ts";
import { NODE_ID_PATTERN, type Route, SLUG_PATTERN } from "./route.ts";
import { type Group, groupOf, settle, TAB_LIMIT, type Tab, type TabsState } from "./tabs.ts";
import { readPrefs, type ViewPrefs } from "./view-prefs.ts";

/**
 * The open tabs, kept in `sessionStorage` so a reload brings them back: per browser tab, never
 * in the address. Only what names a place, how each tab shows its board and the group it sits
 * in are stored, never a rendered board; a pasted board has no place to name and is left out.
 * Anything that does not read back exactly as written is dropped, so a stale or hand-edited
 * value never reaches the server. A list stored before there were two groups reads as one.
 */

/** The storage key: one list per atlas, and one for the library kept in this browser. */
export function tabStorageKey(atlasId: string | undefined, library: boolean): string {
  return `groundboard.tabs.${library ? "library" : (atlasId ?? "atlas")}`;
}

/** Ids of tabs and history entries, as `use-atlas.ts` makes them. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Selected elements kept with a view; more than this is not a selection worth restoring. */
const SELECTED_LIMIT = 500;

interface StoredTabs {
  tabs: {
    id: string;
    preview: boolean;
    history: { entries: NavEntry[]; index: number };
    prefs?: ViewPrefs;
    /** Absent for the left group. */
    group?: 1;
  }[];
  activeIndex: number;
  /** The tab on screen in the other pane, with two groups; absent otherwise. */
  otherIndex?: number;
}

export function saveTabs(key: string, state: TabsState): void {
  const tabs = state.tabs.filter((tab) => tab.slug !== null);
  const value: StoredTabs = {
    tabs: tabs.map((tab) => ({
      id: tab.id,
      preview: tab.preview,
      history: {
        entries: tab.history.entries.map((e) => ({
          id: e.id,
          route: e.route,
          ...(e.view ? { view: e.view } : {}),
        })),
        index: tab.history.index,
      },
      ...(tab.prefs ? { prefs: tab.prefs } : {}),
      ...(groupOf(tab) === 1 ? { group: 1 as const } : {}),
    })),
    activeIndex: tabs.findIndex((tab) => tab.id === state.activeId),
  };
  const other = tabs.findIndex((tab) => tab.id === state.otherId);
  if (other >= 0) value.otherIndex = other;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: the tabs last for this page load.
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is string =>
  typeof value === "string" && ID_PATTERN.test(value);

function readRoute(value: unknown): Route | null {
  if (!isRecord(value) || value.view !== "board") return null;
  const { slug, node } = value;
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) return null;
  if (node === undefined) return { view: "board", slug };
  if (typeof node !== "string" || !NODE_ID_PATTERN.test(node)) return null;
  return { view: "board", slug, node };
}

function readView(value: unknown): ViewState | null {
  if (!isRecord(value)) return null;
  const { scrollX, scrollY, zoom, selected } = value;
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (!finite(scrollX) || !finite(scrollY) || !finite(zoom) || zoom <= 0) return null;
  if (
    !Array.isArray(selected) ||
    selected.length > SELECTED_LIMIT ||
    !selected.every((id) => typeof id === "string" && id.length <= 200)
  ) {
    return null;
  }
  return { scrollX, scrollY, zoom, selected: selected as string[] };
}

function readEntry(value: unknown): NavEntry | null {
  if (!isRecord(value) || !isId(value.id)) return null;
  const route = readRoute(value.route);
  if (!route) return null;
  if (value.view === undefined) return { id: value.id, route };
  const view = readView(value.view);
  return view ? { id: value.id, route, view } : null;
}

function readTab(value: unknown, now: number): Tab | null {
  if (!isRecord(value) || !isId(value.id) || typeof value.preview !== "boolean") return null;
  const history = value.history;
  if (!isRecord(history) || !Array.isArray(history.entries)) return null;
  const { index } = history;
  if (history.entries.length === 0 || history.entries.length > NAV_LIMIT) return null;
  if (typeof index !== "number" || !Number.isInteger(index)) return null;
  if (index < 0 || index >= history.entries.length) return null;
  const entries: NavEntry[] = [];
  for (const raw of history.entries) {
    const entry = readEntry(raw);
    if (!entry) return null;
    entries.push(entry);
  }
  const stack = { entries, index };
  const route = currentEntry(stack)?.route;
  if (route?.view !== "board") return null;
  // A group that does not read back puts the tab in the left one.
  const group: Group = value.group === 1 ? 1 : 0;
  const tab: Tab = {
    id: value.id,
    slug: route.slug,
    preview: value.preview,
    history: stack,
    lastUsed: now,
    ...(group === 1 ? { group } : {}),
  };
  // Choices that do not read back are left out: the tab starts with the ones made last.
  const prefs = readPrefs(value.prefs);
  return prefs ? { ...tab, prefs } : tab;
}

/**
 * The tabs stored under the key; none when there are none, storage is blocked, or the value is
 * not what `saveTabs` writes. A tab that does not read back is dropped, the others kept.
 */
export function loadTabs(key: string, now: number = Date.now()): TabsState {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    return { tabs: [], activeId: null };
  }
  if (raw === null) return { tabs: [], activeId: null };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { tabs: [], activeId: null };
  }
  if (!isRecord(value) || !Array.isArray(value.tabs)) return { tabs: [], activeId: null };
  const active = typeof value.activeIndex === "number" ? value.activeIndex : -1;
  const other = typeof value.otherIndex === "number" ? value.otherIndex : -1;
  const tabs: Tab[] = [];
  const seen = new Set<string>();
  let activeId: string | null = null;
  let otherId: string | undefined;
  value.tabs.forEach((raw, i) => {
    const tab = readTab(raw, now);
    // Two tabs of one id, or of one board in one group: only the first is kept.
    if (!tab || seen.has(tab.id)) return;
    if (tabs.some((t) => t.slug === tab.slug && groupOf(t) === groupOf(tab))) return;
    if (tabs.length >= TAB_LIMIT) return;
    seen.add(tab.id);
    // The tabs on screen count as the ones used last, so they stay when room is made.
    tabs.push(
      i === active
        ? { ...tab, lastUsed: now + 2 }
        : i === other
          ? { ...tab, lastUsed: now + 1 }
          : tab,
    );
    if (i === active) activeId = tab.id;
    if (i === other) otherId = tab.id;
  });
  // At most one preview tab per group: the rest are pinned.
  const previewSeen = new Set<Group>();
  const single = tabs.map((tab) => {
    if (!tab.preview) return tab;
    if (previewSeen.has(groupOf(tab))) return { ...tab, preview: false };
    previewSeen.add(groupOf(tab));
    return tab;
  });
  // Without a tab on screen (the home), the focus stays with the left pane.
  return settle({
    tabs: single,
    activeId,
    ...(otherId !== undefined ? { otherId } : {}),
  });
}
