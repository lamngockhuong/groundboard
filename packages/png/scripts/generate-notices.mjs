#!/usr/bin/env node
// Writes dist/THIRD_PARTY_NOTICES.md: every third-party package this package bundles (Excalidraw,
// React, linkedom and what they bring in) or installs (resvg), with its licence and notice texts,
// and the licences of the fonts in dist/fonts.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { collect } from "../../groundboard/scripts/generate-notices.mjs";

const packageDir = path.resolve(import.meta.dirname, "..");
const outDir = path.join(packageDir, "dist");
const fontLicenseDir = path.resolve(packageDir, "../../apps/web/font-licenses");

/** The devDependencies tsdown bundles into dist (tsdown.config.ts). */
const BUNDLED = ["@excalidraw/excalidraw", "linkedom", "react", "react-dom"];
/** Replaced by a stub at build time (src/stubs/), so nothing of it ships. */
const STUBBED = ["@excalidraw/mermaid-to-excalidraw"];

const packages = collect([packageDir], {
  pick: (pkg) => [...Object.keys(pkg.dependencies ?? {}), ...BUNDLED],
  skip: STUBBED,
});

const fonts = JSON.parse(readFileSync(path.join(fontLicenseDir, "fonts.json"), "utf8")).map(
  (font) => {
    if (!existsSync(path.join(outDir, "fonts", font.family))) {
      throw new Error(`fonts.json lists ${font.family}, which dist/fonts does not hold`);
    }
    return { ...font, text: readFileSync(path.join(fontLicenseDir, font.licenseFile), "utf8") };
  },
);

const lines = [
  "# Third-party notices",
  "",
  "groundboard-png is MIT licensed. It bundles or depends on the third-party software listed",
  "below. Each entry gives the licence it is used under and the full licence and notice texts its",
  "authors publish. The packages are used unmodified; @excalidraw/mermaid-to-excalidraw is",
  "replaced by a stub and not shipped.",
  "",
];
for (const p of packages) {
  lines.push(`## ${p.name}@${p.version}`, "", `- Licence: ${p.license}`);
  if (p.source) lines.push(`- Source: ${p.source}`);
  lines.push("");
  if (p.files.length === 0) lines.push("No licence file is shipped in the package.", "");
  for (const f of p.files) lines.push(`### ${f.name}`, "", "```text", f.text, "```", "");
}
lines.push(
  "# Fonts",
  "",
  "The fonts in dist/fonts are Excalidraw's, converted from woff2 to TrueType. dist/fonts/",
  "Nunito-merged/Nunito.ttf is a Modified Version of Nunito under the OFL: its subsets merged",
  "into one file (scripts/merge-nunito.py).",
  "",
);
for (const font of fonts) {
  lines.push(`## ${font.family}`, "", `- Licence: ${font.license}`, `- Source: ${font.source}`);
  lines.push(`- ${font.copyright}`, "", "```text", font.text.trim(), "```", "");
}
writeFileSync(path.join(outDir, "THIRD_PARTY_NOTICES.md"), `${lines.join("\n").trimEnd()}\n`);
console.log(`THIRD_PARTY_NOTICES.md: ${packages.length} packages, ${fonts.length} font families`);
