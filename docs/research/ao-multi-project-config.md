# AO multi-project config comparison

Date: 2026-06-02

## Scope

Compared AgentV's multi-project registry against the local Composio Agent Orchestrator (AO) setup and AO docs/config available on this machine:

- `/home/entity/.agent-orchestrator/config.yaml`
  - `projects.agentv_af00e23536`
  - `projects.allagents_4ce7565799`
  - `defaults`, `notificationRouting`, `notifiers`
- `/home/entity/projects/tsoyang-org/composio-ao-deploy/README.md`
- `/home/entity/projects/tsoyang-org/composio-ao-deploy/docs/agentv.md`
- `/home/entity/projects/ComposioHQ/agent-orchestrator/agent-orchestrator.yaml.example`
- `/home/entity/projects/ComposioHQ/agent-orchestrator/examples/multi-project.yaml`
- `/home/entity/projects/ComposioHQ/agent-orchestrator/ARCHITECTURE.md`
- `/home/entity/projects/ComposioHQ/agent-orchestrator/skills/agent-orchestrator/references/config.md`
- AgentV implementation/docs in `packages/core/src/projects.ts`, `packages/core/test/projects.test.ts`, and `apps/web/src/content/docs/docs/tools/dashboard.mdx`

## What AgentV does today

AgentV's Dashboard project registry is deliberately small:

```yaml
projects:
  - id: my-evals
    name: My Evals
    path: /srv/agentv/my-evals
    source:
      url: https://github.com/example/my-evals
      ref: main
    added_at: "2026-03-20T10:00:00Z"
    last_opened_at: "2026-03-30T14:00:00Z"
```

Current behavior:

- `~/.agentv/projects.yaml` is the single source of truth for Dashboard project cards.
- Dashboard re-reads `projects.yaml` on every `/api/projects` request, so direct edits, API writes, CLI `--add`/`--remove`, and ConfigMap mounts are live without restarting the server.
- `agentv dashboard --add <path>` derives IDs from directory names, validates `.agentv/`, and keeps writes snake_case on disk.
- Optional `source.url` / `source.ref` supports remote clone/pull sync.
- Legacy `~/.agentv/benchmarks.yaml` migrates once to `projects.yaml`.
- TypeScript internals stay camelCase; YAML and API surfaces stay snake_case.

This matches AgentV's current problem: show eval runs/traces/experiments from multiple registered project directories.

## What the local AO setup does

The local AO portfolio config is a broader operational routing document. Its top-level shape includes runtime defaults, notification routing, and a map of registered projects keyed by stable project IDs:

```yaml
defaults:
  runtime: tmux
  agent: codex
  workspace: worktree
  notifiers:
    - composio
    - desktop
  orchestrator:
    agent: codex
  worker:
    agent: codex
projects:
  agentv_af00e23536:
    projectId: agentv_af00e23536
    path: /home/entity/projects/EntityProcess/agentv
    repo:
      owner: EntityProcess
      name: agentv
      platform: github
      originUrl: https://github.com/EntityProcess/agentv
    defaultBranch: main
    source: ao-project-add
    registeredAt: 1780301309
    displayName: agentv
    sessionPrefix: age
  allagents_4ce7565799:
    projectId: allagents_4ce7565799
    path: /home/entity/projects/EntityProcess/allagents
    repo:
      owner: EntityProcess
      name: allagents
      platform: github
      originUrl: https://github.com/EntityProcess/allagents
    defaultBranch: main
    source: ao-project-add
    registeredAt: 1780305846
    displayName: allagents
    sessionPrefix: all
notifiers: {}
notificationRouting:
  urgent: [desktop, composio]
  action: [desktop, composio]
  warning: [composio]
  info: [composio]
```

AO docs/examples also show:

- Top-level `defaults` for runtime, agent, workspace, notifiers, and role-specific orchestrator/worker overrides.
- Per-project `repo`, `defaultBranch`, `sessionPrefix`, tracker/SCM, agent config/rules, symlinks, post-create commands, and reaction overrides.
- Notification channel definitions plus priority-based `notificationRouting`.
- Runtime isolation using config-hash + project ID directories and globally unique runtime session names.
- In the deploy wrapper, local policy stays outside upstream AO by using a `codex` shim instead of adding AO config fields for local-only behavior.

## Comparison

| Area | AgentV | AO | Should AgentV adopt it? |
| --- | --- | --- | --- |
| Registry purpose | Display and query eval artifacts from project directories. | Operate coding agents across repos, worktrees, trackers, notifications, and feedback loops. | No. AgentV's narrower registry is appropriate. |
| Project shape | Array of entries with `id`, `name`, `path`, timestamps, optional remote `source`. | Object map keyed by project ID, with repo metadata, default branch, session prefix, runtime/agent/tracker/routing settings. | Not now. A map would reduce ID duplication, but adds a second accepted YAML shape and migration surface without a current user need. |
| Live config edits | Re-read per `/api/projects`; UI polls. | Global config drives portfolio/project orchestrators; config is operational policy. | AgentV already has the important live-edit behavior. |
| Defaults/inheritance | None for project registry. | Top-level defaults with per-project overrides. | No. AgentV project entries do not have repeated operational settings that need inheritance. |
| Notifications/routing | Out of scope for project registry. | Central routing by priority to configured notifiers. | No. AgentV does not run persistent workers that need project-level notification routing. Use external wrappers/webhooks if needed. |
| Repo/default branch metadata | Optional remote sync `source.url` / `source.ref`; no SCM metadata object. | Explicit repo identity and default branch for PR/issue/worktree operations. | No. AgentV remote sync only needs URL and ref. More SCM metadata would be speculative. |
| Session prefix/runtime isolation | Not relevant; AgentV routes by project ID in URLs and reads artifacts from project paths. | Needed to avoid tmux/worktree/session collisions. | No. AgentV does not allocate per-project agent sessions. |
| Local deploy shims | Not applicable. | Keeps machine-specific Codex profile policy outside upstream AO config. | Yes as a principle: local/deployment-specific policy should stay outside AgentV core unless it becomes a general primitive. |

## Recommendation

Do not implement a code change from the AO comparison right now.

The useful AO lessons are already covered by AgentV's current design or are intentionally out of scope:

1. **Single source of truth with live reload** — AgentV already does this with `~/.agentv/projects.yaml` and per-request reload.
2. **Stable project identity** — AgentV already has explicit `id` and project-scoped routes.
3. **Avoid local operational policy in core** — AO's deploy repo demonstrates this well; AgentV should likewise avoid adding local-only fields such as notifier routing, agent defaults, branch/session prefixes, or SCM metadata unless a concrete AgentV workflow requires them.
4. **Keep the wire format simple and snake_case** — AO's local config uses camelCase fields (`projectId`, `defaultBranch`, `displayName`, `sessionPrefix`) because AO has its own contract. Importing that shape would violate AgentV's snake_case convention and create a compatibility mode that does not serve AgentV's eval-dashboard use case.

The tempting improvement is to support an AO-like object map for `projects`, keyed by project ID. That would remove repeated `id` fields in hand-edited YAML, but it also introduces a second registry shape, ordering questions, save-format decisions, and migration/precedence behavior. Under AgentV's YAGNI and "stop before adding a second mode" guidance, that is not justified without a real user request.

If future demand appears, the smallest plausible AgentV-native extension would be documented first as a separate proposal:

```yaml
projects:
  my_evals:
    name: My Evals
    path: /srv/agentv/my-evals
    source:
      url: https://github.com/example/my-evals
      ref: main
```

That proposal should still use snake_case, preserve the existing array format, define a single save format, and ship only if direct YAML editing becomes a demonstrated pain point.
