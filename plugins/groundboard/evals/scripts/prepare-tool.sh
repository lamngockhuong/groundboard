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

# A copy of the Node that runs this script. A run's agent gets a temporary HOME, so a version
# manager's shim finds no Node there. run-eval.sh puts this copy first on PATH, which is enough
# when nothing else comes before it.
node_prefix="$(dirname "$(dirname "$(node -p process.execPath)")")"
cp -R "$node_prefix" "$tool/node"
node_version="$("$tool/node/bin/node" -p 'process.versions.node')"
echo "copied Node $node_version from $node_prefix to $tool/node"

# With Volta, the agent's shell takes PATH from the login shell, where the Volta shims come
# first, and a shim reads its Node from $HOME/.volta. So keep the few files a shim reads; each
# run's scaffold writes them to the run's temporary HOME, with the Node copy as the only image.
if command -v volta >/dev/null 2>&1; then
  npm_version="$("$tool/node/bin/node" -p "require('$tool/node/lib/node_modules/npm/package.json').version")"
  mkdir -p "$tool/volta/tools/user" "$tool/volta/tools/inventory/node"
  touch "$tool/volta/layout.v4"
  printf '{ "node": { "runtime": "%s", "npm": null }, "pnpm": null, "yarn": null }\n' \
    "$node_version" > "$tool/volta/tools/user/platform.json"
  printf '%s' "$npm_version" > "$tool/volta/tools/inventory/node/node-v$node_version-npm"
  echo "Volta found: each run gets a Volta home whose default Node is $node_version"
fi
