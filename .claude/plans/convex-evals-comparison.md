# Convex Evals vs AgentV: Comparative Analysis

## Core Purpose

| | **Convex Evals** | **AgentV** |
|---|---|---|
| **Scope** | Domain-specific — evaluates LLMs on Convex backend code generation | General-purpose — evaluates any AI agent on any task |
| **What it tests** | "Can this model write correct Convex code?" | "Does this agent accomplish the task correctly?" |
| **Primary audience** | Convex team benchmarking LLM providers | Any developer evaluating AI agents |

## Eval Definition

| | **Convex Evals** | **AgentV** |
|---|---|---|
| **Format** | File-system convention: `TASK.txt` + `answer/` + `grader.test.ts` | Declarative YAML files with `cases` array |
| **Task spec** | Plain text prompt in `TASK.txt` | Structured `input_messages`, `criteria`, `rubrics` |
| **Reference answer** | Full working Convex project in `answer/` directory | `expected_output` or `expected_messages` fields |
| **Grading** | Per-eval Vitest test file (`grader.test.ts`) | Reusable evaluator types configured in YAML |

**Key difference:** Convex evals require writing a custom test file per eval. AgentV lets you declaratively compose evaluators from built-in primitives without writing code.

## Evaluation Pipeline

**Convex Evals — Code execution pipeline:**
```
TASK.txt → LLM generates files → Write to disk → bun install →
  convex deploy → TypeScript check → ESLint → Run grader.test.ts →
  Score (0/1 per step, fractional for tests)
```

**AgentV — Flexible evaluation pipeline:**
```
YAML case → Provider invokes agent → Capture output/trace/file changes →
  Run evaluators in parallel (code_judge, llm_judge, rubric, tool_trajectory,
  field_accuracy, latency, cost, etc.) → Weighted aggregate score → Verdict
```

## Scoring & Grading

| | **Convex Evals** | **AgentV** |
|---|---|---|
| **Scoring model** | Multi-stage pipeline: filesystem, install, deploy, typecheck, lint, tests — each pass/fail | Multi-evaluator parallel execution with weighted aggregation |
| **Score range** | 0 or 1 per stage, fractional for test pass ratio | 0-1 continuous, with pass/borderline/fail verdicts |
| **Grading approach** | Functional testing (deploy & run the code) + optional AI grader | LLM judges, code judges, rubrics, tool trajectory, field accuracy, etc. |
| **Custom logic** | Write a Vitest test file per eval | `code_judge` scripts (Python/TS) receiving JSON stdin |

## Provider / Model Support

| | **Convex Evals** | **AgentV** |
|---|---|---|
| **Model access** | All via OpenRouter (30+ models: Claude, GPT, Gemini, DeepSeek, Llama, etc.) | Pluggable providers: Azure, Anthropic, CLI agents, VS Code, Claude Code, Codex, custom |
| **What gets tested** | Raw LLM code generation (text completion) | Full agent execution (tool use, multi-turn, file operations) |
| **Concurrency** | Per-model `maxConcurrency` with rate-limit detection | Configurable `--workers` with parallel execution |

## Architecture

| | **Convex Evals** | **AgentV** |
|---|---|---|
| **Runtime** | Bun + Vitest | Bun + custom orchestrator |
| **Backend** | Optional Convex backend for storing scores/leaderboard | None — local-first, file output (JSONL/YAML) |
| **Distribution** | Monolithic repo, not published as a package | Published npm package (`agentv` CLI + `@agentv/core` SDK) |
| **Extensibility** | Add new evals by creating directories with TASK.txt + grader | Plugin system: code_judge, llm_judge, composite evaluators |
| **CI integration** | GitHub Actions with scheduled runs (daily/weekly/monthly per model) | CLI-first, integrates with any CI |

## Key Philosophical Differences

1. **Domain-specific vs General-purpose**: Convex evals is a benchmark suite for one platform. AgentV is a framework for building evaluation suites for anything.

2. **Functional testing vs Multi-objective evaluation**: Convex evals actually deploys and runs the generated code — it's a functional correctness test. AgentV supports correctness, latency, cost, safety, and tool trajectory evaluation simultaneously.

3. **Custom tests vs Declarative config**: Each Convex eval needs a hand-written `grader.test.ts`. AgentV lets you compose evaluators in YAML without writing test code (though `code_judge` supports custom scripts when needed).

4. **Leaderboard-oriented vs Developer-oriented**: Convex evals feeds a public LLM leaderboard for Convex code generation. AgentV is designed for developers iterating on their agent's prompts and behavior.

5. **Single-turn generation vs Agent execution**: Convex evals tests "generate these files from a prompt." AgentV supports multi-turn conversations, tool use trajectories, workspace file changes, and full agent execution traces.

## What AgentV Could Learn from Convex Evals

- **Functional execution grading**: Convex evals' pipeline of "deploy it and run it" is powerful for code generation evals. AgentV's `workspace_template` + `code_judge` achieves this but requires more setup.
- **Structured benchmark organization**: The category-based numbering system (`000-fundamentals`, `001-data_modeling`) makes progressive difficulty clear.
- **CI scheduling per model**: Running different models at different cadences (daily vs weekly) based on importance is practical for cost management.
- **Public leaderboard integration**: Convex evals publishes results to a leaderboard, which drives community engagement.

## What Convex Evals Lacks That AgentV Has

- **Declarative eval definition** — no YAML, must write code per eval
- **LLM judges and rubrics** — limited AI grading vs AgentV's rich rubric system
- **Multi-objective scoring** — no latency/cost/token tracking
- **Tool trajectory validation** — can't verify agent tool call sequences
- **Composite evaluators** — no way to combine evaluation strategies
- **Agent provider abstraction** — locked to OpenRouter text completion
- **Published SDK** — can't be used as a library in other projects
