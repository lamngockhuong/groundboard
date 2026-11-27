import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasBoardResult } from "../src/api.ts";
import { type AtlasHost, useAtlas } from "../src/use-atlas.ts";
import { DEFAULT_PREFS, type ViewPrefs } from "../src/view-prefs.ts";

const api = vi.hoisted(() => ({
  fetchHealth: vi.fn(),
  fetchAtlas: vi.fn(),
  fetchAtlasBoard: vi.fn(),
}));
vi.mock("../src/api.ts", () => api);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scene = { elements: [], appState: {}, files: {} };
const ok: AtlasBoardResult = {
  status: "ok",
  scene: scene as never,
  stale: false,
  staleSourceIds: [],
  warnings: [],
  references: { frames: 0, cached: 0 },
};

/** A board request the test settles by hand. */
function deferred() {
  let resolve: (value: AtlasBoardResult) => void = () => undefined;
  const promise = new Promise<AtlasBoardResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function host(): AtlasHost & { shown: string[] } {
  const shown: string[] = [];
  return {
    shown,
    setBusy: vi.fn(),
    clearMessages: vi.fn(),
    setError: vi.fn(),
    setIssues: vi.fn(),
    setWarnings: vi.fn(),
    askToken: vi.fn(),
    showBoard: vi.fn((board: { slug: string | null }) => {
      shown.push(board.slug ?? "(pasted)");
    }),
    closeScene: vi.fn(),
    closeAtlasBoard: vi.fn(),
  };
}

let root: Root;
let container: HTMLElement;

let latest: ReturnType<typeof useAtlas>;

function Probe({ host }: { host: AtlasHost }) {
  latest = useAtlas(host);
  return null;
}

async function mount(h: AtlasHost) {
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(createElement(Probe, { host: h })));
}

/** Follows a link, as the browser does: the hash changes, then one hashchange event fires. */
async function go(hash: string) {
  await act(async () => {
    if (window.location.hash === hash || (hash === "#/" && window.location.hash === "")) return;
    const changed = new Promise((resolve) =>
      window.addEventListener("hashchange", resolve, { once: true }),
    );
    window.location.hash = hash;
    await changed;
  });
}

const flush = () => act(async () => undefined);

/** Back or Forward: waits for the popstate the browser fires once it has moved. */
async function traverse(move: () => void) {
  await act(async () => {
    const moved = new Promise((resolve) =>
      window.addEventListener("popstate", resolve, { once: true }),
    );
    move();
    await moved;
  });
}

describe("useAtlas", () => {
  beforeEach(async () => {
    sessionStorage.clear();
    await new Promise<void>((resolve) => {
      if (window.location.hash === "#/") return resolve();
      window.addEventListener("hashchange", () => resolve(), { once: true });
      window.location.hash = "#/";
    });
    api.fetchHealth.mockResolvedValue({ atlas: true });
    api.fetchAtlas.mockResolvedValue({
      status: "ok",
      atlas: { boards: [], refs: [], problems: [] },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.clearAllMocks();
  });

  it("sends one board request at a time, then the board asked for last", async () => {
    const first = deferred();
    const last = deferred();
    api.fetchAtlasBoard.mockImplementation((slug: string) =>
      slug === "a" ? first.promise : last.promise,
    );
    const h = host();
    await mount(h);
    await go("#/board/a");
    await go("#/board/b");
    await go("#/board/c");
    expect(api.fetchAtlasBoard.mock.calls.map((c) => c[0])).toEqual(["a"]);
    await act(async () => first.resolve(ok));
    expect(api.fetchAtlasBoard.mock.calls.map((c) => c[0])).toEqual(["a", "c"]);
    await act(async () => last.resolve(ok));
    expect(h.shown).toEqual(["c"]);
  });

  it("asks again for a board whose request failed when its link is followed again", async () => {
    // The first request and the one retry after it both fail.
    api.fetchAtlasBoard
      .mockResolvedValueOnce({ status: "error", message: "busy" })
      .mockResolvedValueOnce({ status: "error", message: "busy" })
      .mockResolvedValueOnce(ok);
    const h = host();
    await mount(h);
    await go("#/board/a");
    await vi.waitFor(async () => {
      await flush();
      expect(h.setError).toHaveBeenCalledWith("busy");
    });
    await go("#/");
    await go("#/board/a");
    await flush();
    expect(api.fetchAtlasBoard).toHaveBeenCalledTimes(3);
    expect(h.shown).toEqual(["a"]);
  });

  it("closes the atlas board and reloads the index on the way home", async () => {
    api.fetchAtlasBoard.mockResolvedValue(ok);
    const h = host();
    await mount(h);
    await go("#/board/a");
    await flush();
    const loads = api.fetchAtlas.mock.calls.length;
    await go("#/");
    await flush();
    expect(h.closeAtlasBoard).toHaveBeenCalledTimes(1);
    expect(api.fetchAtlas.mock.calls.length).toBe(loads + 1);
  });

  it("reports checked only once the server answered and its index loaded", async () => {
    let answer: (value: unknown) => void = () => undefined;
    api.fetchAtlas.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await mount(host());
    expect(latest.checked).toBe(false);
    expect(latest.atlas).toBeNull();
    await act(async () => answer({ status: "ok", atlas: { boards: [], refs: [], problems: [] } }));
    expect(latest.checked).toBe(true);
    expect(latest.atlas).not.toBeNull();
  });

  it("lists the sample boards and opens the sample overview when the server serves no atlas", async () => {
    api.fetchHealth.mockResolvedValue({ atlas: false });
    const h = host();
    await mount(h);
    await vi.waitFor(
      async () => {
        await flush();
        expect(latest.checked).toBe(true);
      },
      { timeout: 10_000 },
    );
    expect(latest.atlasEnabled).toBe(true);
    expect(latest.library).toEqual({ sample: true, memoryOnly: false });
    expect(latest.atlas?.boards.map((b) => b.slug)).toContain("overview-web");
    expect(api.fetchAtlas).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/board/overview-web");
    await vi.waitFor(
      async () => {
        await flush();
        expect(h.shown).toEqual(["overview-web"]);
      },
      { timeout: 10_000 },
    );
    expect(api.fetchAtlasBoard).not.toHaveBeenCalled();
  });

  it("stores opened boards in place of the samples, and brings the samples back when the list is empty", async () => {
    api.fetchHealth.mockResolvedValue({ atlas: false });
    const h = host();
    await mount(h);
    await vi.waitFor(
      async () => {
        await flush();
        expect(latest.checked).toBe(true);
      },
      { timeout: 10_000 },
    );
    const scene = { elements: [], appState: {}, files: {} };
    await act(async () =>
      latest.addToLibrary([
        { slug: "mine", input: { type: "scene", scene, title: "mine.excalidraw" }, openedAt: 1 },
      ]),
    );
    expect(latest.library?.sample).toBe(false);
    expect(latest.atlas?.boards.map((b) => b.slug)).toEqual(["mine"]);
    expect(window.location.hash).toBe("#/board/mine");
    await vi.waitFor(
      async () => {
        await flush();
        expect(h.shown).toContain("mine");
      },
      { timeout: 10_000 },
    );

    await act(async () => latest.removeFromLibrary("mine"));
    expect(latest.library?.sample).toBe(true);
    expect(latest.atlas?.boards.map((b) => b.slug)).toContain("overview-web");
    expect(window.location.hash).toBe("#/");
  });

  it("goes back to the last node of the same board without loading it again, with its view", async () => {
    api.fetchAtlasBoard.mockResolvedValue(ok);
    const h = host();
    await mount(h);
    await go("#/board/a");
    await flush();
    const view = { scrollX: 5, scrollY: 6, zoom: 2, selected: ["el"] };
    latest.viewReader.current = (slug) => (slug === "a" ? view : null);
    await go("#/board/a?node=n1");
    expect(latest.focus).toMatchObject({ nodeId: "n1" });
    expect(latest.canBack).toBe(true);
    await traverse(() => latest.back());
    expect(window.location.hash).toBe("#/board/a");
    expect(latest.focus?.view).toEqual(view);
    expect(latest.focus?.nodeId).toBeUndefined();
    expect(latest.canForward).toBe(true);
    expect(api.fetchAtlasBoard).toHaveBeenCalledTimes(1);
    await traverse(() => latest.forward());
    expect(window.location.hash).toBe("#/board/a?node=n1");
    expect(latest.focus?.view).toEqual(view);
    expect(api.fetchAtlasBoard).toHaveBeenCalledTimes(1);
  });

  it("opens the board of an earlier entry on Back, and a new link drops the entries ahead", async () => {
    api.fetchAtlasBoard.mockResolvedValue(ok);
    const h = host();
    await mount(h);
    await go("#/board/a");
    await flush();
    await go("#/board/b");
    await flush();
    await traverse(() => latest.back());
    await flush();
    expect(h.shown).toEqual(["a", "b", "a"]);
    await go("#/board/c");
    await flush();
    expect(latest.canForward).toBe(false);
    expect(latest.canBack).toBe(true);
  });

  it("stays on the board when unsaved edits refuse Back, and keeps the history as it was", async () => {
    api.fetchAtlasBoard.mockResolvedValue(ok);
    const h = host();
    await mount(h);
    await go("#/board/a");
    await flush();
    await go("#/board/b");
    await flush();
    latest.leaveGuard.current = () => false;
    await traverse(() => latest.back());
    // The refused step is undone by a step the other way.
    await vi.waitFor(() => expect(window.location.hash).toBe("#/board/b"));
    await flush();
    expect(latest.route).toEqual({ view: "board", slug: "b" });
    expect(h.shown).toEqual(["a", "b"]);
    expect(latest.canBack).toBe(true);
    expect(latest.canForward).toBe(false);
    latest.leaveGuard.current = null;
    await traverse(() => latest.back());
    await flush();
    expect(h.shown).toEqual(["a", "b", "a"]);
  });

  it("does nothing on the way home when no atlas board was asked for", async () => {
    const h = host();
    await mount(h);
    await go("#/");
    expect(h.closeAtlasBoard).not.toHaveBeenCalled();
  });

  it("answers the boards of two tabs into each, whichever is on screen when they arrive", async () => {
    const first = deferred();
    const second = deferred();
    api.fetchAtlasBoard.mockImplementation((slug: string) =>
      slug === "a" ? first.promise : second.promise,
    );
    const h = host();
    await mount(h);
    await go("#/board/a");
    await act(async () => latest.openPlace({ slug: "b" }, "new"));
    expect(latest.tabs.tabs.map((t) => t.slug)).toEqual(["a", "b"]);
    expect(window.location.hash).toBe("#/board/b");
    await act(async () => first.resolve(ok));
    // Tab a is not on screen: its board is kept, not shown.
    expect(h.shown).toEqual([]);
    await act(async () => second.resolve(ok));
    expect(h.shown).toEqual(["b"]);
    // Back on tab a: its board comes from memory, with no request.
    const tabA = latest.tabs.tabs[0]?.id as string;
    await act(async () => latest.selectTab(tabA));
    expect(h.shown).toEqual(["b", "a"]);
    expect(window.location.hash).toBe("#/board/a");
    expect(api.fetchAtlasBoard.mock.calls.map((c) => c[0])).toEqual(["a", "b", "a"]);
  });

  it("keeps a missing board's tab, with the error in it, and leaves the address alone", async () => {
    api.fetchAtlasBoard.mockResolvedValue({ status: "not-found" });
    const h = host();
    await mount(h);
    await go("#/board/gone");
    await flush();
    expect(window.location.hash).toBe("#/board/gone");
    expect(latest.tabs.tabs).toHaveLength(1);
    expect(latest.tabs.tabs[0]?.error).toMatch(/gone/);
    expect(h.closeScene).toHaveBeenCalled();
  });

  it("brings the tabs back after a reload, at the place the address names", async () => {
    api.fetchAtlasBoard.mockResolvedValue(ok);
    let h = host();
    await mount(h);
    await go("#/board/a");
    await flush();
    await act(async () => latest.openPlace({ slug: "b" }, "new"));
    await flush();
    await act(async () => root.unmount());
    // A reload: the same session storage, the address of tab b.
    h = host();
    await mount(h);
    await flush();
    expect(latest.tabs.tabs.map((t) => t.slug)).toEqual(["a", "b"]);
    expect(latest.route).toEqual({ view: "board", slug: "b" });
    expect(h.shown).toEqual(["b"]);
  });

  it("opens the board of a deep link in a preview tab beside the tabs kept", async () => {
    api.fetchAtlasBoard.mockResolvedValue(ok);
    sessionStorage.setItem(
      "groundboard.tabs.atlas",
      JSON.stringify({
        tabs: [
          {
            id: "t1",
            preview: false,
            history: { entries: [{ id: "e1", route: { view: "board", slug: "a" } }], index: 0 },
          },
        ],
        activeIndex: 0,
      }),
    );
    await new Promise<void>((resolve) => {
      window.addEventListener("hashchange", () => resolve(), { once: true });
      window.location.hash = "#/board/c?node=n1";
    });
    const h = host();
    await mount(h);
    await flush();
    expect(latest.tabs.tabs.map((t) => t.slug)).toEqual(["a", "c"]);
    expect(latest.route).toEqual({ view: "board", slug: "c", node: "n1" });
    expect(latest.focus).toMatchObject({ nodeId: "n1" });
    expect(h.shown).toEqual(["c"]);
  });

  it("asks before another tab takes the screen, and stays when refused", async () => {
    api.fetchAtlasBoard.mockResolvedValue(ok);
    const h = host();
    await mount(h);
    await go("#/board/a");
    await flush();
    await act(async () => latest.openPlace({ slug: "b" }, "new"));
    await flush();
    const kinds: string[] = [];
    latest.leaveGuard.current = (kind) => {
      kinds.push(kind);
      return false;
    };
    const tabA = latest.tabs.tabs[0]?.id as string;
    await act(async () => latest.selectTab(tabA));
    await act(async () => latest.closeTab(latest.tabs.activeId as string));
    expect(kinds).toEqual(["tab", "tab"]);
    expect(latest.tabs.tabs).toHaveLength(2);
    expect(window.location.hash).toBe("#/board/b");
  });

  it("goes home without closing a tab, and back to a tab's board when it is chosen", async () => {
    api.fetchAtlasBoard.mockResolvedValue(ok);
    const h = host();
    await mount(h);
    await go("#/board/a");
    await flush();
    await go("#/");
    expect(latest.tabs.tabs).toHaveLength(1);
    expect(latest.tabs.activeId).toBeNull();
    expect(latest.route).toEqual({ view: "home" });
    await act(async () => latest.selectTab(latest.tabs.tabs[0]?.id as string));
    expect(window.location.hash).toBe("#/board/a");
    expect(latest.route).toEqual({ view: "board", slug: "a" });
  });

  it("shows a pasted board in a tab of its own, under the home address", async () => {
    api.fetchAtlasBoard.mockResolvedValue(ok);
    const h = host();
    await mount(h);
    await go("#/board/a");
    await flush();
    await act(async () => latest.pinTab(latest.tabs.activeId as string));
    await act(async () => {
      latest.showPastedBoard({ scene: scene as never, title: "Pasted", fileName: "pasted" });
    });
    expect(latest.tabs.tabs.map((t) => t.slug)).toEqual(["a", null]);
    expect(window.location.hash).toBe("#/");
    expect(h.shown).toEqual(["a", "(pasted)"]);
    expect(latest.tabTitle(latest.tabs.tabs[1] as never)).toBe("Pasted");
    // Back returns to the atlas board's tab.
    await traverse(() => window.history.back());
    expect(latest.route).toEqual({ view: "board", slug: "a" });
    expect(latest.tabs.tabs).toHaveLength(2);
  });

  it("pins a pasted board in a tab of its own: links never replace it, closing it asks nothing more", async () => {
    api.fetchAtlasBoard.mockResolvedValue(ok);
    const h = host();
    await mount(h);
    await go("#/board/b");
    await flush();
    const asked: string[] = [];
    latest.leaveGuard.current = (kind) => {
      asked.push(kind);
      return true;
    };
    // The preview tab that shows b stays: the paste opens after it, pinned.
    await act(async () => {
      latest.showPastedBoard({ scene: scene as never, title: "Pasted", fileName: "pasted" });
    });
    expect(latest.tabs.tabs.map((t) => [t.slug, t.preview])).toEqual([
      ["b", true],
      [null, false],
    ]);
    expect(asked).toEqual(["tab"]);
    // An ordinary link replaces the preview tab, never the paste, and asks only as any tab does.
    await go("#/board/c");
    await flush();
    expect(asked).toEqual(["tab", "tab"]);
    expect(latest.tabs.tabs.map((t) => t.slug)).toEqual(["c", null]);
    // Back to the paste's entry, then to b's entry the preview tab still has.
    await traverse(() => window.history.back());
    await flush();
    expect(latest.tabs.tabs[1]?.id).toBe(latest.tabs.activeId);
    await traverse(() => window.history.back());
    await flush();
    const ids = latest.tabs.tabs.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(latest.route).toEqual({ view: "board", slug: "b" });
    expect(latest.tabs.tabs.filter((t) => t.slug === null)).toHaveLength(1);

    // Closing the paste asks only through the unsaved-work guard, refused here.
    const paste = latest.tabs.tabs.find((t) => t.slug === null)?.id as string;
    await act(async () => latest.selectTab(paste));
    asked.length = 0;
    latest.leaveGuard.current = (kind) => {
      asked.push(kind);
      return false;
    };
    await act(async () => latest.closeTab(paste));
    expect(asked).toEqual(["tab"]);
    expect(latest.tabs.tabs.some((t) => t.id === paste)).toBe(true);
    latest.leaveGuard.current = () => true;
    await act(async () => latest.closeTab(paste));
    expect(latest.tabs.tabs.some((t) => t.id === paste)).toBe(false);
  });

  it("gives a new tab the choices made last, and keeps each tab's own across a reload", async () => {
    api.fetchAtlasBoard.mockResolvedValue(ok);
    api.fetchAtlas.mockResolvedValue({
      status: "ok",
      atlas: {
        atlasId: "prefs",
        boards: [
          { slug: "a", title: "A" },
          { slug: "b", title: "B" },
        ],
        refs: [],
        problems: [],
      },
    });
    let last: ViewPrefs = DEFAULT_PREFS;
    const h = { ...host(), defaultPrefs: () => last };
    await mount(h);
    await go("#/board/a");
    await flush();
    const a = latest.tabs.activeId as string;
    expect(latest.tabs.tabs[0]?.prefs).toEqual(DEFAULT_PREFS);
    const own: ViewPrefs = { ...DEFAULT_PREFS, designShown: false, font: "mono" };
    last = own;
    await act(async () => latest.setTabPrefs(a, own));
    await act(async () => latest.openPlace({ slug: "b" }, "new"));
    await flush();
    const b = latest.tabs.activeId as string;
    expect(b).not.toBe(a);
    // Tab b started from the choices made last; changing them later leaves tab a as it was.
    expect(latest.tabs.tabs.find((t) => t.id === b)?.prefs).toEqual(own);
    const other: ViewPrefs = { ...own, sourcesOpen: false };
    await act(async () => latest.setTabPrefs(b, other));
    expect(latest.tabs.tabs.find((t) => t.id === a)?.prefs).toEqual(own);

    await act(async () => root.unmount());
    await mount(h);
    await flush();
    expect(latest.tabs.tabs.map((t) => [t.slug, t.prefs])).toEqual([
      ["a", own],
      ["b", other],
    ]);
  });

  it("asks once when the browser's Back is refused", async () => {
    api.fetchAtlasBoard.mockResolvedValue(ok);
    const h = host();
    await mount(h);
    await go("#/board/a");
    await flush();
    await go("#/board/a?node=n1");
    let asked = 0;
    latest.leaveGuard.current = () => {
      asked += 1;
      return false;
    };
    await traverse(() => window.history.back());
    await vi.waitFor(() => expect(window.location.hash).toBe("#/board/a?node=n1"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flush();
    expect(asked).toBe(1);
    expect(latest.route).toEqual({ view: "board", slug: "a", node: "n1" });
  });

  it("tries a failed board request once more before showing the error", async () => {
    api.fetchAtlasBoard
      .mockResolvedValueOnce({ status: "error", message: "busy" })
      .mockResolvedValueOnce(ok);
    const h = host();
    await mount(h);
    await go("#/board/a");
    await vi.waitFor(async () => {
      await flush();
      expect(h.shown).toEqual(["a"]);
    });
    expect(h.setError).not.toHaveBeenCalled();
  });

  it("asks the server once when a tab is chosen again while its board is still on the way", async () => {
    const slow = deferred();
    api.fetchAtlasBoard.mockImplementation((slug: string) =>
      slug === "a" ? slow.promise : Promise.resolve(ok),
    );
    const h = host();
    await mount(h);
    await go("#/board/a");
    const tabA = latest.tabs.activeId as string;
    await act(async () => latest.openPlace({ slug: "b" }, "new"));
    await act(async () => latest.selectTab(tabA));
    await act(async () => slow.resolve(ok));
    await flush();
    expect(api.fetchAtlasBoard.mock.calls.filter((c) => c[0] === "a")).toHaveLength(1);
    expect(h.shown.filter((s) => s === "a")).toHaveLength(1);
  });
});
