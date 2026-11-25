#!/usr/bin/env node
// Copies the built viewer (apps/web) into this package's build output as `web/`, so
// `npx groundboard serve` works with nothing else installed. `pnpm -r build` builds the viewer
// first because this package lists it as a workspace devDependency.

import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const packageDir = path.resolve(import.meta.dirname, "..");
const source = path.resolve(packageDir, "../../apps/web/dist");
const target = path.join(packageDir, "dist", "web");

if (!existsSync(path.join(source, "index.html"))) {
  console.error(`copy-web: ${source} has no index.html; build @groundboard/web first`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`copy-web: viewer copied to ${path.relative(packageDir, target)}`);
