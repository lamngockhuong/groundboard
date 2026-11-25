import { describe, expect, test } from "vitest";
import {
  checkoutScreens,
  exampleNames,
  loadExample,
  parse,
  refScreens,
  syntheticBoard,
  syntheticScreens,
} from "../test/boards.ts";
import { layoutBoard } from "./layout.ts";
import { nodeText } from "./text.ts";
import { CHIP_PREFIX, toElk } from "./to-elk.ts";
import type { LaidOutBoard, LaidOutNode, Point } from "./types.ts";
import { layoutInWorker } from "./worker.ts";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EPS = 1;

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - EPS &&
    b.x < a.x + a.width - EPS &&
    a.y < b.y + b.height - EPS &&
    b.y < a.y + a.height - EPS
  );
}

function inside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.width <= outer.x + outer.width + EPS &&
    inner.y + inner.height <= outer.y + outer.height + EPS
  );
}

function onBorder([px, py]: Point, b: Box): boolean {
  const withinX = px >= b.x - EPS && px <= b.x + b.width + EPS;
  const withinY = py >= b.y - EPS && py <= b.y + b.height + EPS;
  const onVertical = Math.abs(px - b.x) <= EPS || Math.abs(px - (b.x + b.width)) <= EPS;
  const onHorizontal = Math.abs(py - b.y) <= EPS || Math.abs(py - (b.y + b.height)) <= EPS;
  return (onVertical && withinY) || (onHorizontal && withinX);
}

function checkGeometry(laidOut: LaidOutBoard): void {
  const groups = new Map(laidOut.groups.map((g) => [g.id, g]));
  const nodes = new Map(laidOut.nodes.map((n) => [n.id, n]));

  const siblings = new Map<string, Box[]>();
  for (const node of laidOut.nodes) {
    const key = node.groupId ?? "";
    siblings.set(key, [...(siblings.get(key) ?? []), node]);
    if (node.groupId) {
      expect(inside(node, groups.get(node.groupId) as Box), `${node.id} inside its group`).toBe(
        true,
      );
    }
  }
  for (const [key, boxes] of siblings) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i] as Box, boxes[j] as Box), `siblings overlap in ${key}`).toBe(
          false,
        );
      }
    }
  }
  for (const group of laidOut.groups) {
    if (group.parentId) {
      expect(inside(group, groups.get(group.parentId) as Box), `${group.id} inside parent`).toBe(
        true,
      );
    }
  }
  for (const edge of laidOut.edges) {
    expect(edge.points.length).toBeGreaterThanOrEqual(2);
    const start = edge.points[0] as Point;
    const end = edge.points.at(-1) as Point;
    expect(onBorder(start, nodes.get(edge.from) as Box), `${edge.id} starts on ${edge.from}`).toBe(
      true,
    );
    expect(onBorder(end, nodes.get(edge.to) as Box), `${edge.id} ends on ${edge.to}`).toBe(true);
  }
}

describe("layoutBoard", () => {
  test.each(exampleNames)(
    "lays out %s without overlaps, inside groups, edges on borders",
    async (name) => {
      const board = loadExample(name);
      for (const direction of ["right", "down"] as const) {
        const laidOut = await layoutBoard(board, { direction });
        expect(laidOut.nodes).toHaveLength(board.nodes.length);
        expect(laidOut.edges).toHaveLength(board.edges.length);
        checkGeometry(laidOut);
      }
    },
  );

  test.each(exampleNames)("every node's text equals nodeText() for %s", async (name) => {
    const board = loadExample(name);
    const laidOut = await layoutBoard(board);
    for (const node of laidOut.nodes) {
      const source = board.nodes.find((n) => n.id === node.id);
      expect(source).toBeDefined();
      if (source) expect(node.text).toBe(nodeText(source));
    }
  });

  test("is deterministic", async () => {
    const board = loadExample("order-state-machine");
    const a = await layoutBoard(board);
    const b = await layoutBoard(board);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("text fits inside every shape", async () => {
    const laidOut = await layoutBoard(loadExample("checkout-flow"));
    for (const node of laidOut.nodes) {
      expect(node.textWidth).toBeLessThanOrEqual(node.width);
      expect(node.textHeight).toBeLessThanOrEqual(node.height);
    }
  });

  test("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      layoutBoard(loadExample("checkout-flow"), { signal: controller.signal }),
    ).rejects.toThrow();
  });

  // Benchmark (2026-11-18, Node 24.22.3, WSL2, 12 cores): 500 nodes / ~620 edges take about
  // 2.5 s on a cold engine with thoroughness 1 (used above 150 nodes), 5.2 s with thoroughness 2.
  // Wall time; when other test files load the CPU the first attempt can run slow, so one retry
  // is allowed. Each attempt's time is logged.
  test("lays out a 500-node board in under 3 s", { retry: 1, timeout: 20_000 }, async () => {
    const board = syntheticBoard();
    const started = performance.now();
    const laidOut = await layoutBoard(board);
    const elapsed = performance.now() - started;
    console.info(`500-node layout: ${Math.round(elapsed)} ms`);
    expect(laidOut.nodes).toHaveLength(500);
    checkGeometry(laidOut);
    expect(elapsed).toBeLessThan(3000);
  });
});

/**
 * Geometry of a board with screens: frames, chips and other placed nodes do not overlap;
 * every element and its text sit inside its parent and its frame; every route is orthogonal,
 * has at least two points and starts and ends on the borders of its two ends.
 */
function checkScreenGeometry(laidOut: LaidOutBoard): void {
  const nodes = new Map(laidOut.nodes.map((n) => [n.id, n]));
  const placed = laidOut.nodes.filter((n) => n.shape !== "wire");
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i] as LaidOutNode;
      const b = placed[j] as LaidOutNode;
      expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
  for (const node of laidOut.nodes) {
    if (node.shape !== "wire") continue;
    const frame = nodes.get(node.screenId as string) as LaidOutNode;
    const parent = nodes.get(node.parentId as string) as LaidOutNode;
    expect(inside(node, frame), `${node.id} inside its frame`).toBe(true);
    expect(inside(node, parent), `${node.id} inside its parent`).toBe(true);
    const text = {
      x: node.textX as number,
      y: node.textY as number,
      width: node.textWidth,
      height: node.textHeight,
    };
    expect(inside(text, node), `text of ${node.id} inside it`).toBe(true);
    expect(inside(text, frame), `text of ${node.id} inside its frame`).toBe(true);
  }
  for (const edge of laidOut.edges) {
    if (edge.marker !== undefined) {
      expect(edge.points, edge.id).toEqual([]);
      continue;
    }
    expect(edge.points.length, edge.id).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < edge.points.length; i++) {
      const [ax, ay] = edge.points[i - 1] as Point;
      const [bx, by] = edge.points[i] as Point;
      expect(
        Math.abs(ax - bx) < 0.01 || Math.abs(ay - by) < 0.01,
        `${edge.id} segment ${i} is orthogonal`,
      ).toBe(true);
    }
    const start = edge.points[0] as Point;
    const end = edge.points.at(-1) as Point;
    expect(onBorder(start, nodes.get(edge.from) as Box), `${edge.id} starts on ${edge.from}`).toBe(
      true,
    );
    expect(onBorder(end, nodes.get(edge.to) as Box), `${edge.id} ends on ${edge.to}`).toBe(true);
  }
}

describe("layoutBoard with screens", () => {
  test("places frames and elements, marks toRef edges, and routes every other edge", async () => {
    const board = checkoutScreens();
    for (const direction of ["right", "down"] as const) {
      const laidOut = await layoutBoard(board, { direction });
      expect(laidOut.nodes.filter((n) => n.shape === "chip")).toEqual([]);
      expect(laidOut.nodes).toHaveLength(board.nodes.length);
      expect(laidOut.edges).toHaveLength(board.edges.length);
      const toCart = laidOut.edges.find((e) => e.id === "to-cart");
      expect(toCart?.toRef).toBe("web:cart");
      expect(toCart?.points).toEqual([]);
      // The frame's own edge comes first, then the element's.
      expect(toCart?.marker).toMatchObject({ number: 2, screenId: "checkout" });
      expect(toCart?.marker?.line.text).toBe("2 → web:cart");
      const fromFrame = laidOut.edges.find((e) => e.id === "screen-cart");
      expect(fromFrame?.marker?.number).toBe(1);
      const pay = laidOut.nodes.find((n) => n.id === "pay");
      expect(pay).toMatchObject({
        shape: "wire",
        role: "button",
        screenId: "checkout",
        parentId: "form",
        ref: "web:checkout/pay-button",
      });
      checkScreenGeometry(laidOut);
    }
  });

  test("routes in-screen edges outside ELK, around the right of the frame", async () => {
    const laidOut = await layoutBoard(checkoutScreens());
    const frame = laidOut.nodes.find((n) => n.id === "checkout") as LaidOutNode;
    for (const id of ["terms-pay", "pay-self"]) {
      const edge = laidOut.edges.find((e) => e.id === id);
      expect(edge?.points).toHaveLength(4);
      expect(edge?.points[1]?.[0]).toBe(frame.x + frame.width + 16);
    }
    const label = laidOut.edges.find((e) => e.id === "terms-pay")?.label;
    expect(label?.text).toBe("enables");
  });

  test("is deterministic", async () => {
    const a = await layoutBoard(checkoutScreens());
    const b = await layoutBoard(checkoutScreens());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  // Benchmarks within the 500-node limit: 19 screens of 25 elements (494 nodes) in a worker,
  // and 40 screens with 80 cross-screen edges. Elements never reach ELK, so both stay small.
  test("lays out 19 screens of 25 elements in a worker in under 3 s", {
    retry: 1,
    timeout: 20_000,
  }, async () => {
    const board = syntheticScreens(19, 25);
    expect(board.nodes.length).toBe(494);
    const started = performance.now();
    const laidOut = await layoutInWorker(board, { timeoutMs: 10_000 });
    const elapsed = performance.now() - started;
    console.info(`19x25 screen layout in worker: ${Math.round(elapsed)} ms`);
    checkScreenGeometry(laidOut);
    expect(elapsed).toBeLessThan(3000);
  });

  test("lays out 40 screens with 80 cross-screen edges in under 3 s", {
    retry: 1,
    timeout: 20_000,
  }, async () => {
    const board = syntheticScreens(40, 6, 80);
    const started = performance.now();
    const laidOut = await layoutBoard(board);
    const elapsed = performance.now() - started;
    console.info(`40-screen layout: ${Math.round(elapsed)} ms`);
    checkScreenGeometry(laidOut);
    expect(elapsed).toBeLessThan(3000);
  });
});

describe("toRef edges on a screen board", () => {
  const markersOf = (laidOut: LaidOutBoard, screenId: string) =>
    laidOut.edges
      .filter((e) => e.marker?.screenId === screenId)
      .sort((a, b) => (a.marker?.number ?? 0) - (b.marker?.number ?? 0));

  test("numbers the tags in visual order and lists the targets in that order beside the frame", async () => {
    for (const direction of ["right", "down"] as const) {
      const laidOut = await layoutBoard(refScreens(), { direction });
      checkScreenGeometry(laidOut);
      expect(laidOut.nodes.filter((n) => n.shape === "chip")).toEqual([]);
      const frame = laidOut.nodes.find((n) => n.id === "list") as LaidOutNode;
      const edges = markersOf(laidOut, "list");
      expect(edges.map((e) => e.id)).toEqual([
        "to-dashboard",
        "to-notifications",
        "to-profile",
        "to-login",
      ]);
      expect(edges.map((e) => e.marker?.line.text)).toEqual([
        "1 → web:dashboard",
        "2 click → web:notifications",
        "3 Profile → web:profile",
        "4 Log out → web:login",
      ]);
      const lines = edges.map((e) => e.marker?.line as Box);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] as Box;
        expect(line.x).toBeGreaterThan(frame.x + frame.width);
        if (i > 0) expect(line.y).toBeGreaterThanOrEqual((lines[i - 1] as Box).y + 18);
        for (let j = i + 1; j < lines.length; j++)
          expect(overlaps(line, lines[j] as Box)).toBe(false);
      }
      // Tags rise left to right with their sources, each on its element's top-right corner.
      const tags = edges.map((e) => e.marker?.tag as Box);
      for (let i = 1; i < tags.length; i++)
        expect((tags[i] as Box).x).toBeGreaterThan((tags[i - 1] as Box).x);
      for (const edge of edges) {
        const node = laidOut.nodes.find((n) => n.id === edge.from) as LaidOutNode;
        // A link is drawn as bare text: its tag goes on the text.
        const source =
          node.role === "link"
            ? { x: node.textX as number, y: node.textY as number, width: node.textWidth }
            : node;
        const tag = edge.marker?.tag as Box;
        expect(tag.y).toBeLessThan(source.y);
        expect(tag.y + tag.height).toBeGreaterThan(source.y);
        expect(tag.x + tag.width).toBeGreaterThan(source.x + source.width - 40);
        expect(tag.x + tag.width).toBeLessThanOrEqual(source.x + source.width + 6);
      }
    }
  });

  test("wraps a long label but never breaks the target ref", async () => {
    const board = refScreens();
    const edge = board.edges.find((e) => e.id === "to-login") as (typeof board.edges)[number];
    edge.toRef = "web:administration-document-archive-settings";
    edge.label = "signs the user out and returns to the login page";
    const laidOut = await layoutBoard(board);
    const line = laidOut.edges.find((e) => e.id === "to-login")?.marker?.line;
    const rows = line?.text.split("\n") ?? [];
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]).toMatch(/^4 signs/);
    expect(rows.at(-1)).toMatch(/ → web:administration-document-archive-settings$/);
  });

  test("puts the tags of one element with two edges side by side", async () => {
    const laidOut = await layoutBoard(refScreens());
    const profile = laidOut.edges.find((e) => e.id === "to-profile")?.marker?.tag as Box;
    const login = laidOut.edges.find((e) => e.id === "to-login")?.marker?.tag as Box;
    expect(login.y).toBe(profile.y);
    expect(login.x).toBeGreaterThanOrEqual(profile.x + profile.width);
    expect(overlaps(profile, login)).toBe(false);
  });

  test("gives an edge out of a state frame its own tag and list, and the family no port", async () => {
    const board = refScreens();
    const laidOut = await layoutBoard(board);
    const empty = laidOut.nodes.find((n) => n.id === "empty") as LaidOutNode;
    const edge = laidOut.edges.find((e) => e.id === "to-new");
    expect(edge?.marker).toMatchObject({ number: 1, screenId: "empty" });
    expect(edge?.marker?.line.x).toBeGreaterThan(empty.x + empty.width);
    const family = toElk(board, "right").families.get("list");
    expect([...(family?.ports.keys() ?? [])]).toEqual(["to-detail"]);
  });

  test("reserves the list's room, so no frame, element or arrow lands on it", async () => {
    for (const direction of ["right", "down"] as const) {
      const laidOut = await layoutBoard(refScreens(), { direction });
      const lines = laidOut.edges.flatMap((e) =>
        e.marker === undefined ? [] : [{ id: e.id, ...e.marker.line }],
      );
      expect(lines).toHaveLength(5);
      for (const line of lines) {
        for (const node of laidOut.nodes) {
          expect(overlaps(line, node), `${line.id} on ${node.id}`).toBe(false);
        }
        expect(line.x + line.width).toBeLessThanOrEqual(laidOut.width);
        expect(line.y + line.height).toBeLessThanOrEqual(laidOut.height);
        for (const edge of laidOut.edges) {
          for (let i = 1; i < edge.points.length; i++) {
            const [ax, ay] = edge.points[i - 1] as Point;
            const [bx, by] = edge.points[i] as Point;
            const segment = {
              x: Math.min(ax, bx),
              y: Math.min(ay, by),
              width: Math.abs(ax - bx) + 2,
              height: Math.abs(ay - by) + 2,
            };
            expect(overlaps(segment, line), `${edge.id} crosses ${line.id}`).toBe(false);
          }
        }
      }
    }
  });

  test("keeps a plain frame's list clear, and its arrows on the frame, in both directions", async () => {
    const board = checkoutScreens();
    // The frame itself navigates on the board and is reached from it, besides its markers.
    board.edges.push(
      { id: "frame-done", from: "checkout", to: "done", kind: "navigates", sourceIds: ["nav"] },
      { id: "done-frame", from: "done", to: "checkout", kind: "navigates", sourceIds: ["nav"] },
    );
    for (const direction of ["right", "down"] as const) {
      const laidOut = await layoutBoard(board, { direction });
      checkScreenGeometry(laidOut);
      const lines = laidOut.edges.flatMap((e) => (e.marker ? [e.marker.line] : []));
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        for (const node of laidOut.nodes)
          expect(overlaps(line, node), `list on ${node.id} (${direction})`).toBe(false);
        expect(line.x + line.width).toBeLessThanOrEqual(laidOut.width);
      }
      for (const edge of laidOut.edges) {
        const id = edge.id;
        for (let i = 1; i < edge.points.length; i++) {
          const [ax, ay] = edge.points[i - 1] as Point;
          const [bx, by] = edge.points[i] as Point;
          const segment = {
            x: Math.min(ax, bx),
            y: Math.min(ay, by),
            width: Math.abs(ax - bx) + 2,
            height: Math.abs(ay - by) + 2,
          };
          for (const line of lines)
            expect(overlaps(segment, line), `${id} crosses the list (${direction})`).toBe(false);
        }
      }
    }
  });

  test("keeps the chip and the arrow on an overview board, where screens have no elements", async () => {
    const screen = (id: string) => ({
      id,
      kind: "screen",
      label: id,
      ref: `web:${id}`,
      platform: "web",
      layoutFrom: "code",
      sourceIds: ["route"],
    });
    const board = parse({
      schemaVersion: 1,
      title: "Overview",
      question: "Which screens are there?",
      nodes: [screen("home"), screen("cart")],
      edges: [
        { id: "a", from: "home", to: "cart", kind: "navigates", sourceIds: ["route"] },
        { id: "b", from: "cart", toRef: "web:pay", kind: "navigates", sourceIds: ["route"] },
      ],
      sources: [{ id: "route", path: "src/routes.tsx", line: 1, quote: "routes" }],
    });
    const laidOut = await layoutBoard(board);
    expect(laidOut.nodes.map((n) => n.id)).toEqual(["home", "cart", `${CHIP_PREFIX}web:pay`]);
    const edge = laidOut.edges.find((e) => e.id === "b");
    expect(edge?.marker).toBeUndefined();
    expect(edge?.to).toBe(`${CHIP_PREFIX}web:pay`);
    checkScreenGeometry(laidOut);
  });
});

describe("overview screens", () => {
  const overview = () => {
    const screen = (id: string, groupId?: string) => ({
      id,
      kind: "screen",
      label: `/${id}`,
      ref: `web:${id}`,
      platform: "web",
      layoutFrom: "code",
      sourceIds: ["route"],
      ...(groupId ? { groupId } : {}),
    });
    return parse({
      schemaVersion: 1,
      title: "Screens",
      question: "Which screens are there?",
      groups: [
        { id: "admin", label: "admin" },
        { id: "admin-reports", label: "reports", parentId: "admin" },
      ],
      nodes: [
        screen("login"),
        screen("dashboard", "admin"),
        screen("users", "admin"),
        screen("report", "admin-reports"),
      ],
      edges: [
        { id: "e1", from: "login", to: "dashboard", kind: "navigates", sourceIds: ["nav"] },
        { id: "e2", from: "dashboard", to: "users", kind: "navigates", sourceIds: ["nav"] },
        { id: "e3", from: "dashboard", to: "report", kind: "navigates", sourceIds: ["nav"] },
      ],
      sources: [
        { id: "route", path: "src/routes.tsx", line: 3, quote: "createRoute" },
        { id: "nav", path: "src/nav.tsx", line: 8, quote: "navigate(" },
      ],
    });
  };

  test("draws a screen with no elements as a box holding only its label, inside its group", async () => {
    const laidOut = await layoutBoard(overview());
    checkGeometry(laidOut);
    for (const node of laidOut.nodes) {
      expect(node.shape, node.id).toBe("rectangle");
      expect(node.text, node.id).toBe(`/${node.id}`);
      expect(node.ref, node.id).toBe(`web:${node.id}`);
    }
    const report = laidOut.nodes.find((n) => n.id === "report");
    expect(report?.groupId).toBe("admin-reports");
  });
});
