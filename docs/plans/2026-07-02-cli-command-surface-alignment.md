---
title: "plan: Align AgentV CLI command surface"
type: plan
date: 2026-07-02
bead: av-ap2w
status: draft
---

# plan: Align AgentV CLI command surface

## Summary

AgentV should make the CLI's common path read as a small, predictable loop:

1. create or import eval material
2. run an eval
3. inspect the produced run bundle
4. rerun, compare, report, export, or publish the same artifacts

The current CLI already has most primitives, but the command taxonomy is uneven. Run execution lives under `agentv eval run` with a compatibility rewrite from `agentv eval <paths>`, local inspection is split across `dashboard`, `results`, `inspect`, `compare`, `trend`, and `runs`, and scaffolding/import commands have different nouns for similar user intent. The amendment should reduce cognitive load without weakening AgentV's product boundary: repo-native inputs, local/Git-backed run bundles, Dashboard as the zero-infra inspection path, and optional adapters rather than external artifact ownership.

This is a research and planning PR only. It does not implement command changes.

## Research Sources

No broad web search was used. Peer research used local clones first, with DeepWiki as architecture-level orientation. Source-level claims below were verified with `git`, `rg`, and file reads in the local clones.

| Project | Local clone | Commit | Working tree status used for this report |
| --- | --- | --- | --- |
| Promptfoo | `/home/entity/projects/promptfoo/promptfoo` | `9a337ab3bc479b1bd7cb3a67c6fc00220390a703` (`origin/main`) | local worktree clean; claims verified against fetched `origin/main` |
| Margin evals | `/home/entity/projects/Margin-Lab/evals` | `53fb2fd080689efaf7934573d8759d14fc1043e4` | `main...origin/main`, clean |
| DeepEval | `/home/entity/projects/confident-ai/deepeval` | `55ad7910e70e3af6cd9d8b12030efb44b356ed3f` (`origin/main`) | local worktree clean; claims verified against fetched `origin/main` |
| Vercel agent-eval | `/home/entity/projects/vercel-labs/agent-eval` | `1d1f4f60b290d1ca3fac00afe07f3db231f00afd` (`origin/main`) | local worktree clean; claims verified against fetched `origin/main`; post-`6ebfe82f39dddb9614add9bebf14a843658ef058` delta touched release/changelog/package metadata only, not inspected command files |
| AgentV baseline | this worktree | branch `research/av-ap2w-cli-command-surface` | clean before this report |

DeepWiki usage:

- Asked a multi-repo command-surface question for `promptfoo/promptfoo`, `Margin-Lab/evals`, `confident-ai/deepeval`, and `vercel-labs/agent-eval`.
- Asked a focused `vercel-labs/agent-eval` command-surface question.
- DeepWiki was useful for orientation, but exact command claims below use fetched local source as authoritative. The current Vercel source has `run`, `status`, `refingerprint`, `playground`, fingerprint reuse, and failure classification; bare `agent-eval` shows status and lets TTY users choose experiments instead of auto-running everything.

Primary local files inspected:

- Promptfoo: `src/main.ts`, `src/commands/eval.ts`, `src/commands/init.ts`, `src/commands/cache.ts`, `src/commands/export.ts`, `src/commands/list.ts`, `src/commands/retry.ts`, `src/commands/view.ts`, `site/docs/usage/command-line.md`.
- Margin evals: `cli/internal/app/app.go`, `cli/internal/app/run.go`, `cli/internal/app/init.go`, `cli/internal/app/suite.go`, `cli/docs/cli.md`.
- DeepEval: `pyproject.toml`, `deepeval/cli/main.py`, `deepeval/cli/test/command.py`, `deepeval/cli/generate/command.py`, `deepeval/cli/inspect.py`, `README.md`.
- Vercel agent-eval: `packages/agent-eval/src/cli.ts`, `packages/agent-eval/src/lib/fingerprint.ts`, `packages/agent-eval/src/lib/results.ts`, `packages/agent-eval/src/lib/classifier.ts`, `README.md`, `packages/agent-eval/package.json`.
- AgentV: `apps/cli/src/index.ts`, `apps/cli/src/commands/eval/index.ts`, `apps/cli/src/commands/eval/commands/run.ts`, `apps/cli/src/commands/results/index.ts`, `apps/cli/src/commands/inspect/index.ts`, `apps/cli/src/commands/runs/index.ts`, `apps/cli/src/commands/create/index.ts`, `apps/cli/src/commands/import/index.ts`, `apps/web/src/content/docs/docs/tools/dashboard.mdx`.

## Peer Command Taxonomy

| Flow | Promptfoo | Margin evals | DeepEval | Vercel agent-eval | Takeaway for AgentV |
| --- | --- | --- | --- | --- | --- |
| Init/config authoring | `promptfoo init [directory]`; `config get/set/unset`; `redteam init/setup`; examples can be fetched during init. | Small explicit resources: `margin init suite`, `case`, `agent-definition`, `agent-config`, `eval-config`; run config is passed as paths. | No project init in the same sense; config is Python tests plus provider settings through `login`, `settings`, and many `set-*`/`unset-*` commands. | `agent-eval init <name>` scaffolds an opinionated project with `experiments/`, `evals/`, `.env.example`, and examples. | Keep AgentV `init` for bootstrap and `create` for individual scaffolds, but make first-run authoring discoverable from one path. |
| Run/eval execution | `promptfoo eval` is the central command and accepts config, prompt/provider/test overrides, filtering, repeat, share, resume, retry, output, and watch flags. | `margin run --suite --agent-config --eval`; explicit inputs, small command count, TUI by default. | `deepeval test run <file-or-dir>` delegates to pytest and accepts pytest passthrough args; evals are code-first. | `agent-eval run <experiment...>` runs named new/changed evals; bare `agent-eval` shows status and lets TTY users choose experiments; a direct config/name still runs one experiment for compatibility; `--dry`, `--smoke`, `--force`. | AgentV should keep `agentv eval <paths>` as the everyday command and make `eval run` the explicit form, not force new users through deeper command depth. |
| Result viewing/reporting | `view [directory]` starts local UI; `show` drills into eval/prompt/dataset; `redteam report`. | Interactive Mission Control stays open after run unless `--exit-on-complete`; plain mode available. | `inspect [PATH]` opens a TUI over saved test runs; `view` uploads/opens Confident AI report. | `playground` launches local results viewer; README emphasizes files under `results/`. | AgentV's `dashboard` is the right primary inspection noun; CLI reports should be grouped under `results`. |
| Cache/resume/rerun | `eval --no-cache`; `cache clear`; `eval --resume [evalId]`; `eval --retry-errors`; standalone `retry <evalId>`. | Remote suites cached and pinned until `suite pull`; `run --resume-from`; `--resume-mode resume|retry-failed`. | `test run --use-cache`; cache disabled when `--repeat` is used; no prominent CLI resume/rerun flow in inspected source. Current CLI also adds `gate` and `test run --official` for Confident AI governance/baseline workflows. | Fingerprint reuse skips matching eval/config results; `status` reports new/changed evals, `refingerprint` carries config-only changes forward, `--force` bypasses reuse, and failure classification can remove non-model failures unless `--ack-failures`. | AgentV should expose resume/rerun in one place with run-bundle nouns: `eval --resume`, `eval --rerun-failed`, and `runs rerun` for captured bundles. |
| Dataset/test management | `generate dataset`, `generate assertions`, `list evals/prompts/datasets`, `show dataset`. | Suites and cases are first-class: `init suite`, `init case`, remote suite pull. | Synthetic goldens via `generate --method ...`; datasets are code/API constructs in README. | Fixtures are directories under `evals/` containing `PROMPT.md`, `EVAL.ts(x)`, `package.json`. | AgentV should keep `create eval` and `import huggingface`; avoid building a generic dataset platform into CLI core. |
| Compare/export/share | `share [id]`, `export eval`, `export logs`, `view`. | No explicit compare/export/share command found in inspected CLI docs/source. | `view` uploads/opens Confident AI; platform owns richer sharing. | Local playground includes side-by-side comparison; result files stay local. No broad export/share CLI in inspected source. | AgentV should keep local/Git-backed `dashboard` plus `results export`, `results compare`, and `results trend`; do not adopt hosted share as a default primitive. |
| Naming/depth | Broad, mostly flat top-level commands with grouped areas (`auth`, `cache`, `generate`, `list`, `redteam`, `validate`, `export`). | Minimal top-level commands: `check`, `init`, `run`, `suite`, `update`; two-level depth for resources. | Mixed: `test run` is good; provider setup is many top-level `set-*` commands. | Shallow but explicit: `run`, `status`, `refingerprint`, `playground`, and direct single-config compatibility. | AgentV needs fewer top-level inspection nouns and a clearer "common path first, advanced groups second" help surface. |

## AgentV Baseline

AgentV currently registers these top-level commands in `apps/cli/src/index.ts`: `dashboard`, `eval`, `grade`, `import`, `compare`, `convert`, `create`, `doctor`, `init`, `pipeline`, `prepare`, `results`, `runs`, `self`, `skills`, `serve`, `inspect`, `trend`, `transpile`, `trim`, `validate`, and `workspace`.

Useful existing strengths:

- `agentv eval <paths>` already rewrites to `agentv eval run <paths>`, so the short common command exists.
- `results` groups local artifact operations: `combine`, `delete`, `export`, `report`, `summary`, `failures`, `show`, and `validate`.
- `dashboard` is already documented as the zero-infra local cockpit and remote-results browser.
- `runs rerun` exists for captured run workspaces, which is the right lower-level noun for bundle replay.
- `create` and `import` already separate scaffolding from data/session ingestion.

Main friction:

- `eval run` command metadata sets `name: 'eval'` inside the `eval` group, which makes help and mental models muddy even though preprocessing keeps old invocations working.
- Inspection is split across `dashboard`, `results`, `inspect`, `compare`, `trend`, and `runs`. Each is defensible, but the top-level help does not communicate a single post-run path.
- `inspect` overlaps semantically with `results`, especially for `list`, `show`, `filter`, `search`, `stats`, and `score` over existing results/traces.
- `compare` and `trend` are useful workflows, but they should read as post-run result analysis actions rather than isolated top-level tools.
- `serve` and `dashboard` are aliases to the same command, and `studio` is still handled as a deprecated hidden alias. This adds vocabulary without adding capability.
- Cache/resume/rerun flags are powerful but distributed: provider cache is on `eval`, resume and rerun-failed are on `eval`, captured rerun is under `runs`, and result combination/deletion is under `results`.

## What AgentV Should Adopt

- Adopt Vercel's explicit status-before-run posture, but keep AgentV's happy path as `agentv init`, `agentv eval`, `agentv dashboard`. The common path should be visible in top-level help and docs before advanced groups.
- Adopt Margin's explicit resource naming where it prevents ambiguity. AgentV has distinct projects, runs, traces, experiments, benchmarks, targets, workspaces, and results; the CLI should not collapse those nouns.
- Adopt Promptfoo's task-oriented discoverability for generation, listing, viewing, retrying, and exporting, but not its large top-level sprawl.
- Adopt Vercel and Margin's clear dry/smoke/preflight patterns, but map them to AgentV primitives: `validate`, `prepare`, and future small smoke workflows rather than provider-specific hidden behavior.
- Adopt a single local result artifact path as the post-run center of gravity. Every post-run command should accept a run directory or `index.jsonl` where practical.

## What AgentV Should Avoid

- Avoid DeepEval-style provider setup sprawl (`set-openai`, `unset-openai`, `set-gemini`, etc.) as top-level commands. AgentV should keep provider configuration in YAML/env and use `doctor` for diagnostics.
- Avoid Promptfoo's hosted `share` default. Sharing in AgentV should stay Git-backed/private-evidence friendly unless a narrow adapter is explicitly added later.
- Avoid Vercel's fingerprint reuse semantics as a hidden CLI policy. AgentV cache/resume/rerun behavior should be explicit in config, flags, and artifacts.
- Avoid making `dataset` a new broad core command group. AgentV can import from Hugging Face and scaffold evals without becoming a dataset registry.
- Avoid moving Phoenix, Confident AI, or other hosted viewers into the primary inspection path. External systems can remain adapters or link-outs.

## Intentional Divergence

- AgentV keeps run bundles, traces, transcripts, experiments, indexes, and Git-backed artifacts as AgentV-owned. Peer CLIs can upload/share or treat result folders as implementation details; AgentV treats artifacts as the product contract.
- AgentV keeps `project` and `benchmark` distinct. Peer CLIs often use suite, experiment, eval, and project loosely; AgentV should keep project as a run/trace container and benchmark as a curated eval suite.
- AgentV should not copy Promptfoo's broad prompt/provider/dataset database model. AgentV's primary value is repo-native agent workflow evaluation.
- AgentV should not copy DeepEval's pytest-first noun as the main CLI noun. `eval` is still the most intuitive AgentV verb because AgentV owns orchestration around agents, workspaces, targets, graders, and artifacts.

## Proposed Command Surface Amendments

### Phase 1: Help and Docs Reframe, No Breakage

Goal: make the existing surface easier to understand without changing behavior.

- Document the primary loop as:
  - `agentv init`
  - `agentv create eval <name>`
  - `agentv eval <eval-paths> --target <target>`
  - `agentv dashboard`
  - `agentv results summary|failures|report|export|compare|trend <run>`
- In top-level help and public docs, present commands in workflow groups:
  - Author: `init`, `create`, `import`, `validate`
  - Run: `eval`, `prepare`, `grade`
  - Inspect: `dashboard`, `results`
  - Analyze: `results compare`, `results trend`
  - Manage: `runs`, `workspace`, `doctor`, `self`, `skills`
  - Compatibility/advanced: `convert`, `transpile`, `pipeline`, `trim`
- Update command descriptions so "result", "run", "trace", and "project" are used consistently.
- Keep `agentv eval <paths>` as the canonical doc command; describe `agentv eval run` as the explicit equivalent for scripts and help pages.

### Phase 2: Normalize Aliases Around Current Behavior

Goal: reduce command-depth surprises while preserving compatibility.

- Make the `eval run` subcommand's internal name and help text say `run`, while retaining the existing `agentv eval <paths>` preprocessing.
- Add explicit, documented aliases only where they match the common mental model:
  - `agentv run <eval-paths>` as an alias for `agentv eval <eval-paths>` only if the team wants a Margin/Vercel-style verb. This should be optional; `eval` is already strong and familiar.
  - `agentv report <run>` as a short alias for `agentv results report <run>` only if top-level help remains uncluttered.
- Do not add or retain stable top-level analysis commands for `compare` or `trend`. Existing top-level `compare` and `trend` should become compatibility aliases for `agentv results compare` and `agentv results trend`, then be hidden from primary help before removal.
- Keep `serve` as a hidden/deprecated alias for `dashboard`, and remove it from primary docs if it is currently visible.
- Keep `studio` deprecated and do not introduce more UI nouns.

### Phase 3: Consolidate Post-Run Inspection

Goal: make `results` the CLI home for local artifact operations and `dashboard` the UI home.

- Move or alias overlapping `inspect` commands into `results` over time:
  - `inspect list` -> `results list` or fold into `results summary --recent`
  - `inspect show` -> `results show`
  - `inspect filter/search/stats/score` -> `results filter/search/stats/score` if they operate on run bundles
- Keep `inspect` only if it means trace-specific post-hoc inspection that is materially different from result artifact inspection. If retained, rename descriptions to "trace inspection" rather than generic "Inspect and analyze evaluation results."
- Move top-level `compare` and `trend` under `results` as canonical subcommands:
  - `compare <runs...>` -> `results compare <runs...>`
  - `trend <runs...>` -> `results trend <runs...>`
- Teach `results compare` and `results trend` to advertise run-directory/index inputs consistently and cross-link from `results summary`.

### Phase 4: Clarify Resume, Retry, and Cache

Goal: make rerun semantics reviewable and artifact-centered.

- Keep run-time controls on `agentv eval`:
  - `--resume` for interrupted runs at the same `--output`
  - `--rerun-failed` for failed/errored tests within a run output
  - `--retry-errors <run>` for execution errors from a previous run
  - `--cache`, `--cache-path`, and `--no-cache` for provider response cache
- Keep captured-bundle replay under `agentv runs rerun <run>`, because that is a different workflow: rehydrate captured test bundles with local target replacement.
- Add docs that distinguish:
  - cache reuse of provider responses
  - resume of a partial output directory
  - rerun of failed/errored cases
  - replay/rerun of captured bundles
- Do not implement hidden fingerprint skip behavior as a default. If AgentV adds fingerprint reuse later, it should be an explicit results-cache or experiment-cache contract with artifact evidence.

### Phase 5: Migration and Compatibility Policy

Goal: avoid breaking current users while converging the surface.

- Treat Phase 1 as documentation/help only.
- Introduce aliases as additive only.
- Deprecate redundant public nouns with warnings before removal. Same-week unreleased surfaces can be hard-corrected under existing AgentV guidance.
- Keep CLI JSON output and artifact wire formats `snake_case`; do not rename artifact fields for command taxonomy work.
- Update public docs and AI-facing skill guidance in the same PR that implements any command behavior change.

## Suggested Target Shape

Recommended stable top-level groups:

| Command | Role |
| --- | --- |
| `agentv init` | Bootstrap `.agentv/` config and starter files. |
| `agentv create <eval|assertion|provider>` | Scaffold AgentV-owned authoring pieces. |
| `agentv import <claude|codex|copilot|huggingface>` | Ingest external sessions or datasets into AgentV artifacts/config. |
| `agentv validate <paths>` | Validate eval and target YAML before running. |
| `agentv eval <paths>` | Primary run command; shorthand for `agentv eval run <paths>`. |
| `agentv prepare <eval> --test-id ...` | Materialize one test workspace without executing a target. |
| `agentv dashboard` | Local web inspection over AgentV projects and run bundles. |
| `agentv results <summary|failures|show|report|export|compare|trend|combine|delete|validate>` | CLI operations over completed run bundles, including comparison and score movement analysis. |
| `agentv runs rerun <run>` | Replay captured test bundles with replacement targets. |
| `agentv doctor` | Check dependencies and environment readiness. |
| `agentv workspace deps` | Inspect eval workspace repository dependencies. |

Commands to hide, de-emphasize, or reconsider:

- `serve`: keep only as a compatibility alias to `dashboard`, not a primary noun.
- `inspect`: either make trace-specific or gradually alias into `results`.
- `compare` and `trend`: move to `results compare` and `results trend`; keep any current top-level commands only as hidden/deprecated compatibility aliases.
- `pipeline`, `trim`, `transpile`, `convert`: keep as advanced/compatibility commands and keep them out of the first-run path.

## Implementation Follow-Up Plan

1. Open a follow-up Bead for Phase 1 documentation/help grouping. Acceptance: no behavior changes; public docs and top-level command descriptions show the common path.
2. Open a follow-up Bead for `eval run` help cleanup. Acceptance: `agentv eval --help`, `agentv eval run --help`, and `agentv eval <path>` remain compatible and clearer.
3. Open a follow-up Bead for post-run command consolidation design. Acceptance: `results compare` and `results trend` are canonical, top-level `compare`/`trend` are hidden compatibility aliases or removed under the allowed compatibility policy, and `inspect` either survives as trace-specific or becomes aliases under `results`.
4. Open a follow-up Bead for resume/cache/rerun docs and examples. Acceptance: one page explains the four behaviors with commands and artifact expectations.
5. Only after docs/help converge, consider optional top-level aliases such as `agentv report` or `agentv run`. Acceptance: aliases are additive, hidden from advanced help if they clutter discoverability, and covered by CLI tests. Do not add top-level aliases for `compare` or `trend`.

## Validation Performed For This Plan

- Ran `bd prime`, `git fetch origin`, and `git status --short --branch` before changes.
- Read `AGENTS.md`, `.agents/workflow.md`, `.agents/product-boundary.md`, `.agents/verification.md`, `.agents/conventions.md`, `STRATEGY.md`, and `ROADMAP.md`.
- Read Bead `av-ap2w` and updated Bead notes before editing.
- Inspected peer repos with `git rev-parse`, `git status --short --branch`, `rg`, and file reads only.
- Used DeepWiki MCP for repo-level orientation and recorded where local source superseded stale orientation.
- Did not run installs, builds, tests, or evals in peer repos.
