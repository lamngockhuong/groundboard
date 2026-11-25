import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FIGMA_CACHE_DIR } from "@groundboard/schema";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { renderBoard } from "../pipeline.ts";
import { decodePng, encodePng } from "../png.ts";
import { run } from "./index.ts";
import type { CliIO } from "./io.ts";

const fixture = path.resolve(import.meta.dirname, "../../../../examples/fixtures/figma");
const BOARD = "web--users.board.json";
const NAME = "AbCdEf0123456789-10-1";
const FRAME_XML = readFileSync(path.join(fixture, "metadata", `${NAME}.xml`), "utf8");
const LOGO_XML = readFileSync(path.join(fixture, "metadata", "AbCdEf0123456789-I10-3.xml"), "utf8");
const FIXTURE_ENTRY = JSON.parse(
  readFileSync(path.join(fixture, "figma-cache", `${NAME}.json`), "utf8"),
);

let base: string;
let count = 0;

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), "groundboard-figma-")));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** A project with the fixture board, the metadata answers and the frame image, nothing cached. */
function project(): { root: string; atlas: string; cache: string } {
  const root = path.join(base, `p${count++}`);
  const atlas = path.join(root, ".groundboard");
  mkdirSync(atlas, { recursive: true });
  cpSync(path.join(fixture, ".groundboard", BOARD), path.join(atlas, BOARD));
  mkdirSync(path.join(root, "figma-in"));
  writeFileSync(path.join(root, "figma-in", "frame.xml"), FRAME_XML);
  writeFileSync(path.join(root, "figma-in", "logo.xml"), LOGO_XML);
  cpSync(
    path.join(fixture, "figma-cache", `${NAME}.png`),
    path.join(root, "figma-in", "frame.png"),
  );
  return { root, atlas, cache: path.join(atlas, FIGMA_CACHE_DIR) };
}

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

async function entry(cwd: string, ...args: string[]) {
  const io = capture(cwd);
  const code = await run(["figma", "entry", ...args], io);
  return { code, out: io.out, err: io.err };
}

const WRITE = [
  `.groundboard/${BOARD}`,
  "--frame",
  "figma-in/frame.xml",
  "--instance",
  "figma-in/logo.xml",
  "--image",
  "figma-in/frame.png",
];

const readEntry = (cache: string, name = NAME) =>
  JSON.parse(readFileSync(path.join(cache, `${name}.json`), "utf8"));

describe("figma entry", () => {
  test("writes the entry, the image and the cache .gitignore, with the boxes of every cited layer", async () => {
    const { root, cache } = project();
    const result = await entry(root, ...WRITE, "--origin", "10,6");
    expect(result.code, result.err).toBe(0);
    expect(result.out).toMatch(
      /wrote \.groundboard\/\.cache\/figma\/AbCdEf0123456789-10-1\.json: 7 box/,
    );
    const written = readEntry(cache);
    expect(written).toMatchObject({
      fileKey: "AbCdEf0123456789",
      nodeId: "10:1",
      image: { width: 980, height: 420, originX: 10, originY: 6 },
      nodes: FIXTURE_ENTRY.nodes,
    });
    expect(written.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(written.pixelHash).toMatch(/^[0-9a-f]{64}$/);
    expect(written.checkedAt).toBeUndefined();
    expect(readFileSync(path.join(cache, `${NAME}.png`))).toEqual(
      readFileSync(path.join(root, "figma-in", "frame.png")),
    );
    expect(readFileSync(path.join(cache, "..", ".gitignore"), "utf8")).toBe("*\n");
    expect(`${result.out}${result.err}${JSON.stringify(written)}`).not.toMatch(/https?:|token/i);
  });

  test("warns about a cited layer inside an instance whose outline was not given", async () => {
    const { root, cache } = project();
    const result = await entry(
      root,
      ...WRITE.filter((a) => !a.includes("logo") && a !== "--instance"),
      "--origin",
      "10,6",
    );
    expect(result.code, result.err).toBe(0);
    expect(result.err).toMatch(/warning: `logo` cite\(s\) I10:3;5:1.*--instance/);
    expect(readEntry(cache).nodes["I10:3;5:1"]).toBeUndefined();
  });

  test("asks for --origin when the extra pixels could lie on either side", async () => {
    const { root, cache } = project();
    const result = await entry(root, ...WRITE);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(
      /cannot tell where frame 10:1 lies inside .*left and right edges.*--origin/,
    );
    expect(existsSync(path.join(cache, `${NAME}.json`))).toBe(false);
  });

  test("gives (0, 0) when the image has the frame's size, even with a layer at x = -1", async () => {
    const { root, cache } = project();
    writeFileSync(
      path.join(root, "figma-in", "frame.xml"),
      FRAME_XML.replace(
        '<frame id="10:2" name="Header" x="0"',
        '<frame id="10:2" name="Header" x="-1"',
      ),
    );
    const blank = { width: 960, height: 408, data: new Uint8Array(960 * 408 * 4).fill(255) };
    writeFileSync(path.join(root, "figma-in", "frame.png"), encodePng(blank));
    const result = await entry(root, ...WRITE);
    expect(result.code, result.err).toBe(0);
    expect(readEntry(cache).image).toEqual({ width: 960, height: 408, originX: 0, originY: 0 });
    expect(readEntry(cache).nodes["10:2"]).toEqual([-1, 0, 960, 56]);
  });

  describe("a frame shared by two boards", () => {
    const second = {
      schemaVersion: 1,
      title: "Users screen for admins",
      question: "What is on the admin users screen?",
      nodes: [
        {
          id: "admin-users",
          kind: "screen",
          label: "Admin users",
          ref: "web:admin-users",
          platform: "web",
          layoutFrom: "figma",
          sourceIds: ["fig-frame"],
        },
        {
          id: "toolbar",
          kind: "element",
          role: "container",
          label: "Toolbar",
          parentId: "admin-users",
          sourceIds: ["fig-toolbar"],
        },
      ],
      edges: [],
      sources: [
        { id: "fig-frame", kind: "figma", fileKey: "AbCdEf0123456789", nodeId: "10:1" },
        { id: "fig-toolbar", kind: "figma", fileKey: "AbCdEf0123456789", nodeId: "10:7" },
      ],
    };
    const SECOND = ".groundboard/web--admin-users.board.json";

    test("keeps the first board's boxes when the outline is unchanged", async () => {
      const { root, atlas, cache } = project();
      writeFileSync(path.join(root, SECOND), JSON.stringify(second));
      expect((await entry(root, ...WRITE, "--origin", "10,6")).code).toBe(0);
      const result = await entry(root, SECOND, ...WRITE.slice(1), "--origin", "10,6");
      expect(result.code, result.err).toBe(0);
      expect(result.out).toMatch(/1 box\(es\) for this board, 7 kept from the earlier entry/);
      expect(readEntry(cache).nodes).toEqual({
        ...FIXTURE_ENTRY.nodes,
        "10:7": [16, 120, 928, 36],
      });
      expect(existsSync(path.join(atlas, BOARD))).toBe(true);
    });

    test("replaces them when the outline changed", async () => {
      const { root, cache } = project();
      writeFileSync(path.join(root, SECOND), JSON.stringify(second));
      expect((await entry(root, ...WRITE, "--origin", "10,6")).code).toBe(0);
      writeFileSync(
        path.join(root, "figma-in", "frame.xml"),
        FRAME_XML.replace('name="Users" x="16"', 'name="All users" x="16"'),
      );
      const result = await entry(root, SECOND, ...WRITE.slice(1), "--origin", "10,6");
      expect(result.code, result.err).toBe(0);
      expect(result.out).toMatch(/the earlier entry replaced \(the outline changed\)/);
      expect(readEntry(cache).nodes).toEqual({ "10:7": [16, 120, 928, 36] });
    });
  });

  describe("--check", () => {
    const CHECK = WRITE.filter((arg, i) => arg !== "--image" && WRITE[i - 1] !== "--image");

    test("records the checked hash and leaves the rest alone when nothing changed", async () => {
      const { root, cache } = project();
      expect((await entry(root, ...WRITE, "--origin", "10,6")).code).toBe(0);
      const before = readEntry(cache);
      const result = await entry(root, ...CHECK, "--check");
      expect(result.code, result.err).toBe(0);
      expect(result.out).toMatch(/outline unchanged; pixels not checked/);
      const after = readEntry(cache);
      expect(after).toEqual({
        ...before,
        checkedAt: after.checkedAt,
        checkedContentHash: before.contentHash,
      });
    });

    test("an outline or pixels that changed put 'design changed since fetch' in the caption", async () => {
      const { root, atlas, cache } = project();
      expect((await entry(root, ...WRITE, "--origin", "10,6")).code).toBe(0);
      const caption = async () => {
        const rendered = await renderBoard(
          JSON.parse(readFileSync(path.join(atlas, BOARD), "utf8")),
          {
            references: { dir: cache },
          },
        );
        const element = rendered.scene?.elements.find((e) => e.id === "refimg/users/caption");
        return element?.type === "text" ? element.text : "";
      };
      expect(await caption()).not.toContain("design changed");

      // the same outline, different pixels
      const pixels = decodePng(readFileSync(path.join(root, "figma-in", "frame.png")));
      pixels.data[0] = (pixels.data[0] ?? 0) ^ 0xff;
      writeFileSync(path.join(root, "figma-in", "recolored.png"), encodePng(pixels));
      const recolored = await entry(root, ...CHECK, "--check", "--image", "figma-in/recolored.png");
      expect(recolored.out).toMatch(/outline unchanged; pixels changed since fetch/);
      expect(await caption()).toContain("design changed since fetch");
      // the cached image is not replaced by the one checked
      expect(readFileSync(path.join(cache, `${NAME}.png`))).toEqual(
        readFileSync(path.join(root, "figma-in", "frame.png")),
      );

      writeFileSync(
        path.join(root, "figma-in", "frame.xml"),
        FRAME_XML.replace('width="200" height="32"', 'width="240" height="32"'),
      );
      const moved = await entry(root, ...CHECK, "--check");
      expect(moved.out).toMatch(/outline changed since fetch/);
      const checked = readEntry(cache);
      expect(checked.checkedContentHash).not.toBe(checked.contentHash);
      expect(await caption()).toContain("design changed since fetch");
    });

    test("an entry written before hashes takes the check as its baseline", async () => {
      const { root, cache } = project();
      mkdirSync(cache, { recursive: true });
      writeFileSync(path.join(cache, `${NAME}.json`), JSON.stringify(FIXTURE_ENTRY));
      const result = await entry(root, ...CHECK, "--check");
      expect(result.code, result.err).toBe(0);
      expect(result.out).toMatch(/outline recorded as the baseline/);
      const checked = readEntry(cache);
      expect(checked.contentHash).toBe(checked.checkedContentHash);
      expect(checked.nodes).toEqual(FIXTURE_ENTRY.nodes);
      expect(checked.fetchedAt).toBe(FIXTURE_ENTRY.fetchedAt);
    });

    test("refuses to check an entry that does not exist", async () => {
      const { root } = project();
      const result = await entry(root, ...CHECK, "--check");
      expect(result.code).toBe(3);
      expect(result.err).toMatch(/no usable cache entry/);
    });
  });

  test("--check-image draws the frame outline and the cited boxes on a copy of the image", async () => {
    const { root } = project();
    const result = await entry(root, ...WRITE, "--origin", "10,6", "--check-image", "check.png");
    expect(result.code, result.err).toBe(0);
    const original = decodePng(readFileSync(path.join(root, "figma-in", "frame.png")));
    const drawn = decodePng(readFileSync(path.join(root, "check.png")));
    expect([drawn.width, drawn.height]).toEqual([original.width, original.height]);
    const at = (image: typeof drawn, x: number, y: number) => [
      ...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4),
    ];
    // the frame's bottom edge (red) and the Delete button's right edge (blue), away from labels
    expect(at(drawn, 500, 6 + 408 - 1)).toEqual([224, 49, 49, 255]);
    expect(at(drawn, 10 + 836 + 108 - 1, 6 + 120 + 30)).toEqual([25, 113, 194, 255]);
    // a pixel inside no box is untouched
    expect(at(drawn, 500, 300)).toEqual(at(original, 500, 300));
  });

  test("refuses bad arguments and a frame no screen cites", async () => {
    const { root } = project();
    expect(
      (await entry(root, `.groundboard/${BOARD}`, "--image", "figma-in/frame.png")).err,
    ).toMatch(/--frame <frame.xml> is required/);
    expect((await entry(root, ...WRITE.slice(0, 5))).err).toMatch(
      /--image <frame.png> is required/,
    );
    expect((await entry(root, ...WRITE, "--origin", "-1,2")).code).toBe(2);
    writeFileSync(
      path.join(root, "figma-in", "other.xml"),
      '<frame id="99:1" width="1" height="1"/>',
    );
    const other = await entry(
      root,
      `.groundboard/${BOARD}`,
      "--frame",
      "figma-in/other.xml",
      "--image",
      "figma-in/frame.png",
    );
    expect(other.code).toBe(3);
    expect(other.err).toMatch(/no screen of .* cites Figma node 99:1/);
  });
});
