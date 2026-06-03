#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/bead-spawn-agent.sh [--check] <bead-id> [launcher args...]

Claim a Beads issue, record a launch note, then start a worker.

Environment:
  AGENTV_BEADS_CLI=auto|br|bd       Beads CLI to use. Default: auto.
  AGENTV_BEADS_DB=/path/to/db       Explicit .beads database path.
  AGENTV_LAUNCHER=auto|ep|ntm       Worker launcher. Default: auto.
  AGENTV_NTM_SESSION=<name>         NTM project/session name for ntm fallback.
  AGENTV_NTM_LABEL=<label>          NTM label. Default: bead id.
  AGENTV_NTM_CODEX_COUNT=<n>        Codex panes for ntm fallback. Default: 1.
  AGENTV_WORKER_PROMPT=<text>       Prompt for ntm fallback.

The wrapper prefers br only when the current issue store is br-readable. If the
repository still has the older bd/Dolt store, it uses bd instead of assuming br
can read that graph.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

candidate_dbs() {
  local root="$1"

  if [[ -n "${AGENTV_BEADS_DB:-}" ]]; then
    printf '%s\n' "$AGENTV_BEADS_DB"
    return
  fi

  for path in \
    "$root/.beads/beads.db" \
    "$root/.beads/issues.db" \
    "$root/.beads/dolt"; do
    [[ -f "$path" ]] && printf '%s\n' "$path"
  done

  git worktree list --porcelain 2>/dev/null \
    | awk '/^worktree / { sub(/^worktree /, ""); print }' \
    | while IFS= read -r worktree; do
      for path in \
        "$worktree/.beads/beads.db" \
        "$worktree/.beads/issues.db" \
        "$worktree/.beads/dolt"; do
        [[ -f "$path" ]] && printf '%s\n' "$path"
      done
    done

  return 0
}

first_matching_db() {
  local root="$1"
  candidate_dbs "$root" | awk 'NF { print; exit }'
}

br_has_issue() {
  local bead_id="$1"
  local db="$2"
  [[ "$(basename "$db")" != "dolt" ]] || return 1
  have br || return 1
  br --db "$db" show "$bead_id" --json >/dev/null 2>&1
}

bd_has_issue() {
  local bead_id="$1"
  local db="$2"
  have bd || return 1
  bd --db "$db" show "$bead_id" --json >/dev/null 2>&1
}

select_beads_cli() {
  local requested="$1"
  local bead_id="$2"
  local db="$3"

  case "$requested" in
    br)
      br_has_issue "$bead_id" "$db" || die "br cannot read bead $bead_id from $db"
      printf 'br\n'
      ;;
    bd)
      bd_has_issue "$bead_id" "$db" || die "bd cannot read bead $bead_id from $db"
      printf 'bd\n'
      ;;
    auto)
      if br_has_issue "$bead_id" "$db"; then
        printf 'br\n'
      elif bd_has_issue "$bead_id" "$db"; then
        printf 'bd\n'
      else
        die "neither br nor bd can read bead $bead_id from $db"
      fi
      ;;
    *)
      die "AGENTV_BEADS_CLI must be auto, br, or bd"
      ;;
  esac
}

claim_bead() {
  local cli="$1"
  local db="$2"
  local bead_id="$3"

  if [[ "$cli" == "br" ]]; then
    br --db "$db" update "$bead_id" --claim --json >/dev/null
  else
    bd --db "$db" update "$bead_id" --claim --json >/dev/null
  fi
}

note_bead() {
  local cli="$1"
  local db="$2"
  local bead_id="$3"
  local note="$4"

  if [[ "$cli" == "br" ]]; then
    br --db "$db" comments add "$bead_id" --message "$note" --json >/dev/null
  else
    bd --db "$db" note "$bead_id" "$note" >/dev/null
  fi
}

launch_with_ep() {
  local bead_id="$1"
  shift

  have ep-spawn-agent || die "ep-spawn-agent is not on PATH"
  EP_TASK_ID="$bead_id" BEAD_ID="$bead_id" AGENTV_BEAD_ID="$bead_id" ep-spawn-agent "$bead_id" "$@"
}

launch_with_ntm() {
  local root="$1"
  local bead_id="$2"
  shift 2

  have ntm || die "ntm is not on PATH"

  local session="${AGENTV_NTM_SESSION:-$(basename "$root")}"
  local label="${AGENTV_NTM_LABEL:-$bead_id}"
  local count="${AGENTV_NTM_CODEX_COUNT:-1}"
  local prompt="${AGENTV_WORKER_PROMPT:-Read AGENTS.md first. Work only on bead $bead_id. EP_TASK_ID=$bead_id BEAD_ID=$bead_id AGENTV_BEAD_ID=$bead_id. Inspect the bead graph before changing files, update the bead with notes, and push the scoped branch when complete.}"
  local projects_base
  projects_base="$(ntm config get projects_base 2>/dev/null || true)"

  if [[ -n "$projects_base" && ! -d "$projects_base/$session" ]]; then
    die "ntm session '$session' does not resolve under projects_base '$projects_base'. Set AGENTV_NTM_SESSION to a resolvable NTM project or create the NTM project first."
  fi

  EP_TASK_ID="$bead_id" BEAD_ID="$bead_id" AGENTV_BEAD_ID="$bead_id" \
    ntm spawn "$session" --label "$label" --cod="$count" --prompt "$prompt" "$@"
}

print_check() {
  local root="$1"
  local db="$2"
  local bead_id="$3"
  local cli="$4"
  local launcher="$5"
  local resolved_launcher="$launcher"
  local ntm_session="${AGENTV_NTM_SESSION:-$(basename "$root")}"
  local projects_base
  projects_base="$(ntm config get projects_base 2>/dev/null || true)"

  if [[ "$launcher" == "auto" ]]; then
    if have ep-spawn-agent; then
      resolved_launcher="ep"
    else
      resolved_launcher="ntm"
    fi
  fi

  cat <<EOF
bead_id: $bead_id
beads_cli: $cli
database_path: $db
launcher: $resolved_launcher
ep_spawn_agent_available: $(have ep-spawn-agent && printf true || printf false)
ntm_available: $(have ntm && printf true || printf false)
ntm_session: $ntm_session
ntm_projects_base: $projects_base
ntm_session_resolves: $([[ -n "$projects_base" && -d "$projects_base/$ntm_session" ]] && printf true || printf false)
EOF
}

main() {
  [[ "${1:-}" != "-h" && "${1:-}" != "--help" ]] || {
    usage
    exit 0
  }

  local check_only=false
  if [[ "${1:-}" == "--check" ]]; then
    check_only=true
    shift
  fi

  [[ $# -ge 1 ]] || {
    usage >&2
    exit 2
  }

  local bead_id="$1"
  shift

  local root db cli launcher
  root="$(repo_root)"
  db="$(first_matching_db "$root")"
  [[ -n "$db" ]] || die "no .beads database found; set AGENTV_BEADS_DB"

  cli="$(select_beads_cli "${AGENTV_BEADS_CLI:-auto}" "$bead_id" "$db")"
  launcher="${AGENTV_LAUNCHER:-auto}"

  case "$launcher" in
    ep | ntm | auto) ;;
    *) die "AGENTV_LAUNCHER must be auto, ep, or ntm" ;;
  esac

  if [[ "$check_only" == true ]]; then
    print_check "$root" "$db" "$bead_id" "$cli" "$launcher"
    exit 0
  fi

  claim_bead "$cli" "$db" "$bead_id"
  note_bead "$cli" "$db" "$bead_id" "Launching worker from $(hostname) in $root via ${launcher} (coordination CLI: $cli, db: $db)."

  case "$launcher" in
    ep)
      launch_with_ep "$bead_id" "$@"
      ;;
    ntm)
      launch_with_ntm "$root" "$bead_id" "$@"
      ;;
    auto)
      if have ep-spawn-agent; then
        launch_with_ep "$bead_id" "$@"
      else
        launch_with_ntm "$root" "$bead_id" "$@"
      fi
      ;;
  esac
}

main "$@"
