import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Board, FIGMA_CACHE_DIR, parseBoard } from "@groundboard/schema";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { renderBoard } from "./pipeline.ts";
import { loadReferences, pngSize } from "./references.ts";
import { createApp } from "./server/app.ts";

const fixture = path.resolve(import.meta.dirname, "../../../examples/fixtures/figma");
const BOARD = "web--users.board.json";
const FRAME = "AbCdEf0123456789-10-1";

let base: string;
let atlasDir: string;
let cacheDir: string;

/** A project with the fixture atlas and its cache where `serve --atlas` looks for it. */
function project(name: string): { root: string; atlas: string; cache: string } {
  const root = path.join(base, name);
  const atlas = path.join(root, ".groundboard");
  const cache = path.join(atlas, FIGMA_CACHE_DIR);
  mkdirSync(cache, { recursive: true });
  cpSync(path.join(fixture, ".groundboard", BOARD), path.join(atlas, BOARD));
  cpSync(path.join(fixture, "figma-cache"), cache, { recursive: true });
  return { root, atlas, cache };
}

function fixtureBoard(): Board {
  const parsed = parseBoard(
    JSON.parse(readFileSync(path.join(fixture, ".groundboard", BOARD), "utf8")),
  );
  if (!parsed.ok) throw new Error("fixture board is invalid");
  return parsed.value;
}

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), "groundboard-refs-")));
  ({ atlas: atlasDir, cache: cacheDir } = project("main"));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("loadReferences", () => {
  test("reads each frame's image and boxes, the state frame's too", async () => {
    const loaded = await loadReferences(fixtureBoard(), { dir: cacheDir });
    expect(loaded.warnings).toEqual([]);
    expect([loaded.frames, loaded.cached]).toEqual([2, 2]);
    expect([...loaded.images.keys()]).toEqual(["users", "confirm"]);
    expect(loaded.sizes.users).toMatchObject({ width: 980, height: 420 });
    expect(loaded.images.get("confirm")?.designChanged).toBe(true);
    expect(loaded.images.get("users")?.nodes["I10:3;5:1"]).toEqual([16, 12, 32, 32]);
  });

  test("a checked hash that differs from the recorded one marks the design changed", async () => {
    const { cache } = project("hashes");
    const file = path.join(cache, `${FRAME}.json`);
    const entry = JSON.parse(readFileSync(file, "utf8"));
    const [a, b] = ["a".repeat(64), "b".repeat(64)];
    const changed = async (fields: Record<string, string>) => {
      writeFileSync(file, JSON.stringify({ ...entry, ...fields }));
      return (await loadReferences(fixtureBoard(), { dir: cache })).images.get("users")
        ?.designChanged;
    };
    expect(await changed({ contentHash: a, pixelHash: a })).toBe(false);
    expect(await changed({ contentHash: a, checkedContentHash: a })).toBe(false);
    expect(await changed({ contentHash: a, checkedContentHash: b })).toBe(true);
    expect(await changed({ pixelHash: a, checkedPixelHash: b })).toBe(true);
  });

  test("a missing cache directory is nothing cached, without a warning", async () => {
    const loaded = await loadReferences(fixtureBoard(), { dir: path.join(base, "nowhere") });
    expect([loaded.frames, loaded.cached, loaded.warnings]).toEqual([2, 0, []]);
  });

  test("refuses an image over the per-image cap and a board over the total cap", async () => {
    const big = await loadReferences(fixtureBoard(), { dir: cacheDir, maxImageBytes: 1000 });
    expect(big.cached).toBe(1); // the 573-byte state image fits, the 1868-byte one does not
    expect(big.warnings[0]).toMatch(/screen `users`.*larger than/);
    const total = await loadReferences(fixtureBoard(), { dir: cacheDir, maxBoardBytes: 2000 });
    expect(total.cached).toBe(1);
    expect(total.warnings[0]).toMatch(/screen `confirm`.*exceeds the total size/);
  });

  test("reads nothing through a symlink or outside the atlas", async () => {
    const { cache, atlas } = project("links");
    const outside = path.join(base, "outside");
    mkdirSync(outside);
    cpSync(path.join(cache, `${FRAME}.png`), path.join(outside, "frame.png"));
    rmSync(path.join(cache, `${FRAME}.png`));
    symlinkSync(path.join(outside, "frame.png"), path.join(cache, `${FRAME}.png`));
    const linked = await loadReferences(fixtureBoard(), { dir: cache, within: atlas });
    expect(linked.images.has("users")).toBe(false);
    expect(linked.warnings[0]).toMatch(/symlink/);

    // The cache directory itself resolving outside the atlas is refused before any read.
    const { atlas: other } = project("dir-link");
    rmSync(path.join(other, ".cache"), { recursive: true });
    symlinkSync(path.join(atlasDir, ".cache"), path.join(other, ".cache"));
    const escaped = await loadReferences(fixtureBoard(), {
      dir: path.join(other, FIGMA_CACHE_DIR),
      within: other,
    });
    expect(escaped.cached).toBe(0);
    expect(escaped.warnings).toEqual([
      "reference images not read: the cache directory resolves outside the atlas",
    ]);
  });

  test("skips an entry that does not match its image, its name, or the schema", async () => {
    const { cache } = project("broken");
    const entryFile = path.join(cache, `${FRAME}.json`);
    const entry = JSON.parse(readFileSync(entryFile, "utf8"));
    writeFileSync(entryFile, JSON.stringify({ ...entry, image: { ...entry.image, width: 10 } }));
    const wrongSize = await loadReferences(fixtureBoard(), { dir: cache });
    expect(wrongSize.warnings[0]).toMatch(/980×420 but its entry says 10×420/);
    writeFileSync(entryFile, JSON.stringify({ ...entry, nodeId: "10:2" }));
    expect((await loadReferences(fixtureBoard(), { dir: cache })).warnings[0]).toMatch(
      /another Figma node/,
    );
    writeFileSync(entryFile, "{");
    expect((await loadReferences(fixtureBoard(), { dir: cache })).warnings[0]).toMatch(
      /not valid JSON/,
    );
    writeFileSync(entryFile, JSON.stringify(entry));
    writeFileSync(path.join(cache, `${FRAME}.png`), "not a png");
    expect((await loadReferences(fixtureBoard(), { dir: cache })).warnings[0]).toMatch(/not a PNG/);
  });

  test("pngSize reads the header and refuses anything else", () => {
    const png = readFileSync(path.join(fixture, "figma-cache", `${FRAME}.png`));
    expect(pngSize(png)).toEqual({ width: 980, height: 420 });
    expect(pngSize(Buffer.from("GIF89a................."))).toBeNull();
  });
});

describe("renderBoard with references", () => {
  test("a board with nothing cached renders exactly as without references", async () => {
    const input = JSON.parse(readFileSync(path.join(fixture, ".groundboard", BOARD), "utf8"));
    const plain = await renderBoard(input);
    const none = await renderBoard(input, { references: { dir: path.join(base, "nowhere") } });
    expect(JSON.stringify(none.scene)).toBe(JSON.stringify(plain.scene));
    expect(none.references).toEqual({ frames: 2, cached: 0 });
    expect(plain.references).toBeUndefined();
  });

  test("draws the cached images and counts them", async () => {
    const input = JSON.parse(readFileSync(path.join(fixture, ".groundboard", BOARD), "utf8"));
    const result = await renderBoard(input, { references: { dir: cacheDir } });
    expect(result.references).toEqual({ frames: 2, cached: 2 });
    expect(Object.keys(result.scene?.files ?? {})).toHaveLength(2);
  });
});

describe("GET /api/atlas/boards/:slug", () => {
  const get = (app: ReturnType<typeof createApp>["app"], url: string) =>
    app.request(url, { headers: { host: "localhost:8787" } });

  test("adds the cached images by default, and leaves them out with ?references=0", async () => {
    const root = path.dirname(atlasDir);
    const { app, close } = createApp({ atlas: { dir: atlasDir, root } });
    const withImages = await get(app, "/api/atlas/boards/web--users");
    expect(withImages.status).toBe(200);
    const body = (await withImages.json()) as {
      scene: { elements: Array<{ id: string }>; files: Record<string, unknown> };
      references: unknown;
    };
    expect(body.references).toEqual({ frames: 2, cached: 2 });
    expect(Object.keys(body.scene.files)).toHaveLength(2);
    expect(body.scene.elements.some((e) => e.id === "refimg/users")).toBe(true);

    const without = await get(app, "/api/atlas/boards/web--users?references=0");
    const plain = (await without.json()) as typeof body;
    expect(plain.references).toBeUndefined();
    expect(plain.scene.files).toEqual({});
    expect(plain.scene.elements.some((e) => e.id.startsWith("refimg/"))).toBe(false);
    await close();
  }, 30_000);

  test("says when the board cites Figma but nothing is cached", async () => {
    const { atlas, cache } = project("empty");
    rmSync(cache, { recursive: true });
    const { app, close } = createApp({ atlas: { dir: atlas, root: path.dirname(atlas) } });
    const body = (await (await get(app, "/api/atlas/boards/web--users")).json()) as {
      references: unknown;
      scene: { files: Record<string, unknown> };
    };
    expect(body.references).toEqual({ frames: 2, cached: 0 });
    expect(body.scene.files).toEqual({});
    await close();
  }, 30_000);
});
