// The lifecycle fixture: the same atlas at the spec stage (requirements, a mockup, Figma) and
// after the code arrived and the skills updated it in place. Checks the invariants only; what
// the skills did is recorded in the acceptance report.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { type AtlasIndex, atlasHasProblems, buildAtlas } from "../src/atlas.ts";

const lifecycle = path.resolve(import.meta.dirname, "../../../examples/fixtures/lifecycle");
const spec = path.join(lifecycle, "spec");
const code = path.join(lifecycle, "code");
const atlasOf = (root: string) => path.join(root, ".groundboard");
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const codeShare = (atlas: AtlasIndex) => {
  const total = { code: 0, all: 0 };
  for (const board of atlas.boards) {
    total.code += board.grounding.code;
    total.all += board.grounding.code + board.grounding.spec + board.grounding.none;
  }
  return total.code / total.all;
};

describe("lifecycle fixture", () => {
  test("the spec stage passes atlas check and fails require code", async () => {
    expect(atlasHasProblems(await buildAtlas(atlasOf(spec), spec))).toBe(false);
    const required = await buildAtlas(atlasOf(spec), spec, { require: "code" });
    expect(atlasHasProblems(required)).toBe(true);
  });

  test("the code stage keeps every id and ref of the spec stage and is backed by code", async () => {
    const atlas = await buildAtlas(atlasOf(code), code, {
      baselineDir: atlasOf(spec),
      require: "code",
    });
    expect(atlas.problems).toEqual([]);
    expect(atlasHasProblems(atlas)).toBe(false);
  });

  test("the code stage has a larger share of claims backed by code", async () => {
    const before = codeShare(await buildAtlas(atlasOf(spec), spec));
    const after = codeShare(await buildAtlas(atlasOf(code), code));
    expect(after).toBeGreaterThan(before);
  });

  test("keeps the requirement next to the code it now cites", async () => {
    const board = JSON.parse(
      readFileSync(path.join(atlasOf(code), "web--signup.board.json"), "utf8"),
    ) as { sources: Array<{ id: string; kind?: string }>; nodes: Array<{ kind: string }> };
    const kinds = new Set(board.sources.map((s) => s.kind ?? "code"));
    expect([...kinds].sort()).toEqual(["code", "doc", "mockup"]);
    expect(board.nodes.some((n) => n.kind === "question")).toBe(true);
  });

  test("editing a cited requirement line makes the board stale", async () => {
    const copy = mkdtempSync(path.join(tmpdir(), "lifecycle-"));
    temps.push(copy);
    cpSync(spec, copy, { recursive: true });
    const doc = path.join(copy, "docs", "requirements.md");
    writeFileSync(
      doc,
      readFileSync(doc, "utf8").replace(
        "The Create account button submits the form and opens the Verify email screen.",
        "The Create account button saves a draft.",
      ),
    );
    const atlas = await buildAtlas(atlasOf(copy), copy);
    expect(atlas.boards.map((b) => [b.slug, b.status])).toEqual([
      ["overview-web", "stale"],
      ["web--signup", "stale"],
    ]);
    expect(atlas.boards[1]?.staleSourceIds).toEqual(["req-create-account"]);
  });

  test("deleting a cited mockup file makes the board stale", async () => {
    const copy = mkdtempSync(path.join(tmpdir(), "lifecycle-"));
    temps.push(copy);
    cpSync(spec, copy, { recursive: true });
    rmSync(path.join(copy, "design", "signup-mockup.png"));
    const atlas = await buildAtlas(atlasOf(copy), copy);
    expect(atlas.boards.every((b) => b.status === "stale")).toBe(true);
    expect(atlas.boards[1]?.staleSourceIds).toEqual(["mockup-signup"]);
  });
});
