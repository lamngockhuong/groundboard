#!/usr/bin/env node
// Points the Claude Code plugin at a published groundboard version: sets the plugin's
// `version`, the `groundboard@X.Y.Z` argument its MCP server runs through npx, and the metadata
// version of every skill. Run only after `npm publish` of that version succeeded.
//
//   node scripts/bump-plugin-version.mjs <version>

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function bumpPluginVersion(version, root = path.resolve(import.meta.dirname, "..")) {
  if (!SEMVER.test(version)) throw new Error(`not a version: ${JSON.stringify(version)}`);
  const file = (rel) => path.join(root, rel);

  const pluginPath = file("plugins/groundboard/.claude-plugin/plugin.json");
  const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
  plugin.version = version;
  writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`);

  const mcpPath = file("plugins/groundboard/.mcp.json");
  const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
  const args = mcp.mcpServers.groundboard.args;
  const index = args.findIndex((a) => typeof a === "string" && a.startsWith("groundboard@"));
  if (index === -1) throw new Error(".mcp.json has no groundboard@<version> argument");
  args[index] = `groundboard@${version}`;
  writeFileSync(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);

  for (const skillPath of skillFiles(root)) {
    const skill = readFileSync(skillPath, "utf8");
    const updated = skill.replace(/^( {2}version: ).*$/m, `$1${version}`);
    if (updated === skill && !skill.includes(`  version: ${version}`)) {
      throw new Error(`${path.relative(root, skillPath)} has no metadata version line`);
    }
    writeFileSync(skillPath, updated);
  }
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
