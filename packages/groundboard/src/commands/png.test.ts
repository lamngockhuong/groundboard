import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { decodePng } from "../png.ts";
import { VERSION } from "../version.ts";
import { run } from "./index.ts";
import type { CliIO } from "./io.ts";
import { installHint, PNG_PACKAGE, pngCommand } from "./png.ts";

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

beforeAll(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "groundboard-png-")));
  cpSync(
    path.join(repoRoot, "examples", "order-state-machine.board.json"),
    path.join(dir, "orders.board.json"),
  );
  cpSync(
    path.join(repoRoot, "packages", "png", "test", "fixtures", "order-state-machine.excalidraw"),
    path.join(dir, "orders.excalidraw"),
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("groundboard png without @groundboard/png", () => {
  test("prints the one command that installs it and draws nothing", async () => {
    const io = capture(dir);
    const code = await pngCommand(["orders.board.json"], io, async () => null);
    expect(code).toBe(1);
    expect(io.err).toContain(`needs the optional package ${PNG_PACKAGE}`);
    expect(io.err).toContain(`npm install ${PNG_PACKAGE}@${VERSION}`);
    expect(io.err).not.toMatch(/\n\s+at /);
    expect(existsSync(path.join(dir, "orders.png"))).toBe(false);
  });

  test("under npx, the command reruns it with both packages", () => {
    const hint = installHint(
      ["my board.json", "--theme", "dark"],
      "file:///x/_npx/ab12/node_modules/groundboard/dist/cli.mjs",
    );
    expect(hint).toBe(
      `npx -y -p groundboard@${VERSION} -p ${PNG_PACKAGE}@${VERSION} groundboard png 'my board.json' --theme dark`,
    );
  });
});

// Uses the workspace's @groundboard/png, built by `pnpm -r build`. The first test loads
// Excalidraw and the fonts, which can pass the default 5 s on a busy machine.
describe("groundboard png", { timeout: 30_000 }, () => {
  test("draws a board beside it and prints the path", async () => {
    const io = capture(dir);
    expect(await run(["png", "orders.board.json"], io)).toBe(0);
    expect(io.out).toBe("orders.png\n");
    const image = decodePng(readFileSync(path.join(dir, "orders.png")));
    expect(Math.max(image.width, image.height)).toBe(1568);
  });

  test("draws an .excalidraw scene as it is, tiled under a small cap", async () => {
    const io = capture(dir);
    const code = await run(
      ["png", "orders.excalidraw", "-o", "out/scene.png", "--max-edge", "600"],
      io,
    );
    expect(code).toBe(0);
    const files = io.out.trim().split("\n");
    expect(files.length).toBeGreaterThan(1);
    expect(files[0]).toBe(path.join("out", "scene-r1c1.png"));
    for (const file of files) {
      const image = decodePng(readFileSync(path.join(dir, file)));
      expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(600);
    }
    expect(io.err).toMatch(/tiles of at most 600 px/);
  });

  test("refuses an unknown theme and a cap that is not a number", async () => {
    const io = capture(dir);
    expect(await run(["png", "orders.board.json", "--theme", "blue"], io)).toBe(2);
    expect(await run(["png", "orders.board.json", "--max-edge", "big"], io)).toBe(2);
    expect(io.err).toContain('--theme must be "light" or "dark"');
  });

  test("an invalid board exits 3 with its issues", async () => {
    const io = capture(dir);
    const bad = path.join(dir, "bad.board.json");
    cpSync(path.join(dir, "orders.board.json"), bad);
    const board = JSON.parse(readFileSync(bad, "utf8"));
    board.nodes = "not a list";
    writeFileSync(bad, JSON.stringify(board));
    expect(await run(["png", "bad.board.json"], io)).toBe(3);
    expect(io.err).toContain("issue(s)");
  });
});
