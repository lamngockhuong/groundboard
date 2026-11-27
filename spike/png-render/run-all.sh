#!/usr/bin/env bash
# Reproduces the spike: renders the sample boards with option A (headless Chromium) and option B
# (Excalidraw exportToSvg under a DOM shim + resvg), compares them, and prints option C's text.
# Scratch prototype only; nothing here is wired into the groundboard CLI.
#
#   cd spike/png-render && pnpm install && ./run-all.sh
# Option A needs a Chromium that Playwright can launch (`npx playwright install chromium-headless-shell`)
# or add `--channel chrome` to use the installed Chrome.
set -euo pipefail
cd "$(dirname "$0")"
repo=../..
mkdir -p out

# The three scenes: a flow board, a screen wireframe, and the flow board with Vietnamese and Japanese labels.
node "$repo/packages/groundboard/src/cli.ts" render "$repo/examples/checkout-flow.board.json" -o out/checkout-flow.excalidraw
node "$repo/packages/groundboard/src/cli.ts" render "$repo/examples/fixtures/.groundboard/web--checkout.board.json" -o out/web--checkout.excalidraw
node "$repo/packages/groundboard/src/cli.ts" render i18n-checkout.board.json -o out/i18n-checkout.excalidraw

node bundle-excalidraw.mjs --minify
node fonts-to-ttf.mjs
# One merged Nunito named "Nunito" for the sans reading font; needs fontTools (pip install fonttools==4.60.1).
mkdir -p out/fonts-merged
${PYTHON:-python3} -I merge-subsets.py out/fonts/Nunito out/fonts-merged/Nunito.ttf Nunito

for board in checkout-flow web--checkout i18n-checkout; do
  for theme in light dark; do
    node render-a.mjs "out/$board.excalidraw" --theme "$theme"
    node render-b.mjs "out/$board.excalidraw" --theme "$theme" --dom linkedom
  done
done
node render-a.mjs out/checkout-flow.excalidraw --font sans
node render-b.mjs out/checkout-flow.excalidraw --font sans --dom linkedom
node compare.mjs checkout-flow-light checkout-flow-dark web--checkout-light web--checkout-dark i18n-checkout-light i18n-checkout-dark
node render-c.mjs out/checkout-flow.excalidraw
