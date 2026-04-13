#!/bin/bash
# Install plugins into each workspace template for benchmark comparison.
# Run once before running the benchmark evals.
#
# Usage:
#   ./scripts/setup-plugins.sh          # Install all plugins
#   ./scripts/setup-plugins.sh --check  # Check which plugins are installed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACES_DIR="$SCRIPT_DIR/../workspaces"

# Plugin definitions
declare -A PLUGINS=(
  ["superpowers"]="superpowers@claude-plugins-official"
  ["compound"]="compound-engineering"
  ["agent-skills"]="agent-skills@addy-agent-skills"
)

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

check_mode=false
if [[ "${1:-}" == "--check" ]]; then
  check_mode=true
fi

echo "============================================"
echo " Bug Fix Benchmark — Plugin Setup"
echo "============================================"
echo ""

if $check_mode; then
  echo "Checking plugin installation status..."
  echo ""
fi

for workspace in baseline superpowers compound agent-skills; do
  workspace_dir="$WORKSPACES_DIR/$workspace"
  settings_file="$workspace_dir/.claude/settings.json"

  if [[ ! -d "$workspace_dir" ]]; then
    echo -e "${RED}✗ $workspace: workspace directory not found${NC}"
    continue
  fi

  if [[ "$workspace" == "baseline" ]]; then
    echo -e "${GREEN}✓ baseline: no plugins (by design)${NC}"
    continue
  fi

  plugin_id="${PLUGINS[$workspace]}"

  if [[ -z "$plugin_id" ]]; then
    echo -e "${RED}✗ $workspace: no plugin mapping defined${NC}"
    continue
  fi

  if $check_mode; then
    # Check if plugin is referenced in settings.json
    if grep -q "$plugin_id" "$settings_file" 2>/dev/null; then
      echo -e "${GREEN}✓ $workspace: $plugin_id configured in settings.json${NC}"
    else
      echo -e "${YELLOW}✗ $workspace: $plugin_id NOT found in settings.json${NC}"
      echo "  Run: /plugin install $plugin_id (from within $workspace_dir)"
    fi
    continue
  fi

  # Install the plugin
  echo ""
  echo -e "${YELLOW}Installing $plugin_id into $workspace...${NC}"
  echo "  Workspace: $workspace_dir"

  # Plugin installation requires running Claude Code in the workspace.
  # We use `claude -p` with a plugin install command.
  # Alternatively, users can manually install by opening Claude Code in the workspace.

  echo ""
  echo "  To install $plugin_id:"
  echo "    1. cd $workspace_dir"
  echo "    2. Run: claude"
  echo "    3. Type: /plugin install $plugin_id"
  echo "    4. Confirm installation"
  echo ""
  echo -e "  ${YELLOW}Or use the one-liner:${NC}"
  echo "    cd $workspace_dir && claude -p '/plugin install $plugin_id' --allowedTools 'Bash(*)'"
  echo ""

  # Attempt automated install via claude -p
  if command -v claude &>/dev/null; then
    echo -e "${GREEN}  Attempting automated install...${NC}"
    cd "$workspace_dir"
    if claude -p "Install the plugin $plugin_id. Use the /plugin install command." \
         --allowedTools "Bash(*)" \
         --max-turns 5 \
         --output-format stream-json 2>/dev/null | grep -q "success\|installed"; then
      echo -e "${GREEN}  ✓ $plugin_id installed successfully${NC}"
    else
      echo -e "${YELLOW}  Automated install may not have succeeded.${NC}"
      echo "  Please verify manually."
    fi
  else
    echo -e "${RED}  claude CLI not found. Install manually.${NC}"
  fi

  echo ""
done

echo "============================================"
if $check_mode; then
  echo " Check complete."
else
  echo " Setup complete."
fi
echo ""
echo "Next steps:"
echo "  1. Verify plugins: ./scripts/setup-plugins.sh --check"
echo "  2. Run benchmark:  agentv eval evals/bug-fixes.eval.yaml --target claude-baseline"
echo "  3. Compare all:    agentv eval evals/bug-fixes.eval.yaml --target claude-baseline,claude-superpowers,claude-compound,claude-agent-skills"
echo "============================================"
