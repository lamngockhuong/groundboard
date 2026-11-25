import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/**
 * A number that grows whenever an element of the scene changes: Excalidraw raises an element's
 * version on every change, deleting it included, and a new element adds its own.
 */
export function sceneVersion(elements: readonly { version: number }[]): number {
  let sum = 0;
  for (const element of elements) sum += element.version;
  return sum;
}

/** How long after the last pointer or key on the canvas a change still counts as the reader's. */
const GESTURE_MS = 1000;

/** Whether an event reached Excalidraw itself, not a panel or a control laid over the canvas. */
function onExcalidraw(event: Event): boolean {
  return event.target instanceof Element && event.target.closest(".excalidraw") !== null;
}

/**
 * Outside edit mode the canvas still lets a reader drag, draw and type, which nothing saves.
 * This tells those changes apart from the viewer's own (reading font, hidden layers, a
 * presentation): only a change that follows a pointer or a key on the canvas counts. While
 * `tracking` is false (editing, presenting) nothing counts and the state is cleared.
 */
export function useCanvasChanges(
  api: ExcalidrawImperativeAPI | null,
  root: RefObject<HTMLElement | null>,
  tracking: boolean,
) {
  const [unsaved, setUnsaved] = useState(false);
  const unsavedRef = useRef(false);
  const trackingRef = useRef(tracking);
  trackingRef.current = tracking;
  /** Until when a change counts as the reader's. */
  const until = useRef(0);
  /** The scene version when the current gesture started. */
  const before = useRef(0);
  /** A copy of the scene before the reader's first change: Excalidraw changes elements in place. */
  const pristine = useRef<ExcalidrawElement[] | null>(null);

  const mark = useCallback((next: boolean) => {
    unsavedRef.current = next;
    setUnsaved(next);
  }, []);

  useEffect(() => {
    if (tracking) return;
    until.current = 0;
    pristine.current = null;
    mark(false);
  }, [tracking, mark]);

  /** A pointer or key on the canvas: opens, or extends, the window in which changes count. */
  const touch = useCallback(
    (event: Event) => {
      if (!api || !trackingRef.current || !onExcalidraw(event)) return;
      const now = performance.now();
      if (now >= until.current) {
        const elements = api.getSceneElementsIncludingDeleted();
        before.current = sceneVersion(elements);
        if (!unsavedRef.current) pristine.current = structuredClone([...elements]);
      }
      until.current = now + GESTURE_MS;
    },
    [api],
  );

  useEffect(() => {
    const element = api ? root.current : null;
    if (!element) return;
    const events = ["pointerdown", "pointerup", "keydown", "keyup", "paste", "drop"] as const;
    for (const type of events) element.addEventListener(type, touch, true);
    return () => {
      for (const type of events) element.removeEventListener(type, touch, true);
    };
  }, [api, root, touch]);

  /** Called from Excalidraw's onChange. */
  const check = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      if (!trackingRef.current || unsavedRef.current) return;
      if (performance.now() >= until.current) return;
      if (sceneVersion(elements) !== before.current) mark(true);
    },
    [mark],
  );

  /**
   * Puts back the scene from before the reader's first change, passed through `prepare` so the
   * layers, design images and reading font chosen since still apply.
   */
  const discard = useCallback(
    (prepare: (elements: readonly ExcalidrawElement[]) => readonly ExcalidrawElement[]) => {
      if (!api || !pristine.current) return;
      api.updateScene({
        elements: prepare(pristine.current),
        appState: { selectedElementIds: {} } as never,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      // Excalidraw's undo would otherwise bring the discarded changes back.
      api.history.clear();
      until.current = 0;
      pristine.current = null;
      mark(false);
    },
    [api, mark],
  );

  return { unsaved, check, discard };
}
