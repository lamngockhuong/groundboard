import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { bumpPluginVersion } from "./bump-plugin-version.mjs";
import { checkPluginVersions, compareVersions, pluginVersions } from "./check-plugin-version.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
let tmp;

function copyRepoParts() {
  tmp = mkdtempSync(path.join(tmpdir(), "plugin-version-"));
  for (const rel of ["plugins", "packages/groundboard/package.json"]) {
    cpSync(path.join(repoRoot, rel), path.join(tmp, rel), { recursive: true });
  }
  return tmp;
}

afterEach(() => tmp && rmSync(tmp, { recursive: true, force: true }));

test("the committed plugin pin is consistent", () => {
  expect(checkPluginVersions(pluginVersions(repoRoot))).toEqual([]);
});

test("the pin may trail the package during a release, never lead it or disagree", () => {
  expect(checkPluginVersions({ package: "0.2.0", plugin: "0.1.0", pinned: "0.1.0" })).toEqual([]);
  expect(checkPluginVersions({ package: "0.1.0", plugin: "0.2.0", pinned: "0.2.0" })).toHaveLength(
    1,
  );
  expect(checkPluginVersions({ package: "0.1.0", plugin: "0.1.0", pinned: "0.0.9" })).toHaveLength(
    1,
  );
  expect(checkPluginVersions({ package: "0.1.0", plugin: "0.1.0", pinned: null })).toHaveLength(1);
});

test("compares versions by semver precedence", () => {
  const sorted = ["1.0.0", "0.1.0", "0.1.0-rc.10", "0.1.0-rc.2", "0.1.0-rc.0", "0.0.9"].sort(
    compareVersions,
  );
  expect(sorted).toEqual(["0.0.9", "0.1.0-rc.0", "0.1.0-rc.2", "0.1.0-rc.10", "0.1.0", "1.0.0"]);
});

test("bump-plugin-version moves the plugin, the npx pin and every skill's metadata together", () => {
  const root = copyRepoParts();
  bumpPluginVersion("1.2.3", root);
  const v = pluginVersions(root);
  expect(v.plugin).toBe("1.2.3");
  expect(v.pinned).toBe("1.2.3");
  expect(v.skills.length).toBeGreaterThan(1);
  for (const { skill, version } of v.skills) expect(version, skill).toBe("1.2.3");
  const skill = readFileSync(path.join(root, "plugins/groundboard/skills/board/SKILL.md"), "utf8");
  expect(skill).toContain("  version: 1.2.3\n");
  expect(() => bumpPluginVersion("latest", root)).toThrow(/not a version/);
});

test("a skill whose version differs from the plugin's fails the check", () => {
  const root = copyRepoParts();
  const file = path.join(root, "plugins/groundboard/skills/atlas/SKILL.md");
  writeFileSync(file, readFileSync(file, "utf8").replace(/^( {2}version: ).*$/m, "$19.9.9"));
  expect(checkPluginVersions(pluginVersions(root))).toEqual([
    expect.stringMatching(/^skills\/atlas\/SKILL\.md is 9\.9\.9 but plugin\.json is /),
  ]);
});
