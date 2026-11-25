import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FIGMA_CACHE_DIR } from "@groundboard/schema";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createApp } from "../server/app.ts";
import { exportAtlas, gitState, STATIC_MODE_META, staticIndexHtml } from "./export.ts";
import { run } from "./index.ts";
import type { CliIO } from "./io.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const fixtures = path.join(repoRoot, "examples/fixtures");

let base: string;
let webRoot: string;
let figmaRoot: string;

/** A stand-in for the built viewer: a page, a script and one CJK font file. */
function fakeViewer(dir: string): string {
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  mkdirSync(path.join(dir, "fonts", "Xiaolai"), { recursive: true });
  mkdirSync(path.join(dir, "fonts", "Excalifont"), { recursive: true });
  writeFileSync(
    path.join(dir, "index.html"),
    '<!doctype html>\n<html lang="en">\n  <head>\n    <title>groundboard</title>\n  </head>\n  <body><div id="root"></div></body>\n</html>\n',
  );
  writeFileSync(path.join(dir, "assets", "index.js"), "console.log(1);\n");
  writeFileSync(path.join(dir, "fonts", "Xiaolai", "a.woff2"), "x");
  writeFileSync(path.join(dir, "fonts", "Excalifont", "b.woff2"), "y");
  return dir;
}

function capture(cwd = repoRoot): CliIO & { out: string; err: string } {
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

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), "groundboard-export-")));
  webRoot = fakeViewer(path.join(base, "web"));
  figmaRoot = path.join(base, "figma");
  const atlas = path.join(figmaRoot, ".groundboard");
  cpSync(path.join(fixtures, "figma", ".groundboard"), atlas, { recursive: true });
  cpSync(path.join(fixtures, "figma", "figma-cache"), path.join(atlas, FIGMA_CACHE_DIR), {
    recursive: true,
  });
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

async function compareWithServer(dir: string, root: string, out: string): Promise<string[]> {
  const index = readJson(path.join(out, "data", "atlas.json"));
  const { app, close } = createApp({ webRoot: path.join(base, "none"), atlas: { dir, root } });
  const get = (url: string) => app.request(url, { headers: { host: "localhost:8787" } });
  const { exported, ...rest } = index;
  // The export never offers to edit tags; the loopback server does.
  const { tagsEditable, ...served } = (await (await get("/api/atlas")).json()) as Record<
    string,
    unknown
  >;
  expect(tagsEditable).toBe(true);
  expect(rest).toEqual(served);
  const slugs: string[] = index.boards.map((b: { slug: string }) => b.slug);
  for (const slug of slugs) {
    const served = await get(`/api/atlas/boards/${slug}`);
    // Beside what the server answers, the export carries the board file as written.
    const { source, ...exportedBoard } = readJson(path.join(out, "data", "boards", `${slug}.json`));
    expect(exportedBoard, slug).toEqual(await served.json());
    expect(source, slug).toBe(readFileSync(path.join(dir, `${slug}.board.json`), "utf8"));
    expect(source, slug).toBe(await (await get(`/api/atlas/boards/${slug}/source`)).text());
  }
  await close();
  return slugs;
}

describe("groundboard export", () => {
  test("writes the viewer, the atlas and every board exactly as serve --atlas returns them", async () => {
    const out = path.join(base, "fixtures-out");
    const dir = path.join(fixtures, ".groundboard");
    const summary = await exportAtlas({ dir, root: fixtures, out, webRoot }, () => {});
    expect(summary.boards).toBe(8);
    const slugs = await compareWithServer(dir, fixtures, out);
    expect(slugs).toHaveLength(8);

    const html = readFileSync(path.join(out, "index.html"), "utf8");
    expect(html).toContain(`<head>\n    ${STATIC_MODE_META}`);
    expect(existsSync(path.join(out, "assets", "index.js"))).toBe(true);
    expect(existsSync(path.join(out, "fonts", "Xiaolai", "a.woff2"))).toBe(true);
    // index.html, the script, two fonts, atlas.json, eight boards and the manifest: the board
    // files ride inside the board JSON, so the count is one per board.
    expect(summary.files).toBe(14);
    const manifest = readFileSync(path.join(out, "manifest.txt"), "utf8").trim().split("\n");
    expect(manifest).toHaveLength(13);
    expect(manifest).toContain("fonts/Xiaolai/a.woff2");
    expect(manifest).toContain("data/boards/web--checkout.json");
    expect(manifest).not.toContain("manifest.txt");
    for (const rel of manifest) expect(existsSync(path.join(out, rel)), rel).toBe(true);
  }, 60_000);

  test("exports the Figma images by default, and leaves them out with references: false", async () => {
    const dir = path.join(figmaRoot, ".groundboard");
    const out = path.join(base, "figma-out");
    await exportAtlas({ dir, root: figmaRoot, out, webRoot }, () => {});
    await compareWithServer(dir, figmaRoot, out);
    const board = readJson(path.join(out, "data", "boards", "web--users.json"));
    expect(board.references).toEqual({ frames: 2, cached: 2 });
    expect(Object.keys(board.scene.files)).toHaveLength(2);

    const plainOut = path.join(base, "figma-plain");
    await exportAtlas(
      { dir, root: figmaRoot, out: plainOut, webRoot, references: false, skipCjkFonts: true },
      () => {},
    );
    const plain = readJson(path.join(plainOut, "data", "boards", "web--users.json"));
    expect(plain.references).toBeUndefined();
    expect(plain.scene.files).toEqual({});
    expect(existsSync(path.join(plainOut, "fonts", "Xiaolai"))).toBe(false);
    expect(existsSync(path.join(plainOut, "fonts", "Excalifont", "b.woff2"))).toBe(true);
  }, 60_000);

  test("a board too large with its images is exported without them, with a warning", async () => {
    const dir = path.join(figmaRoot, ".groundboard");
    const withImages = readFileSync(
      path.join(base, "figma-out", "data", "boards", "web--users.json"),
    );
    const withoutImages = readFileSync(
      path.join(base, "figma-plain", "data", "boards", "web--users.json"),
    );
    const between = Math.floor((withImages.length + withoutImages.length) / 2);
    let warnings = "";
    const summary = await exportAtlas(
      { dir, root: figmaRoot, out: path.join(base, "figma-big"), webRoot, maxFileBytes: between },
      (text) => {
        warnings += text;
      },
    );
    expect(summary.withoutReferences).toEqual(["web--users"]);
    expect(warnings).toContain("web--users is larger than");
    const board = readJson(path.join(base, "figma-big", "data", "boards", "web--users.json"));
    expect(board.scene.files).toEqual({});

    const tiny = path.join(base, "figma-tiny");
    await expect(
      exportAtlas({ dir, root: figmaRoot, out: tiny, webRoot, maxFileBytes: 100 }, () => {}),
    ).rejects.toThrow(/nothing was written/);
    expect(existsSync(tiny)).toBe(false);
  }, 60_000);

  test("stamps the check time, and no commit outside git", async () => {
    const out = path.join(base, "stamp-out");
    const now = new Date("2026-11-20T07:00:00.000Z");
    await exportAtlas(
      { dir: path.join(figmaRoot, ".groundboard"), root: figmaRoot, out, webRoot, now: () => now },
      () => {},
    );
    const { exported } = readJson(path.join(out, "data", "atlas.json"));
    expect(exported).toMatchObject({
      checkedAt: "2026-11-20T07:00:00.000Z",
      commit: null,
      dirty: false,
    });
    expect(typeof exported.version).toBe("string");

    const inRepo = path.join(base, "repo-out");
    await exportAtlas(
      { dir: path.join(fixtures, ".groundboard"), root: fixtures, out: inRepo, webRoot },
      () => {},
    );
    const stamp = readJson(path.join(inRepo, "data", "atlas.json")).exported;
    expect(stamp.commit).toMatch(/^[0-9a-f]{4,}$/);
    expect(new Date(stamp.checkedAt).toISOString()).toBe(stamp.checkedAt);
  }, 60_000);

  test("a repository with no commit has no commit but says it is dirty", async () => {
    const root = path.join(base, "fresh-repo");
    mkdirSync(root);
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(path.join(root, "a.txt"), "x");
    expect(await gitState(root)).toEqual({ commit: null, dirty: true });
    expect(await gitState(path.join(base, "web"))).toEqual({ commit: null, dirty: false });
  }, 60_000);

  test("refuses an output inside or around the atlas, a non-empty one and a missing --out", async () => {
    const atlasDir = path.join(figmaRoot, ".groundboard");
    const args = ["--root", figmaRoot, "--atlas-dir", atlasDir];
    for (const out of [path.join(atlasDir, "site"), figmaRoot]) {
      const io = capture();
      expect(await run(["export", ...args, "--out", out], io), out).toBe(2);
      expect(io.err).toContain("--out must neither be inside the atlas directory nor contain it");
    }
    expect(existsSync(path.join(atlasDir, "site"))).toBe(false);

    const full = path.join(base, "full");
    mkdirSync(full);
    writeFileSync(path.join(full, "keep.txt"), "x");
    const io = capture();
    expect(await run(["export", ...args, "--out", full], io)).toBe(2);
    expect(io.err).toContain("--out must be empty");
    expect(readdirSync(full)).toEqual(["keep.txt"]);

    expect(await run(["export", ...args], capture())).toBe(2);
    expect(
      await run(["export", ...args, "--out", path.join(base, "x"), "--bogus"], capture()),
    ).toBe(2);
  });

  test("ignores files in the atlas directory that are not boards", async () => {
    const root = path.join(base, "with-publish");
    const dir = path.join(root, ".groundboard");
    cpSync(path.join(figmaRoot, ".groundboard"), dir, { recursive: true });
    writeFileSync(
      path.join(dir, "publish.json"),
      JSON.stringify({ url: "https://claude.ai/artifact/x", publishedAt: "2026-11-20" }),
    );
    const out = path.join(base, "with-publish-out");
    const summary = await exportAtlas({ dir, root, out, webRoot }, () => {});
    // The fixture's own two dangling refs, and nothing about publish.json.
    expect(summary.problems).toBe(2);
    expect(readFileSync(path.join(out, "data", "atlas.json"), "utf8")).not.toContain("publish");
    expect(readdirSync(path.join(out, "data", "boards"))).toEqual(["web--users.json"]);
  }, 60_000);

  test("staticIndexHtml puts the flag first in the head", () => {
    expect(staticIndexHtml('<html><head lang="x"><title>t</title></head></html>')).toBe(
      `<html><head lang="x">\n    ${STATIC_MODE_META}<title>t</title></head></html>`,
    );
    expect(() => staticIndexHtml("<html></html>")).toThrow(/no <head>/);
  });
});
