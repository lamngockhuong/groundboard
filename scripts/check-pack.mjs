#!/usr/bin/env node
// Packs `groundboard` (scripts/pack.mjs) and checks the tarball before anything is published:
//   - package.json has no `workspace:` specifier and names no private package;
//   - no shipped file imports a private `@groundboard/` package;
//   - THIRD_PARTY_NOTICES.md, LICENSE, README.md and npm-shrinkwrap.json are inside;
//   - `npx <tarball> render <example>` works in an empty directory, and `png` there prints the
//     command that installs groundboard-png instead of failing;
//   - with --measure, reports the tarball size and the cold start of `npx <tarball> mcp`
//     (empty npm cache), so the plugin's first start can be tracked.
// Usage: node scripts/check-pack.mjs [--tarball <file>] [--measure]

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { packStage, stagePackage } from "./pack.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: { tarball: { type: "string" }, measure: { type: "boolean" } },
});

const work = mkdtempSync(path.join(tmpdir(), "groundboard-check-pack-"));
const failures = [];
const fail = (message) => failures.push(message);

try {
  const tarball = values.tarball
    ? path.resolve(values.tarball)
    : packStage(stagePackage(path.join(work, "package")), work);
  const unpacked = path.join(work, "unpacked");
  execFileSync("mkdir", ["-p", unpacked]);
  execFileSync("tar", ["-xzf", tarball, "-C", unpacked]);
  const root = path.join(unpacked, "package");
  const files = execFileSync("find", [root, "-type", "f"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((f) => path.relative(root, f))
    .sort();

  const pkgText = readFileSync(path.join(root, "package.json"), "utf8");
  if (pkgText.includes("workspace:")) fail("package.json contains a workspace: specifier");
  if (pkgText.includes("@groundboard/")) fail("package.json names a private @groundboard/ package");
  const pkg = JSON.parse(pkgText);
  if (pkg.devDependencies) fail("package.json still lists devDependencies");

  for (const file of files.filter((f) => /\.(m?js|d\.mts|json)$/.test(f))) {
    const text = readFileSync(path.join(root, file), "utf8");
    if (/["'`]@groundboard\//.test(text)) fail(`${file} refers to a private @groundboard/ package`);
  }
  for (const required of [
    "LICENSE",
    "README.md",
    "npm-shrinkwrap.json",
    "dist/THIRD_PARTY_NOTICES.md",
    "dist/cli.mjs",
    "dist/layout-worker.mjs",
  ]) {
    if (!files.includes(required)) fail(`tarball is missing ${required}`);
  }

  // Smoke: run the packed CLI in an empty directory.
  const smoke = path.join(work, "smoke");
  execFileSync("mkdir", ["-p", smoke]);
  cpSync(
    path.join(repoRoot, "examples", "order-state-machine.board.json"),
    path.join(smoke, "board.json"),
  );
  execFileSync(
    "npx",
    [
      "--yes",
      `--package=${tarball}`,
      "groundboard",
      "render",
      "board.json",
      "-o",
      "out.excalidraw",
    ],
    {
      cwd: smoke,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, npm_config_cache: path.join(work, "npm-cache-smoke") },
    },
  );
  const scene = JSON.parse(readFileSync(path.join(smoke, "out.excalidraw"), "utf8"));
  if (scene.type !== "excalidraw") fail("packed CLI did not write an Excalidraw scene");

  // `png` needs the separate groundboard-png package; without it the CLI names the install command.
  const png = spawnSync(
    "npx",
    ["--yes", `--package=${tarball}`, "groundboard", "png", "board.json"],
    {
      cwd: smoke,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: path.join(work, "npm-cache-smoke") },
    },
  );
  if (png.status !== 1 || !png.stderr.includes("groundboard-png@")) {
    fail(`packed CLI "png" without groundboard-png: exit ${png.status}, ${png.stderr.trim()}`);
  }

  const size = statSync(tarball).size;
  console.log(
    `tarball: ${path.basename(tarball)} ${(size / 1024).toFixed(1)} kB, ${files.length} files`,
  );

  if (values.measure) {
    const cold = await coldStart(tarball, path.join(work, "npm-cache-cold"), smoke);
    console.log(`cold start of "npx <tarball> mcp" with an empty npm cache: ${cold} ms`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

/** Time from spawning `npx <tarball> mcp` to the server answering an initialize request. */
function coldStart(tarball, cache, cwd) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn("npx", ["--yes", `--package=${tarball}`, "groundboard", "mcp"], {
      cwd,
      env: { ...process.env, npm_config_cache: cache },
      stdio: ["pipe", "pipe", "inherit"],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("mcp did not answer within 120 s"));
    }, 120_000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes('"result"')) {
        clearTimeout(timer);
        const elapsed = Math.round(performance.now() - started);
        child.kill();
        resolve(elapsed);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`mcp exited with code ${code} before answering`));
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "check-pack", version: "0" },
        },
      })}\n`,
    );
  });
}

if (failures.length > 0) {
  console.error(`check-pack: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("check-pack: ok");
