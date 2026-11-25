import { readFileSync } from "node:fs";
import path from "node:path";
import { type Board, parseBoard } from "@groundboard/schema";
import { describe, expect, test } from "vitest";
import { layoutBoard } from "./layout.ts";
import { centreSegment, placeFamily, segmentCentre } from "./screen-states.ts";
import type { LaidOutBoard, LaidOutEdge, Point } from "./types.ts";

const fixture = path.resolve(
  import.meta.dirname,
  "../../../examples/fixtures/states/.groundboard/web--users-upload.board.json",
);

function loadFixture(): Board {
  const result = parseBoard(JSON.parse(readFileSync(fixture, "utf8")));
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Box, b: Box, eps = 1) =>
  a.x < b.x + b.width - eps &&
  b.x < a.x + a.width - eps &&
  a.y < b.y + b.height - eps &&
  b.y < a.y + a.height - eps;

type Segment = [Point, Point];
const segments = (edge: LaidOutEdge): Segment[] =>
  edge.points.slice(1).map((p, i) => [edge.points[i] as Point, p]);

/** Whether two axis-parallel segments lie on one line and share more than a point. */
function sharesRun([a, b]: Segment, [c, d]: Segment): boolean {
  if (a[1] === b[1] && c[1] === d[1] && a[1] === c[1]) {
    const lo = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]));
    const hi = Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]));
    return hi - lo > 1;
  }
  if (a[0] === b[0] && c[0] === d[0] && a[0] === c[0]) {
    const lo = Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]));
    const hi = Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
    return hi - lo > 1;
  }
  return false;
}

/** Whether a segment passes through the inside of a box (not just along its border). */
function crossesInside([a, b]: Segment, box: Box): boolean {
  const seg: Box = {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    width: Math.abs(a[0] - b[0]),
    height: Math.abs(a[1] - b[1]),
  };
  const inner = { x: box.x + 2, y: box.y + 2, width: box.width - 4, height: box.height - 4 };
  return (
    seg.x <= inner.x + inner.width &&
    inner.x <= seg.x + seg.width &&
    seg.y <= inner.y + inner.height &&
    inner.y <= seg.y + seg.height
  );
}

describe("placeFamily", () => {
  test("follows the first transition out of each frame, and puts branches on a second row", () => {
    const placement = placeFamily(
      ["a", "b", "c", "d", "x", "y"],
      [
        { fromFrame: "a", toFrame: "b" },
        { fromFrame: "b", toFrame: "c" },
        { fromFrame: "b", toFrame: "x" },
        { fromFrame: "b", toFrame: "y" },
        { fromFrame: "c", toFrame: "d" },
        { fromFrame: "x", toFrame: "a" },
      ],
    );
    expect(Object.fromEntries(placement)).toEqual({
      a: { row: 0, col: 0 },
      b: { row: 0, col: 1 },
      c: { row: 0, col: 2 },
      d: { row: 0, col: 3 },
      x: { row: 1, col: 2 },
      y: { row: 1, col: 3 },
    });
  });

  test("puts a state no transition reaches at the end of the second row", () => {
    const placement = placeFamily(["a", "b", "z"], [{ fromFrame: "a", toFrame: "b" }]);
    expect(placement.get("z")).toEqual({ row: 1, col: 0 });
  });
});

describe("centreSegment", () => {
  test("splits segments so the chosen one is in the middle, without moving the route", () => {
    const route: Point[] = [
      [0, 0],
      [10, 0],
      [10, 50],
      [100, 50],
    ];
    const centred = centreSegment(route, 0);
    expect(segmentCentre(centred)).toEqual([5, 0]);
    expect(centred[0]).toEqual([0, 0]);
    expect(centred.at(-1)).toEqual([100, 50]);
    expect(segmentCentre(centreSegment(route, 2))).toEqual([55, 50]);
  });
});

describe("a screen with states", () => {
  let laidOut: LaidOutBoard;
  let board: Board;
  const frame = (id: string) => laidOut.nodes.find((n) => n.id === id) as Box & { id: string };

  test("lays out", async () => {
    board = loadFixture();
    laidOut = await layoutBoard(board);
    expect(laidOut.nodes.filter((n) => n.shape === "frame")).toHaveLength(8);
  });

  test("draws the main path left to right in one row, and branches below", () => {
    const main = ["upload", "validating", "confirm", "dialog", "executing", "complete"].map(frame);
    for (let i = 1; i < main.length; i++) {
      const left = main[i - 1] as Box;
      const right = main[i] as Box;
      expect(right.y).toBe(left.y);
      expect(right.x).toBeGreaterThan(left.x + left.width);
    }
    const validating = frame("validating");
    for (const branch of [frame("errors"), frame("mismatch")]) {
      expect(branch.y).toBeGreaterThan(Math.max(...main.map((f) => f.y + f.height)));
      expect(branch.x).toBeGreaterThan(validating.x + validating.width);
    }
  });

  test("gives every frame the platform's full width, and no two frames overlap", () => {
    const frames = laidOut.nodes.filter((n) => n.shape === "frame");
    for (const f of frames) expect(f.width).toBe(960);
    for (const a of frames) {
      for (const b of frames) if (a !== b) expect(overlaps(a, b), `${a.id} ${b.id}`).toBe(false);
    }
  });

  test("gives every frame the root's width when the root sets one", async () => {
    const input = JSON.parse(readFileSync(fixture, "utf8"));
    input.nodes[0].width = 1280;
    const result = parseBoard(input);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const wide = await layoutBoard(result.value);
    const frames = wide.nodes.filter((n) => n.shape === "frame");
    expect(frames).toHaveLength(8);
    for (const f of frames) expect(f.width, f.id).toBe(1280);
    for (const a of frames) {
      for (const b of frames) if (a !== b) expect(overlaps(a, b), `${a.id} ${b.id}`).toBe(false);
    }
  });

  test("routes every transition orthogonally, with no run shared by two arrows", () => {
    const transitions = laidOut.edges.filter((e) => e.kind === "transition");
    expect(transitions).toHaveLength(13);
    for (const edge of laidOut.edges) {
      for (const [a, b] of segments(edge)) {
        expect(a[0] === b[0] || a[1] === b[1], `${edge.id} is not orthogonal`).toBe(true);
      }
    }
    for (const e1 of laidOut.edges) {
      for (const e2 of laidOut.edges) {
        if (e1.id >= e2.id) continue;
        for (const s1 of segments(e1)) {
          for (const s2 of segments(e2)) {
            expect(sharesRun(s1, s2), `${e1.id} and ${e2.id} share a run`).toBe(false);
          }
        }
      }
    }
  });

  test("starts each arrow at its control and crosses no other element", () => {
    const parentOf = new Map(board.nodes.map((n) => [n.id, n.parentId]));
    const lineage = (id: string) => {
      const out = new Set([id]);
      for (let p = parentOf.get(id); p !== undefined; p = parentOf.get(p)) out.add(p);
      return out;
    };
    const wires = laidOut.nodes.filter((n) => n.shape === "wire");
    for (const edge of laidOut.edges) {
      const own = new Set([...lineage(edge.from), ...lineage(edge.to)]);
      for (const segment of segments(edge)) {
        for (const wire of wires) {
          if (own.has(wire.id)) continue;
          expect(crossesInside(segment, wire), `${edge.id} crosses ${wire.id}`).toBe(false);
        }
      }
    }
  });

  test("puts labels where Excalidraw centres them, clear of each other and of the frames", () => {
    const labelled = laidOut.edges.filter((e) => e.label !== undefined && e.kind === "transition");
    expect(labelled).toHaveLength(13);
    const boxes = labelled.map((e) => ({ id: e.id, ...(e.label as Box) }));
    for (const edge of labelled) {
      const [cx, cy] = segmentCentre(edge.points);
      const label = edge.label as Box;
      expect(Math.abs(label.x + label.width / 2 - cx)).toBeLessThan(1);
      expect(Math.abs(label.y + label.height / 2 - cy)).toBeLessThan(1);
    }
    for (const a of boxes) {
      for (const b of boxes) {
        if (a.id < b.id) expect(overlaps(a, b), `labels ${a.id} ${b.id}`).toBe(false);
      }
      for (const f of laidOut.nodes.filter((n) => n.shape === "frame")) {
        expect(overlaps(a, f), `label ${a.id} on frame ${f.id}`).toBe(false);
      }
    }
  });
});
