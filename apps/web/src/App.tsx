import type { Overlay } from "@groundboard/schema";
import {
  type CSSProperties,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Issue, type ReferenceCount, saveBoardTags, saveToken } from "./api.ts";
import { atlasTags, boardDefiningRef, groupTitle, neighbours } from "./atlas-nav.ts";
import { AtlasHome } from "./components/AtlasHome.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import type { BoardContext, BoardEditing, CanvasReader } from "./components/Editor.tsx";
import { Icon } from "./components/Icon.tsx";
import { type InputItem, InputPanel } from "./components/InputPanel.tsx";
import { IssueList } from "./components/IssueList.tsx";
import { Modal } from "./components/Modal.tsx";
import { SettingsMenu } from "./components/SettingsMenu.tsx";
import { SIDEBAR_WIDTH, Sidebar } from "./components/Sidebar.tsx";
import { SourcePanel } from "./components/SourcePanel.tsx";
import { SplitHandle } from "./components/SplitHandle.tsx";
import { TabBar } from "./components/TabBar.tsx";
import { TokenForm } from "./components/TokenForm.tsx";
import { ZipDialog } from "./components/ZipDialog.tsx";
import type { ZipSource } from "./download.ts";
import { missingFlowSet } from "./flow-hints.ts";
import { type Locale, setLocale, t, useLocale } from "./i18n.ts";
import { parseInput, type Scene } from "./input.ts";
import type { LayerId } from "./layers.ts";
import type { LibraryEntry } from "./library.ts";
import { isStaticMode } from "./mode.ts";
import { canBack as hasBack, canForward as hasForward } from "./nav-history.ts";
import { type PaletteItem, paletteCommands } from "./palette.ts";
import {
  MOTION_ALL_KEY,
  readFlag,
  readNumber,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_WIDTH_KEY,
  SPLIT_RATIO_KEY,
  saveFlag,
  saveValue,
} from "./prefs.ts";
import { renderBoard } from "./render-client.ts";
import { formatRoute } from "./route.ts";
import {
  historyKeyWins,
  isHistoryKey,
  isPageKey,
  isPaletteKey,
  isTabKey,
  isViewerKey,
} from "./shortcuts.ts";
import type { BoardNode, NodeCitations } from "./sources.ts";
import { groupView, narrowView, SPLIT_NARROW, SPLIT_RATIO, showsTwoPanes } from "./split.ts";
import { describeStamp } from "./stamp.ts";
import { focusedGroup, type Group, isSplit, tabById } from "./tabs.ts";
import {
  applyStyle,
  applyTheme,
  readStylePreference,
  readThemePreference,
  resolveTheme,
  saveStylePreference,
  saveThemePreference,
  type ThemePreference,
  type ThemeStyle,
} from "./theme.ts";
import { type BoardCheck, type LeaveKind, type NodeFocus, useAtlas } from "./use-atlas.ts";
import {
  applyChange,
  keepLayers,
  type PrefChange,
  readStoredPrefs,
  storeChange,
  type ViewPrefs,
} from "./view-prefs.ts";

// The editor pulls in several MB of Excalidraw; it is fetched only after the page is up.
const loadEditor = () => import("./components/Editor.tsx");
const Editor = lazy(() =>
  loadEditor().catch((error: unknown) => ({
    default: () => (
      <p className="error" role="alert">
        {t("app.editorLoadFailed", {
          error: error instanceof Error ? error.message : String(error),
        })}
      </p>
    ),
  })),
);

const NO_CHECK: BoardCheck = {
  stale: false,
  staleSourceIds: [],
  references: { frames: 0, cached: 0 },
};

interface LoadedScene {
  scene: Scene;
  key: number;
  fileName: string;
  title: string;
  /** The atlas board shown, or null for a pasted board or scene. */
  slug: string | null;
  /** Whether the board check found the code changed; false for a pasted board. */
  stale: boolean;
  /** Sources the board check found changed; empty for a pasted board. */
  staleSourceIds: string[];
  /** Figma frames the board cites and how many have a cached image; none for a pasted board. */
  references: ReferenceCount;
  /** Rendered in this browser from a draft kept there. */
  draft: boolean;
}

/** Where the board shown with no tab goes (no atlas): the page has one board at a time. */
const SOLO = "";

/** The record without that key; the same record when it has none. */
function without<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  if (!(key in record)) return record;
  const { [key]: _gone, ...rest } = record;
  return rest;
}

/** Callbacks a board's editor hands its findings back through, made once per tab. */
interface TabHandlers {
  onSelectionChange: (citations: NodeCitations[]) => void;
  onNodes: (nodes: BoardNode[]) => void;
  registerCanvas: (reader: CanvasReader | null) => void;
  onPresentingChange: (presenting: boolean) => void;
}

/** Requests that hit a 401, kept so the token form can send them again once, in order. */
interface TokenPrompt {
  rejected: boolean;
  retry: () => Promise<void>;
}

const titleOf = (board: Record<string, unknown> | null): string =>
  typeof board?.title === "string" ? board.title : "";

function fileNameFor(board: Record<string, unknown> | null): string {
  const title = titleOf(board);
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "groundboard";
}

/** Below this width the sidebar becomes a drawer. Same breakpoint as the CSS. */
const NARROW = "(max-width: 760px)";
const matches = (query: string) =>
  typeof window.matchMedia === "function" && window.matchMedia(query).matches;

/** Tracks a media query. */
function useMedia(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setValue(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return value;
}

export function App() {
  // Read once: an exported page stays exported.
  const staticMode = isStaticMode();
  // Every component below renders again in the new language when the reader switches it.
  const locale = useLocale();
  /**
   * The boards on screen, by the tab that shows them: one, or two side by side. Without an
   * atlas the one board shown sits under `SOLO`.
   */
  const [boards, setBoards] = useState<Readonly<Record<string, LoadedScene>>>({});
  const boardsRef = useRef(boards);
  boardsRef.current = boards;
  const boardKey = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tokenPrompt, setTokenPrompt] = useState<TokenPrompt | null>(null);
  /** The citations of what is selected on each board on screen, by tab. */
  const [citations, setCitations] = useState<Readonly<Record<string, NodeCitations[]>>>({});
  /** The nodes of each board on screen, for the palette, by tab. */
  const [nodes, setNodes] = useState<Readonly<Record<string, BoardNode[]>>>({});
  /** Focus asked for on a pasted board, which has no deep link, by tab. */
  const [localFocus, setLocalFocus] = useState<Readonly<Record<string, NodeFocus>>>({});
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);
  const systemDark = useMedia("(prefers-color-scheme: dark)");
  const theme = resolveTheme(themePreference, systemDark);
  const [themeStyle, setThemeStyle] = useState<ThemeStyle>(readStylePreference);
  const narrow = useMedia(NARROW);
  /** Too narrow for two boards side by side: the panes share one row of tabs. */
  const narrowSplit = useMedia(SPLIT_NARROW);
  const [splitRatio, setSplitRatio] = useState(() =>
    readNumber(SPLIT_RATIO_KEY, SPLIT_RATIO.initial, SPLIT_RATIO.min, SPLIT_RATIO.max),
  );
  /** The tab whose board is presenting; another pane does not start a presentation beside it. */
  const [presentingId, setPresentingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => readFlag(SIDEBAR_COLLAPSED_KEY, false));
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readNumber(SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH.initial, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max),
  );
  /** The toolbar choices made last: what a new tab, or a board shown with no tab, starts with. */
  const [lastPrefs, setLastPrefs] = useState<ViewPrefs>(readStoredPrefs);
  const lastPrefsRef = useRef(lastPrefs);
  const [motionAll, setMotionAll] = useState(() => readFlag(MOTION_ALL_KEY, false));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [zipOpen, setZipOpen] = useState(false);
  /**
   * The board being edited, in the tab that edits it, as last saved; one object per save, which
   * the editor keys on. One board at a time is edited, whichever pane it is in.
   */
  const [editSession, setEditSession] = useState<{
    tabId: string;
    slug: string;
    board: Record<string, unknown>;
    overlay: Overlay;
  } | null>(null);
  /** Asks the editor of the tab being edited whether the board has unsaved changes. */
  const dirtyCheck = useRef<{ tabId: string; check: () => boolean } | null>(null);
  /** Read the canvas of each board on screen, by tab: its view, and what is selected. */
  const canvasReaders = useRef(new Map<string, CanvasReader>());
  /** The callbacks of each tab's editor, made once so the editor does not render again. */
  const handlers = useRef(new Map<string, TabHandlers>());
  /** Edits not saved on the board of that tab. */
  const hasDirtyEdits = (tabId: string) =>
    dirtyCheck.current?.tabId === tabId && dirtyCheck.current.check();
  /** Work the board of that tab would lose if it left the screen. */
  const unsavedIn = (tabId: string) =>
    hasDirtyEdits(tabId) || canvasReaders.current.get(tabId)?.unsaved() === true;
  const filterRef = useRef<HTMLInputElement>(null);
  const [focusFilter, setFocusFilter] = useState(0);
  /** A short notice about the tabs, such as every tab being pinned; it clears itself. */
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    // Warm the editor chunk once the page is on screen; a failure surfaces on use.
    loadEditor().catch(() => undefined);
  }, []);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => applyStyle(themeStyle), [themeStyle]);

  const appearance = {
    preference: themePreference,
    theme,
    style: themeStyle,
    onPreference: (next: ThemePreference) => {
      setThemePreference(next);
      saveThemePreference(next);
    },
    onStyle: (next: ThemeStyle) => {
      setThemeStyle(next);
      saveStylePreference(next);
    },
    onLocale: (next: Locale) => setLocale(next),
    motionAll,
    onMotionAll: (next: boolean) => {
      setMotionAll(next);
      saveFlag(MOTION_ALL_KEY, next);
    },
  };

  const clearMessages = useCallback(() => {
    setError(null);
    setIssues([]);
    setWarnings([]);
  }, []);

  // The server lays out one request per client at a time, so retries run one after another.
  const askToken = useCallback((rejected: boolean, retry: () => Promise<void>) => {
    setTokenPrompt((previous) => ({
      rejected,
      retry: previous
        ? async () => {
            await previous.retry();
            await retry();
          }
        : retry,
    }));
  }, []);

  const showScene = useCallback(
    (
      scene: Scene,
      fileName: string,
      title: string,
      slug: string | null,
      check: BoardCheck = NO_CHECK,
      tabId: string = SOLO,
    ) => {
      setCitations((previous) => without(previous, tabId));
      setNodes((previous) => without(previous, tabId));
      setLocalFocus((previous) => without(previous, tabId));
      boardKey.current += 1;
      const key = boardKey.current;
      setBoards((previous) => ({
        ...previous,
        [tabId]: {
          scene,
          fileName,
          title,
          slug,
          stale: check.stale,
          staleSourceIds: check.staleSourceIds,
          references: check.references,
          draft: check.draft === true,
          key,
        },
      }));
    },
    [],
  );

  /** Takes a tab's board off screen; every board without a tab named. */
  const closeScene = useCallback((tabId?: string) => {
    if (tabId === undefined) {
      handlers.current.clear();
      setBoards({});
      setCitations({});
      setNodes({});
      setLocalFocus({});
      return;
    }
    setBoards((previous) => without(previous, tabId));
    handlers.current.delete(tabId);
    setCitations((previous) => without(previous, tabId));
    setNodes((previous) => without(previous, tabId));
    setLocalFocus((previous) => without(previous, tabId));
  }, []);

  const {
    checked,
    atlasEnabled,
    atlas,
    route,
    focusOf,
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
    canBack,
    canForward,
    viewReader,
    tabs,
    tabTitle,
    selectTab,
    selectTabAt,
    closeTab,
    pinTab,
    showPastedBoard,
    setTabPrefs,
    focusPane,
    openBeside,
    moveTab,
  } = useAtlas({
    setBusy,
    clearMessages,
    setError,
    setIssues,
    setWarnings,
    askToken,
    showBoard: (board, tabId) =>
      showScene(board.scene, board.fileName, board.title, board.slug, board.check, tabId),
    closeScene: (tabId) => closeScene(tabId),
    closeAtlasBoard: () => closeScene(),
    notify: setNotice,
    hasUnsavedWork: unsavedIn,
    defaultPrefs: () => lastPrefsRef.current,
    twoPanes: !narrowSplit,
  });

  /** Elements with no flow yet: the source panel and the canvas marks read the same set. */
  const missingFlows = useMemo(() => missingFlowSet(atlas), [atlas]);
  /** Tabs show where the source has more than one board to keep open. */
  const tabsShown = atlas !== null && atlas.boards.length > 1;
  /** Back and Forward sit at the start of the tab bar when it shows, else in the toolbar. */
  const tabBarShown = tabsShown && tabs.tabs.length > 0;
  const boardHistory = { canBack, canForward, onBack: back, onForward: forward };
  /** Two boards side by side: two groups of tabs, a board on screen, and room for both. */
  const split = tabsShown && showsTwoPanes(tabs, !narrowSplit);

  /** The focused pane's tab, whose board the keys, the palette and the source panel follow. */
  const focusedId = atlasEnabled ? tabs.activeId : SOLO;
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;
  /** The focused pane's board; null while its tab waits for it, or on the home. */
  const loaded = focusedId === null ? null : (boards[focusedId] ?? null);

  /**
   * The tab of a board on screen, which keeps the toolbar choices made on it. None for a board
   * shown with no tab (no atlas), or while the tab waits for its board.
   */
  const prefsTabOf = (id: string) => {
    const board = boards[id];
    const tab = atlasEnabled && board ? tabById(tabs, id) : undefined;
    return tab && tab.slug === board?.slug ? tab : undefined;
  };
  const prefsOf = (id: string) => prefsTabOf(id)?.prefs ?? lastPrefs;
  const viewPrefs = focusedId === null ? lastPrefs : prefsOf(focusedId);
  const { sourcesOpen } = viewPrefs;

  /** A choice made on a board's toolbar: kept by its tab, and as the one made last. */
  const changePrefs = (id: string, change: PrefChange) => {
    storeChange(change);
    lastPrefsRef.current = applyChange(lastPrefsRef.current, change);
    setLastPrefs(lastPrefsRef.current);
    // One source panel serves both panes: opening or closing it from either pane does it for
    // the boards of both, so moving the focus never makes it come or go (and the panes jump).
    const ids =
      split && "sourcesOpen" in change
        ? [groupView(tabs, 0).activeId, groupView(tabs, 1).activeId]
        : [id];
    for (const each of ids) {
      const tab = each === null ? undefined : prefsTabOf(each);
      if (tab) setTabPrefs(tab.id, applyChange(prefsOf(tab.id), change));
    }
  };

  /** A board on screen has these layers: its tab keeps hidden only those of them. */
  const presentLayersShown = (id: string, present: readonly LayerId[]) => {
    const tab = prefsTabOf(id);
    if (!tab) return;
    const prefs = prefsOf(id);
    const kept = keepLayers(prefs, present);
    if (kept !== prefs) setTabPrefs(tab.id, kept);
  };

  /**
   * A pasted board or scene: under an atlas it opens in a pinned tab of its own, with the home
   * as its address (it has none of its own), so following an atlas link again reopens that
   * board.
   */
  const showPasted = useCallback(
    (scene: Scene, fileName: string, title: string) => {
      if (atlasEnabled) {
        if (showPastedBoard({ scene, fileName, title })) setFileOpen(false);
        return;
      }
      setFileOpen(false);
      showScene(scene, fileName, title, null);
    },
    [atlasEnabled, showPastedBoard, showScene],
  );

  const submitBoard = useCallback(
    async (board: Record<string, unknown>): Promise<void> => {
      setBusy(true);
      clearMessages();
      const result = await renderBoard(board);
      setBusy(false);
      switch (result.status) {
        case "ok":
          setWarnings(result.warnings);
          showPasted(result.scene, fileNameFor(board), titleOf(board) || t("app.untitledBoard"));
          break;
        case "invalid":
          setIssues(result.issues);
          setWarnings(result.warnings);
          break;
        case "error":
          setError(result.message);
          break;
      }
    },
    [clearMessages, showPasted],
  );

  /**
   * Without an atlas, opened boards join the list kept in this browser and the first one opens;
   * under an atlas, one board is shown in place of the atlas board and not kept.
   */
  const handleInput = useCallback(
    (items: readonly InputItem[]) => {
      if (library) {
        void (async () => {
          const { slugFor } = await import("./library-index.ts");
          const entries: LibraryEntry[] = [];
          const errors: string[] = [];
          // What zips held besides the boards loaded: the summary, files left out, files refused.
          const summaries: string[] = [];
          const skipped: string[] = [];
          const rejected: Issue[] = [];
          let fromZip = false;
          // Two files of one name in the same pick: the last one wins, as it would one by one.
          const put = (entry: LibraryEntry) => {
            const at = entries.findIndex((e) => e.slug === entry.slug);
            if (at >= 0) entries.splice(at, 1);
            entries.push(entry);
          };
          for (const item of items) {
            if ("zip" in item) {
              fromZip = true;
              const zip = await import("./zip-client.ts");
              setBusy(true);
              const read = await zip.readZip(item.zip).catch((error: unknown) => ({
                ok: false as const,
                message: error instanceof Error ? error.message : String(error),
              }));
              setBusy(false);
              if (!read.ok) {
                const message =
                  "problem" in read ? zip.describeZipProblem(read.problem) : read.message;
                errors.push(`${item.fileName}: ${message}`);
                continue;
              }
              const overlays = new Map(read.overlays.map((o) => [o.slug, o.overlay]));
              for (const board of read.boards) {
                const overlay = overlays.get(board.slug);
                put({
                  slug: board.slug,
                  input: { type: "board", board: board.board },
                  openedAt: Date.now(),
                  ...(overlay ? { overlay } : {}),
                });
              }
              for (const scene of read.scenes) {
                put({
                  slug: scene.slug,
                  input: { type: "scene", scene: scene.scene, title: `${scene.slug}.excalidraw` },
                  openedAt: Date.now(),
                });
              }
              for (const note of read.rejected) {
                rejected.push({
                  path: `${item.fileName}: ${note.name}`,
                  message: zip.describeZipNote(note),
                });
              }
              for (const note of read.skipped)
                skipped.push(`${note.name}: ${zip.describeZipNote(note)}`);
              summaries.push(
                t("zip.summary", {
                  file: item.fileName,
                  boards: read.boards.length,
                  scenes: read.scenes.length,
                  rejected: read.rejected.length,
                  skipped: read.skipped.length,
                }),
              );
              continue;
            }
            const parsed = parseInput(item.text);
            if (parsed.kind === "error") {
              errors.push(item.fileName ? `${item.fileName}: ${parsed.message}` : parsed.message);
              continue;
            }
            const sceneTitle = item.fileName ?? t("app.excalidrawScene");
            const input =
              parsed.kind === "scene"
                ? { type: "scene" as const, scene: parsed.scene, title: sceneTitle }
                : { type: "board" as const, board: parsed.board };
            const slug = slugFor(
              item.fileName,
              titleOf(parsed.kind === "board" ? parsed.board : null) || sceneTitle,
            );
            put({ slug, input, openedAt: Date.now() });
          }
          // A zip can hold many boards: say which of the list it replaces before it does.
          if (fromZip && !library.sample) {
            const kept = new Set(libraryEntries().map((e) => e.slug));
            const replaced = entries.filter((e) => kept.has(e.slug)).map((e) => e.slug);
            const shown = replaced.slice(0, 20).join(", ") + (replaced.length > 20 ? ", …" : "");
            if (
              replaced.length > 0 &&
              !window.confirm(t("zip.replaceConfirm", { count: replaced.length, slugs: shown }))
            ) {
              return;
            }
          }
          clearMessages();
          if (errors.length > 0) setError(errors.join(" · "));
          if (entries.length === 0) {
            setIssues(rejected);
            setWarnings([...summaries, ...skipped]);
            return;
          }
          setFileOpen(false);
          await addToLibrary(entries, fromZip ? { open: false } : {});
          if (fromZip) {
            setWarnings([...summaries, ...skipped]);
            setIssues(rejected);
          }
        })();
        return;
      }
      const first = items[0];
      if (!first) return;
      if ("zip" in first) {
        setError(t("zip.libraryOnly"));
        return;
      }
      const parsed = parseInput(first.text);
      if (parsed.kind === "error") {
        setError(parsed.message);
        setIssues([]);
        return;
      }
      if (parsed.kind === "scene") {
        clearMessages();
        showPasted(parsed.scene, fileNameFor(null), t("app.excalidrawScene"));
        return;
      }
      void submitBoard(parsed.board);
    },
    [library, addToLibrary, libraryEntries, clearMessages, showPasted, submitBoard],
  );

  const handleToken = (token: string) => {
    if (!tokenPrompt) return;
    if (!saveToken(token)) {
      setError(t("app.tokenInvalid"));
      return;
    }
    const { retry } = tokenPrompt;
    setTokenPrompt(null);
    void retry();
  };

  const reset = () => {
    setTokenPrompt(null);
    if (atlasEnabled) {
      // Home keeps the tabs open; the board on screen leaves it.
      clearMessages();
      goHome();
      return;
    }
    closeScene();
    clearMessages();
    if (window.location.hash !== "" && window.location.hash !== "#/") {
      window.location.hash = formatRoute({ view: "home" });
    }
    if (atlasEnabled) void loadAtlas();
  };

  /** Focuses a node of the focused pane's board, through its deep link when it has one. */
  const focusNode = (nodeId: string) => {
    if (loaded?.slug) {
      openPlace({ slug: loaded.slug, nodeId });
      return;
    }
    if (focusedId === null) return;
    setLocalFocus((previous) => ({
      ...previous,
      [focusedId]: { nodeId, seq: (previous[focusedId]?.seq ?? 0) + 1 },
    }));
  };

  /** Opens a board beside the one on screen, then gives the keyboard to its tab. */
  const openBesideAndFocus = (tabId?: string) => {
    openBeside(tabId);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('.pane-focused [role="tab"][aria-selected="true"]')
        ?.focus(),
    );
  };

  /** Opens the board that defines a ref; false when there is no atlas or no such board. */
  const openRef = (ref: string): boolean => {
    const place = atlas ? boardDefiningRef(atlas, ref) : null;
    if (place) openPlace(place, tabsShown ? "new" : "preview");
    return place !== null;
  };

  const pick = (item: PaletteItem, newTab: boolean) => {
    switch (item.type) {
      case "board":
        if (newTab) openPlace({ slug: item.board.slug }, "new");
        else window.location.hash = formatRoute({ view: "board", slug: item.board.slug });
        break;
      case "node":
        focusNode(item.node.nodeId);
        break;
      case "ref": {
        const place = atlas ? boardDefiningRef(atlas, item.ref.ref) : null;
        const target = place ?? item.ref.usedIn[0];
        if (target) openPlace(target, newTab ? "new" : "preview");
        break;
      }
      case "command":
        if (item.command.id === "openBeside") openBesideAndFocus();
        break;
    }
  };

  /** Writes the tags of the board on screen, then reloads the index so the sidebar regroups. */
  const saveTags = useCallback(
    async (slug: string, tags: string[]): Promise<string | null> => {
      const result = await saveBoardTags(slug, tags);
      switch (result.status) {
        case "ok":
          await loadAtlas();
          return null;
        case "unauthorized":
          askToken(result.rejected, async () => {
            await saveTags(slug, tags);
          });
          return t("app.tagsNeedToken");
        case "error":
          return result.message;
      }
    },
    [askToken, loadAtlas],
  );
  const stepTo = (board: { slug: string; title: string } | null) =>
    board
      ? {
          slug: board.slug,
          title: board.title,
          href: formatRoute({ view: "board", slug: board.slug }),
        }
      : null;
  /** Where a board on screen sits in the atlas: its toolbar's breadcrumb and steps. */
  const contextOf = (board: LoadedScene | null): BoardContext | null => {
    const atlasBoard =
      atlas && board?.slug ? atlas.boards.find((b) => b.slug === board.slug) : undefined;
    const steps = atlas && atlasBoard ? neighbours(atlas, atlasBoard.slug) : null;
    return atlasBoard && board && steps
      ? {
          group: groupTitle(atlasBoard.kind),
          status: board.stale ? "stale" : "ok",
          staleCount: board.staleSourceIds.length,
          layoutFrom: atlasBoard.layoutFrom,
          references: board.references,
          ...(atlas?.exported ? { snapshot: describeStamp(atlas.exported) } : {}),
          ...(library ? { unchecked: true } : {}),
          ...(board.draft ? { draft: true } : {}),
          prev: stepTo(steps.prev),
          next: stepTo(steps.next),
          position: { index: steps.index, count: steps.count },
          tags: atlasBoard.tags,
          allTags: atlas ? atlasTags(atlas).map((t) => t.tag) : [],
          ...(atlas?.tagsEditable && !staticMode
            ? { onSaveTags: (tags: string[]) => saveTags(atlasBoard.slug, tags) }
            : {}),
          ...(tabsShown ? { onOpenInTab: (slug: string) => openPlace({ slug }, "new") } : {}),
        }
      : null;
  };
  /** The focused pane's: `[` and `]` step through its group. */
  const context = contextOf(loaded);

  // Shortcuts: Ctrl K (Cmd K) opens the palette, even from the canvas, where Excalidraw would
  // otherwise take it for "add a link"; "/" filters the boards; "[" and "]" step between boards.
  // Alt ← and Alt → go Back and Forward, ahead of the browser and of Excalidraw, as long as
  // nothing is selected on the canvas.
  // Alt 1 to Alt 9 choose a tab and Alt W closes the one on screen, read first so neither
  // Excalidraw nor the browser takes them.
  const keys = useRef({
    context,
    atlas,
    narrow,
    collapsed,
    back,
    forward,
    canBack,
    canForward,
    tabsShown,
    tabs,
    selectTabAt,
    closeTab,
  });
  keys.current = {
    context,
    atlas,
    narrow,
    collapsed,
    back,
    forward,
    canBack,
    canForward,
    tabsShown,
    tabs,
    selectTabAt,
    closeTab,
  };
  useEffect(() => {
    const onCapture = (event: KeyboardEvent) => {
      const tabKey = isTabKey(event);
      if (tabKey) {
        const current = keys.current;
        if (!current.tabsShown || document.querySelector("dialog[open]")) return;
        event.preventDefault();
        event.stopPropagation();
        if (tabKey.type === "select") current.selectTabAt(tabKey.n);
        else if (current.tabs.activeId !== null) current.closeTab(current.tabs.activeId);
        return;
      }
      const move = isHistoryKey(event);
      if (move) {
        const current = keys.current;
        const reader = canvasReaders.current.get(focusedIdRef.current ?? SOLO);
        const selected = reader?.selectedCount() ?? 0;
        const possible = move === "back" ? current.canBack : current.canForward;
        if (
          !current.atlas ||
          !possible ||
          !historyKeyWins(event, selected) ||
          document.querySelector("dialog[open]")
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (move === "back") current.back();
        else current.forward();
        return;
      }
      // Not over another dialog: the drawer or the file dialog would stay open behind it.
      if (!isPaletteKey(event) || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      event.stopPropagation();
      setPaletteOpen(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const current = keys.current;
      if (current.atlas && isPageKey(event, "/")) {
        event.preventDefault();
        if (current.narrow) setDrawerOpen(true);
        else if (current.collapsed) {
          setCollapsed(false);
          saveFlag(SIDEBAR_COLLAPSED_KEY, false);
        }
        setFocusFilter((n) => n + 1);
        return;
      }
      const step = isViewerKey(event, "[")
        ? current.context?.prev
        : isViewerKey(event, "]")
          ? current.context?.next
          : undefined;
      if (step) {
        event.preventDefault();
        window.location.hash = step.href;
      }
    };
    window.addEventListener("keydown", onCapture, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onCapture, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (focusFilter > 0) filterRef.current?.focus();
  }, [focusFilter]);

  // Leaving the narrow layout closes the drawer; the sidebar is back in place.
  useEffect(() => {
    if (!narrow) setDrawerOpen(false);
  }, [narrow]);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      saveFlag(SIDEBAR_COLLAPSED_KEY, !value);
      return !value;
    });
  };

  const resizeSidebar = (width: number, done: boolean) => {
    setSidebarWidth(width);
    if (done) saveValue(SIDEBAR_WIDTH_KEY, width);
  };

  // Over the board, not above it: a line in the flow would push the page down and back up.
  const loadingBoard =
    busy && atlas ? (
      <p className="loading-line" role="status">
        <span className="spinner" aria-hidden="true" />
        {t("app.loadingBoard")}
      </p>
    ) : null;

  const messages = (
    <>
      {notice ? (
        <p className="warnings" role="status">
          {notice}
        </p>
      ) : null}
      {draftsVolatile ? (
        <p className="warnings" role="status">
          {t("edit.draftsVolatile")}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <p className="warnings" role="status">
          {warnings.join(" · ")}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {tokenPrompt && !staticMode ? (
        <TokenForm
          rejected={tokenPrompt.rejected}
          onSubmit={handleToken}
          onCancel={() => setTokenPrompt(null)}
        />
      ) : null}
    </>
  );

  // Leaving the board with unsaved edits asks first, whichever way the address changes.
  // Changes made on the canvas outside edit mode are asked about when the board leaves the
  // screen for another tab or another board in its tab; moving within the tab keeps them.
  // Each pane's board is asked about on its own: the one that leaves the screen.
  useEffect(() => {
    leaveGuard.current = (kind: LeaveKind, tabId?: string) => {
      const id = tabId ?? focusedIdRef.current ?? SOLO;
      const edits = dirtyCheck.current;
      if (edits?.tabId === id && edits.check()) return window.confirm(t("edit.leaveConfirm"));
      if (kind !== "nav" && canvasReaders.current.get(id)?.unsaved()) {
        return window.confirm(t("tabs.leaveCanvasConfirm"));
      }
      // A pasted board has no address to come back to: replacing it always asks.
      if (kind === "pasted") return window.confirm(t("tabs.replacePastedConfirm"));
      return true;
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (dirtyCheck.current?.check()) event.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [leaveGuard]);

  // Reads where a tab's canvas stands, while it shows the board of that slug.
  useEffect(() => {
    viewReader.current = (slug, tabId) => {
      const id = tabId ?? focusedIdRef.current;
      if (id === null || boardsRef.current[id]?.slug !== slug) return null;
      return canvasReaders.current.get(id)?.view() ?? null;
    };
  }, [viewReader]);

  // The board being edited leaving the screen, or its tab showing another board, ends editing.
  useEffect(() => {
    setEditSession((current) =>
      current && boards[current.tabId]?.slug !== current.slug ? null : current,
    );
  }, [boards]);

  const handlersOf = (id: string): TabHandlers => {
    let made = handlers.current.get(id);
    if (!made) {
      made = {
        onSelectionChange: (found) => setCitations((previous) => ({ ...previous, [id]: found })),
        onNodes: (list) => setNodes((previous) => ({ ...previous, [id]: list })),
        registerCanvas: (reader) => {
          if (reader) canvasReaders.current.set(id, reader);
          else canvasReaders.current.delete(id);
        },
        onPresentingChange: (presenting) =>
          setPresentingId((previous) => (presenting ? id : previous === id ? null : previous)),
      };
      handlers.current.set(id, made);
    }
    return made;
  };

  /**
   * Editing of a board on screen: atlas and library boards, not the samples. One board is edited
   * at a time: while one pane edits, the other cannot start.
   */
  const boardEditingOf = (id: string, loaded: LoadedScene): BoardEditing | undefined =>
    atlas && loaded.slug && !library?.sample
      ? {
          session:
            editSession && editSession.tabId === id && editSession.slug === loaded.slug
              ? editSession
              : null,
          ...(editSession && editSession.tabId !== id ? { blocked: t("split.editElsewhere") } : {}),
          onStart: () => {
            const slug = loaded.slug as string;
            // A board being edited stays in its tab: the next ordinary click goes elsewhere.
            const tab = tabById(tabs, id);
            if (tab?.slug === slug) pinTab(tab.id);
            void (async () => {
              const started = await startEditing(slug);
              if ("error" in started) {
                setError(started.error);
                return;
              }
              setEditSession({ tabId: id, slug, board: started.board, overlay: started.overlay });
            })();
          },
          render: async (board, overlay) => {
            const result = await renderBoard(board, overlay);
            if (result.status === "ok") return { scene: result.scene, warnings: result.warnings };
            if (result.status === "error") return { error: result.message };
            // Each message names its node; the path into the board file means nothing here.
            return { error: result.issues.map((i) => i.message).join(" · ") };
          },
          onSave: async (board, overlay) => {
            const slug = loaded.slug as string;
            const error = await saveEdits(board, overlay);
            if (error !== null) return error;
            // The saved state first, then the board rendered again: the editor that shows it
            // starts from what was saved. Another pane showing it loads it again too.
            setEditSession({ tabId: id, slug, board, overlay });
            await reloadBoard(slug, atlasEnabled ? id : undefined);
            return null;
          },
          onDone: (discard) => {
            const slug = loaded.slug as string;
            setEditSession(null);
            // Unsaved edits are thrown away: render the board as it was saved.
            if (discard) void reloadBoard(slug, atlasEnabled ? id : undefined);
          },
          registerDirtyCheck: (check) => {
            if (check) dirtyCheck.current = { tabId: id, check };
            else if (dirtyCheck.current?.tabId === id) dirtyCheck.current = null;
          },
        }
      : undefined;
  /** The editor of a board on screen; `active`: its pane is the focused one. */
  const editorOf = (id: string, active: boolean) => {
    const board = boards[id];
    if (!board) return null;
    const prefs = prefsOf(id);
    const editing = boardEditingOf(id, board);
    const on = handlersOf(id);
    return (
      <Suspense
        fallback={
          <div className="loading" role="status">
            <span className="spinner" aria-hidden="true" />
            {t("app.loadingEditor")}
          </div>
        }
      >
        <Editor
          key={board.key}
          scene={board.scene}
          title={board.title}
          context={contextOf(board)}
          sourcesOpen={prefs.sourcesOpen}
          onToggleSources={() => changePrefs(id, { sourcesOpen: !prefs.sourcesOpen })}
          prefs={prefs}
          onPrefsChange={(change) => changePrefs(id, change)}
          onLayers={(present) => presentLayersShown(id, present)}
          theme={theme}
          locale={locale}
          motionAll={motionAll}
          missingFlows={missingFlows}
          fileName={board.fileName}
          focus={board.slug !== null ? focusOf(id) : (localFocus[id] ?? focusOf(id))}
          {...(atlas && !tabBarShown ? { history: boardHistory } : {})}
          registerCanvas={on.registerCanvas}
          onSelectionChange={on.onSelectionChange}
          onNodes={on.onNodes}
          onOpenRef={openRef}
          {...(atlas && board.slug !== null ? { onDownloadZip: () => setZipOpen(true) } : {})}
          {...(editing ? { edit: editing } : {})}
          onError={setError}
          active={active}
          {...(presentingId !== null && presentingId !== id
            ? { presentBlocked: t("split.presentElsewhere") }
            : {})}
          onPresentingChange={on.onPresentingChange}
        />
      </Suspense>
    );
  };

  /** One source panel, beside the boards: it follows the focused pane. */
  const sourcePanel =
    loaded && focusedId !== null && sourcesOpen ? (
      <SourcePanel
        nodes={citations[focusedId] ?? []}
        atlas={atlas}
        currentSlug={loaded.slug}
        staleSourceIds={loaded.staleSourceIds}
        missingFlows={missingFlows}
        onOpen={(place) => openPlace(place, tabsShown ? "new" : "preview")}
      />
    ) : null;

  const workspace =
    loaded && focusedId !== null ? (
      <main className="workspace">
        {editorOf(focusedId, true)}
        {sourcePanel}
      </main>
    ) : null;

  /** The atlas home: in the page, or in the focused pane beside the other pane's board. */
  const homeView = atlas ? (
    <>
      <AtlasHome
        atlas={atlas}
        {...(library
          ? {
              library: {
                ...library,
                onOpenFile: () => {
                  setDrawerOpen(false);
                  setFileOpen(true);
                },
                onClear: () => {
                  if (window.confirm(t("library.clearConfirm"))) void clearLibrary();
                },
              },
            }
          : {})}
      />
      <IssueList issues={issues} />
    </>
  ) : null;

  /** The tabs sit in two groups, one pane each, whether or not the window shows both. */
  const grouped =
    tabsShown && isSplit(tabs) && (tabs.activeId !== null || tabs.otherId !== undefined);

  /**
   * A pane: its tab bar, and its tab's board (or why there is none yet, or the atlas home).
   * Panes are keyed by their tab, in one list however many show, so a board on screen keeps its
   * editor (and the work in it) when a pane comes, goes, moves or is hidden. With one pane
   * showing, its tab bar holds every tab and the messages sit under it; with two, the messages
   * sit above both, so moving the focus never moves a pane's content.
   */
  const paneOf = (slot: "left" | "right" | "whole", group: Group, hidden = false) => {
    const id = slot === "whole" ? tabs.activeId : groupView(tabs, group).activeId;
    const tab = id === null ? undefined : tabById(tabs, id);
    const focused = slot === "whole" || group === focusedGroup(tabs);
    const side =
      split && slot !== "whole" ? t(slot === "left" ? "split.leftPane" : "split.rightPane") : null;
    const bar =
      side === null
        ? {
            history: boardHistory,
            tabs: narrowView(tabs),
            ...(narrowSplit ? {} : { onOpenBeside: openBesideAndFocus }),
          }
        : {
            ...(tab
              ? {
                  history: {
                    canBack: hasBack(tab.history),
                    canForward: hasForward(tab.history),
                    onBack: back,
                    onForward: forward,
                  },
                }
              : {}),
            tabs: groupView(tabs, group),
            label: `${t("tabs.label")}, ${side}`,
            onOpenBeside: openBesideAndFocus,
            onMove: moveTab,
          };
    return (
      <section
        key={id ?? "home"}
        className={side !== null && focused ? "pane pane-focused" : "pane"}
        hidden={hidden}
        {...(side === null
          ? {}
          : {
              "aria-label": focused ? `${side}, ${t("split.activePane")}` : side,
              // A click or the keyboard in a pane makes it the one the keys and the address
              // follow.
              onPointerDownCapture: () => focusPane(group),
              onFocusCapture: () => focusPane(group),
            })}
      >
        {tabBarShown && !hidden ? (
          <TabBar
            {...bar}
            title={tabTitle}
            onSelect={selectTab}
            onClose={closeTab}
            onPin={pinTab}
          />
        ) : null}
        {focused && !split && !fileOpen ? messages : null}
        {id === null ? (
          <div className="start pane-home">{homeView}</div>
        ) : boards[id] ? (
          editorOf(id, focused && !hidden)
        ) : (
          <div className="pane-pending">
            {tab?.error !== undefined ? (
              <p className="error" role="alert">
                {tab.error}
              </p>
            ) : null}
            {focused ? <IssueList issues={issues} /> : null}
          </div>
        )}
      </section>
    );
  };

  /**
   * The tabs' boards: the focused pane's, or two side by side, with the source panel. A narrow
   * window hides the other pane rather than taking its board off the page.
   */
  const atlasWorkspace =
    atlasEnabled && (tabs.activeId !== null || grouped) ? (
      <main className="workspace">
        <div
          className={split ? "split" : "split split-one"}
          style={{ "--split": `${splitRatio}%` } as CSSProperties}
        >
          {grouped
            ? [
                paneOf("left", 0, !split && focusedGroup(tabs) !== 0),
                ...(split
                  ? [
                      <SplitHandle
                        key="split-handle"
                        ratio={splitRatio}
                        onChange={(ratio) => {
                          setSplitRatio(ratio);
                          saveValue(SPLIT_RATIO_KEY, ratio);
                        }}
                      />,
                    ]
                  : []),
                paneOf("right", 1, !split && focusedGroup(tabs) !== 1),
              ]
            : [paneOf("whole", 0)]}
        </div>
        {sourcePanel}
      </main>
    ) : null;

  /** Where a zip of every board comes from: the library, the exported page, or the server. */
  const zipSource = async (): Promise<ZipSource> => {
    if (library) return { kind: "library", entries: libraryEntries() };
    // Drafts kept in this browser are what the person sees, so they go into the zip.
    const drafts =
      atlas?.atlasId && !atlas.tagsEditable
        ? await (await import("./drafts.ts")).listDrafts(atlas.atlasId)
        : [];
    return staticMode
      ? { kind: "static", slugs: atlas?.boards.map((b) => b.slug) ?? [], drafts }
      : { kind: "server", drafts };
  };
  const zipDialog = zipOpen ? (
    <ZipDialog
      source={zipSource}
      fileName={library ? "groundboard-boards" : "groundboard-atlas"}
      onUnauthorized={(rejected) => askToken(rejected, async () => setZipOpen(true))}
      onClose={() => setZipOpen(false)}
    />
  ) : null;

  const palette = paletteOpen ? (
    <CommandPalette
      atlas={atlas}
      nodes={loaded && focusedId !== null ? (nodes[focusedId] ?? []) : []}
      onPick={pick}
      onClose={() => setPaletteOpen(false)}
      tabs={tabsShown}
      commands={paletteCommands({
        boardCount: tabsShown ? (atlas?.boards.length ?? 0) : 0,
        boardOnScreen: loaded?.slug != null,
        twoPanes: !narrowSplit,
      })}
    />
  ) : null;

  // Until the server says whether it serves an atlas, either layout could be the wrong one:
  // show neither, so a reload does not flash the board picker before the atlas.
  if (!checked && !loaded) {
    return (
      <div className="app app-booting">
        <div className="loading" role="status">
          <span className="spinner" aria-hidden="true" />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  if (atlas) {
    const sidebarProps = {
      atlas,
      currentSlug: loaded?.slug ?? null,
      atHome: !loaded && route.view === "home",
      appearance,
      onHome: reset,
      // An exported page has no server to render a local board with.
      ...(staticMode
        ? {}
        : {
            onOpenFile: () => {
              setDrawerOpen(false);
              setFileOpen(true);
            },
          }),
      onOpenPalette: () => {
        setDrawerOpen(false);
        setPaletteOpen(true);
      },
      // The samples are not stored, so there is nothing to remove until a board is opened.
      ...(library && !library.sample
        ? { onRemove: (slug: string) => void removeFromLibrary(slug) }
        : {}),
      ...(tabsShown ? { onOpenInTab: (slug: string) => openPlace({ slug }, "new") } : {}),
    };
    return (
      <div
        className={collapsed ? "app app-atlas sidebar-collapsed" : "app app-atlas"}
        style={{ "--sidebar-w": `${sidebarWidth}px` } as CSSProperties}
      >
        {narrow ? null : (
          <Sidebar
            {...sidebarProps}
            collapsed={collapsed}
            filterRef={filterRef}
            onToggleCollapsed={toggleCollapsed}
            width={sidebarWidth}
            onResize={resizeSidebar}
          />
        )}
        <div className="main-column">
          {fileOpen ? null : loadingBoard}
          {narrow ? (
            <header className="header mobile-header">
              <div className="brand">
                <button
                  type="button"
                  className="ghost icon-button"
                  onClick={() => setDrawerOpen(true)}
                  aria-label={t("app.openAtlasMenu")}
                  aria-haspopup="dialog"
                  aria-expanded={drawerOpen}
                >
                  <Icon name="menu" size={18} />
                </button>
                <span className="logo" aria-hidden="true">
                  <Icon name="logo" size={18} />
                </span>
                <h1>groundboard</h1>
              </div>
              <button
                type="button"
                className="ghost icon-button"
                onClick={() => setPaletteOpen(true)}
                aria-label={t("common.searchAll")}
              >
                <Icon name="search" size={18} />
              </button>
            </header>
          ) : null}
          {split && !fileOpen ? messages : null}
          {atlasWorkspace ?? (
            <>
              {/* On the home the tabs stay open in one row; none is on screen. */}
              {tabBarShown ? (
                <TabBar
                  history={boardHistory}
                  tabs={narrowView(tabs)}
                  title={tabTitle}
                  onSelect={selectTab}
                  onClose={closeTab}
                  onPin={pinTab}
                />
              ) : null}
              {fileOpen ? null : messages}
              <main className="start">{homeView}</main>
            </>
          )}
        </div>
        {drawerOpen ? (
          <Modal className="drawer" label={t("common.atlas")} onClose={() => setDrawerOpen(false)}>
            <Sidebar
              {...sidebarProps}
              drawer
              filterRef={filterRef}
              onClose={() => setDrawerOpen(false)}
              onNavigate={() => setDrawerOpen(false)}
            />
          </Modal>
        ) : null}
        {fileOpen && !staticMode ? (
          <Modal
            className="file-dialog"
            label={t("app.openLocalBoard")}
            onClose={() => setFileOpen(false)}
          >
            <div className="file-dialog-head">
              <button
                type="button"
                className="ghost icon-button"
                onClick={() => setFileOpen(false)}
                aria-label={t("common.close")}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            {loadingBoard}
            {messages}
            <InputPanel
              busy={busy}
              compact
              multiple={library !== null}
              zip={library !== null}
              onInput={handleInput}
              onError={setError}
            />
            <IssueList issues={issues} />
          </Modal>
        ) : null}
        {palette}
        {zipDialog}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          {loaded ? (
            <button
              type="button"
              className="ghost icon-button"
              onClick={reset}
              aria-label={t("app.openAnotherBoard")}
              title={t("app.openAnotherBoard")}
            >
              <Icon name="back" size={18} />
            </button>
          ) : null}
          <span className="logo" aria-hidden="true">
            <Icon name="logo" size={18} />
          </span>
          <h1>groundboard</h1>
          <span className="tagline">{t("app.tagline")}</span>
        </div>
        <div className="header-actions">
          <SettingsMenu {...appearance} />
          {loaded ? (
            <button type="button" className="secondary" onClick={reset}>
              <Icon name="upload" />
              {t("app.newBoard")}
            </button>
          ) : null}
        </div>
      </header>
      {messages}
      {workspace ??
        (staticMode ? (
          <main className="start">
            <section className="hero">
              <h2>{t("app.noAtlasTitle")}</h2>
              <p className="muted">{t("app.noAtlasBody")}</p>
            </section>
          </main>
        ) : (
          <main className="start">
            <section className="hero">
              <h2>{t("app.openBoardTitle")}</h2>
              <p className="muted">{t("app.openBoardBody")}</p>
            </section>
            <InputPanel busy={busy} onInput={handleInput} onError={setError} />
            <IssueList issues={issues} />
          </main>
        ))}
      {palette}
    </div>
  );
}
