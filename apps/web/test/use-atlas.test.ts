import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasBoardResult } from "../src/api.ts";
import { type AtlasHost, useAtlas } from "../src/use-atlas.ts";

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
    showBoard: vi.fn((_scene, slug: string) => shown.push(slug)),
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

describe("useAtlas", () => {
  beforeEach(async () => {
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
    api.fetchAtlasBoard
      .mockResolvedValueOnce({ status: "error", message: "busy" })
      .mockResolvedValueOnce(ok);
    const h = host();
    await mount(h);
    await go("#/board/a");
    await flush();
    expect(h.setError).toHaveBeenCalledWith("busy");
    await go("#/");
    await go("#/board/a");
    await flush();
    expect(api.fetchAtlasBoard).toHaveBeenCalledTimes(2);
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

  it("does nothing on the way home when no atlas board was asked for", async () => {
    const h = host();
    await mount(h);
    await go("#/");
    expect(h.closeAtlasBoard).not.toHaveBeenCalled();
  });
});
