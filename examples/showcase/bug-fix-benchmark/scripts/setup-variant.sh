#!/bin/bash
# Copy plugin configuration for a benchmark variant into the workspace.
# Called as a target-level before_each hook by agentv.
#
# Usage (called by agentv, not manually):
#   bash scripts/setup-variant.sh <variant>
#
# The workspace path is received via stdin JSON from agentv:
#   { "workspace_path": "/tmp/agentv-workspace-xxx", ... }
#
# Variants: baseline, superpowers, compound, agent-skills

set -e

VARIANT="${1:?Usage: setup-variant.sh <variant>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VARIANT_DIR="$SCRIPT_DIR/../workspaces/$VARIANT"

# Read workspace_path from stdin JSON
WORKSPACE_PATH="$(cat | python3 -c "import sys,json; print(json.load(sys.stdin)['workspace_path'])" 2>/dev/null || true)"

if [[ -z "$WORKSPACE_PATH" ]]; then
  echo "Error: No workspace_path received via stdin" >&2
  exit 1
fi

if [[ ! -d "$VARIANT_DIR" ]]; then
  echo "Error: Unknown variant '$VARIANT' (no directory at $VARIANT_DIR)" >&2
  exit 1
fi

# Copy variant config files into the workspace
mkdir -p "$WORKSPACE_PATH/.claude"

if [[ -f "$VARIANT_DIR/.claude/settings.json" ]]; then
  cp "$VARIANT_DIR/.claude/settings.json" "$WORKSPACE_PATH/.claude/settings.json"
fi

if [[ -f "$VARIANT_DIR/CLAUDE.md" ]]; then
  cp "$VARIANT_DIR/CLAUDE.md" "$WORKSPACE_PATH/CLAUDE.md"
fi

echo "Configured variant '$VARIANT' in $WORKSPACE_PATH"
