#!/usr/bin/env bash
# Installs this repository's own build of groundboard and @groundboard/png into evals/.tool/,
# which every case's scaffold copies into its workspace. Run it after `pnpm -r build`, and again
# after any change under packages/. It needs the npm registry once, for the packages' dependencies.
set -euo pipefail

evals="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root="$(cd "$evals/../../.." && pwd)"
tool="$evals/.tool"

for pkg in groundboard png; do
  if [ ! -f "$root/packages/$pkg/dist/index.mjs" ]; then
    echo "packages/$pkg is not built: run pnpm install && pnpm -r build first" >&2
    exit 1
  fi
done

rm -rf "$tool"
mkdir -p "$tool/pack"
pnpm -C "$root/packages/groundboard" pack --pack-destination "$tool/pack" >/dev/null
pnpm -C "$root/packages/png" pack --pack-destination "$tool/pack" >/dev/null
cd "$tool"
printf '{ "name": "groundboard-eval-tool", "private": true }\n' > package.json
npm install --no-audit --no-fund --no-package-lock ./pack/*.tgz >/dev/null
echo "installed $(cd pack && echo *.tgz) in $tool"
