#!/usr/bin/env node
// Points the Claude Code plugin at a published groundboard version: sets the plugin's
// `version`, the `groundboard@X.Y.Z` argument its MCP server runs through npx, and the metadata
// version of every skill. Run only after `npm publish` of that version succeeded.
// Each file is edited in place, so the formatting the linter expects stays as it is.
//
//   node scripts/bump-plugin-version.mjs <version>

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function bumpPluginVersion(version, root = path.resolve(import.meta.dirname, "..")) {
  if (!SEMVER.test(version)) throw new Error(`not a version: ${JSON.stringify(version)}`);
  const file = (rel) => path.join(root, rel);

  replaceOnce(
    file("plugins/groundboard/.claude-plugin/plugin.json"),
    /^( {2}"version": )"[^"]*"/m,
    `$1"${version}"`,
    "plugin.json has no top-level version",
  );
  replaceOnce(
    file("plugins/groundboard/.mcp.json"),
    /"groundboard@[^"]*"/,
    `"groundboard@${version}"`,
    ".mcp.json has no groundboard@<version> argument",
  );

  for (const skillPath of skillFiles(root)) {
    const skill = readFileSync(skillPath, "utf8");
    const updated = skill.replace(/^( {2}version: ).*$/m, `$1${version}`);
    if (updated === skill && !skill.includes(`  version: ${version}`)) {
      throw new Error(`${path.relative(root, skillPath)} has no metadata version line`);
    }
    writeFileSync(skillPath, updated);
  }
}

/** Replaces the one match of `pattern` in a JSON file and checks the file still parses. */
function replaceOnce(filePath, pattern, replacement, missing) {
  const text = readFileSync(filePath, "utf8");
  if (!pattern.test(text)) throw new Error(missing);
  const updated = text.replace(pattern, replacement);
  JSON.parse(updated);
  writeFileSync(filePath, updated);
}

/** Every skill of the plugin: `plugins/groundboard/skills/<name>/SKILL.md`. */
export function skillFiles(root) {
  const dir = path.join(root, "plugins/groundboard/skills");
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(dir, e.name, "SKILL.md"))
    .sort();
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedDirectly) {
  const version = process.argv[2];
  if (!version) {
    console.error("usage: node scripts/bump-plugin-version.mjs <version>");
    process.exit(2);
  }
  bumpPluginVersion(version);
  console.log(`plugin now pins groundboard@${version}`);
}
