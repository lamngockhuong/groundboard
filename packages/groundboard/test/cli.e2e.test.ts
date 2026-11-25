// Spawns the built CLI (run `pnpm -r build` first; CI builds before testing).
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const packageDir = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageDir, "../..");
const cli = path.join(packageDir, "dist", "cli.mjs");
let tmp: string;

function run(args: string[], input?: string, cwd = repoRoot) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    input,
    timeout: 30_000,
  });
}

beforeAll(() => {
  if (!existsSync(cli)) throw new Error(`${cli} is missing; run "pnpm -r build" first`);
  tmp = mkdtempSync(path.join(tmpdir(), "groundboard-cli-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("groundboard CLI", () => {
  test("--version and --help", () => {
    const version = run(["--version"]);
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("render <board.json>");
  });

  test.each(["checkout-flow", "order-state-machine"])("renders %s with checked sources", (name) => {
    const out = path.join(tmp, `${name}.excalidraw`);
    const result = run([
      "render",
      `examples/${name}.board.json`,
      "-o",
      out,
      "--check-sources",
      ".",
      "--direction",
      "down",
    ]);
    expect(result.status, result.stderr).toBe(0);
    const scene = JSON.parse(readFileSync(out, "utf8"));
    expect(scene.type).toBe("excalidraw");
    expect(scene.elements.find((e: { id: string }) => e.id === "title-status").text).toBe(
      "Sources checked against the working tree",
    );
  });

  test("writes to stdout with -o - and warns that sources were not checked", () => {
    const result = run(["render", "examples/checkout-flow.board.json", "-o", "-"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).type).toBe("excalidraw");
    expect(result.stderr).toContain("sources not checked");
  });

  test("render --references embeds the cached Figma images; without it the scene has none", () => {
    const atlas = path.join(tmp, "refs", ".groundboard");
    const fixture = path.join(repoRoot, "examples/fixtures/figma");
    mkdirSync(path.join(atlas, ".cache"), { recursive: true });
    cpSync(path.join(fixture, ".groundboard"), atlas, { recursive: true });
    cpSync(path.join(fixture, "figma-cache"), path.join(atlas, ".cache", "figma"), {
      recursive: true,
    });
    const board = path.join(atlas, "web--users.board.json");
    const plain = run(["render", board, "-o", "-"]);
    expect(plain.status).toBe(0);
    expect(JSON.parse(plain.stdout).files).toEqual({});
    const drawn = run(["render", board, "-o", "-", "--references"]);
    expect(drawn.status).toBe(0);
    expect(Object.keys(JSON.parse(drawn.stdout).files)).toHaveLength(2);
    rmSync(path.join(atlas, ".cache"), { recursive: true });
    const missing = run(["render", board, "-o", "-", "--references"]);
    expect(missing.stderr).toContain("0 of 2 Figma frame(s) have a cached reference image");
  });

  test("figma entry writes the cache entry that render --references then draws, and --check finds a change", () => {
    const root = path.join(tmp, "figma-entry");
    const atlas = path.join(root, ".groundboard");
    const fixture = path.join(repoRoot, "examples/fixtures/figma");
    mkdirSync(atlas, { recursive: true });
    cpSync(path.join(fixture, ".groundboard"), atlas, { recursive: true });
    cpSync(path.join(fixture, "metadata"), path.join(root, "metadata"), { recursive: true });
    cpSync(
      path.join(fixture, "figma-cache", "AbCdEf0123456789-10-1.png"),
      path.join(root, "frame.png"),
    );
    const args = [
      "figma",
      "entry",
      ".groundboard/web--users.board.json",
      "--frame",
      "metadata/AbCdEf0123456789-10-1.xml",
      "--instance",
      "metadata/AbCdEf0123456789-I10-3.xml",
    ];
    const written = run([...args, "--image", "frame.png", "--origin", "10,6"], undefined, root);
    expect(written.status, written.stderr).toBe(0);
    expect(written.stdout).toContain("7 box(es) for this board");
    const cache = path.join(atlas, ".cache");
    expect(readFileSync(path.join(cache, ".gitignore"), "utf8")).toBe("*\n");
    const entry = JSON.parse(
      readFileSync(path.join(cache, "figma", "AbCdEf0123456789-10-1.json"), "utf8"),
    );
    expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const caption = () => {
      const drawn = run(
        ["render", ".groundboard/web--users.board.json", "-o", "-", "--references"],
        undefined,
        root,
      );
      expect(drawn.status, drawn.stderr).toBe(0);
      const scene = JSON.parse(drawn.stdout);
      return scene.elements.find((e: { id: string }) => e.id === "refimg/users/caption").text;
    };
    expect(caption()).not.toContain("design changed");

    const xml = path.join(root, "metadata", "AbCdEf0123456789-10-1.xml");
    writeFileSync(xml, readFileSync(xml, "utf8").replace('name="Help"', 'name="Support"'));
    const checked = run([...args, "--check"], undefined, root);
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stdout).toContain("outline changed since fetch");
    expect(caption()).toContain("design changed since fetch");
  });

  test("export writes the built viewer flagged as static, with the atlas and its boards", () => {
    const out = path.join(tmp, "export");
    const result = run([
      "export",
      "--atlas-dir",
      "examples/fixtures/.groundboard",
      "--root",
      "examples/fixtures",
      "--out",
      out,
      "--skip-cjk-fonts",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("exported 8 board(s)");
    expect(readFileSync(path.join(out, "index.html"), "utf8")).toContain(
      '<meta name="groundboard:mode" content="static" />',
    );
    expect(existsSync(path.join(out, "fonts", "Xiaolai"))).toBe(false);
    const atlas = JSON.parse(readFileSync(path.join(out, "data", "atlas.json"), "utf8"));
    expect(atlas.boards).toHaveLength(8);
    expect(atlas.exported.commit).toMatch(/^[0-9a-f]+$/);
    for (const board of atlas.boards) {
      expect(existsSync(path.join(out, "data", "boards", `${board.slug}.json`)), board.slug).toBe(
        true,
      );
    }
    // A second export into the same, now full, directory is refused.
    expect(run(["export", "--root", "examples/fixtures", "--out", out]).status).toBe(2);
  });

  test("reads the board from stdin", () => {
    const board = readFileSync(path.join(repoRoot, "examples/checkout-flow.board.json"), "utf8");
    const result = run(["validate", "-", "--json"], board);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).ok).toBe(true);
  });

  test("validate --check-sources passes the example and fails a copy with one quote changed", () => {
    expect(
      run(["validate", "examples/checkout-flow.board.json", "--check-sources", "."]).status,
    ).toBe(0);
    const board = JSON.parse(
      readFileSync(path.join(repoRoot, "examples/checkout-flow.board.json"), "utf8"),
    );
    board.sources[2].quote = "await gateway.charge(amount)";
    const copy = path.join(tmp, "changed.board.json");
    writeFileSync(copy, JSON.stringify(board));
    const result = run(["validate", copy, "--check-sources", "."]);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("sources[2].quote");
  });

  test("exit codes: 1 I/O, 2 usage, 3 invalid", () => {
    expect(run(["render", "examples/missing.board.json"]).status).toBe(1);
    expect(run(["render"]).status).toBe(2);
    expect(run(["frobnicate"]).status).toBe(2);
    expect(run(["render", "examples/checkout-flow.board.json", "--direction", "up"]).status).toBe(
      2,
    );
    expect(run(["render", "examples/checkout-flow.board.json", "--bogus"]).status).toBe(2);
    const bad = path.join(tmp, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(run(["validate", bad]).status).toBe(3);
    writeFileSync(bad, JSON.stringify({ schemaVersion: 9 }));
    expect(run(["validate", bad]).status).toBe(3);
  });

  test("schema prints the JSON Schema", () => {
    const result = run(["schema"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).title).toBe("groundboard board");
  });

  test("atlas check: 0 clean, 3 dangling or stale, 2 bad arguments, 1 unreadable", () => {
    const project = path.join(tmp, "atlas-project");
    const atlasDir = path.join(project, ".groundboard");
    mkdirSync(path.join(project, "src"), { recursive: true });
    mkdirSync(atlasDir, { recursive: true });
    writeFileSync(path.join(project, "src", "routes.tsx"), '<Route path="/cart" />\n');
    const board = {
      schemaVersion: 1,
      title: "Overview",
      question: "Which screens?",
      nodes: [
        {
          id: "cart",
          kind: "screen",
          label: "Cart",
          ref: "web:cart",
          platform: "web",
          layoutFrom: "code",
          sourceIds: ["r"],
        },
      ],
      sources: [{ id: "r", path: "src/routes.tsx", line: 1, quote: 'path="/cart"' }],
    };
    writeFileSync(path.join(atlasDir, "overview-web.board.json"), JSON.stringify(board));
    const clean = run(["atlas", "check"], undefined, project);
    expect(clean.status, clean.stderr).toBe(0);
    expect(clean.stdout).toContain("overview-web.board.json (overview): ok");

    const json = run(
      ["atlas", "check", ".groundboard", "--root", ".", "--json"],
      undefined,
      project,
    );
    expect(JSON.parse(json.stdout).refs[0].ref).toBe("web:cart");

    writeFileSync(
      path.join(atlasDir, "flow.board.json"),
      JSON.stringify({
        schemaVersion: 1,
        title: "Flow",
        question: "q",
        nodes: [{ id: "n", kind: "note", label: "see", ref: "web:checkout" }],
      }),
    );
    const dangling = run(["atlas", "check"], undefined, project);
    expect(dangling.status).toBe(3);
    expect(dangling.stderr).toContain("no board defines it");
    rmSync(path.join(atlasDir, "flow.board.json"));

    writeFileSync(path.join(project, "src", "routes.tsx"), "// moved\n");
    const stale = run(["atlas", "check"], undefined, project);
    expect(stale.status).toBe(3);
    expect(stale.stderr).toContain("overview-web.board.json (overview): stale");

    expect(run(["atlas"], undefined, project).status).toBe(2);
    expect(run(["atlas", "check", "../.."], undefined, project).status).toBe(2);
    expect(run(["atlas", "check", "--root", "/"], undefined, project).status).toBe(2);

    chmodSync(atlasDir, 0o000);
    try {
      expect(run(["atlas", "check"], undefined, project).status).toBe(1);
    } finally {
      chmodSync(atlasDir, 0o755);
    }
  });

  test("atlas check: grounding, --require and --baseline", () => {
    const spec = "examples/fixtures/lifecycle/spec";
    const args = ["atlas", "check", `${spec}/.groundboard`, "--root", spec];
    const plain = run(args);
    expect(plain.status, plain.stderr).toBe(0);
    expect(plain.stdout).toContain(
      "web--signup.board.json (screen): ok\n  grounding: code 0, spec 6, none 1",
    );
    expect(plain.stdout).toContain("grounding: code 0, spec 11, none 1");

    const code = run([...args, "--require", "code"]);
    expect(code.status).toBe(3);
    expect(code.stderr).toContain("overview-web.board.json: 5 claim(s) are not backed by code");
    const specLevel = run([...args, "--require", "spec"]);
    expect(specLevel.status).toBe(3);
    expect(specLevel.stderr).toContain("cite no specification or code (unresolved): nodes[7]");
    expect(run([...args, "--require", "figma"]).status).toBe(2);

    // A baseline equal to the atlas passes; it may sit outside --root but inside the cwd.
    const same = run([...args, "--baseline", `${spec}/.groundboard`]);
    expect(same.status, same.stderr).toBe(0);
    const copy = path.join(tmp, "lifecycle-copy");
    mkdirSync(path.join(copy, ".groundboard"), { recursive: true });
    for (const dir of ["docs", "design"]) {
      cpSync(path.join(repoRoot, spec, dir), path.join(copy, dir), { recursive: true });
    }
    const signup = JSON.parse(
      readFileSync(path.join(repoRoot, spec, ".groundboard", "web--signup.board.json"), "utf8"),
    );
    signup.nodes = signup.nodes.filter((n: { id: string }) => n.id !== "sign-in");
    writeFileSync(
      path.join(copy, ".groundboard", "web--signup.board.json"),
      JSON.stringify(signup),
    );
    cpSync(
      path.join(repoRoot, spec, ".groundboard", "overview-web.board.json"),
      path.join(copy, ".groundboard", "overview-web.board.json"),
    );
    const lost = run(
      ["atlas", "check", ".groundboard", "--baseline", path.join(repoRoot, spec, ".groundboard")],
      undefined,
      copy,
    );
    // The repository is neither inside the copy's root nor its cwd.
    expect(lost.status).toBe(2);
    expect(lost.stderr).toContain("--baseline must be the project root, the current directory,");
    cpSync(path.join(repoRoot, spec, ".groundboard"), path.join(copy, "baseline"), {
      recursive: true,
    });
    const gone = run(["atlas", "check", ".groundboard", "--baseline", "baseline"], undefined, copy);
    expect(gone.status).toBe(3);
    expect(gone.stderr).toContain("node id(s) in the baseline are gone: `sign-in`");
    expect(gone.stderr).toContain("ref(s) in the baseline are gone: `web:signup/sign-in`");
  });

  test("serve --atlas: refuses / and home as root, a dir outside the root, a public bind", () => {
    const project = path.join(tmp, "serve-project");
    mkdirSync(path.join(project, ".groundboard"), { recursive: true });
    const env = { ...process.env, GROUNDBOARD_TOKEN: "", GROUNDBOARD_ALLOWED_HOSTS: "" };
    const serve = (args: string[], extraEnv: Record<string, string> = {}) =>
      spawnSync(process.execPath, [cli, "serve", "--port", "0", ...args], {
        cwd: project,
        encoding: "utf8",
        timeout: 10_000,
        env: { ...env, ...extraEnv },
      });
    const root = serve(["--atlas", "--root", "/"]);
    expect(root.status).toBe(2);
    expect(root.stderr).toContain("filesystem root");
    expect(serve(["--atlas", "--root", homedir()]).stderr).toContain("home directory");
    const outside = serve(["--atlas", "--atlas-dir", tmp]);
    expect(outside.status).toBe(2);
    expect(outside.stderr).toContain(
      "--atlas-dir must be the project root or a directory inside it",
    );
    expect(serve(["--atlas-dir", ".groundboard"]).status).toBe(2);
    const open = serve(["--atlas", "--host", "0.0.0.0"]);
    expect(open.status).toBe(2);
    expect(open.stderr).toMatch(/GROUNDBOARD_TOKEN and GROUNDBOARD_ALLOWED_HOSTS/);
    expect(serve(["--atlas", "--host", "0.0.0.0"], { GROUNDBOARD_TOKEN: "t" }).status).toBe(2);
  });

  test("serve --atlas takes no value and starts on loopback", async () => {
    const project = path.join(tmp, "serve-project");
    mkdirSync(path.join(project, ".groundboard"), { recursive: true });
    const child = spawn(process.execPath, [cli, "serve", "--atlas", "--port", "0"], {
      cwd: project,
    });
    try {
      const line = await new Promise<string>((resolve, reject) => {
        let err = "";
        const timer = setTimeout(() => reject(new Error(`no start: ${err}`)), 15_000);
        child.stderr.on("data", (chunk: Buffer) => {
          err += chunk.toString("utf8");
          if (err.includes("listening")) {
            clearTimeout(timer);
            resolve(err);
          }
        });
        child.once("exit", (code) => reject(new Error(`exited ${code}: ${err}`)));
      });
      expect(line).toContain("serving the atlas in");
      const port = /:(\d+)/.exec(line.split("at http://")[1] ?? "")?.[1];
      const health = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(await health.json()).toMatchObject({ atlas: true });
      const atlas = await fetch(`http://127.0.0.1:${port}/api/atlas`);
      expect(await atlas.json()).toEqual({
        boards: [],
        refs: [],
        problems: [],
        atlasId: expect.stringMatching(/^[0-9a-f]{32}$/),
        tagsEditable: true,
      });
    } finally {
      child.kill();
    }
  }, 20_000);
});
