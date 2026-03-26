#!/bin/bash
# Workspace before_all hook: copy skills into .agents/skills/ for agent discovery.
# Runs from the workspace root at eval startup.

set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(cd "$(dirname "$0")/../../../.." && pwd)")"

mkdir -p .agents/skills

# Copy agentic-engineering skills
cp -r "$REPO_ROOT/plugins/agentic-engineering/skills/agent-plugin-review" .agents/skills/
cp -r "$REPO_ROOT/plugins/agentic-engineering/skills/agent-architecture-design" .agents/skills/

# Copy agentv-dev eval review skill
cp -r "$REPO_ROOT/plugins/agentv-dev/skills/agentv-eval-review" .agents/skills/

echo "Skills copied to .agents/skills/"
ls .agents/skills/
