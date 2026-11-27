import { describe, expect, it } from "vitest";
import type { NavEntry } from "../src/nav-history.ts";
import {
  clampRatio,
  focusGroup,
  groupView,
  moveToOtherGroup,
  narrowView,
  openBeside,
  ratioAfterKey,
  SPLIT_RATIO,
  showsTwoPanes,
  visibleTabIds,
} from "../src/split.ts";
import {
  activate,
  close,
  emptyTabs,
  groupOf,
  openNew,
  openPasted,
  openPreview,
  saveTabView,
  settle,
  TAB_LIMIT,
  type Tab,
  type TabsState,
  tabAtIndex,
  tabById,
} from "../src/tabs.ts";

let n = 0;
const entry = (slug: string): NavEntry => ({ id: `e${++n}`, route: { view: "board", slug } });

/** Opens each slug in a new pinned tab, one after another; the last is on screen. */
function pinnedTabs(slugs: string[]): TabsState {
  let state = emptyTabs();
  slugs.forEach((slug, i) => {
    state = openNew(state, entry(slug), `t-${slug}`, i + 1).state;
  });
  return state;
}

const ids = (state: TabsState) => state.tabs.map((t) => t.id);
const groups = (state: TabsState) => state.tabs.map((t) => groupOf(t));

/** a and b on the left, b opened beside on the right: the right pane focused. */
function splitState(): TabsState {
  const state = activate(pinnedTabs(["a", "b"]), "t-a", 10);
  const opened = openBeside(state, "t-a2", 11);
  if (!opened) throw new Error("openBeside refused");
  return opened.state;
}

describe("openBeside", () => {
  it("copies the tab on screen into the other group, with its history and views, and focuses it", () => {
    let state = pinnedTabs(["a", "b"]);
    const view = { scrollX: 3, scrollY: 4, zoom: 1.5, selected: ["x"] };
    state = saveTabView(state, "t-b", view);
    const opened = openBeside(state, "t-new", 5);
    expect(opened).not.toBeNull();
    const next = opened?.state as TabsState;
    expect(next.activeId).toBe("t-new");
    expect(next.focused).toBe(1);
    expect(next.otherId).toBe("t-b");
    const copy = tabById(next, "t-new");
    expect(copy).toMatchObject({ slug: "b", preview: false, group: 1 });
    expect(copy?.history).toEqual(tabById(state, "t-b")?.history);
    expect(copy?.history.entries[0]?.view).toEqual(view);
    expect(ids(next)).toEqual(["t-a", "t-b", "t-new"]);
    expect(visibleTabIds(next, true)).toEqual(["t-new", "t-b"]);
    expect(showsTwoPanes(next, true)).toBe(true);
    expect(showsTwoPanes(next, false)).toBe(false);
  });

  it("adds to the other group when there are two already", () => {
    let state = splitState();
    // Back to the left pane, then its other tab beside: it joins the right group.
    state = focusGroup(state, 0, 20);
    expect(state.activeId).toBe("t-a");
    const opened = openBeside(state, "t-b2", 21, "t-b");
    const next = opened?.state as TabsState;
    expect(groupView(next, 1).tabs.map((t) => t.id)).toEqual(["t-a2", "t-b2"]);
    expect(next.activeId).toBe("t-b2");
    expect(next.otherId).toBe("t-a");
  });

  it("shows the other group's tab of that board instead of a second copy", () => {
    const state = focusGroup(splitState(), 0, 20);
    const opened = openBeside(state, "t-again", 21);
    expect(opened?.tabId).toBe("t-a2");
    expect(opened?.state.tabs).toHaveLength(3);
  });

  it("refuses a pasted board, and a full bar of pinned tabs", () => {
    const pasted = openPasted(pinnedTabs(["a"]), { id: "p", route: { view: "home" } }, "t-p", 2);
    expect(openBeside(pasted.state, "t-x", 3)).toBeNull();
    const slugs = Array.from({ length: TAB_LIMIT }, (_, i) => `s${i}`);
    expect(openBeside(pinnedTabs(slugs), "t-x", 99)).toBeNull();
  });

  it("counts the limit of tabs over both groups", () => {
    const slugs = Array.from({ length: TAB_LIMIT - 1 }, (_, i) => `s${i}`);
    let state = pinnedTabs(slugs);
    state = (openBeside(state, "t-beside", 50) as { state: TabsState }).state;
    expect(state.tabs).toHaveLength(TAB_LIMIT);
    // One more preview in the right group: the bar is full, so it goes into the tab on screen.
    const opened = openPreview(state, entry("more"), "t-more", 51);
    expect(opened.state.tabs).toHaveLength(TAB_LIMIT);
    expect(opened.full).toBe(true);
  });
});

describe("closing in two groups", () => {
  it("closing the last tab of the right group leaves one group, focused on the left", () => {
    const state = close(splitState(), "t-a2");
    expect(groups(state)).toEqual([0, 0]);
    expect(state.activeId).toBe("t-a");
    expect(state.focused).toBeUndefined();
    expect(state.otherId).toBeUndefined();
  });

  it("closing the last tab of the left group makes the right group the left one", () => {
    let state = splitState();
    state = close(state, "t-a");
    state = close(focusGroup(state, 0, 30), "t-b");
    expect(groups(state)).toEqual([0]);
    expect(ids(state)).toEqual(["t-a2"]);
    expect(state.activeId).toBe("t-a2");
    expect(state.focused).toBeUndefined();
  });

  it("closing the other pane's tab on screen shows its neighbour there", () => {
    let state = splitState();
    state = (openBeside(focusGroup(state, 0, 20), "t-b2", 21, "t-b") as { state: TabsState }).state;
    // Right group: a2, b2 (on screen, focused). Left pane shows a.
    state = focusGroup(state, 0, 22);
    expect(state.otherId).toBe("t-b2");
    state = close(state, "t-b2");
    expect(state.otherId).toBe("t-a2");
    expect(state.activeId).toBe("t-a");
  });
});

describe("narrowView", () => {
  it("keeps the left group first, both tabs of one board, and no tab's group changes", () => {
    let state = splitState();
    state = (openBeside(focusGroup(state, 0, 20), "t-b2", 21, "t-b") as { state: TabsState }).state;
    const before = state.tabs.map((t) => [t.id, groupOf(t)]);
    const row = narrowView(state);
    expect(row.tabs.map((t) => t.slug)).toEqual(["a", "b", "a", "b"]);
    expect(row.activeId).toBe(state.activeId);
    expect(state.tabs.map((t) => [t.id, groupOf(t)])).toEqual(before);
  });

  it("gives a tab opened while narrow the group of the tab on screen", () => {
    // The right pane is focused: a new tab joins it.
    const state = openNew(splitState(), entry("c"), "t-c", 40).state;
    expect(groupOf(tabById(state, "t-c") as never)).toBe(1);
    expect(groupView(state, 1).tabs.map((t) => t.id)).toEqual(["t-a2", "t-c"]);
    // From the left pane, it joins the left one.
    const left = openNew(focusGroup(splitState(), 0, 50), entry("d"), "t-d", 51).state;
    expect(groupOf(tabById(left, "t-d") as never)).toBe(0);
  });

  it("brings both groups back as they were when the screen is wide again", () => {
    const state = splitState();
    // Narrow: the reader picks the left group's tab from the one row; nothing else changes.
    const narrowed = activate(state, "t-b", 60);
    expect(visibleTabIds(narrowed, false)).toEqual(["t-b"]);
    expect(groupView(narrowed, 0).tabs.map((t) => t.id)).toEqual(["t-a", "t-b"]);
    expect(groupView(narrowed, 1).tabs.map((t) => t.id)).toEqual(["t-a2"]);
    expect(visibleTabIds(narrowed, true)).toEqual(["t-b", "t-a2"]);
  });
});

describe("focus and moving", () => {
  it("focusGroup moves the focus to the pane's tab on screen, both staying on screen", () => {
    const state = focusGroup(splitState(), 0, 20);
    expect(state.activeId).toBe("t-a");
    expect(state.otherId).toBe("t-a2");
    expect(state.focused).toBeUndefined();
    expect(focusGroup(state, 0, 21)).toBe(state);
  });

  it("choosing a tab of the other group focuses that pane; the pane left keeps its tab", () => {
    const state = activate(splitState(), "t-b", 20);
    expect(state.activeId).toBe("t-b");
    expect(state.otherId).toBe("t-a2");
    expect(state.focused).toBeUndefined();
  });

  it("moveToOtherGroup moves a tab across and focuses it there", () => {
    const state = moveToOtherGroup(focusGroup(splitState(), 0, 20), "t-b", 21);
    expect(groupView(state, 0).tabs.map((t) => t.id)).toEqual(["t-a"]);
    expect(groupView(state, 1).tabs.map((t) => t.id)).toEqual(["t-a2", "t-b"]);
    expect(state.activeId).toBe("t-b");
    expect(state.otherId).toBe("t-a");
  });

  it("moving the only tab of a group leaves one group", () => {
    const state = moveToOtherGroup(splitState(), "t-a2", 30);
    expect(groups(state)).toEqual([0, 0, 0]);
    expect(state.otherId).toBeUndefined();
  });

  it("numbers the tabs of the focused group for Alt and a digit", () => {
    const state = splitState();
    expect(tabAtIndex(state, 1, 1)).toBe("t-a2");
    expect(tabAtIndex(state, 2, 1)).toBeNull();
    expect(tabAtIndex(state, 9, 0)).toBe("t-b");
    expect(tabAtIndex(state, 3)).toBe("t-a2");
  });

  it("settles a right group alone into the left one", () => {
    const state = settle({
      tabs: [{ ...(tabById(splitState(), "t-a2") as Tab), group: 1 }],
      activeId: "t-a2",
      focused: 1,
    });
    expect(groups(state)).toEqual([0]);
    expect(state.focused).toBeUndefined();
  });
});

describe("split ratio", () => {
  it("keeps the ratio between the limits", () => {
    expect(clampRatio(10)).toBe(SPLIT_RATIO.min);
    expect(clampRatio(90)).toBe(SPLIT_RATIO.max);
    expect(clampRatio(42.345)).toBe(42.3);
    expect(clampRatio(Number.NaN)).toBe(SPLIT_RATIO.initial);
  });

  it("steps with the arrow keys, further with Shift, and jumps with Home and End", () => {
    expect(ratioAfterKey(50, "ArrowLeft", false)).toBe(48);
    expect(ratioAfterKey(50, "ArrowRight", true)).toBe(60);
    expect(ratioAfterKey(74, "ArrowRight", true)).toBe(75);
    expect(ratioAfterKey(50, "Home", false)).toBe(25);
    expect(ratioAfterKey(50, "End", false)).toBe(75);
    expect(ratioAfterKey(50, "Enter", false)).toBeNull();
  });
});
