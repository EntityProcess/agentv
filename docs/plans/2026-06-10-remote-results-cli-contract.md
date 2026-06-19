# Remote Results CLI Contract Decision

## Decision

AgentV should not add `agentv results remote status` or `agentv results remote sync` for the current production remote-results release.

The production contract is:

- `agentv eval` and `agentv pipeline bench` may auto-export newly created runs to the configured results repository when `sync.auto_push: true`.
- `agentv results` remains a local-result workspace command family: combine, delete, export, report, summary, failures, show, and validate.
- Manual remote status and sync are Dashboard/API capabilities:
  - `GET /api/remote/status`
  - `POST /api/remote/sync`
  - `GET /api/projects/:projectId/remote/status`
  - `POST /api/projects/:projectId/remote/sync`
- Advanced CLI automation should call those Dashboard API endpoints while `agentv dashboard` is running, or use `git` directly in the configured `projects[].results.path` clone.

## Rationale

The remote sync operation is not a simple result-artifact primitive. It is project-scoped and coordinates git fetch/fast-forward/push behavior, mutable remote metadata overlays, dirty-state detection, conflict blocking, and safe recovery guidance. Dashboard already owns the project context and exposes the status/sync API that the UI uses.

Adding another CLI subcommand now would duplicate the Dashboard/API contract, widen the command surface, and force users to learn two manual sync entry points before there is evidence that the API-only automation path is insufficient. That conflicts with AgentV's lightweight-core and YAGNI principles.

Keeping `agentv results` local also preserves a clean mental model:

- Use `agentv results ...` for local artifacts already on disk.
- Use Dashboard/API for exchanging local and remote result repositories.
- Use eval auto-export for the common CI/publisher path.

## Future extension trigger

Add an explicit CLI sync command only if production users need headless manual sync without a long-running Dashboard server and cannot reasonably use the existing API or direct `git` workflow. If that demand appears, start with one project-scoped primitive that mirrors the existing API response shape instead of inventing a second contract.
