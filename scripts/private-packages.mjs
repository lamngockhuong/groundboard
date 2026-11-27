// Names of the workspace packages marked `"private": true` (packages/* and apps/*). They are
// internal: `groundboard` bundles them and nothing published may name them. Workspace packages
// that are published, such as @groundboard/png, are not in the list.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

export function privatePackageNames(root = repoRoot) {
  const names = [];
  for (const group of ["packages", "apps"]) {
    const dir = path.join(root, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir).sort()) {
      const file = path.join(dir, entry, "package.json");
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      if (pkg.private === true && typeof pkg.name === "string") names.push(pkg.name);
    }
  }
  return names;
}

/** The names as one regular-expression alternation. */
export function namesAlternation(names = privatePackageNames()) {
  return names.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|");
}

/** Matches a package name or a subpath of it (`@groundboard/layout/overlay`). */
export function privatePackagePattern(names = privatePackageNames()) {
  return new RegExp(`^(?:${namesAlternation(names)})(?:/|$)`);
}
