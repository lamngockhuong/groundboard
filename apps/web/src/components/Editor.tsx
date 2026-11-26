import "@excalidraw/excalidraw/index.css";
import {
  CaptureUpdateAction,
  Excalidraw,
  exportToBlob,
  exportToSvg,
  MainMenu,
  restoreElements,
  serializeAsJSON,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import { emptyOverlay, type Overlay } from "@groundboard/schema";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReferenceCount } from "../api.ts";
import { originLabel } from "../atlas-nav.ts";
import type { EditResult, RawBoard } from "../board-edit.ts";
import { downloadBlob } from "../download.ts";
import { EditHistory } from "../edit-history.ts";
import {
  familyFor,
  originalFamilies,
  READING_FONTS,
  type ReadingFontId,
  readFontPreference,
  saveFontPreference,
  withFontFamily,
} from "../fonts.ts";
import { LOCALES, type Locale, t, tn } from "../i18n.ts";
import type { Scene } from "../input.ts";
import { isLayerId, type LayerId, presentLayers, withLayersHidden } from "../layers.ts";
import {
  collectOverlay,
  lockForLayout,
  movableUnits,
  rendererIds,
  unlockAfterLayout,
} from "../layout-edit.ts";
import { safeExternalUrl } from "../links.ts";
import { lockedItemAt } from "../locked-hit.ts";
import { readMotionGraph, selectedBoardItems } from "../motion-graph.ts";
import type { ViewState } from "../nav-history.ts";
import {
  DESIGN_SHOWN_KEY,
  HIDDEN_LAYERS_KEY,
  readFlag,
  readList,
  saveFlag,
  saveValue,
} from "../prefs.ts";
import { hasReferences, missingReferencesNote, withReferencesShown } from "../references.ts";
import {
  type BoardNode,
  boardNodes,
  elementForNode,
  type NodeCitations,
  selectedCitations,
  selectedRefTarget,
} from "../sources.ts";
import { useCanvasChanges } from "../use-canvas-changes.ts";
import { usePresentation } from "../use-presentation.ts";
import { EditPanel, type EditPanelHandle } from "./EditPanel.tsx";
import { ExportMenu } from "./ExportMenu.tsx";
import { Icon } from "./Icon.tsx";
import { LayersMenu } from "./LayersMenu.tsx";
import { MotionOverlay } from "./MotionOverlay.tsx";
import { PresentControls } from "./PresentControls.tsx";
import { TagEditor } from "./TagEditor.tsx";

/** CSS names of the families in READING_FONTS, used to load a face before measuring text. */
const CSS_FAMILY: Record<number, string> = {
  2: "Helvetica",
  3: "Cascadia",
  5: "Excalifont",
  6: "Nunito",
};

/** A board the toolbar can step to; null at the start or the end of its group. */
/**
 * Excalidraw actions the viewer turns off, menu items and shortcuts alike. Opening a scene is
 * the viewer's "Open file", which checks the scene and names it; saving the scene is the
 * export menu; clearing the canvas only wipes the board being read.
 */
const CANVAS_UI = {
  canvasActions: {
    loadScene: false,
    export: false,
    saveToActiveFile: false,
    clearCanvas: false,
  },
} as const;

/** What the editor needs to let a person edit a board's content and layout, and to save them. */
export interface BoardEditing {
  /** The board and overlay as saved; null until editing starts. */
  session: { board: Record<string, unknown>; overlay: Overlay } | null;
  onStart: () => void;
  /** Renders a board with an overlay in the browser, for each edit. */
  render: (
    board: Record<string, unknown>,
    overlay: Overlay,
  ) => Promise<{ scene: Scene; warnings: string[] } | { error: string }>;
  /** Saves the board and its overlay; resolves to an error message, or null. */
  onSave: (board: Record<string, unknown>, overlay: Overlay) => Promise<string | null>;
  /** Leaves editing; `discard` asks to render the board again without the unsaved changes. */
  onDone: (discard: boolean) => void;
  /** Hands over a check of unsaved changes, asked before the viewer leaves the board. */
  registerDirtyCheck: (check: (() => boolean) | null) => void;
}

/** One step of the edit history: the board and its layout, as a whole. */
interface EditStep {
  board: Record<string, unknown>;
  overlay: Overlay;
}

/** The board being edited: where it is now, its history, and what the canvas was rendered from. */
interface EditWork {
  /** The saved board this work started from; a new save starts it again. */
  from: NonNullable<BoardEditing["session"]>;
  current: EditStep;
  history: EditHistory<EditStep>;
  /** The scene last rendered and the step it shows: offsets are read against it. */
  base: { elements: readonly unknown[]; step: EditStep };
}

/** The viewer's Back and Forward, shown in the toolbar. */
export interface BoardHistory {
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

/** What the viewer reads from the canvas: where it stands, and how much is selected. */
export interface CanvasReader {
  /** Null while presenting or before the scene is on the canvas: nothing worth going back to. */
  view: () => ViewState | null;
  selectedCount: () => number;
}

export interface BoardStep {
  title: string;
  href: string;
}

/** Where the board sits in the atlas, shown in the toolbar. Absent for a pasted board. */
export interface BoardContext {
  /** The board's group, as the breadcrumb names it: "Screens". */
  group: string;
  status: "ok" | "stale" | "invalid";
  staleCount: number;
  layoutFrom: string[];
  /** Figma frames the board cites, and how many have a cached image beside them. */
  references?: ReferenceCount;
  /** Rendered in the browser, which has no repository to compare the citations with. */
  unchecked?: boolean;
  /** Rendered in the browser from a draft kept there, not compared with the sources since. */
  draft?: boolean;
  /** On an exported page: when the sources were checked, in words. */
  snapshot?: string;
  prev: BoardStep | null;
  next: BoardStep | null;
  /** The board's tags, and every tag of the atlas to suggest. */
  tags: string[];
  allTags: string[];
  /** Saves new tags into the board file; resolves to an error message, or null. Absent when the server cannot write. */
  onSaveTags?: (tags: string[]) => Promise<string | null>;
}

interface EditorProps {
  scene: Scene;
  title: string;
  context?: BoardContext | null;
  sourcesOpen: boolean;
  onToggleSources: () => void;
  /** Viewer theme; exports stay light whatever it is. */
  theme: "light" | "dark";
  /** Interface language; Excalidraw's own menus and hints follow it. */
  locale: Locale;
  /** Every arrow in view runs, not only the arrows of the selected node. */
  motionAll?: boolean;
  fileName: string;
  /**
   * Put the canvas back where a view left it, else select this board node and scroll to it;
   * `seq` changes to apply the same focus again.
   */
  focus?: { nodeId?: string; view?: ViewState; seq: number } | null;
  /** Back and Forward through the places visited; absent where there is no history. */
  history?: BoardHistory;
  /** Hands over a reader of the canvas, and null when the board leaves the screen. */
  registerCanvas?: (reader: CanvasReader | null) => void;
  onSelectionChange: (citations: NodeCitations[]) => void;
  /** The nodes of the board, handed over once the scene is ready. */
  onNodes?: (nodes: BoardNode[]) => void;
  /**
   * A tag or list line naming a screen on another board was double-clicked. Returns true when
   * the viewer opened that board; the double click then does not start editing the text.
   */
  onOpenRef?: (ref: string) => boolean;
  /** Downloads every board of the atlas or the library as a zip; absent for a pasted board. */
  onDownloadZip?: () => void;
  /** Editing of this board; absent where the board cannot be edited. */
  edit?: BoardEditing;
  onError: (message: string) => void;
}

function StatusChip({ context }: { context: BoardContext }) {
  if (context.draft) {
    return (
      <span className="status status-unchecked" title={t("edit.draftTitle")}>
        {t("edit.draftBadge")}
      </span>
    );
  }
  if (context.unchecked) {
    return (
      <span className="status status-unchecked" title={t("editor.uncheckedTitle")}>
        {t("editor.unchecked")}
      </span>
    );
  }
  if (context.status === "stale") {
    const n = context.staleCount;
    return (
      <span className="status status-stale" title={t("editor.staleTitle")}>
        {tn("editor.stale", n)}
      </span>
    );
  }
  return context.status === "ok" ? (
    <span className="status status-ok">{t("status.ok")}</span>
  ) : null;
}

function StepLink({
  step,
  dir,
  group,
}: {
  step: BoardStep | null;
  dir: "prev" | "next";
  group: string;
}) {
  const key = dir === "prev" ? "[" : "]";
  if (!step) {
    return (
      <button
        type="button"
        className="ghost icon-button"
        disabled
        aria-label={t(dir === "prev" ? "editor.noPrev" : "editor.noNext", { group })}
      >
        <Icon name={dir} size={18} />
      </button>
    );
  }
  return (
    <a
      className="step-link"
      href={step.href}
      aria-label={t(dir === "prev" ? "editor.prevBoard" : "editor.nextBoard", {
        title: step.title,
      })}
      title={t(dir === "prev" ? "editor.prevStep" : "editor.nextStep", { title: step.title, key })}
    >
      <Icon name={dir} size={18} />
    </a>
  );
}

/** The ids marked selected, in order. */
const selectedIds = (ids: Readonly<Record<string, boolean>>) =>
  Object.keys(ids).filter((id) => ids[id]);

/** A saved view as Excalidraw's app state, keeping only the selected elements still there. */
function viewAppState(view: ViewState, elements: readonly unknown[]) {
  const present = new Set(elements.map((e) => (e as { id: string }).id));
  return {
    scrollX: view.scrollX,
    scrollY: view.scrollY,
    zoom: { value: view.zoom },
    selectedElementIds: Object.fromEntries(
      view.selected.filter((id) => present.has(id)).map((id) => [id, true]),
    ),
  };
}

const selectionKey = (ids: Readonly<Record<string, boolean>>) =>
  Object.keys(ids)
    .filter((id) => ids[id])
    .sort()
    .join(",");

export default function Editor({
  scene,
  title,
  context = null,
  sourcesOpen,
  onToggleSources,
  theme,
  locale,
  motionAll = false,
  fileName,
  focus = null,
  history,
  registerCanvas,
  onSelectionChange,
  onNodes,
  onOpenRef,
  onDownloadZip,
  edit,
  onError,
}: EditorProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const lastSelection = useRef("");
  const [font, setFont] = useState<ReadingFontId>(readFontPreference);
  // Excalidraw loads initialData after the API is handed over; text can switch font only then.
  const [sceneReady, setSceneReady] = useState(false);
  /** The scene on the canvas: the board's, or the last one rendered while editing. */
  const [rendered, setRendered] = useState(scene);
  const originals = useMemo(() => originalFamilies(rendered.elements), [rendered]);
  const session = edit?.session ?? null;
  const [saving, setSaving] = useState(false);
  const work = useRef<EditWork | null>(null);
  /** A step being rendered: saving now would read the canvas before it shows that step. */
  const rendering = useRef<Promise<string | null> | null>(null);
  const [renderingStep, setRenderingStep] = useState(false);
  /** Changes whenever the history moves, so the undo buttons follow. */
  const [, setHistoryTick] = useState(0);
  const tick = useCallback(() => setHistoryTick((n) => n + 1), []);
  const [selection, setSelection] = useState<{ nodes: string[]; edges: string[] }>({
    nodes: [],
    edges: [],
  });
  /** The selected board items, for the arrows that run around them. */
  const [selected, setSelected] = useState<{ nodes: string[]; edges: string[] }>({
    nodes: [],
    edges: [],
  });
  const panelRef = useRef<EditPanelHandle>(null);
  /** The edit session is set up on the canvas: until then its buttons would act on nothing. */
  const editReady = session !== null && work.current?.from === session;
  const editRef = useRef(edit);
  editRef.current = edit;
  // Reference images show unless the reader hid them; the choice is kept across boards.
  const [designShown, setDesignShown] = useState(() => readFlag(DESIGN_SHOWN_KEY, true));
  const shownAtLoad = useRef(designShown);
  const hasDesign = useMemo(() => hasReferences(scene.elements), [scene]);
  const missingDesign = missingReferencesNote(context?.references);
  // Layers the reader hid stay hidden on the next board too.
  const [hiddenLayers, setHiddenLayers] = useState<ReadonlySet<LayerId>>(
    () => new Set(readList(HIDDEN_LAYERS_KEY).filter(isLayerId)),
  );
  const hiddenAtLoad = useRef(hiddenLayers);
  const layers = useMemo(() => presentLayers(scene.elements), [scene]);
  const hasArrows = useMemo(
    () => readMotionGraph(rendered.elements, { includeDeleted: true }).arrows.length > 0,
    [rendered],
  );
  const presentation = usePresentation(api);
  const presenting = presentation.view !== null;
  const presentRef = useRef(presentation);
  presentRef.current = presentation;
  const presentButton = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Changes made on the canvas outside edit mode, which nothing saves.
  const canvasChanges = useCanvasChanges(api, canvasRef, session === null && !presenting);
  const exitPresentation = () => {
    presentation.exit();
    presentButton.current?.focus();
  };

  // Excalidraw runs `restore()` over initialData, which validates and normalizes every
  // element, so the opaque scene parsed at the boundary is handed over as-is (with reference
  // images marked deleted when the reader hid them).
  // Back or Forward to this board opens it where the reader left it, without a fit first.
  const viewAtLoad = useRef(focus?.view);
  const initialData = useMemo(
    () =>
      ({
        elements: withLayersHidden(
          shownAtLoad.current ? scene.elements : withReferencesShown(scene.elements, false),
          hiddenAtLoad.current,
          shownAtLoad.current,
        ),
        appState: viewAtLoad.current
          ? { ...scene.appState, ...viewAppState(viewAtLoad.current, scene.elements) }
          : scene.appState,
        files: scene.files,
        scrollToContent: !viewAtLoad.current,
      }) as ExcalidrawInitialDataState,
    [scene],
  );

  const toggleDesign = () => {
    const next = !designShown;
    setDesignShown(next);
    saveFlag(DESIGN_SHOWN_KEY, next);
    if (!api) return;
    // Not an undoable edit: undo must never bring back what the button hid.
    api.updateScene({
      elements: withLayersHidden(
        withReferencesShown(api.getSceneElementsIncludingDeleted(), next),
        hiddenLayers,
        next,
      ),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  };

  const toggleLayer = (layer: LayerId) => {
    const next = new Set(hiddenLayers);
    if (!next.delete(layer)) next.add(layer);
    setHiddenLayers(next);
    saveValue(HIDDEN_LAYERS_KEY, [...next]);
    if (!api) return;
    // Like the Design button: not an undoable edit.
    api.updateScene({
      elements: withLayersHidden(api.getSceneElementsIncludingDeleted(), next, designShown),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  };

  // Boards are often wider than the window; fit the whole scene once the editor is ready,
  // unless a deep link names one node, which is then selected and brought into view. Back and
  // Forward put the canvas back where the reader left it.
  useEffect(() => {
    if (!api) return;
    const frame = requestAnimationFrame(() => {
      if (focus?.view) {
        api.updateScene({
          appState: viewAppState(focus.view, api.getSceneElements()) as never,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        return;
      }
      const target = focus?.nodeId ? elementForNode(api.getSceneElements(), focus.nodeId) : null;
      if (!target) {
        api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9 });
        return;
      }
      const element = api.getSceneElements().find((e) => e.id === target.id);
      api.updateScene({ appState: { selectedElementIds: { [target.id]: true } } });
      if (element) api.scrollToContent(element, { fitToContent: true, viewportZoomFactor: 0.5 });
    });
    return () => cancelAnimationFrame(frame);
  }, [api, focus]);

  // Switch board text to the reading font. The face is loaded first, for the characters the
  // board uses, so text is measured and re-wrapped in its containers with the real glyphs.
  useEffect(() => {
    if (!api || !sceneReady) return;
    let cancelled = false;
    const family = familyFor(font);
    void (async () => {
      const current = api.getSceneElementsIncludingDeleted();
      const next = withFontFamily(current, family, originals);
      if (next.every((el, i) => el === current[i])) return;
      const sample = next
        .map((el) => ("text" in el && typeof el.text === "string" ? el.text : ""))
        .join("")
        .slice(0, 2000);
      const families = new Set(
        next.flatMap((el) => ("fontFamily" in el ? [el.fontFamily as number] : [])),
      );
      await Promise.all(
        [...families].map((f) =>
          CSS_FAMILY[f]
            ? document.fonts.load(`20px "${CSS_FAMILY[f]}"`, sample || "a").catch(() => [])
            : [],
        ),
      );
      if (cancelled) return;
      // A presentation started while the font loaded ends first: leaving it later would put
      // back the scene from before the font.
      presentRef.current.exit();
      // Re-read the scene: it may have changed while the font loaded (the Design button).
      const latest = withFontFamily(api.getSceneElementsIncludingDeleted(), family, originals);
      api.updateScene({
        elements: restoreElements(latest, null, { refreshDimensions: true, repairBindings: true }),
      });
    })().catch((error: unknown) => {
      onError(
        t("editor.fontFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [api, sceneReady, font, originals, onError]);

  // The viewer reads the canvas before it leaves the board, to come back to the same view.
  const readerState = useRef({ api, sceneReady, presenting });
  readerState.current = { api, sceneReady, presenting };
  const registerCanvasRef = useRef(registerCanvas);
  registerCanvasRef.current = registerCanvas;
  useEffect(() => {
    const register = registerCanvasRef.current;
    register?.({
      view: () => {
        const { api, sceneReady, presenting } = readerState.current;
        if (!api || !sceneReady || presenting) return null;
        const state = api.getAppState();
        return {
          scrollX: state.scrollX,
          scrollY: state.scrollY,
          zoom: state.zoom.value,
          selected: selectedIds(state.selectedElementIds),
        };
      },
      selectedCount: () => {
        const { api } = readerState.current;
        return api ? selectedIds(api.getAppState().selectedElementIds).length : 0;
      },
    });
    return () => register?.(null);
  }, []);

  // Hand the board's nodes over once, for the command palette.
  const onNodesRef = useRef(onNodes);
  onNodesRef.current = onNodes;
  useEffect(() => {
    if (!api || !sceneReady) return;
    onNodesRef.current?.(boardNodes(api.getSceneElements()));
  }, [api, sceneReady]);

  /** The scene as the viewer shows it: reference images and layers the reader hid stay hidden. */
  const prepare = (elements: readonly unknown[]) =>
    withLayersHidden(
      designShown ? elements : withReferencesShown(elements as never, false),
      hiddenLayers,
      designShown,
    );

  /** The overlay the canvas shows now, read against the scene last rendered. */
  const collect = () => {
    const w = work.current;
    if (!w || !api) return { overlay: emptyOverlay(), dropped: 0 };
    return collectOverlay({
      rendered: w.base.elements,
      current: api.getSceneElements(),
      units: movableUnits(w.base.step.board),
      base: w.base.step.overlay,
    });
  };

  /** Whether the board or its layout differs from what was saved. */
  const isDirty = () => {
    const w = work.current;
    const saved = editRef.current?.session;
    if (!w || !saved) return false;
    return (
      JSON.stringify(w.current.board) !== JSON.stringify(saved.board) ||
      JSON.stringify(collect().overlay) !== JSON.stringify(saved.overlay)
    );
  };
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  /**
   * Renders a step and puts it on the canvas in place, without mounting the editor again: the
   * viewport stays, and so does the selection of anything still there.
   */
  const show = (step: EditStep): Promise<string | null> => {
    const run = render(step).finally(() => {
      if (rendering.current === run) {
        rendering.current = null;
        setRenderingStep(false);
      }
    });
    rendering.current = run;
    setRenderingStep(true);
    return run;
  };
  const render = async (step: EditStep): Promise<string | null> => {
    const w = work.current;
    if (!api || !edit || !w) return null;
    const result = await edit.render(step.board, step.overlay);
    if ("error" in result) return result.error;
    const elements = result.scene.elements;
    const locked = lockForLayout(
      prepare(elements),
      movableUnits(step.board),
      rendererIds(elements),
    );
    const present = new Set(locked.elements.map((e) => String(e.id)));
    const selected = Object.fromEntries(
      Object.entries(api.getAppState().selectedElementIds).filter(([id]) => present.has(id)),
    );
    api.updateScene({
      elements: locked.elements as never,
      appState: { selectedElementIds: selected } as never,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    w.current = step;
    w.base = { elements, step };
    setRendered(result.scene);
    return null;
  };

  // Edit mode: only movable boxes and notes can be picked up, and edits go through the panel.
  useEffect(() => {
    if (!api || !sceneReady) return;
    if (session && work.current?.from !== session) {
      // Editing reads and locks the whole board: a presentation that started while the
      // session was being opened ends first.
      presentRef.current.exit();
      const step = { board: session.board, overlay: session.overlay };
      const locked = lockForLayout(
        api.getSceneElementsIncludingDeleted(),
        movableUnits(session.board),
        rendererIds(rendered.elements),
      );
      api.updateScene({
        elements: locked.elements as never,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      work.current = {
        from: session,
        current: step,
        history: new EditHistory<EditStep>(step),
        base: { elements: rendered.elements, step },
      };
      editRef.current?.registerDirtyCheck(() => isDirtyRef.current());
      setSelection(
        selectedBoardItems(api.getSceneElements(), api.getAppState().selectedElementIds),
      );
      tick();
    } else if (!session && work.current) {
      api.updateScene({
        elements: unlockAfterLayout(api.getSceneElementsIncludingDeleted(), new Map()) as never,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      work.current = null;
      editRef.current?.registerDirtyCheck(null);
    }
  }, [api, sceneReady, session, rendered, tick]);

  // Edit mode locks what may not be dragged, and Excalidraw never picks a locked element: a
  // press on one selects it here instead, so the panel can edit or remove it. Excalidraw never
  // sees that press, so nothing is dragged.
  useEffect(() => {
    const root = canvasRef.current;
    if (!api || !session || !root) return;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof HTMLCanvasElement)) return;
      const appState = api.getAppState();
      if (appState.activeTool.type !== "selection") return;
      const point = viewportCoordsToSceneCoords(event, appState);
      const id = lockedItemAt(api.getSceneElements(), point, 8 / appState.zoom.value);
      if (id === null) return;
      event.preventDefault();
      event.stopPropagation();
      const kept = event.shiftKey ? appState.selectedElementIds : {};
      api.updateScene({
        appState: { selectedElementIds: { ...kept, [id]: true }, selectedGroupIds: {} } as never,
      });
      // Keep the keyboard on the canvas, as Excalidraw's own press would.
      (root.querySelector(".excalidraw") as HTMLElement | null)?.focus();
    };
    root.addEventListener("pointerdown", onDown, true);
    return () => root.removeEventListener("pointerdown", onDown, true);
  }, [api, session]);

  // Leaving the board ends its editing.
  useEffect(() => () => editRef.current?.registerDirtyCheck(null), []);

  /** Applies a content edit: checked, added to the history with the layout as it is, rendered. */
  const applyEdit = async (change: (board: RawBoard) => EditResult): Promise<string | null> => {
    const w = work.current;
    if (!w) return null;
    const result = change(w.current.board);
    // The message names the node; the path into the board file means nothing to the person editing.
    if (!result.ok) return result.issues.map((i) => i.message).join(" · ");
    if (result.board === w.current.board) return null;
    const step = { board: result.board, overlay: collect().overlay };
    w.history.push(step);
    tick();
    return show(step);
  };

  /** A drag that ended is a step of the history too. */
  const handlePointerUp = () => {
    const w = work.current;
    if (!w) return;
    const { overlay } = collect();
    if (JSON.stringify(overlay) === JSON.stringify(w.current.overlay)) return;
    w.current = { board: w.current.board, overlay };
    w.history.push(w.current);
    tick();
  };

  const undo = () => {
    const step = work.current?.history.undo();
    tick();
    if (step) void show(step).then((error) => error && onError(error));
  };
  const redo = () => {
    const step = work.current?.history.redo();
    tick();
    if (step) void show(step).then((error) => error && onError(error));
  };

  // While editing, Ctrl Z and Ctrl Shift Z go through the one history, never Excalidraw's own,
  // and Enter on a box does not start typing into it: text is edited in the panel.
  const keysRef = useRef({ undo, redo });
  keysRef.current = { undo, redo };
  useEffect(() => {
    if (!session) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) keysRef.current.redo();
        else keysRef.current.undo();
      } else if (mod && key === "y") {
        event.preventDefault();
        event.stopPropagation();
        keysRef.current.redo();
      } else if (event.key === "Enter" && !mod) {
        event.preventDefault();
        event.stopPropagation();
        panelRef.current?.focusLabel();
      } else if ((event.key === "Delete" || event.key === "Backspace") && !mod) {
        // Excalidraw would only drop the element from the canvas; the board keeps the node.
        event.preventDefault();
        event.stopPropagation();
        panelRef.current?.removeSelected();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [session]);

  // While presenting: → and ← step, Space plays or pauses, Esc leaves. Read before Excalidraw,
  // which would otherwise take arrows and Esc for itself.
  // Menus, dialogs and the sidebar's resize handle keep their own arrow keys and Esc.
  const exitRef = useRef(exitPresentation);
  exitRef.current = exitPresentation;
  useEffect(() => {
    if (!presenting) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (target?.closest?.('[role="menu"], [role="separator"], [role="dialog"], dialog, .Modal'))
        return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // A focused button answers Space and Enter itself.
      if (target?.tagName === "BUTTON" && (event.key === " " || event.key === "Enter")) return;
      const p = presentRef.current;
      const act =
        event.key === "ArrowRight"
          ? p.next
          : event.key === "ArrowLeft"
            ? p.prev
            : event.key === " "
              ? p.togglePlay
              : event.key === "Escape"
                ? exitRef.current
                : null;
      if (!act) return;
      event.preventDefault();
      event.stopPropagation();
      // Space held down plays and pauses once, not on every repeat.
      if (event.repeat && event.key === " ") return;
      act();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [presenting]);

  const onSaveEdits = async () => {
    // A step still being drawn is part of what is saved: wait until the canvas shows it.
    if (rendering.current) await rendering.current;
    const w = work.current;
    if (!api || !w || !edit) return;
    const { overlay, dropped } = collect();
    if (dropped > 0) onError(t("edit.droppedNotes", { count: dropped }));
    setSaving(true);
    const error = await edit.onSave(w.current.board, overlay);
    setSaving(false);
    if (error) onError(error);
  };

  const onResetLayout = () => {
    const w = work.current;
    if (!w || !window.confirm(t("edit.resetConfirm"))) return;
    const step = { board: w.current.board, overlay: emptyOverlay() };
    w.history.push(step);
    tick();
    void show(step).then((error) => error && onError(error));
  };

  const onDoneEditing = () => {
    const dirty = isDirty();
    if (dirty && !window.confirm(t("edit.leaveConfirm"))) return;
    edit?.onDone(dirty);
  };

  const pickFont = (id: ReadingFontId) => {
    setFont(id);
    saveFontPreference(id);
  };

  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      if (elements.length > 0) setSceneReady(true);
      canvasChanges.check(elements);
      const key = selectionKey(appState.selectedElementIds);
      if (key === lastSelection.current) return;
      lastSelection.current = key;
      onSelectionChange(selectedCitations(elements, appState.selectedElementIds));
      const items = selectedBoardItems(elements, appState.selectedElementIds);
      setSelected(items);
      if (work.current) setSelection(items);
    },
    [onSelectionChange, canvasChanges.check],
  );

  /** Puts the board back as it was before the changes made outside edit mode. */
  const discardCanvasChanges = () =>
    canvasChanges.discard((elements) =>
      restoreElements(
        withFontFamily(prepare(elements), familyFor(font), originals) as ExcalidrawElement[],
        null,
        {
          refreshDimensions: true,
          repairBindings: true,
        },
      ),
    );

  const handleLinkOpen = useCallback(
    (element: { link: string | null }, event: CustomEvent<unknown>) => {
      // Never let Excalidraw navigate on its own; only vetted https links open, in a new tab.
      event.preventDefault();
      const url = safeExternalUrl(element.link);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    },
    [],
  );

  // A single click selects a ref marker and shows its sources; a double click follows it. The
  // first click of the pair has already selected the marker, so the selection says what was hit.
  // Excalidraw drops element links that are not https, so the scene cannot carry this link.
  const onOpenRefRef = useRef(onOpenRef);
  onOpenRefRef.current = onOpenRef;
  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!api) return;
    // Editing: a double click on a box opens its label in the panel, never typing on the canvas.
    if (work.current) {
      const picked = selectedBoardItems(
        api.getSceneElements(),
        api.getAppState().selectedElementIds,
      );
      if (picked.nodes.length === 1) {
        event.preventDefault();
        event.stopPropagation();
        panelRef.current?.focusLabel();
      }
      return;
    }
    const ref = selectedRefTarget(api.getSceneElements(), api.getAppState().selectedElementIds);
    if (ref === null || !onOpenRefRef.current?.(ref)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const snapshot = (): {
    elements: readonly ExcalidrawElement[];
    appState: AppState;
    files: BinaryFiles;
  } | null =>
    api
      ? { elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles() }
      : null;

  const run = (label: string, task: () => Promise<void> | void) => async () => {
    try {
      await task();
    } catch (error) {
      onError(
        t("editor.failed", {
          task: label,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  const saveScene = run(t("editor.taskSaveScene"), () => {
    const s = snapshot();
    if (!s) return;
    const json = serializeAsJSON(s.elements, s.appState, s.files, "local");
    downloadBlob(new Blob([json], { type: "application/json" }), `${fileName}.excalidraw`);
  });

  const savePng = run(t("editor.taskPng"), async () => {
    const s = snapshot();
    if (!s) return;
    const blob = await exportToBlob({ ...s, mimeType: "image/png" });
    downloadBlob(blob, `${fileName}.png`);
  });

  const saveSvg = run(t("editor.taskSvg"), async () => {
    const s = snapshot();
    if (!s) return;
    const svg = await exportToSvg({ ...s });
    const text = new XMLSerializer().serializeToString(svg);
    downloadBlob(new Blob([text], { type: "image/svg+xml" }), `${fileName}.svg`);
  });

  return (
    <div className="editor">
      <div className="toolbar">
        <div className="toolbar-title">
          {history ? (
            <nav className="board-steps" aria-label={t("editor.history")}>
              <button
                type="button"
                className="ghost icon-button"
                onClick={history.onBack}
                disabled={!history.canBack}
                aria-label={t("editor.back")}
                aria-keyshortcuts="Alt+ArrowLeft"
                title={t("editor.backHint", { key: "Alt+←" })}
              >
                <Icon name="historyBack" size={18} />
              </button>
              <button
                type="button"
                className="ghost icon-button"
                onClick={history.onForward}
                disabled={!history.canForward}
                aria-label={t("editor.forward")}
                aria-keyshortcuts="Alt+ArrowRight"
                title={t("editor.forwardHint", { key: "Alt+→" })}
              >
                <Icon name="historyForward" size={18} />
              </button>
            </nav>
          ) : null}
          {context ? (
            <nav className="board-steps" aria-label={t("editor.boardsInGroup")}>
              <StepLink step={context.prev} dir="prev" group={context.group} />
              <StepLink step={context.next} dir="next" group={context.group} />
            </nav>
          ) : null}
          <h2 className="board-title" title={title}>
            {context ? (
              <>
                <span className="crumb">{context.group}</span>
                <Icon name="next" size={14} />
              </>
            ) : null}
            <span className="board-title-text">{title}</span>
          </h2>
        </div>
        <div className="toolbar-actions">
          <div className="toolbar-group">
            {hasDesign ? (
              <button
                type="button"
                className={designShown ? "ghost pressed" : "ghost"}
                onClick={toggleDesign}
                aria-pressed={designShown}
                disabled={!api || presenting}
                title={designShown ? t("editor.hideDesign") : t("editor.showDesign")}
              >
                <Icon name="image" />
                <span className="button-label">{t("editor.design")}</span>
              </button>
            ) : null}
            {edit && session ? (
              <>
                <button
                  type="button"
                  className="keep-label"
                  onClick={() => void onSaveEdits()}
                  disabled={!api || saving || !editReady || renderingStep}
                >
                  {saving ? <span className="spinner" aria-hidden="true" /> : <Icon name="check" />}
                  <span className="button-label">{t("edit.saveAll")}</span>
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={onResetLayout}
                  disabled={!api || saving || !editReady || renderingStep}
                  title={t("edit.reset")}
                >
                  <Icon name="reset" />
                  <span className="button-label">{t("edit.reset")}</span>
                </button>
                <button
                  type="button"
                  className="secondary keep-label"
                  onClick={onDoneEditing}
                  disabled={saving || !editReady}
                >
                  <span className="button-label">{t("edit.done")}</span>
                </button>
              </>
            ) : edit ? (
              <button
                type="button"
                className="ghost"
                onClick={edit.onStart}
                disabled={!api || presenting}
                title={t("edit.startHint")}
              >
                <Icon name="move" />
                <span className="button-label">{t("edit.start")}</span>
              </button>
            ) : null}
            {session ? null : (
              <button
                ref={presentButton}
                type="button"
                className={presenting ? "ghost pressed" : "ghost"}
                onClick={presenting ? exitPresentation : presentation.start}
                aria-pressed={presenting}
                disabled={!api || !sceneReady || !hasArrows}
                title={presenting ? t("present.stop") : t("present.startHint")}
              >
                <Icon name="present" />
                <span className="button-label">{t("present.start")}</span>
              </button>
            )}
          </div>
          <span className="toolbar-divider" aria-hidden="true" />
          <div className="toolbar-group">
            <LayersMenu
              layers={layers}
              hidden={hiddenLayers}
              disabled={!api || presenting}
              onToggle={toggleLayer}
            />
            <label className="font-picker">
              <Icon name="type" />
              <span className="visually-hidden">{t("editor.readingFont")}</span>
              <select
                value={font}
                onChange={(event) => pickFont(event.currentTarget.value as ReadingFontId)}
                disabled={!api || presenting}
                title={t("editor.fontTitle")}
              >
                {READING_FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {t(`font.${f.id}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <span className="toolbar-divider" aria-hidden="true" />
          <div className="toolbar-group">
            <ExportMenu
              disabled={!api || presenting}
              items={[
                {
                  label: ".excalidraw",
                  hint: t("editor.exportScene"),
                  icon: "download",
                  run: saveScene,
                },
                { label: "PNG", hint: t("editor.exportPng"), icon: "image", run: savePng },
                { label: "SVG", hint: t("editor.exportSvg"), icon: "code", run: saveSvg },
                ...(onDownloadZip
                  ? [
                      {
                        label: t("zip.download"),
                        hint: t("zip.downloadHint"),
                        icon: "download" as const,
                        run: onDownloadZip,
                      },
                    ]
                  : []),
              ]}
            />
            <button
              type="button"
              className={sourcesOpen ? "ghost icon-button pressed" : "ghost icon-button"}
              onClick={onToggleSources}
              aria-pressed={sourcesOpen}
              aria-label={t("editor.sourcesPanel")}
              title={sourcesOpen ? t("editor.hideSources") : t("editor.showSources")}
            >
              <Icon name="panel" size={18} />
            </button>
          </div>
        </div>
        {context || missingDesign ? (
          <div className="board-meta">
            {context ? <StatusChip context={context} /> : null}
            {context?.layoutFrom.map((origin) => (
              <span key={origin} className="badge">
                {originLabel(origin)}
              </span>
            ))}
            {context ? (
              <TagEditor
                tags={context.tags}
                suggestions={context.allTags}
                {...(context.onSaveTags ? { onSave: context.onSaveTags } : {})}
              />
            ) : null}
            {context?.snapshot ? (
              <span
                className="badge snapshot"
                title={`${context.snapshot}. ${t("common.snapshotNote")}`}
              >
                {context.snapshot}
              </span>
            ) : null}
            {missingDesign ? (
              <span className="badge" title={missingDesign}>
                {t("editor.designNotCached")}
                <span className="visually-hidden">: {missingDesign}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div
        ref={canvasRef}
        className={
          !session
            ? "canvas"
            : selection.nodes.length + selection.edges.length > 0
              ? "canvas editing board-selected"
              : "canvas editing"
        }
        onDoubleClickCapture={handleDoubleClick}
      >
        <Excalidraw
          onPointerUp={handlePointerUp}
          initialData={initialData}
          theme={theme}
          langCode={LOCALES.find((l) => l.id === locale)?.excalidraw ?? "en"}
          excalidrawAPI={setApi}
          onChange={handleChange}
          onLinkOpen={handleLinkOpen}
          UIOptions={CANVAS_UI}
          viewModeEnabled={presenting}
        >
          {/* Excalidraw's own menu without its GitHub, X and Discord links: the viewer leads
              nowhere off this machine. The library panel and the help dialog's links are
              hidden in styles.css for the same reason. */}
          <MainMenu>
            {/* Saving an image mid-presentation would save the half-revealed board. */}
            {presenting ? null : <MainMenu.DefaultItems.SaveAsImage />}
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        </Excalidraw>
        <MotionOverlay
          api={api}
          mode={presenting ? "off" : motionAll ? "all" : "selection"}
          selection={selected}
          arrowsHidden={hiddenLayers.has("arrows")}
          drawing={presentation.drawing}
        />
        {presentation.view ? (
          <PresentControls
            view={presentation.view}
            delay={presentation.delay}
            onPrev={presentation.prev}
            onNext={presentation.next}
            onTogglePlay={presentation.togglePlay}
            onExit={exitPresentation}
            onDelay={presentation.setDelay}
          />
        ) : null}
        {canvasChanges.unsaved ? (
          <div className="canvas-unsaved" role="status">
            <span>{t(edit ? "editor.canvasUnsavedEdit" : "editor.canvasUnsaved")}</span>
            {edit ? (
              <button type="button" className="ghost" onClick={edit.onStart}>
                {t("edit.start")}
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={discardCanvasChanges}>
              {t("editor.canvasDiscard")}
            </button>
          </div>
        ) : null}
        {session && work.current ? (
          <EditPanel
            ref={panelRef}
            board={work.current.current.board}
            selection={selection}
            canUndo={work.current.history.canUndo}
            canRedo={work.current.history.canRedo}
            onUndo={undo}
            onRedo={redo}
            onApply={applyEdit}
          />
        ) : null}
      </div>
    </div>
  );
}
