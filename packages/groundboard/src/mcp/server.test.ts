import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { IR_GUIDE } from "../ir-guide.ts";
import { resolveRoot } from "./file-access.ts";
import { buildServer, type FileAccess } from "./server.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const example = (name: string) =>
  JSON.parse(readFileSync(path.join(repoRoot, "examples", `${name}.board.json`), "utf8"));

const base = mkdtempSync(path.join(tmpdir(), "groundboard-mcp-"));
const root = path.join(base, "project");

beforeAll(() => {
  mkdirSync(path.join(root, "examples"), { recursive: true });
  // The examples cite examples/fixtures/..., so copy them into the temporary project.
  cpSync(path.join(repoRoot, "examples", "fixtures"), path.join(root, "examples", "fixtures"), {
    recursive: true,
  });
  mkdirSync(path.join(base, "outside"));
  symlinkSync(path.join(base, "outside"), path.join(root, "escape"));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

async function connect(fileAccess: FileAccess) {
  const server = buildServer({ fileAccess });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

type CallResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: Array<{ type: string; text?: string }>;
};

async function call(fileAccess: FileAccess, name: string, args: Record<string, unknown>) {
  const client = await connect(fileAccess);
  try {
    return (await client.callTool({ name, arguments: args })) as CallResult;
  } finally {
    await client.close();
  }
}

describe("MCP tools in process", () => {
  test("lists the four tools", async () => {
    const client = await connect(false);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_atlas",
      "get_board_schema",
      "render_board",
      "validate_board",
    ]);
    await client.close();
  });

  test("get_board_schema returns the schema and the guide", async () => {
    const result = await call(false, "get_board_schema", {});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.guide).toBe(IR_GUIDE);
    const schema = result.structuredContent?.schema as { title: string } | undefined;
    expect(schema?.title).toBe("groundboard board");
  });

  test.each(["checkout-flow", "order-state-machine"])("render_board renders %s", async (name) => {
    const result = await call(false, "render_board", { board: example(name) });
    expect(result.isError).toBeFalsy();
    const scene = result.structuredContent?.scene as { type: string };
    expect(scene.type).toBe("excalidraw");
    // The examples cite their design notes as code, which adds a "cites a document" warning.
    const warnings = result.structuredContent?.warnings as string[];
    expect(warnings.filter((w) => !/cites a document as code/.test(w))).toEqual([
      expect.stringMatching(/sources not checked/),
    ]);
  });

  test("render_board returns path-precise issues as a tool error", async () => {
    const board = example("checkout-flow");
    board.nodes[0].sourceIds = [];
    const result = await call(false, "render_board", { board });
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.issues).toEqual([
      expect.objectContaining({ path: "nodes[0].sourceIds" }),
    ]);
    expect(result.content[0]?.text).toContain("nodes[0].sourceIds");
  });

  test("validate_board checks sources inside the root", async () => {
    const result = await call({ root }, "validate_board", {
      board: example("checkout-flow"),
      checkSourcesRoot: ".",
    });
    expect(result.isError, JSON.stringify(result)).toBeFalsy();
    expect(result.structuredContent?.sourcesChecked).toEqual({ root: "working tree" });
  });

  test("render_board writes inside .groundboard/ and may overwrite its own scene", async () => {
    for (let i = 0; i < 2; i++) {
      const result = await call({ root }, "render_board", {
        board: example("order-state-machine"),
        checkSourcesRoot: root,
        outputPath: ".groundboard/osm.excalidraw",
      });
      expect(result.isError, JSON.stringify(result)).toBeFalsy();
      expect(result.structuredContent?.path).toBe(path.join(".groundboard", "osm.excalidraw"));
    }
    const scene = JSON.parse(
      readFileSync(path.join(root, ".groundboard", "osm.excalidraw"), "utf8"),
    );
    expect(scene.elements.find((e: { id: string }) => e.id === "title-status").text).toBe(
      "Sources checked against the working tree",
    );
  });

  test("render_board applies the overlay beside its outputPath, and only there", async () => {
    const dir = path.join(root, ".groundboard");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "laid.overlay.json"),
      JSON.stringify({
        schemaVersion: 1,
        nodes: {},
        notes: [{ id: "hi", type: "rectangle", x: 0, y: 0, width: 5, height: 5 }],
      }),
    );
    const result = await call({ root }, "render_board", {
      board: example("checkout-flow"),
      outputPath: ".groundboard/laid.excalidraw",
    });
    expect(result.isError, JSON.stringify(result)).toBeFalsy();
    const scene = JSON.parse(readFileSync(path.join(dir, "laid.excalidraw"), "utf8"));
    expect(scene.elements.some((e: { id: string }) => e.id === "note/hi")).toBe(true);
    // Without outputPath nothing is read from disk.
    const inline = await call({ root }, "render_board", { board: example("checkout-flow") });
    const inlineScene = inline.structuredContent?.scene as { elements: Array<{ id: string }> };
    const elements = inlineScene.elements;
    expect(elements.some((e) => e.id === "note/hi")).toBe(false);
  });

  test.each([
    ["/", /must be the project root or a directory inside it/],
    [homedir(), /must be the project root or a directory inside it/],
    ["escape", /must be the project root or a directory inside it/],
    ["..", /must be the project root or a directory inside it/],
  ])("refuses checkSourcesRoot %s", async (dir, pattern) => {
    const result = await call({ root }, "validate_board", {
      board: example("checkout-flow"),
      checkSourcesRoot: dir,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(pattern);
  });

  test.each([
    ["out.excalidraw", /inside \.groundboard\//],
    ["../out.excalidraw", /inside \.groundboard\//],
    [".groundboard/out.json", /must end in \.excalidraw/],
    [path.join(base, "outside", "x.excalidraw"), /inside \.groundboard\//],
  ])("refuses outputPath %s", async (outputPath, pattern) => {
    const result = await call({ root }, "render_board", {
      board: example("checkout-flow"),
      outputPath,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(pattern);
  });

  test("refuses outputPath through a symlinked parent", async () => {
    mkdirSync(path.join(root, ".groundboard"), { recursive: true });
    symlinkSync(path.join(base, "outside"), path.join(root, ".groundboard", "linked"));
    const result = await call({ root }, "render_board", {
      board: example("checkout-flow"),
      outputPath: ".groundboard/linked/x.excalidraw",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/symlink/);
  });

  test("refuses to overwrite a file groundboard did not write", async () => {
    mkdirSync(path.join(root, ".groundboard"), { recursive: true });
    writeFileSync(
      path.join(root, ".groundboard", "mine.excalidraw"),
      '{"type":"excalidraw","source":"someone"}',
    );
    const result = await call({ root }, "render_board", {
      board: example("checkout-flow"),
      outputPath: ".groundboard/mine.excalidraw",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/did not write/);
    expect(readFileSync(path.join(root, ".groundboard", "mine.excalidraw"), "utf8")).toContain(
      "someone",
    );
  });

  test("concurrent writes to one outputPath leave a valid scene", async () => {
    const outputPath = ".groundboard/race.excalidraw";
    const results = await Promise.all(
      ["checkout-flow", "order-state-machine", "checkout-flow", "order-state-machine"].map((name) =>
        call({ root }, "render_board", { board: example(name), outputPath }),
      ),
    );
    expect(
      results.every((r) => !r.isError),
      JSON.stringify(results.map((r) => r.content)),
    ).toBe(true);
    const scene = JSON.parse(readFileSync(path.join(root, outputPath), "utf8"));
    expect(scene.type).toBe("excalidraw");
  });

  test("refuses both file arguments without file access", async () => {
    for (const args of [{ checkSourcesRoot: "." }, { outputPath: ".groundboard/x.excalidraw" }]) {
      const result = await call(false, "render_board", {
        board: example("checkout-flow"),
        ...args,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/no file access/);
    }
  });

  test("check_atlas reads the atlas inside the root and reports a dangling ref", async () => {
    const atlasDir = path.join(root, "atlas");
    mkdirSync(atlasDir, { recursive: true });
    const flow = example("checkout-flow");
    flow.nodes[0].ref = "web:checkout/pay-button";
    writeFileSync(path.join(atlasDir, "checkout-flow.board.json"), JSON.stringify(flow));
    const result = await call({ root }, "check_atlas", { dir: "atlas", checkSourcesRoot: "." });
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.boards).toEqual([
      expect.objectContaining({ slug: "checkout-flow", kind: "flow", status: "ok" }),
    ]);
    expect(result.content[0]?.text).toMatch(/no board defines it/);

    flow.nodes[0].ref = undefined;
    writeFileSync(path.join(atlasDir, "checkout-flow.board.json"), JSON.stringify(flow));
    const clean = await call({ root }, "check_atlas", { dir: "atlas" });
    expect(clean.isError).toBeFalsy();
    expect(clean.content[0]?.text).toMatch(/The atlas is clean: 1 board/);
  });

  test("check_atlas refuses a dir outside the root and runs only with file access", async () => {
    const outside = await call({ root }, "check_atlas", { dir: "escape" });
    expect(outside.isError).toBe(true);
    expect(outside.content[0]?.text).toMatch(
      /dir must be the project root or a directory inside it/,
    );
    const noFiles = await call(false, "check_atlas", {});
    expect(noFiles.isError).toBe(true);
    expect(noFiles.content[0]?.text).toMatch(/no file access/);
  });
});

describe("resolveRoot", () => {
  test("uses GROUNDBOARD_ROOT, else the working directory", async () => {
    expect(await resolveRoot({ GROUNDBOARD_ROOT: root }, "/")).toEqual({ ok: true, root });
    expect(await resolveRoot({}, root)).toEqual({ ok: true, root });
    expect(await resolveRoot({ GROUNDBOARD_ROOT: "" }, root)).toEqual({ ok: true, root });
  });

  test("refuses a filesystem root or the home directory", async () => {
    expect((await resolveRoot({}, "/")).ok).toBe(false);
    expect((await resolveRoot({ GROUNDBOARD_ROOT: "/" }, root)).ok).toBe(false);
    expect((await resolveRoot({}, root, root)).ok).toBe(false);
    expect((await resolveRoot({}, path.join(base, "missing"))).ok).toBe(false);
  });
});
