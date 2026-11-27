import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";
import { type FlowHintBox, flowHintBoxes } from "../flow-hints.ts";

interface FlowHintOverlayProps {
  api: ExcalidrawImperativeAPI | null;
  /** Refs of elements that call an API or change state with no flow yet. */
  missing: ReadonlySet<string>;
  /** The layer is off, or the board is being presented: no marks. */
  hidden: boolean;
}

/** Size of a mark, in screen pixels, and how far it sits outside the element's corner. */
const MARK = 12;
const OUTSET = 4;

interface Mark {
  id: string;
  x: number;
  y: number;
}

/** A cheap fingerprint of the scene: Excalidraw bumps an element's version when it moves. */
function sceneKey(elements: readonly { version: number }[]): number {
  let sum = elements.length;
  for (const el of elements) sum += el.version;
  return sum;
}

/**
 * Small marks at the top-right corner of every element that has no flow yet, drawn over the
 * canvas like the motion layer. They live outside the scene, so they are never saved, undone
 * or exported; the source panel says the same in words, so the marks are hidden from screen
 * readers.
 */
export function FlowHintOverlay({ api, missing, hidden }: FlowHintOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const props = useRef({ missing, hidden });
  props.current = { missing, hidden };
  const cache = useRef<{
    elements: unknown;
    key: number;
    missing: ReadonlySet<string>;
    boxes: FlowHintBox[];
  } | null>(null);
  const last = useRef("");
  const schedule = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!api) return;
    let pending = 0;
    const draw = () => {
      pending = 0;
      const root = rootRef.current;
      if (!root) return;
      const { missing, hidden } = props.current;
      const next: Mark[] = [];
      if (!hidden && missing.size > 0) {
        const elements = api.getSceneElements();
        const key = sceneKey(elements);
        const c = cache.current;
        if (c?.elements !== elements || c.key !== key || c.missing !== missing) {
          cache.current = { elements, key, missing, boxes: flowHintBoxes(elements, missing) };
        }
        const state = api.getAppState();
        const rect = root.getBoundingClientRect();
        const zoom = state.zoom.value;
        const dx = state.offsetLeft - rect.left;
        const dy = state.offsetTop - rect.top;
        for (const box of cache.current?.boxes ?? []) {
          const x = Math.round((box.x + box.width + state.scrollX) * zoom + dx - MARK + OUTSET);
          const y = Math.round((box.y + state.scrollY) * zoom + dy - OUTSET);
          // Only the marks in view.
          if (x < -MARK || y < -MARK || x > rect.width || y > rect.height) continue;
          next.push({ id: box.nodeId, x, y });
        }
      }
      const text = JSON.stringify(next);
      if (text === last.current) return;
      last.current = text;
      setMarks(next);
    };
    schedule.current = () => {
      if (pending === 0) pending = requestAnimationFrame(draw);
    };
    schedule.current();
    const unsubscribe = api.onChange(() => schedule.current());
    return () => {
      unsubscribe();
      cancelAnimationFrame(pending);
      schedule.current = () => undefined;
    };
  }, [api]);

  // Props are read on the next frame; a change of them alone draws again too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each listed prop is a trigger to draw.
  useEffect(() => schedule.current(), [missing, hidden]);

  return (
    <div ref={rootRef} className="flow-hint-overlay" aria-hidden="true">
      {marks.map((m) => (
        <span
          key={m.id}
          className="flow-hint-mark"
          data-node-id={m.id}
          style={{ left: m.x, top: m.y, width: MARK, height: MARK }}
        />
      ))}
    </div>
  );
}
