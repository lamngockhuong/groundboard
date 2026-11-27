#!/usr/bin/env node
// Writes THIRD_PARTY_NOTICES.md into the build output: name, version, licence, source and the
// full licence and NOTICE texts of every third-party package the published package depends on
// at runtime or bundles into the web viewer, plus the licences of fonts the viewer ships.

import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { privatePackageNames } from "../../../scripts/private-packages.mjs";

const packageDir = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageDir, "../..");
const outDir = path.join(packageDir, "dist");
const MODULES = "node_modules";

/** Finds an installed package the way Node does: walk up from `fromDir`. */
function resolvePackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, MODULES, name, "package.json");
    if (existsSync(candidate)) return realpathSync(path.dirname(candidate));
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function licenceFiles(dir) {
  return readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice)(\.|-|$)/i.test(f))
    .sort()
    .map((f) => ({ name: f, text: readFileSync(path.join(dir, f), "utf8").trim() }));
}

function repositoryUrl(pkg) {
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return repo ? repo.replace(/^git\+/, "").replace(/\.git$/, "") : (pkg.homepage ?? "");
}

/**
 * Collects `dependencies` (and installed optional ones) of each root, transitively. `pick` names
 * the packages a root starts from (its `dependencies` by default); packages named in `skip` are
 * left out with everything only they bring in.
 */
export function collect(
  roots,
  { pick = (pkg) => Object.keys(pkg.dependencies ?? {}), skip = [] } = {},
) {
  const seen = new Map();
  const internal = new Set(privatePackageNames());
  const visit = (name, fromDir) => {
    if (skip.includes(name)) return;
    const dir = resolvePackageDir(name, fromDir);
    if (!dir) return;
    const pkg = readJson(path.join(dir, "package.json"));
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) return;
    if (internal.has(pkg.name)) return;
    seen.set(key, {
      name: pkg.name,
      version: pkg.version,
      license: typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "UNKNOWN"),
      source: repositoryUrl(pkg),
      files: licenceFiles(dir),
    });
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      visit(dep, dir);
    }
  };
  for (const root of roots) {
    const pkg = readJson(path.join(root, "package.json"));
    for (const dep of pick(pkg)) visit(dep, root);
  }
  return [...seen.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

/** Fonts the viewer ships, with the licence each is used under (apps/web/font-licenses). */
function fontLicences() {
  const dir = path.join(repoRoot, "apps", "web", "font-licenses");
  const manifest = path.join(dir, "fonts.json");
  if (!existsSync(manifest) || !existsSync(path.join(outDir, "web", "fonts"))) return [];
  return readJson(manifest).map((font) => {
    if (!existsSync(path.join(outDir, "web", "fonts", font.family))) {
      throw new Error(`fonts.json lists ${font.family}, which the viewer build does not ship`);
    }
    return { ...font, text: readFileSync(path.join(dir, font.licenseFile), "utf8").trim() };
  });
}

function render(packages, fonts) {
  const lines = [
    "# Third-party notices",
    "",
    "groundboard is MIT licensed. It depends on, or ships in its web viewer, the third-party",
    "software listed below. Each entry gives the licence it is used under and the full licence",
    "and notice texts its authors publish. The packages are used unmodified.",
    "",
  ];
  for (const p of packages) {
    lines.push(`## ${p.name}@${p.version}`, "", `- Licence: ${p.license}`);
    if (p.source) lines.push(`- Source: ${p.source}`);
    lines.push("");
    if (p.files.length === 0) lines.push("No licence file is shipped in the package.", "");
    for (const f of p.files) lines.push(`### ${f.name}`, "", "```text", f.text, "```", "");
  }
  if (fonts.length > 0) {
    lines.push("# Fonts shipped with the web viewer", "");
    for (const font of fonts) {
      lines.push(`## ${font.family}`, "", `- Licence: ${font.license}`, `- Source: ${font.source}`);
      lines.push(`- ${font.copyright}`, "", "```text", font.text, "```", "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// Imported by packages/png/scripts/generate-notices.mjs for `collect`; writes only when run.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedDirectly) {
  const roots = [packageDir];
  const webDir = path.join(repoRoot, "apps", "web");
  if (existsSync(path.join(webDir, "package.json"))) roots.push(webDir);
  const packages = collect(roots);
  const fonts = fontLicences();
  writeFileSync(path.join(outDir, "THIRD_PARTY_NOTICES.md"), render(packages, fonts));
  console.log(`THIRD_PARTY_NOTICES.md: ${packages.length} packages, ${fonts.length} font families`);
}
