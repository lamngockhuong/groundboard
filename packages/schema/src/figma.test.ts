import { describe, expect, test } from "vitest";
import { figmaUrl } from "./board.ts";
import { designChanged, FigmaCacheEntrySchema, figmaCacheName, lintFigmaSources } from "./figma.ts";
import { lintBoardText } from "./lint-text.ts";
import { parseBoard } from "./validate.ts";

const FILE = "AbCdEf0123456789";

// biome-ignore lint/suspicious/noExplicitAny: test boards are mutated freely to build bad inputs
function screenBoard(): Record<string, any> {
  return {
    schemaVersion: 1,
    title: "Users screen",
    question: "What is on the users screen?",
    nodes: [
      {
        id: "users",
        kind: "screen",
        label: "Users",
        ref: "web:users",
        platform: "web",
        layoutFrom: "figma",
        sourceIds: ["fig-frame"],
      },
      {
        id: "logo",
        kind: "element",
        role: "image",
        label: "Logo",
        parentId: "users",
        sourceIds: ["fig-logo"],
      },
    ],
    sources: [
      { id: "fig-frame", kind: "figma", fileKey: FILE, nodeId: "29544:149543" },
      { id: "fig-logo", kind: "figma", fileKey: FILE, nodeId: "I29544:149545;25738:46752" },
    ],
  };
}

describe("figma node ids", () => {
  test("a layer inside an instance validates", () => {
    const result = parseBoard(screenBoard());
    expect(result.ok, JSON.stringify(result.ok ? null : result.error)).toBe(true);
  });

  test.each([
    "I29544:149545",
    "29544:149545;25738:46752",
    "I29544:149545;",
    "I29544-149545;25738-46752",
    "i29544:149545;25738:46752",
  ])("a malformed id %s is rejected with its path", (nodeId) => {
    const board = screenBoard();
    board.sources[1].nodeId = nodeId;
    const result = parseBoard(board);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveLength(1);
    expect(result.error[0]?.path).toBe("sources[1].nodeId");
    expect(result.error[0]?.message).toMatch(/I12:34;56:78/);
  });

  test("the Figma link of an instance child names the whole id", () => {
    expect(figmaUrl({ fileKey: FILE, nodeId: "I29544:149545;25738:46752" })).toBe(
      `https://www.figma.com/design/${FILE}?node-id=I29544-149545%3B25738-46752`,
    );
  });
});

describe("element figma sources", () => {
  test("a layer of the screen's file gives no warning", () => {
    const result = parseBoard(screenBoard());
    if (!result.ok) throw new Error("invalid");
    expect(lintFigmaSources(result.value)).toEqual([]);
  });

  test("a layer of another file gives a warning naming both files", () => {
    const board = screenBoard();
    board.sources[1].fileKey = "ZzZzZz0123456789";
    const result = parseBoard(board);
    if (!result.ok) throw new Error("invalid");
    const warnings = lintBoardText(result.value);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^nodes\[1\]\.sourceIds\[0\] cites figma source `fig-logo`/);
    expect(warnings[0]).toMatch(/ZzZzZz0123456789.*AbCdEf0123456789/);
  });

  test("an element of a state without its own frame is compared with the root's frame", () => {
    const board = screenBoard();
    board.nodes.push(
      { id: "dialog", kind: "screen", label: "Dialog", stateOf: "users", sourceIds: ["mock"] },
      {
        id: "ok",
        kind: "element",
        role: "text",
        label: "OK",
        parentId: "dialog",
        sourceIds: ["fig-other"],
      },
    );
    board.sources.push({ id: "mock", kind: "mockup", label: "Dialog mockup" });
    board.sources.push({
      id: "fig-other",
      kind: "figma",
      fileKey: "ZzZzZz0123456789",
      nodeId: "1:2",
    });
    const result = parseBoard(board);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(lintFigmaSources(result.value)).toHaveLength(1);
  });
});

describe("figma cache entries", () => {
  const entry = {
    fileKey: FILE,
    nodeId: "29544:149543",
    fetchedAt: "2026-11-20T05:00:00Z",
    lastModified: "2026-11-19T10:00:00Z",
    image: { width: 1501, height: 1203, originX: 28, originY: 19 },
    nodes: { "29544:149600": [10, 20, 100, 40], "I29544:149545;25738:46752": [0, 0, 120, 32] },
  };

  test("parse, with instance children among the boxes", () => {
    expect(FigmaCacheEntrySchema.safeParse(entry).success).toBe(true);
  });

  test("refuse a box with a negative size", () => {
    const bad = { ...entry, nodes: { "1:2": [0, 0, -1, 4] } };
    expect(FigmaCacheEntrySchema.safeParse(bad).success).toBe(false);
  });

  test("refuse an image wider than 16384 pixels", () => {
    const wide = { ...entry, image: { ...entry.image, width: 100_000 } };
    expect(FigmaCacheEntrySchema.safeParse(wide).success).toBe(false);
  });

  test("are named after the file and the node, with `:` and `;` replaced", () => {
    expect(figmaCacheName({ fileKey: FILE, nodeId: "I29544:149545;25738:46752" })).toBe(
      `${FILE}-I29544-149545_25738-46752`,
    );
  });

  test("know the design changed only when a later check found a newer file", () => {
    const parsed = FigmaCacheEntrySchema.parse(entry);
    expect(designChanged(parsed)).toBe(false);
    expect(designChanged({ ...parsed, checkedLastModified: "2026-11-19T10:00:00Z" })).toBe(false);
    expect(designChanged({ ...parsed, checkedLastModified: "2026-11-20T09:00:00Z" })).toBe(true);
    const unknown = {
      ...parsed,
      lastModified: undefined,
      checkedLastModified: "2026-11-21T00:00:00Z",
    };
    expect(designChanged(unknown)).toBe(false);
  });

  const A = "a".repeat(64);
  const B = "b".repeat(64);

  test("accept content and pixel hashes, and refuse one that is not SHA-256 hex", () => {
    const hashed = { ...entry, contentHash: A, pixelHash: B, checkedContentHash: A };
    expect(FigmaCacheEntrySchema.safeParse(hashed).success).toBe(true);
    expect(FigmaCacheEntrySchema.safeParse({ ...entry, contentHash: "abc" }).success).toBe(false);
    expect(FigmaCacheEntrySchema.safeParse({ ...entry, pixelHash: B.toUpperCase() }).success).toBe(
      false,
    );
  });

  test("know the design changed when a checked hash differs from the recorded one", () => {
    const parsed = FigmaCacheEntrySchema.parse({ ...entry, lastModified: undefined });
    expect(designChanged({ ...parsed, contentHash: A, checkedContentHash: A })).toBe(false);
    expect(designChanged({ ...parsed, contentHash: A, checkedContentHash: B })).toBe(true);
    expect(designChanged({ ...parsed, pixelHash: A, checkedPixelHash: B })).toBe(true);
    expect(designChanged({ ...parsed, contentHash: A, pixelHash: A, checkedContentHash: A })).toBe(
      false,
    );
    // a hash on one side only proves nothing
    expect(designChanged({ ...parsed, checkedContentHash: B, checkedPixelHash: B })).toBe(false);
    expect(designChanged({ ...parsed, contentHash: A })).toBe(false);
  });
});
