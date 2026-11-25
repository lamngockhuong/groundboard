#!/usr/bin/env node
// Stages the published `groundboard` package and packs it.
//
//   node scripts/pack.mjs [--stage <dir>] [--out <dir>]
//
// The stage holds exactly what npm publishes: the built output, README, LICENSE, a package.json
// without devDependencies or scripts (so no `workspace:` specifier or private package name can
// reach the registry), and an npm-shrinkwrap.json that pins the tested dependency tree for `npx`
// users. Run `pnpm -r build` first. Prints `{ "stage": ..., "tarball": ... }` as JSON.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageDir = path.join(repoRoot, "packages", "groundboard");
const BUILD = "dist";

export function stagePackage(stage) {
  const built = path.join(packageDir, BUILD);
  if (!existsSync(path.join(built, "cli.mjs"))) {
    throw new Error(`${built} is missing; run "pnpm -r build" first`);
  }
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(built, path.join(stage, BUILD), { recursive: true });
  cpSync(path.join(repoRoot, "README.md"), path.join(stage, "README.md"));
  cpSync(path.join(repoRoot, "LICENSE"), path.join(stage, "LICENSE"));

  const pkg = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
  delete pkg.devDependencies;
  delete pkg.scripts;
  // npm 11 leaves the shrinkwrap out of the tarball unless `files` names it.
  pkg.files = [...new Set([...(pkg.files ?? []), "npm-shrinkwrap.json"])];
  writeFileSync(path.join(stage, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

  const npm = (args) =>
    execFileSync("npm", args, {
      cwd: stage,
      stdio: ["ignore", "pipe", "inherit"],
      encoding: "utf8",
    });
  npm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
  npm(["shrinkwrap"]);
  return stage;
}

export function packStage(stage, outDir) {
  mkdirSync(outDir, { recursive: true });
  const out = execFileSync("npm", ["pack", "--json", "--pack-destination", outDir], {
    cwd: stage,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [info] = JSON.parse(out);
  return path.join(outDir, info.filename);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedDirectly) {
  const { values } = parseArgs({
    options: { stage: { type: "string" }, out: { type: "string" } },
  });
  const work = mkdtempSync(path.join(tmpdir(), "groundboard-pack-"));
  const stage = stagePackage(path.resolve(values.stage ?? path.join(work, "package")));
  const tarball = packStage(stage, path.resolve(values.out ?? work));
  console.log(JSON.stringify({ stage, tarball }));
}
