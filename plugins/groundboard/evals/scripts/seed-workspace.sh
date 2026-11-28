#!/usr/bin/env bash
# Seeds one run's workspace (the current directory) for a case: the case's fixed fixture
# repository from <case>/repo/, committed as one commit, and the local groundboard build from
# evals/.tool/, so `npx groundboard` and `npx groundboard png` work without the network.
# Each case's scaffold.sh calls it with the case directory as its only argument.
set -euo pipefail

case_dir="$1"
tool="$case_dir/../.tool"
if [ ! -x "$tool/node_modules/.bin/groundboard" ]; then
  echo "no local groundboard build in evals/.tool: run plugins/groundboard/evals/scripts/prepare-tool.sh" >&2
  exit 1
fi

cp -R "$case_dir/repo/." .
cp -R "$tool/node_modules" node_modules
printf '{ "name": "fixture", "private": true }\n' > package.json
printf 'node_modules/\npackage.json\n' > .gitignore
git init -q
git add -A
git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "fixture"

# HOME here is the run's temporary home. Where prepare-tool.sh found Volta, give it a Volta home
# whose only Node is the copy in evals/.tool/node, so the Volta shims the agent's shell puts first
# on PATH run that Node instead of stopping with "Could not create directory .../.volta".
if [ -d "$tool/volta" ]; then
  node_version="$("$tool/node/bin/node" -p 'process.versions.node')"
  cp -R "$tool/volta" "$HOME/.volta"
  mkdir -p "$HOME/.volta/tools/image/node"
  cp -R "$tool/node" "$HOME/.volta/tools/image/node/$node_version"
fi
