import { readFileSync } from "node:fs";
import path from "node:path";
import type { BoardInput } from "@groundboard/schema";
import { describe, expect, test } from "vitest";
import { parse, repoRoot, syntheticScreens } from "../test/boards.ts";
import { measureText } from "./measure.ts";
import { childrenByParent, EMPTY_SCREEN_SIZE, layoutScreen, type WireBox } from "./wireframe.ts";

function screenWith(
  nodes: BoardInput["nodes"],
  platform: "web" | "mobile" = "web",
  direction?: "row",
  screenExtra: Record<string, unknown> = {},
) {
  const board = parse({
    schemaVersion: 1,
    title: "t",
    question: "q",
    nodes: [
      {
        id: "s",
        kind: "screen",
        label: "S",
        ref: `${platform}:s`,
        platform,
        layoutFrom: "screenshot",
        sourceIds: ["src"],
        ...(direction ? { direction } : {}),
        ...screenExtra,
      },
      ...nodes,
    ],
    sources: [{ id: "src", path: "src/routes.tsx", line: 4, quote: "s" }],
  });
  const screen = board.nodes[0] as (typeof board.nodes)[number];
  return { board, layout: layoutScreen(screen, childrenByParent(board)) };
}

const el = (id: string, role: string, parentId = "s", extra: Record<string, unknown> = {}) => ({
  id,
  kind: "element" as const,
  role: role as "text",
  label: id,
  parentId,
  ...(["button", "input", "checkbox", "link"].includes(role) ? { unresolved: "Frontend" } : {}),
  ...extra,
});

function boxes(list: WireBox[]) {
  return new Map(list.map((b) => [b.id, b]));
}

function inside(
  inner: { x: number; y: number; width: number; height: number },
  outer: typeof inner,
) {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

describe("layoutScreen", () => {
  test("stacks a column top to bottom at full inner width, in board order", () => {
    const { layout } = screenWith([el("a", "bar"), el("b", "text"), el("c", "bar")]);
    const [a, b, c] = layout.boxes as [WireBox, WireBox, WireBox];
    expect(layout.boxes.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(a.width).toBe(960 - 24);
    expect(a.height).toBe(56);
    expect(b.y).toBe(a.y + a.height + 8);
    expect(c.y).toBeGreaterThan(b.y + b.height);
    expect(layout.height).toBe(c.y + c.height + 12);
  });

  test("splits a row evenly and gives the row its tallest child's height", () => {
    const { layout } = screenWith(
      [el("a", "button"), el("b", "image"), el("c", "input")],
      "web",
      "row",
    );
    const all = boxes(layout.boxes);
    const a = all.get("a") as WireBox;
    const b = all.get("b") as WireBox;
    expect(a.width).toBeCloseTo((936 - 16) / 3, 1);
    expect(b.x).toBeCloseTo(a.x + a.width + 8, 1);
    expect(a.y).toBe(b.y);
    expect(b.height).toBe(64); // an image in a row is shorter than a stacked one
    expect(layout.height).toBe(12 + 64 + 12);
  });

  test("nests three levels and keeps every box and its text inside its parent and the screen", () => {
    const { layout } = screenWith([
      el("card", "container"),
      el("inner", "container", "card", { direction: "row" }),
      el("deep", "container", "inner"),
      el("leaf", "button", "deep"),
      el("side", "text", "inner"),
    ]);
    const all = boxes(layout.boxes);
    const screen = { x: 0, y: 0, width: layout.width, height: layout.height };
    for (const [id, parent] of [
      ["inner", "card"],
      ["deep", "inner"],
      ["leaf", "deep"],
      ["side", "inner"],
    ] as const) {
      expect(inside(all.get(id) as WireBox, all.get(parent) as WireBox), `${id} in ${parent}`).toBe(
        true,
      );
    }
    for (const box of layout.boxes) {
      expect(inside(box, screen)).toBe(true);
      const text = { x: box.textX, y: box.textY, width: box.textWidth, height: box.textHeight };
      expect(inside(text, box), `text of ${box.id}`).toBe(true);
    }
  });

  test("wraps long labels in a row of four buttons on mobile and grows the boxes to fit", () => {
    const label = "Add this product to the wish list for later";
    const { layout } = screenWith(
      [
        el("row", "container", "s", { direction: "row" }),
        ...[1, 2, 3, 4].map((i) => ({ ...el(`b${i}`, "button", "row"), label })),
      ],
      "mobile",
    );
    expect(layout.width).toBe(360);
    for (const box of layout.boxes.filter((b) => b.id.startsWith("b"))) {
      expect(box.text.split("\n").length).toBeGreaterThan(2);
      expect(box.text).not.toMatch(/\.tsx?:/); // labels only, never citations
      expect(box.textWidth).toBeLessThanOrEqual(box.width);
      expect(box.height).toBeGreaterThanOrEqual(measureText(box.text, 16).height);
      const text = { x: box.textX, y: box.textY, width: box.textWidth, height: box.textHeight };
      expect(inside(text, box)).toBe(true);
    }
  });

  test("draws an empty screen at thumbnail size with no text inside", () => {
    const { layout } = screenWith([], "mobile");
    expect(layout.boxes).toEqual([]);
    expect(layout.width).toBe(EMPTY_SCREEN_SIZE.mobile.width);
    expect(layout.height).toBe(EMPTY_SCREEN_SIZE.mobile.height);
  });

  test("gives a row child its fixed width and the rest to the flexible child", () => {
    const { layout } = screenWith(
      [el("side", "container", "s", { width: 225 }), el("main", "text")],
      "web",
      "row",
    );
    const all = boxes(layout.boxes);
    const side = all.get("side") as WireBox;
    const main = all.get("main") as WireBox;
    expect(side.x).toBe(12);
    expect(side.width).toBe(225);
    expect(main.x).toBe(12 + 225 + 8);
    expect(main.width).toBe(936 - 225 - 8);
  });

  test("puts a fixed child anywhere in the row and shares the rest among the others", () => {
    const { layout } = screenWith(
      [el("a", "text"), el("b", "text", "s", { width: 100 }), el("c", "text")],
      "web",
      "row",
    );
    const all = boxes(layout.boxes);
    const share = (936 - 100 - 16) / 2;
    expect((all.get("a") as WireBox).width).toBe(share);
    expect((all.get("b") as WireBox).x).toBe(12 + share + 8);
    expect((all.get("c") as WireBox).x).toBe(12 + share + 8 + 100 + 8);
    expect((all.get("c") as WireBox).width).toBe(share);
  });

  test("left-aligns a row whose children all have a width, leaving the rest empty", () => {
    const { layout } = screenWith(
      [el("a", "text", "s", { width: 200 }), el("b", "text", "s", { width: 300 })],
      "web",
      "row",
    );
    const all = boxes(layout.boxes);
    const a = all.get("a") as WireBox;
    const b = all.get("b") as WireBox;
    expect([a.x, a.width, b.x, b.width]).toEqual([12, 200, 220, 300]);
    expect(b.x + b.width).toBeLessThan(layout.width - 12);
  });

  test("draws a screen with a width at that width, top-level children included", () => {
    const { layout } = screenWith([el("a", "bar"), el("b", "text")], "web", undefined, {
      width: 1280,
    });
    expect(layout.width).toBe(1280);
    for (const box of layout.boxes) expect(box.width).toBe(1280 - 24);
  });

  test("draws the sizing fixture with a 225px sidebar and the content in the rest of 1280px", () => {
    const file = path.join(
      repoRoot,
      "examples/fixtures/sizing/.groundboard/web--admin-users.board.json",
    );
    const board = parse(JSON.parse(readFileSync(file, "utf8")));
    const screen = board.nodes[0] as (typeof board.nodes)[number];
    const layout = layoutScreen(screen, childrenByParent(board));
    const all = boxes(layout.boxes);
    expect(layout.width).toBe(1280);
    expect((all.get("nav") as WireBox).width).toBe(225);
    expect((all.get("content") as WireBox).width).toBe(1280 - 2 * 12 - 225 - 8 - 2 * 12);
    expect((all.get("title") as WireBox).text).not.toContain("\n");
  });

  test("lays out a 100-element screen quickly", () => {
    const board = syntheticScreens(1, 100);
    const screen = board.nodes[0] as (typeof board.nodes)[number];
    const start = performance.now();
    const layout = layoutScreen(screen, childrenByParent(board));
    expect(performance.now() - start).toBeLessThan(200);
    expect(layout.boxes).toHaveLength(100);
  });
});
