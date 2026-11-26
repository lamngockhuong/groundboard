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
  goTo,
  indexOf,
  type NavStack,
  push,
  replaceRoute,
  saveView,
  startStack,
  stateId,
  type ViewState,
} from "./nav-history.ts";
import { formatRoute, parseRoute, type Route } from "./route.ts";

/** Boards opened in this browser, shown like an atlas when the server serves none. */
export interface LibraryState {
  /** Nothing opened yet: the sample boards are listed instead. */
  sample: boolean;
  /** Storage failed, so the list lasts for this page load only. */
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
  /** Rendered in this browser from a draft: not compared with the sources since. */
  draft?: boolean;
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
  showBoard: (scene: Scene, slug: string, title: string, check: BoardCheck) => void;
  /** Closes whatever is on screen: the board asked for could not be shown. */
  closeScene: () => void;
  /** Back to the atlas home: closes an atlas board, keeps a pasted one. */
  closeAtlasBoard: () => void;
}

/**
 * Where the board on screen should look: a saved view (Back and Forward), else a node (a deep
 * link), else the whole board. `seq` changes to apply the same focus again.
 */
export interface NodeFocus {
  nodeId?: string;
  view?: ViewState;
  seq: number;
}

/** Ids of the viewer's history entries: unique to this page load, so a reload never mixes them. */
const pageLoad = Math.random().toString(36).slice(2, 8);
let entryCount = 0;
const newEntryId = () => `${pageLoad}-${++entryCount}`;

const currentRoute = (): Route => parseRoute(window.location.hash);

const NO_REFERENCES: ReferenceCount = { frames: 0, cached: 0 };

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

/**
 * The screen atlas: whether the server serves one, its index, and the board the deep link
 * names. The server answers one request per client at a time, so the index is loaded before
 * the board, and only one board is asked for at a time.
 *
 * Without an atlas on the server (a plain `serve`, or the viewer hosted as static files), the
 * boards opened in this browser take its place: they are stored locally, indexed and rendered
 * in the browser, and the sample boards stand in while none has been opened.
 */
export function useAtlas(host: AtlasHost) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const [atlasEnabled, setAtlasEnabled] = useState(false);
  /** The server said whether it serves an atlas and, when it does, the index load ended. */
  const [checked, setChecked] = useState(false);
  const [atlas, setAtlas] = useState<AtlasIndex | null>(null);
  const [route, setRoute] = useState<Route>(currentRoute);
  const [focus, setFocus] = useState<NodeFocus | null>(null);
  const focusSeq = useRef(0);
  /** The atlas board last asked for, so following a link to it again only refocuses. */
  const requestedSlug = useRef<string | null>(null);
  /** A board request is running; the server refuses a second one from the same client. */
  const inFlight = useRef(false);
  // Kept in a ref so opening a board does not depend on the index being reloaded.
  const atlasRef = useRef<AtlasIndex | null>(null);
  atlasRef.current = atlas;
  const [library, setLibrary] = useState<LibraryState | null>(null);
  /** The board opened for editing, with the ETags its saves are checked against. */
  const editing = useRef<(EditSession & { sourceEtag: string; overlayEtag: string | null }) | null>(
    null,
  );
  /** Asked before the route leaves a board with unsaved edits; false keeps the board. */
  const leaveGuard = useRef<(() => boolean) | null>(null);
  const lastHash = useRef(typeof window === "undefined" ? "" : window.location.hash);
  /** Drafts cannot be stored in this browser: they last until the page is closed. */
  const [draftsVolatile, setDraftsVolatile] = useState(false);
  /** The library's boards; null while the server serves an atlas. */
  const libraryRef = useRef<LibraryData | null>(null);
  const memoryOnly = useRef(false);

  /** The viewer's history of places; the browser's entries carry their ids in `history.state`. */
  const nav = useRef<NavStack | null>(null);
  const [navState, setNavState] = useState({ canBack: false, canForward: false });
  /**
   * Reads where the canvas stands when the board of that slug is the one on screen; null when
   * another board is (the one asked for is still loading) or there is nothing to keep.
   */
  const viewReader = useRef<((slug: string) => ViewState | null) | null>(null);
  /** The view saved on the entry just reached, for the route effect to hand to the board. */
  const arrivingView = useRef<ViewState | undefined>(undefined);

  const commitNav = useCallback((stack: NavStack) => {
    nav.current = stack;
    setNavState({ canBack: canBack(stack), canForward: canForward(stack) });
  }, []);

  /** Keeps the view of the board on screen on the entry being left. */
  const keepView = useCallback((stack: NavStack): NavStack => {
    const entry = currentEntry(stack);
    if (entry?.route.view !== "board") return stack;
    const view = viewReader.current?.(entry.route.slug);
    return view ? saveView(stack, entry.id, view) : stack;
  }, []);

  /** The current entry names another address without becoming a new place. */
  const replaceAddress = useCallback(
    (hash: string) => {
      const stack = nav.current;
      const entry = stack ? currentEntry(stack) : undefined;
      window.history.replaceState(entry ? { gb: entry.id } : null, "", hash);
      lastHash.current = window.location.hash;
      if (stack) commitNav(replaceRoute(stack, currentRoute()));
    },
    [commitNav],
  );

  useEffect(() => {
    const first = { id: newEntryId(), route: currentRoute() };
    window.history.replaceState({ gb: first.id }, "");
    commitNav(startStack(first));

    // A link followed fires hashchange (and popstate in most browsers) with no id in the state:
    // a new place. Back and Forward fire popstate with the id of the entry reached. Both events
    // of one move land here; the second finds the entry already current and does nothing.
    const onNavigate = () => {
      const stack = nav.current;
      if (!stack) return;
      const hash = window.location.hash;
      const id = stateId(window.history.state);
      const here = currentEntry(stack);
      if (id !== null && id === here?.id) return;
      const target = id === null ? -1 : indexOf(stack, id);
      if (id === null && hash === lastHash.current) {
        // Same address, state dropped by someone else's replaceState: the same place still.
        if (here) window.history.replaceState({ gb: here.id }, "");
        return;
      }
      // Unsaved edits: the user may stay, and the address goes back to the board.
      if (hash !== lastHash.current && leaveGuard.current?.() === false) {
        if (target >= 0) {
          // Back or Forward refused: step back the other way, onto the entry still current.
          window.history.go(stack.index - target);
        } else {
          window.history.replaceState(here ? { gb: here.id } : null, "", lastHash.current);
        }
        return;
      }
      const left = keepView(stack);
      lastHash.current = hash;
      if (target >= 0 && id !== null) {
        const next = goTo(left, id);
        arrivingView.current = currentEntry(next)?.view;
        commitNav(next);
      } else if (id !== null) {
        // An entry of an earlier page load: the history kept before it is gone.
        const entry = { id: newEntryId(), route: currentRoute() };
        window.history.replaceState({ gb: entry.id }, "");
        arrivingView.current = undefined;
        commitNav(startStack(entry));
      } else {
        const entry = { id: newEntryId(), route: currentRoute() };
        window.history.replaceState({ gb: entry.id }, "");
        arrivingView.current = undefined;
        commitNav(push(left, entry));
      }
      setRoute(currentRoute());
    };
    window.addEventListener("hashchange", onNavigate);
    window.addEventListener("popstate", onNavigate);
    return () => {
      window.removeEventListener("hashchange", onNavigate);
      window.removeEventListener("popstate", onNavigate);
    };
  }, [commitNav, keepView]);

  /** Back and Forward go through the browser's history, so both histories stay in step. */
  const back = useCallback(() => {
    if (nav.current && canBack(nav.current)) window.history.back();
  }, []);
  const forward = useCallback(() => {
    if (nav.current && canForward(nav.current)) window.history.forward();
  }, []);

  /** Reads the stored boards (or the samples when there are none) and indexes them. */
  const loadLibrary = useCallback(async (): Promise<void> => {
    let entries = await listEntries();
    const sample = entries.length === 0;
    if (sample) entries = await (await import("./samples.ts")).loadSamples();
    const { buildLibraryIndex } = await import("./library-index.ts");
    libraryRef.current = { entries: new Map(entries.map((e) => [e.slug, e])), sample };
    setAtlas(buildLibraryIndex(entries));
    setLibrary({ sample, memoryOnly: memoryOnly.current });
  }, []);

  const loadAtlas = useCallback(async (): Promise<void> => {
    if (libraryRef.current) {
      await loadLibrary();
      return;
    }
    const result = await fetchAtlas();
    switch (result.status) {
      case "ok":
        setAtlas(result.atlas);
        break;
      case "unauthorized":
        hostRef.current.askToken(result.rejected, loadAtlas);
        break;
      case "error":
        hostRef.current.setError(result.message);
        break;
    }
  }, [loadLibrary]);

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
        // Nothing opened yet: show a sample board rather than an empty page.
        const data = libraryRef.current;
        if (data?.sample && currentRoute().view === "home") {
          const { SAMPLE_START } = await import("./samples.ts");
          const start = data.entries.has(SAMPLE_START) ? SAMPLE_START : [...data.entries.keys()][0];
          if (start !== undefined) {
            replaceAddress(formatRoute({ view: "board", slug: start }));
            setRoute(currentRoute());
          }
        }
      }
      setAtlasEnabled(enabled || libraryRef.current !== null);
      setChecked(true);
    })();
  }, [loadAtlas, loadLibrary, replaceAddress]);

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

  const openAtlasBoard = useCallback(
    async (slug: string): Promise<void> => {
      requestedSlug.current = slug;
      // One board request at a time: the one asked for last is sent when the running one ends.
      if (inFlight.current) return;
      inFlight.current = true;
      const host = hostRef.current;
      host.setBusy(true);
      host.clearMessages();
      const result = await loadBoard(slug);
      inFlight.current = false;
      host.setBusy(false);
      // The user moved on to another board or back to the list while this one loaded.
      const wanted = requestedSlug.current;
      if (wanted !== slug) {
        if (wanted !== null) void openAtlasBoard(wanted);
        return;
      }
      switch (result.status) {
        case "ok":
          host.setWarnings(result.warnings);
          host.showBoard(
            result.scene,
            slug,
            atlasRef.current?.boards.find((b) => b.slug === slug)?.title ?? slug,
            {
              stale: result.stale,
              staleSourceIds: result.staleSourceIds,
              references: result.references,
              ...("draft" in result && result.draft ? { draft: true } : {}),
            },
          );
          break;
        case "invalid":
          host.closeScene();
          host.setIssues(result.issues);
          host.setWarnings(result.warnings);
          host.setError(t("atlas.boardInvalid", { slug }));
          break;
        case "not-found":
          window.location.hash = formatRoute({ view: "home" });
          host.setError(t("atlas.boardMissing", { slug }));
          break;
        case "unauthorized":
          requestedSlug.current = null;
          host.askToken(result.rejected, () => openAtlasBoard(slug));
          break;
        case "error":
          // Forget it, so following the same link again retries.
          requestedSlug.current = null;
          host.setError(result.message);
          break;
      }
    },
    [loadBoard],
  );

  // Follow the deep link: open its board unless it is already open, then focus its node.
  useEffect(() => {
    if (!atlasEnabled) return;
    if (route.view === "home") {
      // Back to the list (also by the browser's Back button): close an atlas board, reload the index.
      if (requestedSlug.current !== null) {
        requestedSlug.current = null;
        hostRef.current.closeAtlasBoard();
        void loadAtlas();
      }
      return;
    }
    focusSeq.current += 1;
    // Back or Forward: the canvas as it was left; else the node the link names, or the board.
    const view = arrivingView.current;
    arrivingView.current = undefined;
    setFocus(
      view
        ? { view, seq: focusSeq.current }
        : route.node
          ? { nodeId: route.node, seq: focusSeq.current }
          : null,
    );
    if (route.slug !== requestedSlug.current) void openAtlasBoard(route.slug);
  }, [atlasEnabled, route, openAtlasBoard, loadAtlas]);

  /** Opens a place; when the link is already the current one, focuses its node again. */
  const openPlace = useCallback((place: AtlasPlace) => {
    const hash = formatRoute({ view: "board", slug: place.slug, node: place.nodeId });
    if (window.location.hash === hash) {
      focusSeq.current += 1;
      setFocus({ nodeId: place.nodeId, seq: focusSeq.current });
      return;
    }
    window.location.hash = hash;
  }, []);

  /** Forgets the board asked for, when something else (a pasted board) takes its place. */
  const forgetBoard = useCallback(() => {
    requestedSlug.current = null;
  }, []);

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
      await loadLibrary();
      if (options.open === false) {
        if (currentRoute().view !== "home") window.location.hash = formatRoute({ view: "home" });
        return;
      }
      // Opened again under the same name: render it again, even if it is the board on screen.
      if (requestedSlug.current === first.slug) requestedSlug.current = null;
      const hash = formatRoute({ view: "board", slug: first.slug });
      if (window.location.hash === hash) setRoute(currentRoute());
      else window.location.hash = hash;
    },
    [loadLibrary],
  );

  const removeFromLibrary = useCallback(
    async (slug: string): Promise<void> => {
      if (!libraryRef.current || libraryRef.current.sample) return;
      // Not kept: the page says the list lasts for this page load.
      if (!(await removeEntry(slug))) memoryOnly.current = true;
      const route = currentRoute();
      if (route.view === "board" && route.slug === slug) {
        window.location.hash = formatRoute({ view: "home" });
      }
      await loadLibrary();
    },
    [loadLibrary],
  );

  /** Renders the board on screen again, after a save changed what it is made of. */
  const reloadBoard = useCallback(
    async (slug: string): Promise<void> => {
      requestedSlug.current = null;
      await openAtlasBoard(slug);
    },
    [openAtlasBoard],
  );

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
    if (currentRoute().view !== "home") window.location.hash = formatRoute({ view: "home" });
    await loadLibrary();
  }, [loadLibrary]);

  return {
    checked,
    atlasEnabled,
    atlas,
    route,
    focus,
    loadAtlas,
    openPlace,
    forgetBoard,
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
  };
}
