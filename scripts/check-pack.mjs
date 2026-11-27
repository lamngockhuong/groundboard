#!/usr/bin/env node
// Packs the published packages, `groundboard` and `@groundboard/png` (scripts/pack.mjs), and
// checks each tarball before anything is published:
//   - package.json has no `workspace:` specifier, no devDependencies, and names no private
//     workspace package (scripts/private-packages.mjs);
//   - no shipped file imports a private workspace package;
//   - THIRD_PARTY_NOTICES.md, LICENSE, README.md and npm-shrinkwrap.json are inside, and both
//     packages have the same version;
//   - in an empty directory, `npx <groundboard> render <example>` works, `png` without
//     @groundboard/png prints the command that installs it, and `png` with both tarballs draws
//     the example as a PNG;
//   - with --measure, reports the cold start of `npx <tarball> mcp` (empty npm cache), so the
//     plugin's first start can be tracked.
// Usage: node scripts/check-pack.mjs [--tarball <groundboard.tgz>] [--png-tarball <png.tgz>] [--measure]

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { packStage, stagePackage } from "./pack.mjs";
import { namesAlternation, privatePackageNames } from "./private-packages.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    tarball: { type: "string" },
    "png-tarball": { type: "string" },
    measure: { type: "boolean" },
  },
});

const work = mkdtempSync(path.join(tmpdir(), "groundboard-check-pack-"));
const failures = [];
const fail = (message) => failures.push(message);
const versions = {};
const internal = privatePackageNames();
const importsInternal = new RegExp(`["'\`](?:${namesAlternation(internal)})(?:/|["'\`])`);

/** Unpacks a tarball and checks what every published package must hold. */
function checkTarball(tarball, label, required) {
  const unpacked = path.join(work, `unpacked-${label}`);
  execFileSync("mkdir", ["-p", unpacked]);
  execFileSync("tar", ["-xzf", tarball, "-C", unpacked]);
  const root = path.join(unpacked, "package");
  const files = execFileSync("find", [root, "-type", "f"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((f) => path.relative(root, f))
    .sort();

  const pkgText = readFileSync(path.join(root, "package.json"), "utf8");
  if (pkgText.includes("workspace:"))
    fail(`${label}: package.json contains a workspace: specifier`);
  const pkg = JSON.parse(pkgText);
  if (pkg.devDependencies) fail(`${label}: package.json still lists devDependencies`);
  const named = Object.keys({
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
  });
  for (const name of named.filter((n) => internal.includes(n))) {
    fail(`${label}: package.json depends on the private package ${name}`);
  }
  for (const file of files.filter((f) => /\.(m?js|d\.mts|json)$/.test(f))) {
    const text = readFileSync(path.join(root, file), "utf8");
    if (importsInternal.test(text)) fail(`${label}: ${file} refers to a private workspace package`);
  }
  for (const file of [
    "LICENSE",
    "README.md",
    "npm-shrinkwrap.json",
    "dist/THIRD_PARTY_NOTICES.md",
    ...required,
  ]) {
    if (!files.includes(file)) fail(`${label}: tarball is missing ${file}`);
  }
  const size = statSync(tarball).size;
  versions[label] = pkg.version;
  console.log(
    `tarball: ${path.basename(tarball)} ${(size / 1024).toFixed(1)} kB, ${files.length} files`,
  );
}

try {
  const tarball = values.tarball
    ? path.resolve(values.tarball)
    : packStage(stagePackage(path.join(work, "package")), work);
  const pngTarball = values["png-tarball"]
    ? path.resolve(values["png-tarball"])
    : packStage(stagePackage(path.join(work, "package-png"), "png"), work);
  checkTarball(tarball, "groundboard", ["dist/cli.mjs", "dist/layout-worker.mjs"]);
  checkTarball(pngTarball, "@groundboard/png", [
    "dist/index.mjs",
    "dist/fonts/Nunito-merged/Nunito.ttf",
  ]);

  // The CLI names @groundboard/png@<its own version>; release-please links the two versions.
  if (versions.groundboard !== versions["@groundboard/png"]) {
    fail(
      `groundboard is ${versions.groundboard} but @groundboard/png is ${versions["@groundboard/png"]}`,
    );
  }

  // Smoke: run the packed CLI in an empty directory.
  const smoke = path.join(work, "smoke");
  execFileSync("mkdir", ["-p", smoke]);
  cpSync(
    path.join(repoRoot, "examples", "order-state-machine.board.json"),
    path.join(smoke, "board.json"),
  );
  const npx = (packages, args) =>
    spawnSync("npx", ["--yes", ...packages.map((p) => `--package=${p}`), "groundboard", ...args], {
      cwd: smoke,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: path.join(work, "npm-cache-smoke") },
    });
  const render = npx([tarball], ["render", "board.json", "-o", "out.excalidraw"]);
  const scene = existsSync(path.join(smoke, "out.excalidraw"))
    ? JSON.parse(readFileSync(path.join(smoke, "out.excalidraw"), "utf8"))
    : null;
  if (render.status !== 0 || scene?.type !== "excalidraw") {
    fail(`packed CLI did not write an Excalidraw scene: ${render.stderr.trim()}`);
  }

  // Without @groundboard/png, `png` names the command that installs it.
  const missing = npx([tarball], ["png", "board.json"]);
  if (missing.status !== 1 || !missing.stderr.includes("@groundboard/png@")) {
    fail(
      `packed CLI "png" without @groundboard/png: exit ${missing.status}, ${missing.stderr.trim()}`,
    );
  }
  // With both tarballs, as the install command runs them, it draws the board.
  const drawn = npx([tarball, pngTarball], ["png", "board.json", "-o", "board.png"]);
  const png = existsSync(path.join(smoke, "board.png"))
    ? readFileSync(path.join(smoke, "board.png"))
    : Buffer.alloc(0);
  if (drawn.status !== 0 || png.subarray(1, 4).toString("latin1") !== "PNG") {
    fail(`packed CLI "png" with @groundboard/png: exit ${drawn.status}, ${drawn.stderr.trim()}`);
  }

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
