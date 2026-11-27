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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FIGMA_CACHE_DIR } from "@groundboard/schema";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createApp } from "../server/app.ts";
import { resolveAtlasPaths } from "./atlas.ts";
import {
  ARTIFACT_LIMITS,
  exportAtlas,
  gitState,
  nonAsciiCodePoints,
  PUBLISH_REMOVE_FILE,
  parsePrevious,
  parseUnicodeRange,
  publishBatches,
  publishRemoval,
  STATIC_MODE_META,
  staticIndexHtml,
} from "./export.ts";
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
    // Without the viewer's range map every CJK font file is kept.
    expect(summary.cjkFonts).toEqual({ written: 1, total: 1 });
    // One batch: every manifest path but index.html, ready to pass as `files`.
    expect(summary.batches).toEqual(["publish-batch-1.json"]);
    const batch = readJson(path.join(out, "publish-batch-1.json"));
    expect(batch).toEqual(manifest.filter((p) => p !== "index.html").map((p) => ({ path: p })));
  }, 60_000);

  test("writes only the CJK font files whose unicode-range the boards' text uses", async () => {
    const web = fakeViewer(path.join(base, "web-cjk"));
    writeFileSync(path.join(web, "fonts", "Xiaolai", "kana.woff2"), "k");
    writeFileSync(path.join(web, "fonts", "Xiaolai", "hangul.woff2"), "h");
    writeFileSync(
      path.join(web, "fonts", "xiaolai-ranges.json"),
      JSON.stringify({
        "a.woff2": "U+4e00-4e2f",
        "kana.woff2": "U+3040-309f,U+30a0-30ff",
        "hangul.woff2": "U+ac00-d7af",
      }),
    );
    const root = path.join(base, "cjk");
    const dir = path.join(root, ".groundboard");
    cpSync(path.join(figmaRoot, ".groundboard"), dir, { recursive: true });
    const board = path.join(dir, "web--users.board.json");
    writeFileSync(
      board,
      readFileSync(board, "utf8").replace(/"title": "([^"]*)"/, '"title": "$1 ユーザー"'),
    );

    const out = path.join(base, "cjk-out");
    const summary = await exportAtlas({ dir, root, out, webRoot: web }, () => {});
    expect(summary.cjkFonts).toEqual({ written: 1, total: 3 });
    expect(readdirSync(path.join(out, "fonts", "Xiaolai"))).toEqual(["kana.woff2"]);
    expect(existsSync(path.join(out, "fonts", "xiaolai-ranges.json"))).toBe(false);
    const manifest = readFileSync(path.join(out, "manifest.txt"), "utf8");
    expect(manifest).not.toContain("xiaolai-ranges");
    expect(manifest).not.toContain("hangul");

    const skipped = await exportAtlas(
      { dir, root, out: path.join(base, "cjk-skip"), webRoot: web, skipCjkFonts: true },
      () => {},
    );
    expect(skipped.cjkFonts).toEqual({ written: 0, total: 3 });
  }, 60_000);

  test("an atlas directory that is a symlink out of the root is accepted", async () => {
    const main = path.join(base, "main-checkout");
    cpSync(path.join(figmaRoot, ".groundboard"), path.join(main, ".groundboard"), {
      recursive: true,
    });
    const worktree = path.join(base, "worktree");
    mkdirSync(worktree);
    symlinkSync(path.join(main, ".groundboard"), path.join(worktree, ".groundboard"));
    const { root, dir, entry } = await resolveAtlasPaths(
      worktree,
      undefined,
      undefined,
      "--atlas-dir",
    );
    expect(root).toBe(worktree);
    expect(dir).toBe(path.join(main, ".groundboard"));
    expect(entry).toBe(path.join(worktree, ".groundboard"));
    const out = path.join(base, "worktree-out");
    const summary = await exportAtlas(
      { dir, root, out, webRoot, title: "Shop screen atlas" },
      () => {},
    );
    expect(summary.boards).toBe(1);
    expect(readFileSync(path.join(out, "index.html"), "utf8")).toContain(
      "<title>Shop screen atlas</title>",
    );

    // A symlink to a parent of the root is still refused, and the message says why.
    const nested = path.join(base, "nested", "project");
    mkdirSync(nested, { recursive: true });
    symlinkSync(path.join(base, "nested"), path.join(nested, ".groundboard"));
    await expect(resolveAtlasPaths(nested, undefined, undefined, "--atlas-dir")).rejects.toThrow(
      /--atlas-dir is a symlink to .*--root/,
    );
    // A directory named outside the root is refused as before.
    await expect(resolveAtlasPaths(worktree, undefined, main, "--atlas-dir")).rejects.toThrow(
      "--atlas-dir must be the project root or a directory inside it",
    );
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

  test("changes in the atlas directory, real or a symlink, are not uncommitted changes", async () => {
    const git = (cwd: string, ...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=test",
          "-c",
          "user.email=test@example.com",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "core.hooksPath=/dev/null",
          ...args,
        ],
        { cwd },
      );
    const repo = path.join(base, "dirty-repo");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src", "app.ts"), "export const a = 1;\n");
    git(repo, "init", "-q");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "init");
    const commit = git(repo, "rev-parse", "--short", "HEAD").toString().trim();

    // A symlinked atlas, as in a worktree linked to the main checkout's atlas.
    const elsewhere = path.join(base, "dirty-main", ".groundboard");
    mkdirSync(elsewhere, { recursive: true });
    const link = path.join(repo, ".groundboard");
    symlinkSync(elsewhere, link);
    expect(await gitState(repo)).toEqual({ commit, dirty: true });
    expect(await gitState(repo, [link])).toEqual({ commit, dirty: false });

    // A real atlas directory with an untracked board in it.
    rmSync(link);
    mkdirSync(path.join(link, "sub"), { recursive: true });
    writeFileSync(path.join(link, "sub", "web--a.board.json"), "{}");
    expect(await gitState(repo, [link])).toEqual({ commit, dirty: false });
    // Paths outside the root are left alone; a file whose name only starts like it counts.
    expect(await gitState(repo, [link, base])).toEqual({ commit, dirty: false });
    writeFileSync(path.join(repo, ".groundboard-notes"), "x");
    expect(await gitState(repo, [link])).toEqual({ commit, dirty: true });
    rmSync(path.join(repo, ".groundboard-notes"));

    // A change to a source is still reported.
    writeFileSync(path.join(repo, "src", "app.ts"), "export const a = 2;\n");
    expect(await gitState(repo, [link])).toEqual({ commit, dirty: true });
  }, 60_000);

  test("--previous writes the paths to remove and says whether they go first", async () => {
    const out = path.join(base, "previous-out");
    const previous = [
      "index.html",
      "assets/index.js",
      "assets/index-old.js",
      "data/boards/web--gone.json",
    ];
    const summary = await exportAtlas(
      { dir: path.join(fixtures, ".groundboard"), root: fixtures, out, webRoot, previous },
      () => {},
    );
    expect(readJson(path.join(out, PUBLISH_REMOVE_FILE))).toEqual({
      "assets/index-old.js": null,
      "data/boards/web--gone.json": null,
    });
    expect(summary.removal).toMatchObject({ previous: 3, removeFirst: false });
    // Never published, so not in the manifest.
    expect(readFileSync(path.join(out, "manifest.txt"), "utf8")).not.toContain(PUBLISH_REMOVE_FILE);

    const none = path.join(base, "previous-none");
    await exportAtlas(
      {
        dir: path.join(fixtures, ".groundboard"),
        root: fixtures,
        out: none,
        webRoot,
        previous: [],
      },
      () => {},
    );
    expect(readFileSync(path.join(none, PUBLISH_REMOVE_FILE), "utf8")).toBe("{}\n");
    const without = path.join(base, "previous-without");
    await exportAtlas(
      { dir: path.join(fixtures, ".groundboard"), root: fixtures, out: without, webRoot },
      () => {},
    );
    expect(existsSync(path.join(without, PUBLISH_REMOVE_FILE))).toBe(false);
  }, 60_000);

  test("the removals go first only when the first batch would not fit beside the old files", () => {
    const old = Array.from({ length: 327 }, (_, i) => `assets/old-${i}.js`);
    const manifest = ["index.html", ...Array.from({ length: 397 }, (_, i) => `assets/new-${i}.js`)];
    const batch1 = manifest.slice(1, 251);
    // 327 + 250 = 577 > 511: removing the 327 old files first is the only way batch 1 fits.
    expect(publishRemoval(["index.html", ...old], manifest, batch1)).toMatchObject({
      previous: 327,
      newInFirstBatch: 250,
      removeFirst: true,
    });
    expect(publishRemoval(["index.html", ...old], manifest, batch1).stale).toHaveLength(327);
    // 261 + 250 = 511: still fits.
    expect(publishRemoval(old.slice(0, 261), manifest, batch1).removeFirst).toBe(false);
    expect(publishRemoval(old.slice(0, 262), manifest, batch1).removeFirst).toBe(true);
    // Paths batch 1 republishes under the same name take no new slot.
    expect(publishRemoval([...old, ...batch1.slice(0, 100)], manifest, batch1)).toMatchObject({
      previous: 427,
      newInFirstBatch: 150,
      removeFirst: true,
    });
    expect(parsePrevious("a\r\n\n  b  \na\n")).toEqual(["a", "b"]);
  });

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
    expect(staticIndexHtml("<head><title>groundboard</title></head>", "A & <B> atlas")).toBe(
      `<head>\n    ${STATIC_MODE_META}<title>A &amp; &lt;B&gt; atlas</title></head>`,
    );
    expect(staticIndexHtml("<head></head>", "T")).toBe(
      `<head>\n    ${STATIC_MODE_META}\n    <title>T</title></head>`,
    );
  });

  test("parses unicode-range and finds the non-ASCII code points", () => {
    expect(parseUnicodeRange("U+20-7e, U+3000,u+ff01-ff5e")).toEqual([
      [0x20, 0x7e],
      [0x3000, 0x3000],
      [0xff01, 0xff5e],
    ]);
    expect([...nonAsciiCodePoints(["abc", "日本 é😀"])].sort()).toEqual(
      [0x65e5, 0x672c, 0xe9, 0x1f600].sort(),
    );
  });

  test("splits the publish into batches by file count and bytes", () => {
    const files = Array.from({ length: 501 }, (_, i) => ({ path: `f${i}`, bytes: 1 }));
    expect(publishBatches(files).map((b) => b.length)).toEqual([250, 250, 1]);
    const big = ARTIFACT_LIMITS.bytesPerPublish / 2;
    expect(
      publishBatches([
        { path: "a", bytes: big },
        { path: "b", bytes: big },
        { path: "c", bytes: 1 },
      ]),
    ).toEqual([["a", "b"], ["c"]]);
    expect(publishBatches([])).toEqual([]);
  });
});
