import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { run } from "./index.ts";
import type { CliIO } from "./io.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
let dir: string;

function capture(cwd: string): CliIO & { out: string; err: string } {
  const io = {
    out: "",
    err: "",
    cwd,
    readStdin: async () => "",
    stdout: (text: string) => {
      io.out += text;
    },
    stderr: (text: string) => {
      io.err += text;
    },
  };
  return io;
}

type Element = { id: string; x: number; y: number };
const element = (out: string, id: string) =>
  (JSON.parse(out).elements as Element[]).find((e) => e.id === id) as Element;

beforeAll(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "groundboard-render-")));
  cpSync(
    path.join(repoRoot, "examples", "checkout-flow.board.json"),
    path.join(dir, "flow.board.json"),
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("groundboard render with a layout overlay", () => {
  test("applies the overlay beside the board, draws its notes, and --no-overlay ignores it", async () => {
    const plain = capture(dir);
    expect(await run(["render", "flow.board.json", "-o", "-"], plain)).toBe(0);
    writeFileSync(
      path.join(dir, "flow.overlay.json"),
      JSON.stringify({
        schemaVersion: 1,
        nodes: { "n-capture": { dx: 0, dy: 200 } },
        notes: [{ id: "why", type: "text", x: 0, y: 0, width: 50, height: 20, text: "Why?" }],
      }),
    );
    const overlaid = capture(dir);
    expect(await run(["render", "flow.board.json", "-o", "-"], overlaid)).toBe(0);
    const before = element(plain.out, "node/n-capture");
    const after = element(overlaid.out, "node/n-capture");
    expect(after.y - before.y).toBeCloseTo(200, 6);
    expect(element(overlaid.out, "note/why")).toBeDefined();

    const ignored = capture(dir);
    expect(await run(["render", "flow.board.json", "-o", "-", "--no-overlay"], ignored)).toBe(0);
    expect(element(ignored.out, "node/n-capture").y).toBe(before.y);
  });

  test("skips an overlay that fails its schema, with a warning, and still renders", async () => {
    writeFileSync(path.join(dir, "flow.overlay.json"), JSON.stringify({ schemaVersion: 9 }));
    const io = capture(dir);
    expect(await run(["render", "flow.board.json", "-o", "-"], io)).toBe(0);
    expect(io.err).toContain("flow.overlay.json ignored");
  });
});
