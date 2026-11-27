import { currentEntry, NAV_LIMIT, type NavEntry, type ViewState } from "./nav-history.ts";
import { NODE_ID_PATTERN, type Route, SLUG_PATTERN } from "./route.ts";
import { TAB_LIMIT, type Tab, type TabsState } from "./tabs.ts";

/**
 * The open tabs, kept in `sessionStorage` so a reload brings them back: per browser tab, never
 * in the address. Only what names a place is stored, never a rendered board; a pasted board
 * has no place to name and is left out. Anything that does not read back exactly as written
 * is dropped, so a stale or hand-edited value never reaches the server.
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
  tabs: { id: string; preview: boolean; history: { entries: NavEntry[]; index: number } }[];
  activeIndex: number;
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
    })),
    activeIndex: tabs.findIndex((tab) => tab.id === state.activeId),
  };
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
  return { id: value.id, slug: route.slug, preview: value.preview, history: stack, lastUsed: now };
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
  const tabs: Tab[] = [];
  const seen = new Set<string>();
  let activeId: string | null = null;
  value.tabs.forEach((raw, i) => {
    const tab = readTab(raw, now);
    // Two tabs of one id or one board: only the first is kept.
    if (!tab || seen.has(tab.id) || tabs.some((t) => t.slug === tab.slug)) return;
    if (tabs.length >= TAB_LIMIT) return;
    seen.add(tab.id);
    // The tab on screen counts as the one used last, so it stays when room is made.
    tabs.push(i === active ? { ...tab, lastUsed: now + 1 } : tab);
    if (i === active) activeId = tab.id;
  });
  // At most one preview tab: the rest are pinned.
  let previewSeen = false;
  const single = tabs.map((tab) => {
    if (!tab.preview) return tab;
    if (previewSeen) return { ...tab, preview: false };
    previewSeen = true;
    return tab;
  });
  return { tabs: single, activeId };
}
