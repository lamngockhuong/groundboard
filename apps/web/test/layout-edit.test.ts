import { readFileSync } from "node:fs";
import path from "node:path";
import { emptyOverlay } from "@groundboard/schema";
import { describe, expect, it } from "vitest";
import {
  collectOverlay,
  lockForLayout,
  movableUnits,
  rendererIds,
  unlockAfterLayout,
} from "../src/layout-edit.ts";
import { renderBoardLocally } from "../src/local-render.ts";

const examples = path.resolve(import.meta.dirname, "../../../examples");
const read = (file: string) =>
  JSON.parse(readFileSync(path.join(examples, file), "utf8")) as Record<string, unknown>;

type El = Record<string, unknown>;

async function scene(board: Record<string, unknown>, overlay?: unknown): Promise<El[]> {
  const result = await renderBoardLocally(board, overlay);
  if (result.status !== "ok") throw new Error(JSON.stringify(result));
  return (result.scene as { elements: El[] }).elements;
}

const moved = (elements: El[], id: string, dx: number, dy: number) =>
  elements.map((e) =>
    e.id === id ? { ...e, x: (e.x as number) + dx, y: (e.y as number) + dy } : e,
  );

describe("collectOverlay", () => {
  it("finds no notes and no offsets in a scene left as rendered, edge and group labels included", async () => {
    // The checkout flow has groups and labelled edges; neither label carries board data.
    const board = read("checkout-flow.board.json");
    const elements = await scene(board);
    expect(elements.some((e) => String(e.id).startsWith("edge-label/"))).toBe(true);
    expect(elements.some((e) => String(e.id).startsWith("group/"))).toBe(true);
    const { overlay, dropped } = collectOverlay({
      rendered: elements,
      current: elements,
      units: movableUnits(board),
      base: emptyOverlay(),
    });
    expect(overlay).toEqual(emptyOverlay());
    expect(dropped).toBe(0);
  });

  it("turns a dragged box into an offset added to the one it was rendered with", async () => {
    const board = read("checkout-flow.board.json");
    const base = { ...emptyOverlay(), nodes: { "n-void": { dx: 10, dy: 0 } } };
    const elements = await scene(board, base);
    const current = moved(moved(elements, "node/n-capture", 40, -20), "node/n-void", 5, 5);
    const { overlay } = collectOverlay({
      rendered: elements,
      current,
      units: movableUnits(board),
      base,
    });
    expect(overlay.nodes).toEqual({
      "n-capture": { dx: 40, dy: -20 },
      "n-void": { dx: 15, dy: 5 },
    });
  });

  it("keeps drawn shapes as notes anchored to the box under them, and drops images", async () => {
    const board = read("checkout-flow.board.json");
    const elements = await scene(board);
    const capture = elements.find((e) => e.id === "node/n-capture") as El;
    const drawn: El[] = [
      {
        id: "abc123",
        type: "text",
        x: (capture.x as number) + 4,
        y: (capture.y as number) + 4,
        width: 40,
        height: 20,
        text: "Why?",
        originalText: "Why?",
        fontSize: 16,
        link: "https://example.com",
        strokeColor: "#e03131",
      },
      { id: "free", type: "rectangle", x: -900, y: -900, width: 10, height: 10 },
      { id: "pic", type: "image", x: 0, y: 0, width: 10, height: 10, fileId: "f" },
    ];
    const { overlay, dropped } = collectOverlay({
      rendered: elements,
      current: [...elements, ...drawn],
      units: movableUnits(board),
      base: emptyOverlay(),
    });
    expect(dropped).toBe(1);
    expect(overlay.notes).toEqual([
      {
        id: "abc123",
        type: "text",
        x: (capture.x as number) + 4,
        y: (capture.y as number) + 4,
        width: 40,
        height: 20,
        strokeColor: "#e03131",
        text: "Why?",
        fontSize: 16,
        anchor: { nodeId: "n-capture", dx: 4, dy: 4 },
      },
      { id: "free", type: "rectangle", x: -900, y: -900, width: 10, height: 10 },
    ]);
    // The link was not carried over.
    expect(JSON.stringify(overlay)).not.toContain("example.com");
  });

  it("reads back the notes the renderer drew, under their own ids", async () => {
    const board = read("checkout-flow.board.json");
    const base = {
      ...emptyOverlay(),
      notes: [{ id: "keep", type: "rectangle" as const, x: 1, y: 2, width: 3, height: 4 }],
    };
    const elements = await scene(board, base);
    expect(elements.some((e) => e.id === "note/keep")).toBe(true);
    const { overlay } = collectOverlay({
      rendered: elements,
      current: elements,
      units: movableUnits(board),
      base,
    });
    expect(overlay.notes.map((n) => n.id)).toEqual(["keep"]);
  });
});

describe("lockForLayout", () => {
  it("leaves only movable boxes, their labels and notes free, then puts locks back", async () => {
    const board = read("fixtures/states/.groundboard/web--users-upload.board.json");
    const elements = await scene(board);
    const units = movableUnits(board);
    expect(units.has("upload")).toBe(true);
    expect(units.has("validating")).toBe(false);
    const { elements: lockedScene, locked } = lockForLayout(elements, units, rendererIds(elements));
    const isLocked = (id: string) => lockedScene.find((e) => e.id === id)?.locked === true;
    expect(isLocked("node/upload")).toBe(false);
    expect(isLocked("node/validating")).toBe(true);
    expect(isLocked("node/pick")).toBe(true);
    expect(unlockAfterLayout(lockedScene, locked)).toEqual(elements);
  });
});
