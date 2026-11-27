import {
  activate,
  focusedGroup,
  type Group,
  groupActiveId,
  groupOf,
  groupTabs,
  isSplit,
  makeRoom,
  type Opened,
  otherGroup,
  settle,
  type Tab,
  type TabsState,
  tabById,
} from "./tabs.ts";

/**
 * Two boards side by side: the tabs in a left and a right group, one pane each. The groups
 * are the `group` of each tab (see `tabs.ts`); a screen too narrow for two panes shows every
 * tab in one row without changing a tab's group, so widening it again brings both panes back.
 * Pure functions over the tabs' state; `use-atlas.ts` keeps it, `App.tsx` lays the panes out.
 */

/** Below this width the panes share one row of tabs and one board. Same breakpoint as the CSS. */
export const SPLIT_NARROW = "(max-width: 1023px)";

/** The left pane's share of the width, in percent: half and half until the reader drags it. */
export const SPLIT_RATIO = { initial: 50, min: 25, max: 75, step: 2, bigStep: 10 } as const;

/**
 * The tabs whose boards are on the page: the focused pane's first (none on the atlas home),
 * then the other pane's. A narrow window hides the other pane's board without taking it off
 * the page, so nothing on it is lost and widening shows it as it was.
 */
export function visibleTabIds(state: TabsState): string[] {
  const ids = state.activeId === null ? [] : [state.activeId];
  return state.otherId !== undefined ? [...ids, state.otherId] : ids;
}

/**
 * Whether two panes show: two groups, room for both, and something in each (the focused pane
 * may show the atlas home beside the other pane's board).
 */
export const showsTwoPanes = (state: TabsState, wide: boolean): boolean =>
  wide && isSplit(state) && (state.activeId !== null || state.otherId !== undefined);

/** One group as its pane's tab bar shows it: its tabs, and the one on screen there. */
export function groupView(state: TabsState, group: Group): TabsState {
  return { tabs: groupTabs(state, group), activeId: groupActiveId(state, group) };
}

/**
 * Every tab in one row, for a screen too narrow for two panes: the left group's tabs, then the
 * right group's, with the focused pane's tab on screen. Only a view: no tab changes group.
 */
export function narrowView(state: TabsState): TabsState {
  return { tabs: state.tabs, activeId: state.activeId };
}

/** Moves the focus to the pane of that group, which keeps the tab it shows. */
export function focusGroup(state: TabsState, group: Group, now: number): TabsState {
  if (group === focusedGroup(state) || !isSplit(state)) return state;
  const id = groupActiveId(state, group);
  return id === null ? state : activate(state, id, now);
}

/** The tab in that group, after the one it shows (or last). */
function insertInGroup(state: TabsState, tab: Tab, group: Group): Tab[] {
  const placed: Tab = group === 1 ? { ...tab, group } : withoutGroup(tab);
  const tabs = state.tabs.filter((t) => t.id !== tab.id);
  const shown = groupActiveId(state, group);
  const at = tabs.findIndex((t) => t.id === shown);
  const last = tabs.reduce((end, t, i) => (groupOf(t) === group ? i : end), -1);
  const index = at >= 0 ? at + 1 : last < 0 ? tabs.length : last + 1;
  tabs.splice(index, 0, placed);
  return tabs;
}

function withoutGroup(tab: Tab): Tab {
  const { group: _group, ...rest } = tab;
  return rest;
}

/**
 * Opens a tab's board beside it, in the other group: the selected tab of the focused pane
 * unless `tabId` names another. The new tab takes the same history and views, so it opens where
 * the reader is, pinned; the focus goes to its pane. A tab of the other group that has the board
 * already is shown instead. Null when it cannot be done: no such tab, a pasted board (it has no
 * address to load again), or every tab pinned at the limit.
 */
export function openBeside(
  state: TabsState,
  newId: string,
  now: number,
  tabId?: string,
): Opened | null {
  const source = tabById(state, tabId ?? state.activeId ?? "");
  if (!source || source.slug === null) return null;
  const target = otherGroup(groupOf(source));
  const existing = state.tabs.find((t) => groupOf(t) === target && t.slug === source.slug);
  if (existing)
    return { state: activate(state, existing.id, now), tabId: existing.id, full: false };
  const room = makeRoom(state);
  if (!room) return null;
  const tab: Tab = {
    id: newId,
    slug: source.slug,
    preview: false,
    history: source.history,
    lastUsed: now,
    ...(source.prefs ? { prefs: source.prefs } : {}),
  };
  // The pane the board is copied from keeps showing what it showed.
  const left = groupActiveId(room, groupOf(source));
  const tabs = insertInGroup(room, tab, target);
  return {
    state: settle({
      tabs,
      activeId: newId,
      ...(target === 1 ? { focused: target } : {}),
      ...(left !== null ? { otherId: left } : {}),
    }),
    tabId: newId,
    full: false,
  };
}

/**
 * Moves a tab to the other group, where it goes on screen and takes the focus. The pane it
 * leaves shows its neighbour, or goes when it held no other tab.
 */
export function moveToOtherGroup(state: TabsState, tabId: string, now: number): TabsState {
  const tab = tabById(state, tabId);
  if (!tab) return state;
  const from = groupOf(tab);
  const to = otherGroup(from);
  const siblings = groupTabs(state, from);
  const at = siblings.findIndex((t) => t.id === tabId);
  const shownFrom = groupActiveId(state, from);
  const left =
    shownFrom === tabId ? (siblings[at + 1] ?? siblings[at - 1])?.id : (shownFrom ?? undefined);
  const tabs = insertInGroup(state, { ...tab, lastUsed: now }, to);
  return settle({
    tabs,
    activeId: tabId,
    ...(to === 1 ? { focused: to } : {}),
    ...(left !== undefined ? { otherId: left } : {}),
  });
}

/** A ratio kept within the limits, to a tenth of a percent. */
export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return SPLIT_RATIO.initial;
  const kept = Math.min(SPLIT_RATIO.max, Math.max(SPLIT_RATIO.min, value));
  return Math.round(kept * 10) / 10;
}

/**
 * The ratio after a key on the handle between the panes: ← and → step (further with Shift),
 * Home and End go to the limits. Null for any other key.
 */
export function ratioAfterKey(ratio: number, key: string, shift: boolean): number | null {
  const step = shift ? SPLIT_RATIO.bigStep : SPLIT_RATIO.step;
  switch (key) {
    case "ArrowLeft":
      return clampRatio(ratio - step);
    case "ArrowRight":
      return clampRatio(ratio + step);
    case "Home":
      return SPLIT_RATIO.min;
    case "End":
      return SPLIT_RATIO.max;
    default:
      return null;
  }
}
