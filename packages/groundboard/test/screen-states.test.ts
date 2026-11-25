// The screen-states example: one screen drawn as a root frame and seven state frames joined by
// cited transitions. Valid with checked sources, a clean atlas in which no state is a ref, and a
// scene with one frame per state. Readability of the drawing is checked by eye on a render;
// the layout tests check its geometry.
import { readFileSync } from "node:fs";
import path from "node:path";
import { type Board, lintBoardText } from "@groundboard/schema";
import { describe, expect, test } from "vitest";
import { buildAtlas } from "../src/atlas.ts";
import { renderBoard, validateBoard } from "../src/pipeline.ts";

const root = path.resolve(import.meta.dirname, "../../../examples/fixtures/states");
const atlasDir = path.join(root, ".groundboard");
const boardFile = path.join(atlasDir, "web--users-upload.board.json");
const input = () => JSON.parse(readFileSync(boardFile, "utf8"));

describe("examples/fixtures/states", () => {
  test("the board has a root, seven states and thirteen cited transitions", async () => {
    const result = await validateBoard(input(), { checkSourcesRoot: root });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    const board = result.board as Board;
    expect(lintBoardText(board)).toEqual([]);
    const screens = board.nodes.filter((n) => n.kind === "screen");
    expect(screens.filter((n) => n.stateOf === undefined).map((n) => n.ref)).toEqual([
      "web:users-upload",
    ]);
    const states = screens.filter((n) => n.stateOf === "upload");
    expect(states).toHaveLength(7);
    for (const state of states) expect(state.ref).toBeUndefined();
    const transitions = board.edges.filter((e) => e.kind === "transition");
    expect(transitions).toHaveLength(13);
    for (const edge of transitions) {
      const cited = edge.sourceIds.map((id) => board.sources.find((s) => s.id === id));
      expect(
        cited.some((s) => s?.kind === "code" && s.quote),
        edge.id,
      ).toBe(true);
    }
  });

  test("the atlas has no problem and no state defines a ref", async () => {
    const atlas = await buildAtlas(atlasDir, root, { require: "code" });
    expect(atlas.problems).toEqual([]);
    expect(atlas.boards.map((b) => [b.slug, b.status])).toEqual([
      ["overview-web", "ok"],
      ["web--users-upload", "ok"],
    ]);
    const screenRefs = atlas.refs.filter((r) => !r.ref.includes("/")).map((r) => r.ref);
    expect(screenRefs).toEqual(["web:users", "web:users-upload"]);
    // Elements of states extend the root's ref.
    for (const ref of atlas.refs.filter((r) => r.ref.includes("/"))) {
      expect(ref.ref.startsWith("web:users-upload/")).toBe(true);
      expect(ref.definedIn).toHaveLength(1);
    }
  });

  test("renders one frame per state and a legend that tells transitions from navigation", async () => {
    const result = await renderBoard(input(), { checkSourcesRoot: root });
    expect(result.issues).toEqual([]);
    const elements = result.scene?.elements ?? [];
    const frameNames = elements
      .filter((e) => e.type === "frame" && e.id !== "legend")
      .map((e) => (e as { name?: string }).name?.split(" · ")[0]);
    expect(frameNames).toEqual([
      "① Upload",
      "② Validating",
      "③ Confirm",
      "④ Import dialog",
      "⑤ Importing",
      "⑥ Complete",
      "⑦ Row errors",
      "⑧ Template mismatch",
    ]);
    const legend = elements
      .filter((e) => e.type === "text" && e.id.startsWith("legend-label/"))
      .map((e) => (e as { text?: string }).text);
    expect(legend).toContain("transition: another state of the same screen");
    // Both navigations leave for other boards, so they are numbered tags, not arrows.
    expect(legend).toContain("1 → ref: opens a screen on another board");
    expect(legend).not.toContain("navigates: opens another screen");
  });
});
