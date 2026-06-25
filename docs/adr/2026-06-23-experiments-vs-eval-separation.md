# ADR: Separate experiments from eval definitions

Date: 2026-06-23

Status: Proposed

## Context

AgentV currently treats an experiment as a run label. The label is threaded
through evaluation config and recorded in run artifacts, but the agent, model,
harness, repeat count, timeout, sandbox, and setup choices mostly remain in
`eval.yaml` `execution` fields or CLI flags.

That conflates two concerns:

- The eval definition is the task contract: prompt, dataset, workspace fixture
  required by the task, and assertions or graders.
- The experiment is the run contract: which agent or target is under test, which
  model and harness are used, how many runs to execute, what setup is injected,
  and which eval cases are selected.

The public Vercel `agent-eval` ecosystem is a useful reference point. The
`vercel/next.js` evals keep task fixtures under `evals/`, while experiments are
generated or committed separately. `vercel/next-evals-oss` commits many
`experiments/*.ts` variants and stores results under experiment-specific
directories. The useful pattern is the vocabulary and ownership split, not a
requirement that AgentV adopt Vercel's package as its core runtime.

This decision must also preserve AgentV's existing product boundary:

- AgentV stays repo-native and zero-infra by default.
- Portable run artifacts remain the source of truth.
- Core primitives should stay small and composable.
- Public wire formats use `snake_case`; TypeScript internals use `camelCase`.
- `project` means the run, trace, and experiment container; `benchmark` means a
  curated eval suite.

## Vocabulary

An eval is a frozen task definition. It includes the prompt or dataset, expected
behavior, task-owned workspace fixtures, and assertions. AgentV's LLM-judge,
code-grader, deterministic assertions, and hidden or explicit evaluation
criteria belong here.

An experiment is a committed or generated run definition. It declares which
agent, target, provider, model, harness options, setup steps, run count, timeout,
sandbox, and case selector are used. Setup that changes the system under test,
such as installing dependencies or dropping an `AGENTS.md` or skill file, belongs
here because it is an A/B variable.

An execution compatibility block is the legacy `eval.yaml` location for runner
selection and runtime controls. It remains supported during migration but should
stop being the canonical home for experiment-level choices.

## Decision

AgentV will make experiments first-class configuration units separate from
eval definitions.

Eval files remain YAML-authored by default. They should describe what is tested:
task inputs, datasets, assertions, and task fixtures. They should not be the
canonical place for which agent, model, harness, setup injection, sandbox, or run
matrix executes the task.

Experiment files will live under `experiments/` by convention. AgentV will
support YAML as the canonical authoring path for the abstraction story and TypeScript
as the power-user escape hatch:

```yaml
name: copilot-gpt55-withskill
target: copilot-gpt55
model: openai/gpt-5.5
eval_suites: "evals/**/*.eval.yaml"
eval_cases: "agent-042-*"
scripts:
  - build
repeat:
  count: 3
  strategy: pass_at_k
  cost_limit_usd: 2.00
early_exit: false
timeout_seconds: 900
sandbox: auto
setup:
  - script: bun install
  - script: cp skills/copilot/AGENTS.md AGENTS.md
```

`config.yaml` will gain a default experiment pointer so existing `agentv eval`
usage keeps working:

```yaml
experiments:
  default: experiments/default.exp.yaml
```

If no default experiment is configured, AgentV keeps the current behavior and
uses the `default` experiment label. Existing `eval.yaml`-only repositories
remain valid.

Legacy `eval.yaml execution` fields that select targets, targets matrices,
workers, cache, budget, thresholds, and workspace runtime behavior will
continue to parse as a compatibility shim until docs and examples have moved.
The prerelease `execution.trials` surface is hard-removed with no alias: run
counts live on the experiment as canonical `repeat` config, with Vercel-style
`runs`/`early_exit` accepted as shorthand for `pass_at_k`.

AgentV should adopt Vercel's structure and lowest-common-denominator contract
ideas, not depend on `@vercel/agent-eval` as core infrastructure in this phase.
The package's `ExperimentConfig` shape is a strong public reference for
experiment vocabulary: agent, model, agent options, case filter, scripts, runs,
early exit, timeout, sandbox, and setup. A direct dependency would force AgentV
to absorb Vercel's fixture model, sandbox assumptions, result caching semantics,
and TypeScript-first authoring story before those boundaries are stable for
AgentV.

## Consequences

Positive:

- Evals become portable task definitions that can be run against multiple agents
  without editing the task file.
- A/B setup variants such as baseline versus skill injection become reviewable,
  committed experiment files.
- Existing artifact paths already use experiment labels, so this decision extends
  an established storage axis instead of introducing a parallel result concept.
- The default experiment pointer gives old repos a non-breaking migration path.
- AgentV can align with Vercel conventions while preserving YAML authoring,
  LLM-judge assertions, workspace fixtures, and Git-backed artifacts.

Negative:

- The migration creates two valid locations for some runtime controls until
  deprecation completes.
- The CLI must resolve explicit experiments, configured defaults, and legacy
  label-only runs without surprising users.
- Artifact readers need a richer experiment fingerprint and provenance model
  beyond the current string label.

## Non-Goals

- Do not replace AgentV's evaluator engine with `@vercel/agent-eval` in the
  initial migration.
- Do not convert AgentV eval YAML into Vercel `PROMPT.md` plus `EVAL.ts`.
- Do not move LLM-judge assertions out of eval definitions.
- Do not make Phoenix, Harbor, Opik, Vercel Sandbox, or another external system
  required for local execution.
- Do not break existing `eval.yaml` files or current result artifacts.

## References

- Vercel `agent-eval`: https://github.com/vercel-labs/agent-eval
- Vercel Next.js eval results: https://github.com/vercel/next-evals-oss
- Anthropic Skills schema vocabulary: https://github.com/anthropics/skills/blob/main/skills/skill-creator/references/schemas.md
- Hugging Face Datasets vocabulary: https://huggingface.co/docs/datasets/en/package_reference/main_classes
- OpenInference trace vocabulary: https://arize-ai.github.io/openinference/spec/
