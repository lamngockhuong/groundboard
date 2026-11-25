import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { drawDuration } from "./components/MotionOverlay.tsx";
import {
  hiddenAtStep,
  type MotionArrow,
  type MotionGraph,
  type PresentationStep,
  presentationSteps,
  readMotionGraph,
  sceneAtStep,
  stepFocus,
} from "./motion-graph.ts";
import { PRESENT_DELAY_KEY, readNumber, saveValue } from "./prefs.ts";

/** How long the camera takes to reach a step. */
const CAMERA_MS = 500;
/** The camera never zooms in past this, so a small flow is not blown up. */
const MAX_ZOOM = 1;
export const DELAY_RANGE = { min: 1, max: 5, initial: 2 } as const;

interface Run {
  /** The scene when the presentation started: every step derives from it, leaving restores it. */
  start: readonly ExcalidrawElement[];
  selected: Readonly<Record<string, true>>;
  graph: MotionGraph;
  steps: PresentationStep[];
  index: number;
  playing: boolean;
  /** Bumped by every move, so a step still animating gives up when a newer one starts. */
  token: number;
  timer: number;
}

export interface PresentationView {
  index: number;
  total: number;
  playing: boolean;
}

const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Presents a board one level of its graph at a time. Elements of later steps are marked
 * deleted, as the Layers menu does, and never as an undoable edit; leaving puts back the scene
 * the presentation started from, element for element.
 */
export function usePresentation(api: ExcalidrawImperativeAPI | null) {
  const run = useRef<Run | null>(null);
  const [view, setView] = useState<PresentationView | null>(null);
  const [drawing, setDrawing] = useState<{ arrows: MotionArrow[]; seq: number } | null>(null);
  const [delay, setDelayState] = useState(() =>
    readNumber(PRESENT_DELAY_KEY, DELAY_RANGE.initial, DELAY_RANGE.min, DELAY_RANGE.max),
  );
  const delayRef = useRef(delay);
  delayRef.current = delay;

  const publish = (r: Run) =>
    setView({ index: r.index, total: r.steps.length, playing: r.playing });

  const showStep = (r: Run, index: number) => {
    api?.updateScene({
      elements: sceneAtStep(r.start, hiddenAtStep(r.graph, r.steps, index)),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  };

  const frameStep = (r: Run, index: number, animate: boolean) => {
    const ids = new Set(stepFocus(r.graph, r.steps[index]).map((n) => n.elementId));
    // Nodes a hidden layer keeps out of view are not framed: the camera would show nothing.
    const targets = r.start.filter((el) => ids.has(el.id) && !el.isDeleted);
    if (!api || targets.length === 0) return;
    api.scrollToContent(targets, {
      fitToViewport: true,
      viewportZoomFactor: 0.8,
      maxZoom: MAX_ZOOM,
      animate,
      duration: CAMERA_MS,
    });
  };

  // The latest closures, for timers set by an earlier render.
  const goToRef = useRef<(index: number) => Promise<void>>(async () => undefined);

  const afterStep = (r: Run, token: number) => {
    if (!r.playing || token !== r.token) return;
    if (r.index >= r.steps.length - 1) {
      r.playing = false;
      publish(r);
      return;
    }
    r.timer = window.setTimeout(() => void goToRef.current(r.index + 1), delayRef.current * 1000);
  };

  const goTo = async (index: number) => {
    const r = run.current;
    if (!r || index < 0 || index >= r.steps.length) return;
    const token = ++r.token;
    window.clearTimeout(r.timer);
    const forward = index === r.index + 1;
    const animate = !reducedMotion();
    r.index = index;
    publish(r);
    setDrawing(null);
    if (!forward || !animate) {
      showStep(r, index);
      frameStep(r, index, animate);
      afterStep(r, token);
      return;
    }
    // A step cut short by this one shows in full first.
    showStep(r, index - 1);
    frameStep(r, index, true);
    await wait(CAMERA_MS);
    if (token !== r.token) return;
    const shown = new Set(r.start.filter((el) => !el.isDeleted).map((el) => el.id));
    const step = r.steps[index] as PresentationStep;
    const arrows = step.arrows.flatMap((id) => {
      const arrow = r.graph.arrows.find((a) => a.id === id);
      // An arrow of a hidden layer stays hidden: it is not drawn in either.
      return arrow && shown.has(arrow.elementId) ? [arrow] : [];
    });
    if (arrows.length > 0) {
      setDrawing({ arrows, seq: token });
      await wait(drawDuration(arrows.length));
      if (token !== r.token) return;
    }
    showStep(r, index);
    setDrawing(null);
    afterStep(r, token);
  };
  goToRef.current = goTo;

  const start = () => {
    if (!api || run.current) return;
    const elements = api.getSceneElementsIncludingDeleted();
    const graph = readMotionGraph(elements, { includeDeleted: true });
    const steps = presentationSteps(graph);
    if (steps.length === 0) return;
    const r: Run = {
      start: elements,
      selected: api.getAppState().selectedElementIds,
      graph,
      steps,
      index: 0,
      playing: false,
      token: 0,
      timer: 0,
    };
    run.current = r;
    api.updateScene({
      elements: sceneAtStep(elements, hiddenAtStep(graph, steps, 0)),
      appState: { selectedElementIds: {} },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    frameStep(r, 0, false);
    publish(r);
  };

  const exit = useCallback(() => {
    const r = run.current;
    if (!r) return;
    r.token++;
    window.clearTimeout(r.timer);
    run.current = null;
    api?.updateScene({
      elements: r.start,
      appState: { selectedElementIds: r.selected },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    setView(null);
    setDrawing(null);
  }, [api]);

  const togglePlay = () => {
    const r = run.current;
    if (!r) return;
    if (r.playing) {
      r.playing = false;
      r.token++;
      window.clearTimeout(r.timer);
      // A step drawing in shows in full: nothing is left half drawn on a pause.
      showStep(r, r.index);
      setDrawing(null);
      publish(r);
      return;
    }
    r.playing = true;
    void goTo(r.index >= r.steps.length - 1 ? 0 : r.index + 1);
  };

  const next = () => {
    const r = run.current;
    if (r) void goTo(r.index + 1);
  };

  const prev = () => {
    const r = run.current;
    if (!r) return;
    // Going back stops playing, even at the first step where there is nowhere to go.
    if (r.playing) {
      r.playing = false;
      r.token++;
      window.clearTimeout(r.timer);
      publish(r);
    }
    void goTo(r.index - 1);
  };

  const setDelay = (seconds: number) => {
    setDelayState(seconds);
    saveValue(PRESENT_DELAY_KEY, seconds);
  };

  // Timers never outlive the board: the canvas they would change is gone.
  useEffect(
    () => () => {
      const r = run.current;
      if (r) {
        r.token++;
        window.clearTimeout(r.timer);
      }
      run.current = null;
    },
    [],
  );

  return { view, drawing, delay, start, exit, next, prev, togglePlay, setDelay };
}
