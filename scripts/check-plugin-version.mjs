#!/usr/bin/env node
// Checks that the Claude Code plugin is pinned consistently:
//   - plugin.json `version` equals the `groundboard@X` its MCP server runs through npx;
//   - that pin is not newer than packages/groundboard, so it names a version that exists;
//   - every skill's metadata version is the plugin's.
// The pin may trail the package: a release bumps packages/groundboard first, npm publishes,
// and only then a follow-up pull request moves the plugin (scripts/bump-plugin-version.mjs).

import { readFileSync } from "node:fs";
import path from "node:path";
import { skillFiles } from "./bump-plugin-version.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

export function pluginVersions(root = repoRoot) {
  const readAt = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
  const pkg = readAt("packages/groundboard/package.json").version;
  const plugin = readAt("plugins/groundboard/.claude-plugin/plugin.json").version;
  const args = readAt("plugins/groundboard/.mcp.json").mcpServers?.groundboard?.args ?? [];
  const pinnedArg = args.find((a) => typeof a === "string" && a.startsWith("groundboard@"));
  const pinned = pinnedArg ? pinnedArg.slice("groundboard@".length) : null;
  const skills = skillFiles(root).map((file) => ({
    skill: path.basename(path.dirname(file)),
    version: /^ {2}version: (.*)$/m.exec(readFileSync(file, "utf8"))?.[1]?.trim() ?? null,
  }));
  return { package: pkg, plugin, pinned, skills };
}

/** Semver precedence: negative when a < b. */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [main, pre] = v.split("-", 2);
    return { main: main.split(".").map(Number), pre: pre === undefined ? [] : pre.split(".") };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if (x.main[i] !== y.main[i]) return x.main[i] - y.main[i];
  }
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export function checkPluginVersions(v) {
  const problems = [];
  if (v.pinned === null) problems.push(".mcp.json does not run groundboard@<version>");
  else if (v.plugin !== v.pinned) {
    problems.push(`plugin.json is ${v.plugin} but .mcp.json pins groundboard@${v.pinned}`);
  } else if (compareVersions(v.pinned, v.package) > 0) {
    problems.push(`.mcp.json pins ${v.pinned}, newer than packages/groundboard ${v.package}`);
  }
  for (const { skill, version } of v.skills ?? []) {
    if (version !== v.plugin) {
      problems.push(
        `skills/${skill}/SKILL.md is ${version ?? "unversioned"} but plugin.json is ${v.plugin}`,
      );
    }
  }
  return problems;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedDirectly) {
  const v = pluginVersions();
  const problems = checkPluginVersions(v);
  if (problems.length > 0) {
    for (const p of problems) console.error(`check-plugin-version: ${p}`);
    process.exit(1);
  }
  const lag =
    v.pinned === v.package
      ? ""
      : ` (package is ${v.package}; the plugin moves after npm publishes it)`;
  console.log(`plugin pins groundboard@${v.pinned}${lag}`);
}
