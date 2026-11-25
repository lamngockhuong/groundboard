#!/usr/bin/env node
// Development mode: the viewer from source with hot reload, in front of the built server.
//
//   pnpm dev                                  # a scratch copy of examples/fixtures
//   pnpm dev --root ../my-app                 # a real project's atlas (edits write into it)
//   pnpm dev --root ../my-app --atlas-dir docs/boards
//
// Starts `groundboard serve --atlas` from the build of packages/groundboard on 127.0.0.1:8788
// (GROUNDBOARD_DEV_PORT changes it) and Vite on 127.0.0.1:5173, which forwards /api and
// /fonts to it. Changes under apps/web reload in the browser; changes to the server or the
// other packages need `pnpm -r build` and a restart. Ctrl+C stops both.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repo = path.resolve(import.meta.dirname, "..");
const cli = path.join(repo, "packages", "groundboard", "dist", "cli.mjs");
const web = path.join(repo, "apps", "web");

const { values } = parseArgs({
  options: { root: { type: "string" }, "atlas-dir": { type: "string" } },
});
const port = Number(process.env.GROUNDBOARD_DEV_PORT ?? 8788);

if (!existsSync(cli)) {
  console.error(`${path.relative(repo, cli)} is missing; run "pnpm -r build" first.`);
  process.exit(1);
}

// Without --root the atlas is a scratch copy of the fixtures, so tags and layouts edited in
// the viewer never change the files the tests read.
let scratch = null;
let root = values.root ? path.resolve(values.root) : null;
if (root === null) {
  scratch = mkdtempSync(path.join(tmpdir(), "groundboard-dev-"));
  cpSync(path.join(repo, "examples", "fixtures"), scratch, { recursive: true });
  root = scratch;
}
const atlasArgs = [
  "--root",
  root,
  ...(values["atlas-dir"] ? ["--atlas-dir", values["atlas-dir"]] : []),
];

const server = spawn(
  process.execPath,
  [cli, "serve", "--atlas", "--host", "127.0.0.1", "--port", String(port), ...atlasArgs],
  { stdio: "inherit" },
);

let stopping = false;
let vite = null;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  if (server.exitCode === null) server.kill("SIGTERM");
  await vite?.close();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  process.exit(code);
}

server.on("exit", (code) => {
  if (!stopping) console.error(`groundboard serve stopped (exit ${code}); stopping Vite.`);
  void stop(code ?? 1);
});
process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));

try {
  process.env.GROUNDBOARD_DEV_SERVER = `http://127.0.0.1:${port}`;
  const vitePath = createRequire(path.join(web, "package.json")).resolve("vite");
  const { createServer } = await import(pathToFileURL(vitePath).href);
  vite = await createServer({ root: web, configFile: path.join(web, "vite.config.ts") });
  await vite.listen();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await stop(1);
}
console.log(`\n  atlas:  ${root}${scratch ? " (scratch copy of examples/fixtures)" : ""}`);
console.log(`  server: http://127.0.0.1:${port}`);
vite.printUrls();
