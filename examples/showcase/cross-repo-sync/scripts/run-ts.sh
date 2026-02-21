#!/usr/bin/env bash
# Cross-runtime TypeScript runner.
# Bun's node shim runs .ts natively; real Node.js needs tsx.
SCRIPT="$1"
shift
if node -e "process.exit(typeof Bun === 'undefined' ? 1 : 0)" 2>/dev/null; then
  exec node "$SCRIPT" "$@"
else
  exec node --import tsx "$SCRIPT" "$@"
fi
