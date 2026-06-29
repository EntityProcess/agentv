#!/usr/bin/env bash
# Cross-runtime TypeScript runner.
# Bun runs .ts files natively; real Node.js needs tsx.
SCRIPT="$1"
shift
if command -v bun >/dev/null 2>&1; then
  exec bun "$SCRIPT" "$@"
else
  exec node --import tsx "$SCRIPT" "$@"
fi
