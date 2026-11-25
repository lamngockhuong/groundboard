import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
  arrowsTouching,
  type Box,
  intersects,
  type MotionArrow,
  type MotionGraph,
  readMotionGraph,
} from "../motion-graph.ts";

/** How long one arrow takes to draw while presenting, and the gap before the next starts. */
export const DRAW_MS = 450;
export const DRAW_STAGGER_MS = 150;
/** The time to draw `count` arrows one after another. */
export const drawDuration = (count: number) =>
  count === 0 ? 0 : DRAW_MS + (count - 1) * DRAW_STAGGER_MS;

/** Glow kept around a node, in screen pixels. */
const GLOW_PAD = 4;

export type MotionMode = "selection" | "all" | "off";

interface MotionOverlayProps {
  api: ExcalidrawImperativeAPI | null;
  /** Which arrows run: those of the selection, every arrow in view, or none. */
  mode: MotionMode;
  selection: { nodes: readonly string[]; edges: readonly string[] };
  /** The arrows layer is hidden: nothing runs. */
  arrowsHidden: boolean;
  /** Arrows drawn in for a presentation step; a new `seq` draws them again from the start. */
  drawing?: { arrows: readonly MotionArrow[]; seq: number } | null;
}

interface Frame {
  flows: Array<{ id: string; d: string }>;
  glows: Array<{ id: string } & Box>;
  draws: Array<{ id: string; d: string }>;
}

const EMPTY: Frame = { flows: [], glows: [], draws: [] };

/**
 * A cheap fingerprint of the scene's elements, which Excalidraw moves in place (a drag bumps
 * the version). A scene put in whole is a new array, so the array itself is compared too: a
 * render may hand over elements whose versions add up to the same sum.
 */
function sceneKey(elements: readonly { version: number }[]): number {
  let sum = elements.length;
  for (const el of elements) sum += el.version;
  return sum;
}

/**
 * A layer of SVG over the canvas that runs dashes along arrows in the direction of the flow
 * and lights up the nodes at their ends. Excalidraw draws the board on a canvas, so the motion
 * lives here, outside the scene: nothing on it is ever saved or undone. Paths are kept in
 * screen pixels, so dashes run at the same speed at any zoom.
 */
export function MotionOverlay({
  api,
  mode,
  selection,
  arrowsHidden,
  drawing = null,
}: MotionOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [frame, setFrame] = useState<Frame>(EMPTY);
  const props = useRef({ mode, selection, arrowsHidden, drawing });
  props.current = { mode, selection, arrowsHidden, drawing };
  const cache = useRef<{ elements: unknown; key: number; graph: MotionGraph } | null>(null);
  const lastFrame = useRef("");
  const schedule = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!api) return;
    let pending = 0;
    const draw = () => {
      pending = 0;
      const svg = svgRef.current;
      if (!svg) return;
      const { mode, selection, arrowsHidden, drawing } = props.current;
      const state = api.getAppState();
      const rect = svg.getBoundingClientRect();
      const zoom = state.zoom.value;
      const dx = state.offsetLeft - rect.left;
      const dy = state.offsetTop - rect.top;
      const sx = (x: number) => Math.round(((x + state.scrollX) * zoom + dx) * 10) / 10;
      const sy = (y: number) => Math.round(((y + state.scrollY) * zoom + dy) * 10) / 10;
      const pathOf = (arrow: MotionArrow) =>
        `M${arrow.points.map(([x, y]) => `${sx(x)} ${sy(y)}`).join(" L")}`;

      let flows: Frame["flows"] = [];
      let glows: Frame["glows"] = [];
      const idle = mode === "selection" && selection.nodes.length + selection.edges.length === 0;
      if (mode !== "off" && !arrowsHidden && !idle) {
        const elements = api.getSceneElements();
        const key = sceneKey(elements);
        if (cache.current?.elements !== elements || cache.current.key !== key) {
          cache.current = { elements, key, graph: readMotionGraph(elements, { owners: false }) };
        }
        const graph = cache.current.graph;
        const touching = arrowsTouching(graph, selection.nodes, selection.edges);
        const view = {
          x: -state.scrollX,
          y: -state.scrollY,
          width: state.width / zoom,
          height: state.height / zoom,
        };
        const running =
          mode === "all" ? graph.arrows.filter((a) => intersects(a.box, view)) : touching.arrows;
        flows = running.map((a) => ({ id: a.id, d: pathOf(a) }));
        glows = touching.nodes.map((n) => ({
          id: n.id,
          x: sx(n.box.x) - GLOW_PAD,
          y: sy(n.box.y) - GLOW_PAD,
          width: n.box.width * zoom + GLOW_PAD * 2,
          height: n.box.height * zoom + GLOW_PAD * 2,
        }));
      }
      const draws = (drawing?.arrows ?? []).map((a) => ({
        id: `${drawing?.seq}:${a.id}`,
        d: pathOf(a),
      }));
      const next = { flows, glows, draws };
      const text = JSON.stringify(next);
      if (text === lastFrame.current) return;
      lastFrame.current = text;
      setFrame(next);
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
  useEffect(() => schedule.current(), [mode, selection, arrowsHidden, drawing]);

  return (
    <svg ref={svgRef} className="motion-overlay" aria-hidden="true" focusable="false">
      {frame.glows.map((g) => (
        <rect
          key={g.id}
          className="motion-glow"
          x={g.x}
          y={g.y}
          width={g.width}
          height={g.height}
          rx={6}
        />
      ))}
      {frame.flows.map((f) => (
        <path key={f.id} className="motion-flow" d={f.d} />
      ))}
      {frame.draws.map((f, i) => (
        <path
          key={f.id}
          className="motion-draw"
          d={f.d}
          pathLength={1}
          style={{ "--motion-i": i } as CSSProperties}
        />
      ))}
    </svg>
  );
}
