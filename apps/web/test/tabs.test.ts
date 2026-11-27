import { describe, expect, it } from "vitest";
import type { NavEntry } from "../src/nav-history.ts";
import {
  activate,
  cachePlan,
  close,
  emptyTabs,
  navigateInTab,
  openNew,
  openPasted,
  openPreview,
  pin,
  TAB_LIMIT,
  type TabsState,
  tabAtIndex,
  tabById,
  tabRoute,
} from "../src/tabs.ts";

let n = 0;
const entry = (slug: string, node?: string): NavEntry => ({
  id: `e${++n}`,
  route: { view: "board", slug, ...(node ? { node } : {}) },
});
const pasted = (): NavEntry => ({ id: `e${++n}`, route: { view: "home" } });

/** Opens each slug in a new pinned tab, one after another; the last is on screen. */
function pinnedTabs(slugs: string[]): TabsState {
  let state = emptyTabs();
  slugs.forEach((slug, i) => {
    state = openNew(state, entry(slug), `t-${slug}`, i + 1).state;
  });
  return state;
}

const slugs = (state: TabsState) => state.tabs.map((t) => t.slug);

describe("openPreview", () => {
  it("adds a preview tab, then replaces its board and keeps its history", () => {
    let state = openPreview(emptyTabs(), entry("a"), "t1", 1).state;
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ id: "t1", slug: "a", preview: true });
    const second = openPreview(state, entry("b"), "t2", 2);
    state = second.state;
    expect(second.tabId).toBe("t1");
    expect(slugs(state)).toEqual(["b"]);
    expect(state.tabs[0]?.history.entries.map((e) => e.route)).toEqual([
      { view: "board", slug: "a" },
      { view: "board", slug: "b" },
    ]);
  });

  it("never replaces a pinned tab: a new preview tab opens after the one on screen", () => {
    let state = pinnedTabs(["a", "b"]);
    state = activate(state, "t-a", 10);
    state = openPreview(state, entry("c"), "t3", 11).state;
    expect(slugs(state)).toEqual(["a", "c", "b"]);
    expect(state.activeId).toBe("t3");
  });

  it("chooses the tab that shows the board already", () => {
    let state = pinnedTabs(["a", "b"]);
    const opened = openPreview(state, entry("a"), "t9", 10);
    state = opened.state;
    expect(opened.tabId).toBe("t-a");
    expect(state.activeId).toBe("t-a");
    expect(state.tabs).toHaveLength(2);
    expect(tabById(state, "t-a")?.history.entries).toHaveLength(1);
  });

  it("adds the node to the history of the tab that has its board", () => {
    let state = pinnedTabs(["a", "b"]);
    state = openPreview(state, entry("a", "n1"), "t9", 10).state;
    const tab = tabById(state, "t-a");
    expect(tab && tabRoute(tab)).toEqual({ view: "board", slug: "a", node: "n1" });
    expect(tab?.history.entries).toHaveLength(2);
  });

  it("starts a new history when the preview tab held a pasted board", () => {
    let state = openPasted(emptyTabs(), pasted(), "t1", 1).state;
    state = openPreview(state, entry("a"), "t2", 2).state;
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ id: "t1", slug: "a", preview: true });
    expect(state.tabs[0]?.history.entries).toHaveLength(1);
  });
});

describe("openNew", () => {
  it("adds a pinned tab after the one on screen", () => {
    let state = pinnedTabs(["a", "b", "c"]);
    state = activate(state, "t-a", 10);
    state = openNew(state, entry("d"), "t-d", 11).state;
    expect(slugs(state)).toEqual(["a", "d", "b", "c"]);
    expect(tabById(state, "t-d")?.preview).toBe(false);
    expect(state.activeId).toBe("t-d");
  });

  it("closes the unpinned tab used longest ago for the eleventh, never the one on screen", () => {
    let state = pinnedTabs(["a", "b", "c", "d", "e", "f", "g", "h"]);
    // Two preview tabs cannot be made by clicks; build them by hand, both unpinned.
    state = openPreview(state, entry("p"), "t-p", 20).state;
    state = openNew(state, entry("q"), "t-q", 21).state;
    state = {
      ...state,
      tabs: state.tabs.map((t) => (t.id === "t-q" ? { ...t, preview: true } : t)),
    };
    expect(state.tabs).toHaveLength(TAB_LIMIT);
    // The older preview tab (t-p) goes; t-q is on screen.
    const opened = openNew(state, entry("r"), "t-r", 22);
    expect(opened.full).toBe(false);
    expect(opened.state.tabs).toHaveLength(TAB_LIMIT);
    expect(tabById(opened.state, "t-p")).toBeUndefined();
    expect(tabById(opened.state, "t-q")).toBeDefined();
    // With t-p on screen instead, the one on screen stays and the other unpinned tab goes.
    const other = openNew(activate(state, "t-p", 30), entry("r"), "t-r", 31);
    expect(tabById(other.state, "t-p")).toBeDefined();
    expect(tabById(other.state, "t-q")).toBeUndefined();
  });

  it("opens into the tab on screen when all ten are pinned, closing none", () => {
    const state = pinnedTabs(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    const opened = openNew(state, entry("k"), "t-k", 30);
    expect(opened.full).toBe(true);
    expect(opened.tabId).toBe("t-j");
    expect(opened.state.tabs).toHaveLength(TAB_LIMIT);
    expect(slugs(opened.state)).toContain("k");
    expect(slugs(opened.state)).not.toContain("j");
    expect(openPreview(state, entry("k"), "t-k", 30).full).toBe(true);
  });
});

describe("close", () => {
  it("puts the tab to the right on screen, else the one to the left, else none", () => {
    let state = activate(pinnedTabs(["a", "b", "c"]), "t-b", 10);
    state = close(state, "t-b");
    expect(state.activeId).toBe("t-c");
    state = close(state, "t-c");
    expect(state.activeId).toBe("t-a");
    state = close(state, "t-a");
    expect(state).toEqual({ tabs: [], activeId: null });
  });

  it("keeps the tab on screen when another closes", () => {
    const state = close(pinnedTabs(["a", "b"]), "t-a");
    expect(state.activeId).toBe("t-b");
    expect(slugs(state)).toEqual(["b"]);
  });
});

describe("tabAtIndex", () => {
  it("counts from one, and 9 is the last tab", () => {
    const state = pinnedTabs(["a", "b", "c"]);
    expect(tabAtIndex(state, 1)).toBe("t-a");
    expect(tabAtIndex(state, 3)).toBe("t-c");
    expect(tabAtIndex(state, 4)).toBeNull();
    expect(tabAtIndex(state, 9)).toBe("t-c");
    expect(tabAtIndex(emptyTabs(), 9)).toBeNull();
  });
});

describe("navigateInTab", () => {
  it("pushes onto that tab only", () => {
    let state = pinnedTabs(["a", "b"]);
    state = navigateInTab(state, "t-a", entry("c"));
    expect(tabById(state, "t-a")?.slug).toBe("c");
    expect(tabById(state, "t-a")?.history.entries).toHaveLength(2);
    expect(tabById(state, "t-b")?.history.entries).toHaveLength(1);
  });
});

describe("pin", () => {
  it("keeps a preview tab: the next click opens another", () => {
    let state = openPreview(emptyTabs(), entry("a"), "t1", 1).state;
    state = pin(state, "t1");
    state = openPreview(state, entry("b"), "t2", 2).state;
    expect(slugs(state)).toEqual(["a", "b"]);
  });
});

describe("openPasted", () => {
  it("makes a preview tab with no slug", () => {
    const opened = openPasted(pinnedTabs(["a"]), pasted(), "t1", 5);
    expect(opened.tabId).toBe("t1");
    expect(tabById(opened.state, "t1")).toMatchObject({ slug: null, preview: true });
    expect(opened.state.activeId).toBe("t1");
  });
});

describe("cachePlan", () => {
  it("keeps the three tabs used last, the one on screen and every pasted board", () => {
    let state = pinnedTabs(["a", "b", "c", "d", "e"]);
    expect([...cachePlan(state)].sort()).toEqual(["t-c", "t-d", "t-e"]);
    state = activate(state, "t-a", 100);
    expect([...cachePlan(state)].sort()).toEqual(["t-a", "t-d", "t-e"]);
    state = openPasted(state, pasted(), "t-p", 101).state;
    state = activate(state, "t-b", 102);
    const kept = cachePlan(state);
    expect(kept.has("t-b")).toBe(true);
    expect(kept.has("t-p")).toBe(true);
    expect(kept.size).toBe(3);
  });
});
