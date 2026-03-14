# AgentV Optimizer Scripts Layer Design

## Problem

`plugins/agentv-dev/skills/agentv-optimizer` currently mirrors the *behavior* of Anthropic's `skill-creator`, but not its bundled resource structure. It lacks the `scripts/` and `eval-viewer/` layers that make repetitive workflow steps deterministic and reusable.

## Goal

Add a Bun-based bundled scripts layer to `agentv-optimizer` that is structurally similar to `skill-creator`, but aligned with AgentV architecture:

- provider-agnostic across AgentV targets and agent harnesses
- built on AgentV CLI/core primitives wherever possible
- compatible with AgentV artifacts (`grading.json`, `timing.json`, `benchmark.json`, results JSONL/HTML)
- avoids duplicating evaluator execution, target execution, or code-judge logic already owned by AgentV core/CLI

## Design

### Skill bundle layout

Add a self-contained Bun mini-project inside the skill:

```text
plugins/agentv-dev/skills/agentv-optimizer/
  SKILL.md
  package.json
  bun.lock
  tsconfig.json
  vitest.config.ts
  scripts/
    quick-validate.ts
    run-eval.ts
    prompt-eval.ts
    convert-evals.ts
    compare-runs.ts
    run-loop.ts
    aggregate-benchmark.ts
    generate-report.ts
    improve-description.ts
  src/
    cli.ts
    paths.ts
    command-runner.ts
    artifact-readers.ts
    aggregate-benchmark.ts
    generate-report.ts
    run-loop.ts
    description-optimizer.ts
  eval-viewer/
    generate-review.ts
    viewer.html
  references/
```

### Responsibility split

**Scripts should call `agentv` as much as possible.**

Scripts own:

- workflow wrappers around `agentv eval`, `agentv compare`, `agentv prompt eval overview/input/judge`, and `agentv convert`
- artifact reading and aggregation
- report generation from AgentV artifacts
- provider-agnostic command planning and iteration loop glue
- description-improvement orchestration that consumes AgentV outputs

AgentV core/CLI keeps owning:

- eval parsing and normalization
- target/provider execution
- prompt subcommand semantics
- deterministic evaluator execution
- `code-judge` execution
- artifact generation and schemas

### Core change rule

If the scripts layer cannot be implemented cleanly by shelling out to existing `agentv` commands and reading established artifacts, add the smallest possible AgentV CLI/core extension that exposes a stable primitive. Do not move orchestration logic or script-owned workflow logic into core.

## Acceptance signals

- `agentv-optimizer` includes a Bun-based `scripts/` layer and `eval-viewer/`
- scripts are provider-agnostic and rely on AgentV targets/artifacts
- no script reimplements code-judge execution or target execution
- skill/docs reference the new scripts correctly
- the new bundle has focused tests and passes repository validation
