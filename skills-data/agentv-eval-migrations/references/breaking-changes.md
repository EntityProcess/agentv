# AgentV Eval YAML Breaking Changes

This reference tracks schema changes that eval authors and migration agents
should apply when modernizing AgentV eval files.

## Eval Runtime Policy Moved Out Of `experiment`

Do not author top-level `experiment:` in eval YAML. The whole eval file defines
the experiment; top-level `name` is the result namespace, top-level `target`
identifies the system under test, and top-level runtime/gating controls own
repeat behavior, timeout, threshold, and budget.

Old:

```yaml
name: backend-with-skills
experiment:
  target: copilot--claude-opus-4.8
  model: claude-opus-4.8
  runs: 3
  timeout_seconds: 600
  threshold: 0.8
  budget_usd: 5
```

New:

```yaml
name: backend-with-skills
target: copilot--claude-opus-4.8
model: claude-opus-4.8

workspace:
  isolation: per_case

repeat:
  count: 3
  strategy: pass_any
  early_exit: false

timeout_seconds: 600
threshold: 0.8
budget_usd: 5
```

## Repeat Policy Uses `repeat`

Do not author top-level `runs`, top-level `early_exit`, or
`repeat.strategy: pass_at_k`.

Old:

```yaml
runs: 3
early_exit: true
```

New:

```yaml
repeat:
  count: 3
  strategy: pass_any
  early_exit: true
```

Use `repeat.strategy: pass_any` for "pass if any completed sample passes" and
`repeat.strategy: pass_all` for "pass only if every completed sample passes".
`repeat.early_exit` is only a scheduling optimization; omit it or set it to
`false` when you want every sample collected for variance analysis.

## Workspace Isolation Spelling

Old:

```yaml
workspace:
  isolation: per_test
```

New:

```yaml
workspace:
  isolation: per_case
```

Use `per_case` for a fresh workspace folder per eval case. Use `shared` when
cases share one prepared workspace.

## Suite Wrapper Workspace Ownership

Eval files that import child eval suites with `type: suite` cannot define a
parent `workspace`. Imported suites own their task environment, including repos,
templates, hooks, Docker config, env checks, and isolation.

If the parent should own workspace context, import raw cases with `type: tests`
or direct path shorthand instead of importing suites.

## Runtime Workspace Blocks Removed From Eval YAML

Do not author these blocks in eval YAML:

```yaml
experiment:
  workspace:
    mode: static
    path: /path/to/local/workspace

execution:
  workspace:
    mode: static
    path: /path/to/local/workspace
```

Existing local workspace directories are machine-local runtime bindings. Use one
of these instead:

```bash
agentv eval evals/my-eval.yaml --workspace-path /path/to/local/workspace
```

```yaml
# .agentv/config.local.yaml
execution:
  workspace_path: /path/to/local/workspace
  workspace_mode: static
```

Keep portable task setup under top-level or case-level `workspace`.

## Workspace Mode and Path Removed From Eval YAML

Do not author `workspace.mode`, `workspace.path`, `workspace.static_path`,
`workspace.static`, or `workspace.pool` in eval YAML.

Old:

```yaml
workspace:
  mode: static
  path: /path/to/local/workspace
```

New portable eval YAML:

```yaml
workspace:
  repos:
    - path: ./repo
      repo: org/repo
      commit: main
  isolation: shared
```

Optional local binding:

```yaml
# .agentv/config.local.yaml
execution:
  workspace_path: /path/to/local/workspace
```

Shared repo workspaces are pooled by default. Use
`--workspace-mode temp` or `execution.workspace_mode: temp` in local config to
force fresh temporary materialization for a local run. Use
`--workspace-path` or `execution.workspace_path` when an existing directory
should be used as-is.

## Docker Is Not Folder Isolation

`workspace.docker` describes environment, preflight, or container bindings. It
does not replace `workspace.isolation`.

Use `workspace.isolation: shared | per_case` for workspace folder reuse versus
per-case folders, regardless of whether Docker is configured.
