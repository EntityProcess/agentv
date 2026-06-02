#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/setup-dashboard-deployment.sh [--no-start]

Build and start a Docker-backed AgentV Dashboard deployment seeded with the
AgentV examples project and a remote eval-results repository.

Environment:
  AGENTV_DEPLOY_DIR       Host deployment directory (default: ~/agentv-dashboard)
  AGENTV_EXAMPLES_REPO    Git URL for the AgentV examples source
                           (default: https://github.com/EntityProcess/agentv.git)
  AGENTV_EXAMPLES_REF     Branch or tag for AGENTV_EXAMPLES_REPO (default: main)
  AGENTV_RESULTS_REPO     GitHub owner/name or git URL for results
                           (default: EntityProcess/agentv-evalresults)
  AGENTV_UID              Container uid for mounted files (default: current uid)
  AGENTV_GID              Container gid for mounted files (default: current gid)
  PORT                    Host/container port (default: 3117)

Examples:
  scripts/setup-dashboard-deployment.sh
  AGENTV_RESULTS_REPO=EntityProcess/agentv-evalresults PORT=8080 scripts/setup-dashboard-deployment.sh
USAGE
}

start=1
for arg in "$@"; do
  case "$arg" in
    --help|-h)
      usage
      exit 0
      ;;
    --no-start)
      start=0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command docker
require_command git

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_dir="${AGENTV_DEPLOY_DIR:-$HOME/agentv-dashboard}"
examples_repo="${AGENTV_EXAMPLES_REPO:-https://github.com/EntityProcess/agentv.git}"
examples_ref="${AGENTV_EXAMPLES_REF:-main}"
results_repo="${AGENTV_RESULTS_REPO:-EntityProcess/agentv-evalresults}"
port="${PORT:-3117}"

home_dir="$deploy_dir/home"
source_dir="$deploy_dir/source/agentv"
project_dir="$deploy_dir/projects/agentv-examples"
results_dir="$deploy_dir/results/agentv-evalresults"

repo_to_url() {
  local repo="$1"
  if [[ "$repo" == *"://"* || "$repo" == git@* ]]; then
    printf '%s\n' "$repo"
  else
    printf 'https://github.com/%s.git\n' "${repo%.git}"
  fi
}

clone_or_update() {
  local url="$1"
  local ref="$2"
  local dest="$3"
  if [[ -d "$dest/.git" ]]; then
    git -C "$dest" fetch origin --prune
    git -C "$dest" checkout "$ref"
    git -C "$dest" pull --ff-only origin "$ref" || true
  else
    rm -rf "$dest"
    mkdir -p "$(dirname "$dest")"
    git clone --depth 1 --filter=blob:none --branch "$ref" "$url" "$dest"
  fi
}

clone_results_repo() {
  local repo="$1"
  local url
  url="$(repo_to_url "$repo")"
  if [[ -d "$results_dir/.git" ]]; then
    if git -C "$results_dir" rev-parse --verify HEAD >/dev/null 2>&1; then
      git -C "$results_dir" fetch origin --prune || true
      git -C "$results_dir" pull --ff-only || true
    fi
  else
    mkdir -p "$(dirname "$results_dir")"
    if ! git clone "$url" "$results_dir"; then
      cat >&2 <<EOF
Failed to clone results repository:
  $url

Create the repository first, or set AGENTV_RESULTS_REPO to an existing repo.
EOF
      exit 1
    fi
  fi
}

write_project_config() {
  mkdir -p "$project_dir/.agentv/results/runs"
  if [[ -f "$source_dir/.agentv/targets.yaml" ]]; then
    cp "$source_dir/.agentv/targets.yaml" "$project_dir/.agentv/targets.yaml"
  fi
  cat > "$project_dir/.agentv/config.yaml" <<EOF
\$schema: agentv-config-v2

eval_patterns:
  - "examples/**/*.eval.yaml"
  - "examples/**/EVAL.yaml"
  - "examples/**/dataset*.yaml"

results:
  mode: github
  repo: $results_repo
  path: /data/results/agentv-evalresults
  auto_push: false
  branch_prefix: eval-results

dashboard:
  project_dashboard: true
EOF
}

write_project_registry() {
  mkdir -p "$home_dir"
  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
  cat > "$home_dir/projects.yaml" <<EOF
projects:
  - id: agentv-examples
    name: AgentV Examples
    path: /data/projects/agentv-examples
    added_at: "$now"
    last_opened_at: "$now"
EOF
}

stage_examples_project() {
  rm -rf "$project_dir"
  mkdir -p "$project_dir"
  cp -R "$source_dir/examples" "$project_dir/examples"
  cp "$source_dir/README.md" "$project_dir/README.md"
}

mkdir -p "$deploy_dir"
clone_or_update "$examples_repo" "$examples_ref" "$source_dir"
clone_results_repo "$results_repo"
stage_examples_project
write_project_config
write_project_registry

export AGENTV_HOME_DIR="$home_dir"
export AGENTV_DATA_DIR_HOST="${AGENTV_DATA_DIR_HOST:-$home_dir/data}"
export AGENTV_PROJECTS_DIR="$project_dir"
export AGENTV_RESULTS_DIR="$results_dir"
export AGENTV_UID="${AGENTV_UID:-$(id -u)}"
export AGENTV_GID="${AGENTV_GID:-$(id -g)}"
export PORT="$port"

mkdir -p "$AGENTV_DATA_DIR_HOST"

docker compose -f "$repo_root/docker-compose.yml" config >/dev/null

if [[ "$start" -eq 1 ]]; then
  docker compose -f "$repo_root/docker-compose.yml" up --build -d
  echo "AgentV Dashboard: http://localhost:$port"
else
  cat <<EOF
Deployment files are ready in $deploy_dir.

Start later with:
  AGENTV_HOME_DIR=$home_dir \\
  AGENTV_DATA_DIR_HOST=${AGENTV_DATA_DIR_HOST} \\
  AGENTV_PROJECTS_DIR=$project_dir \\
  AGENTV_RESULTS_DIR=$results_dir \\
  AGENTV_UID=${AGENTV_UID} \\
  AGENTV_GID=${AGENTV_GID} \\
  PORT=$port \\
  docker compose -f $repo_root/docker-compose.yml up --build -d
EOF
fi
