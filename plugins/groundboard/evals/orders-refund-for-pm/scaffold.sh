#!/usr/bin/env bash
# Seeds the workspace with this case's fixture repository and the local groundboard build.
set -euo pipefail
exec bash "$(dirname "${BASH_SOURCE[0]}")/../scripts/seed-workspace.sh" "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
