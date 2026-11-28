#!/usr/bin/env bash
# Runs `claude plugin eval` on this plugin with what every case needs: the scaffold, the tool
# grants the board skill uses, and the Node copied by prepare-tool.sh first on PATH (the scaffold
# also gives Volta shims a home with that Node). Extra arguments are passed through:
#   scripts/run-eval.sh --case checkout-why-declined --runs 1 --ablation none --keep-temp
set -euo pipefail

plugin="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tool="$plugin/evals/.tool"
if [ ! -x "$tool/node/bin/node" ] || [ ! -d "$tool/node_modules/groundboard" ]; then
  echo "no local groundboard build or Node in evals/.tool: run evals/scripts/prepare-tool.sh" >&2
  exit 1
fi

cd "$plugin"
PATH="$tool/node/bin:$PATH" exec claude plugin eval . "$@" \
  --scaffold --trust-plugin --no-publish \
  --allow-tools Write Edit "Bash(npx groundboard:*)" "Bash(npx -y -p groundboard@:*)" \
  "Bash(git remote get-url:*)" "Bash(git rev-parse:*)" "Bash(git status:*)" "Bash(git branch:*)"
