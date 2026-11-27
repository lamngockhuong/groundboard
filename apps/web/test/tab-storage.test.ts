import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTabs, saveTabs, tabStorageKey } from "../src/tab-storage.ts";
import {
  emptyTabs,
  openNew,
  openPasted,
  openPreview,
  saveTabView,
  setTabPrefs,
  type TabsState,
} from "../src/tabs.ts";
import { DEFAULT_PREFS } from "../src/view-prefs.ts";

const KEY = "groundboard.tabs.test";

function sample(): TabsState {
  let state = emptyTabs();
  state = openNew(state, { id: "e1", route: { view: "board", slug: "a" } }, "ta", 1).state;
  state = openPreview(
    state,
    { id: "e2", route: { view: "board", slug: "b", node: "n.1" } },
    "tb",
    2,
  ).state;
  state = saveTabView(state, "tb", { scrollX: 1.5, scrollY: -2, zoom: 0.8, selected: ["x"] });
  return state;
}

describe("tab storage", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("reads back what it wrote", () => {
    const state = sample();
    saveTabs(KEY, state);
    const read = loadTabs(KEY, 1);
    expect(read.activeId).toBe("tb");
    expect(read.tabs.map(({ lastUsed: _l, ...rest }) => rest)).toEqual(
      state.tabs.map(({ lastUsed: _l, ...rest }) => rest),
    );
  });

  it("never writes a pasted board", () => {
    const state = openPasted(sample(), { id: "e3", route: { view: "home" } }, "tp", 3).state;
    saveTabs(KEY, state);
    const read = loadTabs(KEY);
    expect(read.tabs.map((t) => t.id)).toEqual(["ta", "tb"]);
    expect(read.activeId).toBeNull();
  });

  it("reads back each tab's toolbar choices", () => {
    const own = {
      designShown: false,
      hiddenLayers: ["arrows", "notes"] as const,
      font: "mono" as const,
      sourcesOpen: false,
    };
    let state = setTabPrefs(sample(), "ta", own);
    state = setTabPrefs(state, "tb", DEFAULT_PREFS);
    saveTabs(KEY, state);
    const read = loadTabs(KEY, 1);
    expect(read.tabs.map((t) => t.prefs)).toEqual([own, DEFAULT_PREFS]);
  });

  it("keeps a tab whose choices do not read back, without them", () => {
    const tab = (id: string, slug: string, prefs: unknown) => ({
      id,
      preview: false,
      history: { entries: [{ id: `e-${id}`, route: { view: "board", slug } }], index: 0 },
      prefs,
    });
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        tabs: [
          tab("t1", "a", { ...DEFAULT_PREFS, font: "comic" }),
          tab("t2", "b", { ...DEFAULT_PREFS, hiddenLayers: ["nope"] }),
          tab("t3", "c", { ...DEFAULT_PREFS, hiddenLayers: ["refs", "refs"] }),
          tab("t4", "d", "yes"),
        ],
        activeIndex: 0,
      }),
    );
    const read = loadTabs(KEY);
    expect(read.tabs.map((t) => t.slug)).toEqual(["a", "b", "c", "d"]);
    expect(read.tabs.map((t) => t.prefs)).toEqual([
      undefined,
      undefined,
      { ...DEFAULT_PREFS, hiddenLayers: ["refs"] },
      undefined,
    ]);
  });

  it("drops what does not read back: broken JSON, a bad slug, a bad node", () => {
    sessionStorage.setItem(KEY, "{not json");
    expect(loadTabs(KEY)).toEqual({ tabs: [], activeId: null });
    const tab = (route: unknown) => ({
      id: "t1",
      preview: false,
      history: { entries: [{ id: "e1", route }], index: 0 },
    });
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        tabs: [
          tab({ view: "board", slug: "../etc" }),
          { ...tab({ view: "board", slug: "ok", node: "bad node" }), id: "t2" },
          { ...tab({ view: "board", slug: "fine" }), id: "t3" },
        ],
        activeIndex: 2,
      }),
    );
    const read = loadTabs(KEY);
    expect(read.tabs.map((t) => t.slug)).toEqual(["fine"]);
    expect(read.activeId).toBe("t3");
  });

  it("drops a tab whose history index or view is out of shape", () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        tabs: [
          {
            id: "t1",
            preview: false,
            history: { entries: [{ id: "e1", route: { view: "board", slug: "a" } }], index: 3 },
          },
          {
            id: "t2",
            preview: false,
            history: {
              entries: [{ id: "e2", route: { view: "board", slug: "b" }, view: { scrollX: "x" } }],
              index: 0,
            },
          },
        ],
        activeIndex: 0,
      }),
    );
    expect(loadTabs(KEY).tabs).toEqual([]);
  });

  it("returns nothing and throws nothing when storage refuses", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveTabs(KEY, sample())).not.toThrow();
    expect(loadTabs(KEY)).toEqual({ tabs: [], activeId: null });
  });

  it("keeps one list per atlas, and one for the library", () => {
    expect(tabStorageKey("abcdef0123456789", false)).toBe("groundboard.tabs.abcdef0123456789");
    expect(tabStorageKey(undefined, true)).toBe("groundboard.tabs.library");
    expect(tabStorageKey("abcdef0123456789", true)).toBe("groundboard.tabs.library");
    expect(tabStorageKey(undefined, false)).not.toBe(tabStorageKey(undefined, true));
  });
});
