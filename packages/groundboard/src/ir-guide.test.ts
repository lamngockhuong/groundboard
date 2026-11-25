import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { IR_GUIDE } from "./ir-guide.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

test("the plugin's IR guide is the one the MCP server returns", () => {
  const file = path.join(repoRoot, "plugins/groundboard/skills/board/references/ir-guide.md");
  expect(readFileSync(file, "utf8")).toBe(IR_GUIDE);
});

test("every example in the guide is a valid board", async () => {
  const { parseBoard } = await import("@groundboard/schema");
  const examples = [...IR_GUIDE.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  expect(examples).toHaveLength(4);
  for (const example of examples) {
    const result = parseBoard(JSON.parse(example as string));
    expect(result.ok, JSON.stringify(result.ok ? null : result.error)).toBe(true);
  }
});
