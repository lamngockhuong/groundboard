import { emptyOverlay, type Overlay, parseOverlay } from "@groundboard/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AtlasBoardResult,
  type AtlasIndex,
  type AtlasPlace,
  fetchAtlas,
  fetchAtlasBoard,
  fetchBoardFiles,
  fetchHealth,
  type Issue,
  type ReferenceCount,
  saveAtlasFile,
} from "./api.ts";
import { deleteDraft, draftsMemoryOnly, getDraft, saveDraft } from "./drafts.ts";
import { t } from "./i18n.ts";
import { type Scene, toScene } from "./input.ts";
import {
  clearEntries,
  type LibraryEntry,
  listEntries,
  removeEntry,
  saveEntries,
} from "./library.ts";
import { isStaticMode } from "./mode.ts";
import {
  canBack,
  canForward,
  currentEntry,
  indexOf,
  type NavEntry,
  type ViewState,
} from "./nav-history.ts";
import { formatRoute, parseRoute, type Route } from "./route.ts";
import { loadTabs, saveTabs, tabStorageKey } from "./tab-storage.ts";
import {
  activate,
  activeTab,
  cachePlan,
  close,
  emptyTabs,
  type Opened,
  openNew,
  openPasted,
  openPreview,
  pin,
  saveTabView,
  setTabError,
  TAB_LIMIT,
  type Tab,
  type TabsState,
  tabAtIndex,
  tabById,
  tabRoute,
  traverseTab,
} from "./tabs.ts";

/** Boards opened in this browser, shown like an atlas when the server serves none. */
export interface LibraryState {
  /** Nothing opened yet: the sample boards are listed instead. */
  sample: boolean;
  /** Storage failed, so the list lasts for this page load. */
  memoryOnly: boolean;
}

interface LibraryData {
  entries: Map<string, LibraryEntry>;
  sample: boolean;
}

/** What the server's check of a board found: changed sources, and the Figma images cached. */
export interface BoardCheck {
  stale: boolean;
  staleSourceIds: string[];
  references: ReferenceCount;
  /** Rendered in this browser from a draft kept there: not compared with the sources since. */
  draft?: boolean;
}

const NO_CHECK: BoardCheck = {
  stale: false,
  staleSourceIds: [],
  references: { frames: 0, cached: 0 },
};

/** A board ready to go on screen: an atlas board as rendered, or a board pasted. */
export interface ShownBoard {
  scene: Scene;
  /** The atlas board, or null for a board pasted or opened from a file. */
  slug: string | null;
  title: string;
  fileName: string;
  check: BoardCheck;
}

/** A board kept in memory for its tab, with what the check said when it was loaded. */
interface CachedBoard extends ShownBoard {
  warnings: string[];
  /** Tells a board loaded again apart from the one kept; absent for a pasted board. */
  signature?: string;
}

/** Where the edits of the board on screen go. */
export type EditMode =
  /** Into its files, through a local `serve --atlas`. */
  | "file"
  /** Into the list of boards kept in this browser. */
  | "library"
  /** Into a draft kept in this browser, to download as a zip. */
  | "draft";

/** A board opened for editing: what it is made of now, and where saves go. */
export interface EditSession {
  slug: string;
  mode: EditMode;
  /** The board as it is now: the draft's when there is one, else the file's. */
  board: Record<string, unknown>;
  overlay: Overlay;
}

/** What the atlas needs from the page around it to show a board or a failure. */
export interface AtlasHost {
  setBusy: (busy: boolean) => void;
  clearMessages: () => void;
  setError: (message: string) => void;
  setIssues: (issues: Issue[]) => void;
  setWarnings: (warnings: string[]) => void;
  askToken: (rejected: boolean, retry: () => Promise<void>) => void;
  /** Puts a board on screen, in place of whatever was there. */
  showBoard: (board: ShownBoard) => void;
  /** Takes the board off screen: the tab on screen has none to show yet, or none at all. */
  closeScene: () => void;
  /** Back to the atlas home: the board leaves the screen, its tab stays open. */
  closeAtlasBoard: () => void;
  /** A short notice for the status line: every tab was pinned, so no tab could be added. */
  notify?: (message: string) => void;
  /**
   * Whether replacing the board on screen would lose work: edits not saved, or a change made
   * on the canvas outside edit mode. A board loaded again in the background then waits.
   */
  hasUnsavedWork?: () => boolean;
}

/**
 * Where the board on screen should look: a saved view (Back and Forward, a tab chosen again),
 * else a node (a deep link), else the whole board. `seq` changes to apply the same focus again.
 */
export interface NodeFocus {
  nodeId?: string;
  view?: ViewState;
  seq: number;
}

/**
 * What leaving the board on screen costs, for the guard to ask about: "nav" moves within the
 * tab (Back, Forward, a node of the same board), "tab" replaces the board on screen or puts
 * another tab there, "pasted" also replaces or closes a pasted board, which cannot be shown
 * again.
 */
export type LeaveKind = "nav" | "tab" | "pasted";

/** Ids of tabs and history entries: unique to this page load, so a reload never mixes them. */
const pageLoad = Math.random().toString(36).slice(2, 8);
let idCount = 0;
const newEntryId = () => `${pageLoad}-${++idCount}`;
const newTabId = () => `t${pageLoad}-${++idCount}`;

const currentRoute = (): Route => parseRoute(window.location.hash);

const NO_REFERENCES: ReferenceCount = { frames: 0, cached: 0 };

/** How long a failed board request waits before it is sent once more. */
const RETRY_MS = 800;

/** What the viewer keeps in `history.state`: the entry, its tab (null on the home), and where. */
interface HistoryMark {
  gb: string;
  tab: string | null;
  pos: number | null;
}

/** The viewer's mark on a browser history entry, or null when the state is not the viewer's. */
function readMark(state: unknown): HistoryMark | null {
  if (typeof state !== "object" || state === null) return null;
  const { gb, tab, pos } = state as { gb?: unknown; tab?: unknown; pos?: unknown };
  if (typeof gb !== "string") return null;
  return {
    gb,
    tab: typeof tab === "string" ? tab : null,
    pos: typeof pos === "number" && Number.isInteger(pos) ? pos : null,
  };
}

/** A cheap fingerprint of a rendered board, to tell whether loading it again changed it. */
export function sceneSignature(scene: Scene, check: BoardCheck): string {
  const text = JSON.stringify([scene.elements, check.stale, check.staleSourceIds]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

/** Renders a board of the library in the browser, answering as the server would for an atlas board. */
async function libraryBoard(entry: LibraryEntry | undefined): Promise<AtlasBoardResult> {
  if (!entry) return { status: "not-found" };
  if (entry.input.type === "board") return renderedInBrowser(entry.input.board, entry.overlay);
  return sceneBoard(entry);
}

/** A board rendered in the browser, answering as the server would for an atlas board. */
async function renderedInBrowser(
  board: Record<string, unknown>,
  overlay: unknown,
): Promise<AtlasBoardResult> {
  const { renderBoard } = await import("./render-client.ts");
  const result = await renderBoard(board, overlay);
  return result.status === "ok"
    ? {
        status: "ok",
        scene: result.scene,
        stale: false,
        staleSourceIds: [],
        warnings: result.warnings,
        references: NO_REFERENCES,
      }
    : result;
}

/** A scene of the library, checked again on its way out of storage, links included. */
async function sceneBoard(entry: LibraryEntry): Promise<AtlasBoardResult> {
  const scene = entry.input.type === "scene" ? toScene(entry.input.scene) : null;
  return scene
    ? {
        status: "ok",
        scene,
        stale: false,
        staleSourceIds: [],
        warnings: [],
        references: NO_REFERENCES,
      }
    : { status: "not-found" };
}

/** An overlay's text as stored, parsed; an empty overlay when there is none or it is invalid. */
function overlayFrom(value: unknown): Overlay {
  let json = value;
  if (typeof value === "string") {
    try {
      json = JSON.parse(value);
    } catch {
      return emptyOverlay();
    }
  }
  const parsed = json === null || json === undefined ? null : parseOverlay(json);
  return parsed?.ok ? parsed.value : emptyOverlay();
}

/** The address of the tab on screen: its place, or the home for none and for a pasted board. */
function addressOf(state: TabsState): string {
  const tab = activeTab(state);
  return tab && tab.slug !== null ? formatRoute(tabRoute(tab)) : formatRoute({ view: "home" });
}

/** What a change of tabs costs the board on screen: nothing, a move within it, or the board. */
function leaving(from: TabsState, to: TabsState): LeaveKind | null {
  const before = activeTab(from);
  if (!before) return null;
  const after = activeTab(to);
  if (!after || after.id !== before.id || after.slug !== before.slug) return "tab";
  const a = currentEntry(before.history)?.id;
  const b = currentEntry(after.history)?.id;
  return a === b ? null : "nav";
}

/** Whether a pasted board leaves its tab: the tab closed, or given another board or paste. */
function losesPasted(from: TabsState, to: TabsState): boolean {
  return from.tabs.some((tab) => {
    if (tab.slug !== null) return false;
    const after = to.tabs.find((t) => t.id === tab.id);
    return (
      !after ||
      after.slug !== null ||
      currentEntry(after.history)?.id !== currentEntry(tab.history)?.id
    );
  });
}

/** What to ask before the tabs change from one state to the other; null when nothing. */
function guardKind(from: TabsState, to: TabsState): LeaveKind | null {
  return losesPasted(from, to) ? "pasted" : leaving(from, to);
}

/** A board asked for on behalf of a tab; `background` checks a board already on screen. */
interface BoardRequest {
  tabId: string;
  slug: string;
  background: boolean;
  done: (() => void)[];
}

/**
 * The screen atlas: whether the server serves one, its index, and the tabs of boards open on
 * it. The server answers one request per client at a time, so the index is loaded before the
 * boards, and board requests wait in one queue, each answered into the tab that asked.
 *
 * Without an atlas on the server (a plain `serve`, or the viewer hosted as static files), the
 * boards opened in this browser take its place: they are stored locally, indexed and rendered
 * in the browser, and the sample boards stand in while none has been opened.
 *
 * Each tab keeps its own history of places. The browser's history follows: every entry
 * carries its tab and entry id in `history.state`, so Back and Forward (the browser's or the
 * viewer's) land on the right tab, at the right place.
 */
export function useAtlas(host: AtlasHost) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const [atlasEnabled, setAtlasEnabled] = useState(false);
  /** The server said whether it serves an atlas and, when it does, the index load ended. */
  const [checked, setChecked] = useState(false);
  const [atlas, setAtlas] = useState<AtlasIndex | null>(null);
  const [focus, setFocus] = useState<NodeFocus | null>(null);
  const focusSeq = useRef(0);
  // Kept in a ref so opening a board does not wait for the page to render the new index.
  const atlasRef = useRef<AtlasIndex | null>(null);
  const [library, setLibrary] = useState<LibraryState | null>(null);
  /** The board opened for editing, with the ETags its saves are checked against. */
  const editing = useRef<(EditSession & { sourceEtag: string; overlayEtag: string | null }) | null>(
    null,
  );
  /**
   * Asked before the board on screen is left with work that would be lost; false keeps it.
   * `kind` says whether the tab changes or its board is replaced ("tab"), or the reader only
   * moves within it ("nav").
   */
  const leaveGuard = useRef<((kind: LeaveKind) => boolean) | null>(null);
  const lastHash = useRef(typeof window === "undefined" ? "" : window.location.hash);
  /** Drafts cannot be stored in this browser: they last until the page is closed. */
  const [draftsVolatile, setDraftsVolatile] = useState(false);
  /** The library's boards; null while the server serves an atlas. */
  const libraryRef = useRef<LibraryData | null>(null);
  const memoryOnly = useRef(false);

  /** The open tabs; the state copy renders them, the ref is what the handlers read. */
  const tabsRef = useRef<TabsState>(emptyTabs());
  const [tabs, setTabs] = useState<TabsState>(tabsRef.current);
  /** Where the tabs are stored; null until they were read back, so nothing is overwritten. */
  const storageKey = useRef<string | null>(null);
  /** Boards rendered for their tabs, kept for the tabs `cachePlan` names. */
  const cache = useRef(new Map<string, CachedBoard>());
  /** The tab and board on screen now. */
  const shown = useRef<{ tabId: string; slug: string | null } | null>(null);
  /** The tab last put on screen; null on the home. */
  const presented = useRef<string | null>(null);
  /** The entry of the atlas home the browser is on, when it is. */
  const homeId = useRef<string>(newEntryId());
  /** Where the browser is in its history, and the entries this page load has seen there. */
  const position = useRef(0);
  const seen = useRef(new Map<number, { tab: string | null; id: string }>());
  /** Navigation events wait until the tabs are read back. */
  const ready = useRef(false);
  /** A refused Back or Forward is being undone: the position the browser goes back to. */
  const reverting = useRef<number | null>(null);
  const [navState, setNavState] = useState({ canBack: false, canForward: false });
  /**
   * Reads where the canvas stands when the board of that slug (null: a pasted board) is the
   * one on screen; null when another board is or there is nothing to keep.
   */
  const viewReader = useRef<((slug: string | null) => ViewState | null) | null>(null);

  const queue = useRef<BoardRequest[]>([]);
  /** Queues a request again, once a token was given for it. */
  const enqueueRef = useRef<(request: BoardRequest) => void>(() => undefined);
  const running = useRef<BoardRequest | null>(null);

  const putAtlas = useCallback((value: AtlasIndex) => {
    atlasRef.current = value;
    setAtlas(value);
  }, []);

  const commit = useCallback((next: TabsState) => {
    tabsRef.current = next;
    setTabs(next);
    const keep = cachePlan(next);
    for (const id of [...cache.current.keys()]) if (!keep.has(id)) cache.current.delete(id);
    if (storageKey.current) saveTabs(storageKey.current, next);
    const tab = activeTab(next);
    setNavState(
      tab
        ? { canBack: canBack(tab.history), canForward: canForward(tab.history) }
        : { canBack: false, canForward: false },
    );
  }, []);

  /** Keeps the view of the board on screen on its tab's current entry. */
  const keepView = useCallback((state: TabsState): TabsState => {
    const tab = activeTab(state);
    const on = shown.current;
    if (!tab || !on || on.tabId !== tab.id || on.slug !== tab.slug) return state;
    const view = viewReader.current?.(tab.slug);
    return view ? saveTabView(state, tab.id, view) : state;
  }, []);

  /**
   * Writes the tab on screen into the browser's history: as a new entry ("push") or in place
   * of the current one ("replace", as choosing a tab does).
   */
  const writeHistory = useCallback((mode: "push" | "replace") => {
    const state = tabsRef.current;
    const tab = activeTab(state);
    const id = tab ? (currentEntry(tab.history)?.id ?? newEntryId()) : homeId.current;
    if (mode === "push") {
      position.current += 1;
      for (const pos of [...seen.current.keys()]) {
        if (pos >= position.current) seen.current.delete(pos);
      }
    }
    const mark: HistoryMark = { gb: id, tab: tab?.id ?? null, pos: position.current };
    const hash = addressOf(state);
    if (mode === "push") window.history.pushState(mark, "", hash);
    else window.history.replaceState(mark, "", hash);
    seen.current.set(position.current, { tab: mark.tab, id });
    lastHash.current = window.location.hash;
  }, []);

  const show = useCallback((tabId: string, board: CachedBoard) => {
    shown.current = { tabId, slug: board.slug };
    hostRef.current.showBoard(board);
  }, []);

  /** Reads the stored boards (or the samples when there are none) and indexes them. */
  const loadLibrary = useCallback(async (): Promise<void> => {
    let entries = await listEntries();
    const sample = entries.length === 0;
    if (sample) entries = await (await import("./samples.ts")).loadSamples();
    const { buildLibraryIndex } = await import("./library-index.ts");
    libraryRef.current = { entries: new Map(entries.map((e) => [e.slug, e])), sample };
    putAtlas(buildLibraryIndex(entries));
    setLibrary({ sample, memoryOnly: memoryOnly.current });
  }, [putAtlas]);

  const loadAtlas = useCallback(async (): Promise<void> => {
    if (libraryRef.current) {
      await loadLibrary();
      return;
    }
    const result = await fetchAtlas();
    switch (result.status) {
      case "ok":
        putAtlas(result.atlas);
        break;
      case "unauthorized":
        hostRef.current.askToken(result.rejected, loadAtlas);
        break;
      case "error":
        hostRef.current.setError(result.message);
        break;
    }
  }, [loadLibrary, putAtlas]);

  /**
   * A board as the viewer shows it: the library's rendered here; an atlas board with a draft in
   * this browser rendered here from its file and the draft; any other as the server renders it.
   */
  const loadBoard = useCallback(
    async (slug: string): Promise<AtlasBoardResult | (AtlasBoardResult & { draft: true })> => {
      const data = libraryRef.current;
      if (data) return libraryBoard(data.entries.get(slug));
      const atlas = atlasRef.current;
      if (atlas?.atlasId && !atlas.tagsEditable) {
        const draft = await getDraft(atlas.atlasId, slug);
        const files = draft ? await fetchBoardFiles(slug) : null;
        if (draft && files?.status === "ok") {
          try {
            const board = draft.board ?? (JSON.parse(files.source) as Record<string, unknown>);
            const result = await renderedInBrowser(
              board,
              draft.overlay ?? overlayFrom(files.overlay),
            );
            if (result.status !== "ok") return result;
            // The file moved on since the draft was made: show the draft, and say so.
            const moved = draft.baseEtag !== files.sourceEtag ? [t("edit.draftBaseChanged")] : [];
            return { ...result, warnings: [...moved, ...result.warnings], draft: true };
          } catch {
            // The board file is not JSON: the server says so.
          }
        }
      }
      return fetchAtlasBoard(slug);
    },
    [],
  );

  /** Answers a board request into the tab that asked, if it still shows that board. */
  const deliver = useCallback(
    (request: BoardRequest, result: Awaited<ReturnType<typeof loadBoard>>) => {
      const host = hostRef.current;
      const state = tabsRef.current;
      const tab = tabById(state, request.tabId);
      // The tab was closed, or moved on to another board, while this one loaded.
      if (!tab || tab.slug !== request.slug) return;
      const onScreen = state.activeId === tab.id;
      const { slug } = request;
      switch (result.status) {
        case "ok": {
          const check: BoardCheck = {
            stale: result.stale,
            staleSourceIds: result.staleSourceIds,
            references: result.references,
            ...("draft" in result && result.draft ? { draft: true } : {}),
          };
          const board: CachedBoard = {
            scene: result.scene,
            slug,
            title: atlasRef.current?.boards.find((b) => b.slug === slug)?.title ?? slug,
            fileName: slug,
            check,
            warnings: result.warnings,
            signature: sceneSignature(result.scene, check),
          };
          if (request.background) {
            const kept = cache.current.get(tab.id);
            if (kept?.slug === slug && kept.signature === board.signature) return;
            if (!onScreen) {
              if (cachePlan(state).has(tab.id)) cache.current.set(tab.id, board);
              return;
            }
            // Never under the reader's hands: unsaved work keeps the board as it is.
            if (host.hasUnsavedWork?.()) return;
            const view = viewReader.current?.(slug) ?? undefined;
            cache.current.set(tab.id, board);
            focusSeq.current += 1;
            setFocus(view ? { view, seq: focusSeq.current } : null);
            host.setWarnings(board.warnings);
            show(tab.id, board);
            return;
          }
          if (tab.error !== undefined) commit(setTabError(tabsRef.current, tab.id, undefined));
          if (cachePlan(tabsRef.current).has(tab.id)) cache.current.set(tab.id, board);
          if (onScreen) {
            host.setWarnings(board.warnings);
            show(tab.id, board);
          }
          break;
        }
        case "invalid":
        case "not-found": {
          // A check in the background never takes the board away from unsaved work.
          if (request.background && (!onScreen || host.hasUnsavedWork?.())) return;
          const message =
            result.status === "invalid"
              ? t("atlas.boardInvalid", { slug })
              : t("atlas.boardMissing", { slug });
          cache.current.delete(tab.id);
          commit(setTabError(tabsRef.current, tab.id, message));
          if (onScreen) {
            shown.current = null;
            host.closeScene();
            if (result.status === "invalid") {
              host.setIssues(result.issues);
              host.setWarnings(result.warnings);
            }
          }
          break;
        }
        case "unauthorized":
          host.askToken(result.rejected, async () => {
            request.done = [];
            enqueueRef.current(request);
          });
          break;
        case "error":
          if (onScreen && !request.background) host.setError(result.message);
          break;
      }
    },
    [commit, show],
  );

  /** Sends the next board request once the one running has been answered. */
  const pump = useCallback(async (): Promise<void> => {
    if (running.current) return;
    const host = hostRef.current;
    while (queue.current.length > 0) {
      const request = queue.current.shift() as BoardRequest;
      const tab = tabById(tabsRef.current, request.tabId);
      if (!tab || tab.slug !== request.slug) {
        for (const done of request.done) done();
        continue;
      }
      running.current = request;
      if (!request.background) {
        host.setBusy(true);
        host.clearMessages();
      }
      const attempt = async (): Promise<Awaited<ReturnType<typeof loadBoard>>> => {
        try {
          return await loadBoard(request.slug);
        } catch (error) {
          // A chunk that failed to load, say: the queue goes on.
          return {
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          };
        }
      };
      let result: Awaited<ReturnType<typeof loadBoard>>;
      try {
        result = await attempt();
        // The server answers one request per client at a time, and a request of another page
        // of this browser (one just reloaded, or opened beside it) may still be running: the
        // reader's request is tried once more before the error shows.
        if (!request.background && result.status === "error") {
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
          const tab = tabById(tabsRef.current, request.tabId);
          if (tab?.slug === request.slug) result = await attempt();
        }
      } finally {
        running.current = null;
        if (!request.background) host.setBusy(false);
      }
      deliver(request, result);
      for (const done of request.done) done();
    }
  }, [loadBoard, deliver]);

  /**
   * Queues a board request for a tab. A tab waits for one board at a time, the one asked for
   * last; requests of the reader go ahead of checks in the background.
   */
  const enqueue = useCallback(
    (request: BoardRequest) => {
      const pending = queue.current;
      const replaced = pending.filter((r) => r.tabId === request.tabId);
      const run = running.current;
      if (
        request.background &&
        (replaced.some((r) => !r.background) || run?.tabId === request.tabId)
      ) {
        for (const done of request.done) done();
        return;
      }
      // The same board is on its way for that tab already: one answer serves both.
      if (run && !run.background && run.tabId === request.tabId && run.slug === request.slug) {
        queue.current = pending.filter((r) => r.tabId !== request.tabId);
        for (const r of replaced) run.done.push(...r.done);
        run.done.push(...request.done);
        return;
      }
      queue.current = pending.filter((r) => r.tabId !== request.tabId);
      for (const r of replaced) request.done.push(...r.done);
      const at = request.background
        ? queue.current.length
        : queue.current.findIndex((r) => r.background);
      queue.current.splice(at < 0 ? queue.current.length : at, 0, request);
      void pump();
    },
    [pump],
  );

  enqueueRef.current = enqueue;

  const request = useCallback(
    (tabId: string, slug: string, background: boolean): Promise<void> =>
      new Promise((resolve) => enqueue({ tabId, slug, background, done: [resolve] })),
    [enqueue],
  );

  /**
   * Puts the tab now chosen on screen, at the place its history is on: its board from memory
   * when kept (checked again in the background on a server), else asked for. `view` is where
   * the canvas stood when the reader left that place; without one, the node the place names.
   */
  const present = useCallback(
    (view?: ViewState) => {
      const host = hostRef.current;
      const tab = activeTab(tabsRef.current);
      if (!tab) {
        // Back to the list (also by the browser's Back button): the board leaves the screen,
        // and the index is loaded again.
        if (presented.current !== null || shown.current !== null) {
          presented.current = null;
          shown.current = null;
          host.closeAtlasBoard();
          void loadAtlas();
        }
        return;
      }
      const switched = presented.current !== tab.id;
      presented.current = tab.id;
      const route = tabRoute(tab);
      focusSeq.current += 1;
      setFocus(
        view
          ? { view, seq: focusSeq.current }
          : route.view === "board" && route.node
            ? { nodeId: route.node, seq: focusSeq.current }
            : null,
      );
      const on = shown.current;
      // The same board stays on screen: only the focus moves.
      if (on?.tabId === tab.id && on.slug === tab.slug) return;
      const kept = cache.current.get(tab.id);
      if (kept && kept.slug === tab.slug) {
        if (switched) host.clearMessages();
        host.setWarnings(kept.warnings);
        show(tab.id, kept);
        // A server may have changed the board since; an exported page or the library cannot.
        if (tab.slug !== null && !isStaticMode() && !libraryRef.current) {
          void request(tab.id, tab.slug, true);
        }
        return;
      }
      if (tab.slug === null) return;
      // Another tab's board must not stand in while this one loads.
      if (on && on.tabId !== tab.id) {
        shown.current = null;
        host.closeScene();
      }
      if (switched) host.clearMessages();
      void request(tab.id, tab.slug, false);
    },
    [loadAtlas, request, show],
  );

  /** Asks before the board on screen is left; true when the reader may go on. */
  const mayLeave = useCallback(
    (kind: LeaveKind): boolean => leaveGuard.current?.(kind) !== false,
    [],
  );

  const setNotice = useCallback((opened: Opened) => {
    if (opened.full) hostRef.current.notify?.(t("tabs.full", { count: TAB_LIMIT }));
  }, []);

  useEffect(() => {
    const mark = readMark(window.history.state);
    position.current = mark?.pos ?? 0;

    // A link followed fires hashchange (and popstate in most browsers) with no mark in the
    // state: a new place. Back and Forward fire popstate with the mark of the entry reached.
    // Both events of one move land here; the second finds the entry already current.
    const onNavigate = () => {
      const hash = window.location.hash;
      if (!ready.current) {
        lastHash.current = hash;
        return;
      }
      const state = tabsRef.current;
      const here = activeTab(state);
      const hereId = here ? currentEntry(here.history)?.id : homeId.current;
      const mark = readMark(window.history.state);
      if (reverting.current !== null) {
        // The other event of the refused move, or the step back from it: nothing to ask again.
        if (mark?.pos === reverting.current) reverting.current = null;
        return;
      }
      if (mark && mark.tab === state.activeId && mark.gb === hereId) {
        if (mark.pos !== null) position.current = mark.pos;
        return;
      }
      if (!mark && hash === lastHash.current) {
        // Same address, state dropped by someone else's replaceState: the same place still.
        writeHistory("replace");
        return;
      }
      const now = Date.now();
      if (mark) {
        // Back or Forward, to an entry of this tab, of another tab, or of a tab since closed.
        const tab = mark.tab === null ? undefined : tabById(state, mark.tab);
        const known = tab !== undefined && indexOf(tab.history, mark.gb) >= 0;
        const target =
          tab && known ? tab.history.entries[indexOf(tab.history, mark.gb)] : undefined;
        const sameBoard =
          mark.tab === here?.id &&
          target?.route.view === "board" &&
          target.route.slug === here.slug;
        // An entry no tab has any more opens its board again, which may replace a paste.
        const route = currentRoute();
        const reopened =
          !known && mark.tab !== null && route.view === "board"
            ? openPreview(state, { id: newEntryId(), route }, tab ? newTabId() : mark.tab, now)
            : null;
        const kind: LeaveKind | null = reopened
          ? guardKind(state, reopened.state)
          : here
            ? sameBoard
              ? "nav"
              : "tab"
            : null;
        if (kind && !mayLeave(kind)) {
          // Refused: step back the other way, onto the entry still current.
          if (mark.pos !== null && mark.pos !== position.current) {
            reverting.current = position.current;
            window.history.go(position.current - mark.pos);
          } else {
            writeHistory("replace");
          }
          return;
        }
        const left = keepView(state);
        if (mark.pos !== null) position.current = mark.pos;
        seen.current.set(position.current, { tab: mark.tab, id: mark.gb });
        lastHash.current = hash;
        if (mark.tab === null) {
          homeId.current = mark.gb;
          commit({ ...left, activeId: null });
          present();
          return;
        }
        if (tab && known) {
          const next = activate(traverseTab(left, tab.id, mark.gb), tab.id, now);
          commit(next);
          const entry = activeTab(next);
          present(entry ? currentEntry(entry.history)?.view : undefined);
          return;
        }
        // The tab was closed, or its entry dropped: its board opens again from the address.
        if (!reopened) {
          homeId.current = mark.gb;
          commit({ ...left, activeId: null });
          present();
          return;
        }
        // The tab may still be open (its entry was dropped): never reuse its id for another.
        const opened = openPreview(
          left,
          { id: newEntryId(), route },
          tab ? newTabId() : (mark.tab as string),
          now,
        );
        commit(opened.state);
        writeHistory("replace");
        setNotice(opened);
        present();
        return;
      }
      // A link followed: a new entry of the browser's history.
      position.current += 1;
      for (const pos of [...seen.current.keys()]) {
        if (pos >= position.current) seen.current.delete(pos);
      }
      const route = currentRoute();
      const entry: NavEntry = { id: newEntryId(), route };
      const kind =
        route.view === "home"
          ? here
            ? "tab"
            : null
          : guardKind(state, openPreview(state, entry, "probe", now).state);
      if (kind && !mayLeave(kind)) {
        // The reader stays: the address goes back to the board on screen.
        writeHistory("replace");
        return;
      }
      const left = keepView(state);
      lastHash.current = hash;
      if (route.view === "home") {
        homeId.current = newEntryId();
        commit({ ...left, activeId: null });
        writeHistory("replace");
        present();
        return;
      }
      const opened = openPreview(left, entry, newTabId(), now);
      commit(opened.state);
      writeHistory("replace");
      setNotice(opened);
      present();
    };
    window.addEventListener("hashchange", onNavigate);
    window.addEventListener("popstate", onNavigate);
    // The view on screen goes with the tabs, so a reload opens each where it was left.
    const onHide = () => {
      if (!ready.current) return;
      const kept = keepView(tabsRef.current);
      if (kept !== tabsRef.current) commit(kept);
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("hashchange", onNavigate);
      window.removeEventListener("popstate", onNavigate);
      window.removeEventListener("pagehide", onHide);
    };
  }, [commit, keepView, mayLeave, present, setNotice, writeHistory]);

  /**
   * Reads the tabs kept for this atlas back, then follows the address: a board it names is
   * shown in its tab (a new preview tab when none has it); the home shows the home.
   */
  const restoreTabs = useCallback(
    async (sample: boolean) => {
      const atlas = atlasRef.current;
      storageKey.current = tabStorageKey(atlas?.atlasId, libraryRef.current !== null);
      const now = Date.now();
      let state = loadTabs(storageKey.current, now);
      if (atlas) {
        for (const tab of state.tabs) {
          if (tab.slug !== null && !atlas.boards.some((b) => b.slug === tab.slug)) {
            state = setTabError(state, tab.id, t("atlas.boardMissing", { slug: tab.slug }));
          }
        }
      }
      const mark = readMark(window.history.state);
      let route = currentRoute();
      // Nothing opened yet: show a sample board rather than an empty page.
      if (sample && state.tabs.length === 0 && route.view === "home") {
        const { SAMPLE_START } = await import("./samples.ts");
        const entries = libraryRef.current?.entries;
        const start = entries?.has(SAMPLE_START) ? SAMPLE_START : [...(entries?.keys() ?? [])][0];
        if (start !== undefined) route = { view: "board", slug: start };
      }
      const markedTab = mark?.tab ? tabById(state, mark.tab) : undefined;
      const marked = markedTab
        ? markedTab.history.entries.find((e) => e.id === mark?.gb)
        : undefined;
      if (
        markedTab &&
        marked &&
        route.view === "board" &&
        marked.route.view === "board" &&
        formatRoute(marked.route) === formatRoute(route)
      ) {
        // A reload: the same tab, at the same place.
        state = activate(traverseTab(state, markedTab.id, marked.id), markedTab.id, now);
      } else if (route.view === "board") {
        state = openPreview(
          { ...state, activeId: null },
          { id: newEntryId(), route },
          newTabId(),
          now,
        ).state;
      } else {
        state = { ...state, activeId: null };
      }
      ready.current = true;
      commit(state);
      writeHistory("replace");
      const tab = activeTab(state);
      present(tab ? currentEntry(tab.history)?.view : undefined);
    },
    [commit, present, writeHistory],
  );

  useEffect(() => {
    void (async () => {
      const { atlas: enabled } = await fetchHealth();
      if (enabled) {
        await loadAtlas();
      } else if (!isStaticMode()) {
        try {
          await loadLibrary();
        } catch (error) {
          hostRef.current.setError(error instanceof Error ? error.message : String(error));
        }
      }
      const on = enabled || libraryRef.current !== null;
      setAtlasEnabled(on);
      if (on) await restoreTabs(libraryRef.current?.sample === true);
      setChecked(true);
    })();
  }, [loadAtlas, loadLibrary, restoreTabs]);

  /**
   * Back and Forward within the tab on screen. When the browser's adjacent entry is that place,
   * they go through the browser's history, so both stay in step; otherwise (the place was left
   * for another tab since) the tab moves there as a new entry of the browser's history.
   */
  const step = useCallback(
    (delta: -1 | 1) => {
      const state = tabsRef.current;
      const tab = activeTab(state);
      if (!tab) return;
      const target = tab.history.entries[tab.history.index + delta];
      if (!target) return;
      const adjacent = seen.current.get(position.current + delta);
      if (adjacent?.tab === tab.id && adjacent.id === target.id) {
        if (delta < 0) window.history.back();
        else window.history.forward();
        return;
      }
      const sameBoard = target.route.view === "board" && target.route.slug === tab.slug;
      if (!mayLeave(sameBoard ? "nav" : "tab")) return;
      const next = traverseTab(keepView(state), tab.id, target.id);
      commit(next);
      writeHistory("push");
      present(target.view);
    },
    [commit, keepView, mayLeave, present, writeHistory],
  );
  const back = useCallback(() => step(-1), [step]);
  const forward = useCallback(() => step(1), [step]);

  /** Puts a tab on screen, where it was left. */
  const selectTab = useCallback(
    (id: string) => {
      const state = tabsRef.current;
      if (state.activeId === id || !tabById(state, id)) return;
      if (state.activeId !== null && !mayLeave("tab")) return;
      const next = activate(keepView(state), id, Date.now());
      commit(next);
      writeHistory("replace");
      const tab = activeTab(next);
      present(tab ? currentEntry(tab.history)?.view : undefined);
    },
    [commit, keepView, mayLeave, present, writeHistory],
  );

  /** `Alt+n`: the nth tab, the last for 9. */
  const selectTabAt = useCallback(
    (n: number) => {
      const id = tabAtIndex(tabsRef.current, n);
      if (id !== null) selectTab(id);
    },
    [selectTab],
  );

  /** Closes a tab; closing the one on screen asks first when its board holds unsaved work. */
  const closeTab = useCallback(
    (id: string) => {
      const state = tabsRef.current;
      if (!tabById(state, id)) return;
      if (state.activeId !== id) {
        commit(close(state, id));
        return;
      }
      if (!mayLeave("tab")) return;
      const next = close(state, id);
      if (next.activeId === null) homeId.current = newEntryId();
      commit(next);
      writeHistory("replace");
      const tab = activeTab(next);
      present(tab ? currentEntry(tab.history)?.view : undefined);
    },
    [commit, mayLeave, present, writeHistory],
  );

  /** Keeps a tab open: the next board opened with an ordinary click goes elsewhere. */
  const pinTab = useCallback(
    (id: string) => {
      const state = tabsRef.current;
      if (tabById(state, id)?.preview) commit(pin(state, id));
    },
    [commit],
  );

  /** Opens a place in a new tab (or the tab that has its board already). */
  const openInNewTab = useCallback(
    (place: { slug: string; nodeId?: string }) => {
      const state = tabsRef.current;
      const route: Route = {
        view: "board",
        slug: place.slug,
        ...(place.nodeId ? { node: place.nodeId } : {}),
      };
      const entry: NavEntry = { id: newEntryId(), route };
      const now = Date.now();
      const probe = openNew(state, entry, "probe", now).state;
      const kind = guardKind(state, probe);
      if (kind === null && probe.activeId === state.activeId) {
        // Already there: focus the node again.
        focusSeq.current += 1;
        setFocus(place.nodeId ? { nodeId: place.nodeId, seq: focusSeq.current } : null);
        return;
      }
      if (kind && !mayLeave(kind)) return;
      const opened = openNew(keepView(state), entry, newTabId(), now);
      commit(opened.state);
      writeHistory("push");
      setNotice(opened);
      present();
    },
    [commit, keepView, mayLeave, present, setNotice, writeHistory],
  );

  /**
   * Opens a place: in the tab on screen or the preview tab ("preview", through the address,
   * as a link would), or in a new tab ("new"). When the address is already that place, its
   * node is focused again.
   */
  const openPlace = useCallback(
    (
      place: AtlasPlace | { slug: string; nodeId?: string },
      target: "preview" | "new" = "preview",
    ) => {
      if (target === "new") {
        openInNewTab(place);
        return;
      }
      const hash = formatRoute({
        view: "board",
        slug: place.slug,
        ...(place.nodeId ? { node: place.nodeId } : {}),
      });
      if (window.location.hash === hash) {
        focusSeq.current += 1;
        setFocus(place.nodeId ? { nodeId: place.nodeId, seq: focusSeq.current } : null);
        return;
      }
      window.location.hash = hash;
    },
    [openInNewTab],
  );

  /**
   * Shows a board pasted or opened from a file in the preview tab (or a new one). It has no
   * address: the address names the home, as before. False when the reader chose to stay.
   */
  const showPastedBoard = useCallback(
    (board: { scene: Scene; title: string; fileName: string }): boolean => {
      const state = tabsRef.current;
      const probe = openPasted(state, { id: "probe", route: { view: "home" } }, "probe", 0).state;
      const kind = guardKind(state, probe) ?? (state.activeId !== null ? "tab" : null);
      if (kind && !mayLeave(kind)) return false;
      const opened = openPasted(
        keepView(state),
        { id: newEntryId(), route: { view: "home" } },
        newTabId(),
        Date.now(),
      );
      cache.current.set(opened.tabId, { ...board, slug: null, check: NO_CHECK, warnings: [] });
      shown.current = null;
      commit(opened.state);
      writeHistory("push");
      setNotice(opened);
      present();
      return true;
    },
    [commit, keepView, mayLeave, present, setNotice, writeHistory],
  );

  /** The title a tab shows: its board's in the atlas, or the pasted board's. */
  const tabTitle = useCallback(
    (tab: Tab): string =>
      tab.slug === null
        ? (cache.current.get(tab.id)?.title ?? t("app.untitledBoard"))
        : (atlas?.boards.find((b) => b.slug === tab.slug)?.title ?? tab.slug),
    [atlas],
  );

  /**
   * Stores boards opened from files or pasted, replacing any of the same slug, and opens the
   * first; with `open: false` (a zip of many boards) it goes back to the list instead. The
   * samples leave the list once a board of the user's own is in it.
   */
  const addToLibrary = useCallback(
    async (entries: readonly LibraryEntry[], options: { open?: boolean } = {}): Promise<void> => {
      const first = entries[0];
      if (!libraryRef.current || !first) return;
      // Not kept: the page says the list lasts for this page load.
      if (!(await saveEntries(entries))) memoryOnly.current = true;
      const wasSample = libraryRef.current.sample;
      await loadLibrary();
      // The samples left the list: so do their tabs. Boards stored again are rendered again.
      const replaced = new Set(entries.map((e) => e.slug));
      let state = tabsRef.current;
      for (const tab of state.tabs) {
        if (tab.slug === null) continue;
        if (wasSample && !replaced.has(tab.slug) && tab.id !== state.activeId) {
          state = close(state, tab.id);
        } else if (replaced.has(tab.slug)) {
          cache.current.delete(tab.id);
          if (shown.current?.tabId === tab.id) shown.current = null;
        }
      }
      if (state !== tabsRef.current) commit(state);
      if (options.open === false) {
        if (currentRoute().view !== "home") window.location.hash = formatRoute({ view: "home" });
        return;
      }
      const hash = formatRoute({ view: "board", slug: first.slug });
      const tab = activeTab(tabsRef.current);
      // Opened again under the same name: render it again, even if it is the board on screen.
      if (window.location.hash === hash && tab?.slug === first.slug) present();
      else window.location.hash = hash;
    },
    [commit, loadLibrary, present],
  );

  /** Closes the tabs of boards no longer in the library; the home when one was on screen. */
  const dropTabs = useCallback(
    (gone: (slug: string) => boolean) => {
      let state = tabsRef.current;
      const onScreen = activeTab(state);
      for (const tab of state.tabs)
        if (tab.slug !== null && gone(tab.slug)) state = close(state, tab.id);
      if (onScreen?.slug != null && gone(onScreen.slug)) state = { ...state, activeId: null };
      if (state === tabsRef.current) return;
      commit(state);
      if (state.activeId === null && onScreen) {
        homeId.current = newEntryId();
        present();
        if (currentRoute().view !== "home") window.location.hash = formatRoute({ view: "home" });
      }
    },
    [commit, present],
  );

  const removeFromLibrary = useCallback(
    async (slug: string): Promise<void> => {
      if (!libraryRef.current || libraryRef.current.sample) return;
      // Not kept: the page says the list lasts for this page load.
      if (!(await removeEntry(slug))) memoryOnly.current = true;
      dropTabs((s) => s === slug);
      await loadLibrary();
    },
    [dropTabs, loadLibrary],
  );

  /** Renders the board on screen again, after a save changed what it is made of. */
  const reloadBoard = useCallback(
    async (slug: string): Promise<void> => {
      const tab = activeTab(tabsRef.current);
      if (tab?.slug !== slug) return;
      await request(tab.id, slug, false);
    },
    [request],
  );

  /** Goes to the atlas home; the tabs stay open. */
  const goHome = useCallback(() => {
    if (window.location.hash !== formatRoute({ view: "home" }) && window.location.hash !== "") {
      window.location.hash = formatRoute({ view: "home" });
      return;
    }
    // The address names the home already (a pasted board is on screen): leave it in place.
    const state = tabsRef.current;
    if (state.activeId === null || !mayLeave("tab")) return;
    homeId.current = newEntryId();
    commit({ ...keepView(state), activeId: null });
    writeHistory("push");
    present();
  }, [commit, keepView, mayLeave, present, writeHistory]);

  /** Opens a board for editing: reads what it is made of now and where its saves go. */
  const startEditing = useCallback(
    async (slug: string): Promise<EditSession | { error: string }> => {
      const data = libraryRef.current;
      if (data) {
        const entry = data.entries.get(slug);
        if (entry?.input.type !== "board" || data.sample) {
          return { error: t("edit.notEditable") };
        }
        const session = {
          slug,
          mode: "library" as const,
          board: entry.input.board,
          overlay: overlayFrom(entry.overlay),
          sourceEtag: "",
          overlayEtag: null,
        };
        editing.current = session;
        return session;
      }
      const atlas = atlasRef.current;
      const files = await fetchBoardFiles(slug);
      if (files.status === "not-found") return { error: t("atlas.boardMissing", { slug }) };
      if (files.status === "unauthorized") return { error: t("app.tagsNeedToken") };
      if (files.status === "error") return { error: files.message };
      let board: Record<string, unknown>;
      try {
        board = JSON.parse(files.source) as Record<string, unknown>;
      } catch {
        return { error: t("atlas.boardInvalid", { slug }) };
      }
      const mode: EditMode = atlas?.tagsEditable ? "file" : "draft";
      let overlay = overlayFrom(files.overlay);
      if (mode === "draft" && atlas?.atlasId) {
        let draft = await getDraft(atlas.atlasId, slug);
        // The file moved on since the draft: the person keeps the draft or takes the file.
        if (
          draft &&
          draft.baseEtag !== files.sourceEtag &&
          !window.confirm(t("edit.sourceChanged"))
        ) {
          await deleteDraft(atlas.atlasId, slug);
          draft = null;
          await reloadBoard(slug);
        }
        if (draft?.board) board = draft.board;
        if (draft?.overlay !== undefined) overlay = overlayFrom(draft.overlay);
        setDraftsVolatile(await draftsMemoryOnly());
      }
      const session = {
        slug,
        mode,
        board,
        overlay,
        sourceEtag: files.sourceEtag,
        overlayEtag: files.overlayEtag,
      };
      editing.current = session;
      return session;
    },
    [reloadBoard],
  );

  /**
   * Saves the board and the layout being edited where the mode says. Only what changed is
   * written. Resolves to an error message, or null; the caller renders the board again.
   */
  const saveEdits = useCallback(
    async (board: Record<string, unknown>, overlay: Overlay): Promise<string | null> => {
      const session = editing.current;
      if (!session) return t("edit.notEditable");
      const boardChanged = JSON.stringify(board) !== JSON.stringify(session.board);
      const overlayChanged = JSON.stringify(overlay) !== JSON.stringify(session.overlay);
      const failed = (saved: Awaited<ReturnType<typeof saveAtlasFile>>): string | null => {
        switch (saved.status) {
          case "ok":
            return null;
          case "conflict":
            return t("edit.conflict");
          case "invalid":
            // Each message names its node; the path into the board file means nothing here.
            return saved.issues.map((i) => i.message).join(" · ");
          case "unauthorized":
            return t("app.tagsNeedToken");
          case "error":
            return saved.message;
        }
      };
      switch (session.mode) {
        case "file": {
          if (boardChanged) {
            const saved = await saveAtlasFile(session.slug, "board", board, session.sourceEtag);
            const error = failed(saved);
            if (error !== null) return error;
            if (saved.status === "ok") session.sourceEtag = saved.etag;
            session.board = board;
          }
          if (overlayChanged) {
            const saved = await saveAtlasFile(
              session.slug,
              "overlay",
              overlay,
              session.overlayEtag,
            );
            const error = failed(saved);
            if (error !== null) return error;
            if (saved.status === "ok") session.overlayEtag = saved.etag;
          }
          break;
        }
        case "library": {
          const entry = libraryRef.current?.entries.get(session.slug);
          if (!entry) return t("edit.notEditable");
          const next: LibraryEntry = { ...entry, input: { type: "board", board }, overlay };
          if (!(await saveEntries([next]))) memoryOnly.current = true;
          await loadLibrary();
          break;
        }
        case "draft": {
          const atlasId = atlasRef.current?.atlasId;
          if (!atlasId) return t("edit.notEditable");
          const previous = await getDraft(atlasId, session.slug);
          const keepBoard = boardChanged || previous?.board !== undefined;
          const kept = await saveDraft({
            atlasId,
            slug: session.slug,
            baseEtag: previous?.baseEtag ?? session.sourceEtag,
            overlay,
            ...(keepBoard ? { board } : {}),
          });
          setDraftsVolatile(!kept);
          break;
        }
      }
      session.board = board;
      session.overlay = overlay;
      return null;
    },
    [loadLibrary],
  );

  /** The boards of the library, samples included; empty while the server serves an atlas. */
  const libraryEntries = useCallback(
    (): LibraryEntry[] => [...(libraryRef.current?.entries.values() ?? [])],
    [],
  );

  const clearLibrary = useCallback(async (): Promise<void> => {
    if (!libraryRef.current || libraryRef.current.sample) return;
    // Not kept: the page says the list lasts for this page load.
    if (!(await clearEntries())) memoryOnly.current = true;
    dropTabs(() => true);
    if (currentRoute().view !== "home") window.location.hash = formatRoute({ view: "home" });
    await loadLibrary();
  }, [dropTabs, loadLibrary]);

  const active = activeTab(tabs);
  const route: Route = active?.slug != null ? tabRoute(active) : { view: "home" };

  return {
    checked,
    atlasEnabled,
    atlas,
    route,
    focus,
    loadAtlas,
    openPlace,
    goHome,
    library,
    addToLibrary,
    removeFromLibrary,
    clearLibrary,
    libraryEntries,
    startEditing,
    saveEdits,
    reloadBoard,
    leaveGuard,
    draftsVolatile,
    back,
    forward,
    canBack: navState.canBack,
    canForward: navState.canForward,
    viewReader,
    tabs,
    tabTitle,
    selectTab,
    selectTabAt,
    closeTab,
    pinTab,
    showPastedBoard,
  };
}
