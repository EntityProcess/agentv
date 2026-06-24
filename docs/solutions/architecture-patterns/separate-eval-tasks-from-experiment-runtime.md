---
title: "Separate eval tasks from experiment runtime"
date: 2026-06-24
category: architecture-patterns
module: evaluation model
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - Designing eval, experiment, or artifact contracts for AgentV
  - Deciding whether setup, target selection, repeat counts, or scripts belong in eval YAML
  - Aligning AgentV with external eval conventions without copying their whole product model
tags:
  - experiments
  - evals
  - artifacts
  - agent-eval
  - dashboard
  - repeat-runs
---

# Separate eval tasks from experiment runtime

## Context

AgentV originally treated an experiment as a string label on a run while `eval.yaml` carried both the task definition and runtime setup. That made simple runs easy, but it blurred the boundary between what is being tested and how it is being tested. It also made A/B tests awkward: setup differences such as adding skill files, installing dependencies, or changing run counts had to be pushed into eval YAML or hidden behind environment variables.

The experiment-separation work aligned AgentV with the useful part of Vercel `agent-eval`: an eval is the frozen task and assertion contract, while an experiment is the committed runtime variant that chooses targets, setup, scripts, repeat behavior, and filters. AgentV kept its own YAML-first authoring, target model, LLM graders, and dashboard artifact contracts instead of taking a hard runtime dependency on Vercel's package.

## Guidance

Keep eval definitions focused on task evidence:

- prompts, datasets, and input files
- assertions and LLM-grader criteria
- task fixtures that represent the work being evaluated

Put runtime variation in experiments:

- target or target matrix selection
- model and provider selection through existing AgentV targets
- setup steps such as installing dependencies or injecting skill files
- post-agent scripts
- timeout, workers, budgets, repeat counts, and early-exit behavior
- eval/test filters for a suite or A/B variant

This keeps A/B experiments honest. A baseline and a "with skill" variant should point at the same eval task and differ only in experiment setup. If the task itself changes, the result is not an A/B comparison.

Use external conventions as a lowest-common-denominator contract, not as a product takeover. The Vercel structure is useful for naming and layout:

```text
eval = what is tested
experiment = how it is run
run-N = one attempt inside a repeated case
```

AgentV should still preserve repo-native constraints that make it useful:

- wire formats stay `snake_case`
- YAML remains the canonical authoring path
- existing target definitions are reused instead of introducing a parallel provider schema
- dashboard and CI discovery stay anchored on root run manifests
- LLM-judge assertions remain part of evals, not experiments

## Why This Matters

The split prevents configuration drift from becoming hidden test drift. When setup lives in an experiment, reviewers can see that two variants are testing the same task. When setup lives inside eval YAML, changing the setup can silently change the meaning of the eval suite.

It also reduces future migration cost. A run can support Vercel-style experiment files, AgentV YAML experiments, repeat attempts, and dashboard browsing without forcing every consumer to understand every nested artifact. Root manifests remain the loading contract; nested files are evidence.

## When to Apply

- Adding a new run-level knob such as repeat count, timeout, workers, budget, sandbox, setup, or post-run scripts.
- Designing an example that compares one agent/model/setup against another.
- Moving a field out of eval YAML and deciding where backward compatibility should live.
- Changing artifact layout for repeat runs or dashboard browsing.
- Mapping an external eval convention into AgentV.

## Examples

**Prefer experiment setup for A/B variants:**

```yaml
name: copilot-with-skill
target: copilot
evals:
  - bug-fix-*
setup:
  - script: cp skills/repo-debugging/AGENTS.md ./
repeat:
  count: 4
  strategy: pass_at_k
early_exit: false
```

**Keep the eval task independent of the runtime variant:**

```yaml
name: bug-fix-suite
tests:
  - id: bug-fix-001
    input_files:
      - PROMPT.md
    assertions:
      - type: llm-grader
        target: grader
```

**Use root manifests for discovery and nested files for evidence:**

```text
.agentv/results/<experiment>/<timestamp>/
  index.jsonl
  benchmark.json
  timing.json
  <suite>/<case>/
    task/PROMPT.md
    summary.json
    grading.json
    run-1/
      result.json
      grading.json
      transcript.json
      transcript-raw.jsonl
      outputs/answer.md
```

The dashboard should discover runs from root manifests and learn case locations from `index.jsonl` fields such as `artifact_dir`, `task_dir`, `summary_path`, and `grading_path`. It should not depend on optional per-attempt sidecars for discovery.

## Related

- `docs/adr/2026-06-23-experiments-vs-eval-separation.md` - architecture decision for the split
- `docs/plans/2026-06-23-002-experiments-separation-plan.md` - phased implementation plan
- `docs/plans/2026-06-23-001-feat-repeat-runs-flaky-evals-plan.md` - repeat-run placement reconciled to experiments
- `docs/solutions/best-practices/prefer-isolated-runtime-boundaries-for-agent-sdk-providers.md` - adjacent guidance on keeping provider runtime instability outside artifact finalization
