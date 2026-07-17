#!/usr/bin/env bash
set -euo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node --experimental-strip-types "$HOOK_DIR/learning/claude-runtime.ts"
