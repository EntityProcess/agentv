# Agent-Mode Evals Design

**Date:** 2026-03-23
**Status:** Approved

## Problem

The current `agentv eval` CLI command requires the AgentV CLI and external API calls to run evaluations. We want an **agent mode** where Claude Code itself orchestrates eval execution and grading — zero dependency on `agentv` CLI, zero external API calls. Claude IS the execution engine and the LLM judge.

## Approach

Adapt the existing `agentv-bench` skill to natively parse `*.eval.yaml` files and orchestrate execution using Claude Code subagents, following the same proven architecture as the `skill-creator` plugin.

**Key principle:** The skill-creator pattern works by having subagents do the work and write results to files. No CLI calls, no API calls — just subagent spawning + file I/O.

## Architecture

```
User invokes agentv-bench skill:
  "Run evals/dataset.eval.yaml against my-agent-skill"

agentv-bench SKILL.md (orchestrator)
  │
  ├── Parses eval.yaml (using references/eval-yaml-spec.md)
  │   → Extracts: tests[], each with input + assertions
  │
  ├── For each test: spawns ad-hoc EXECUTOR subagent
  │   → Runs in current workspace (inherits CLAUDE.md, skills, MCP)
  │   → Receives `input` from eval.yaml as the task
  │   → Optional: context hint (skill path, plugin, or workspace description)
  │   → Captures response + outputs to workspace dir
  │   → Timing captured from subagent completion notification
  │
  ├── For each test: spawns GRADER subagent (agents/grader.md)
  │   → Reads response from workspace
  │   → Evaluates ALL assertion types natively
  │   → Writes grading.json per test (isolated, no concurrent writes)
  │
  └── Assembles results.jsonl (AgentV JSONL format)
      → Copies to .agentv/results/raw/ for downstream tooling
```

## Component Changes

### 1. Restructure agents

Move plugin-level agents under `skills/agentv-bench/agents/` (aligning with skill-creator's pattern where agents live under the skill):

- `plugins/agentv-dev/agents/eval-grader.md` → `skills/agentv-bench/agents/grader.md`
- `plugins/agentv-dev/agents/eval-comparator.md` → `skills/agentv-bench/agents/comparator.md`
- `plugins/agentv-dev/agents/eval-analyzer.md` → `skills/agentv-bench/agents/analyzer.md`
- Delete plugin-level `agents/` directory

### 2. New reference file: `references/eval-yaml-spec.md`

Documents the eval.yaml schema for the orchestrator and grader:

- Full eval.yaml structure (tests, input, assertions, expected_output)
- Mapping of each assertion type to grading logic
- Deterministic assertion recipes (exact matching rules)
- AgentV JSONL output format spec
- eval_set support (multiple eval.yaml files)

### 3. Update `agents/grader.md`

The grader handles both deterministic and LLM-judged assertions:

| Assertion Type | How Grader Handles It |
|---|---|
| `contains`, `equals` | Direct string comparison on response text |
| `regex` | Regex match on response text |
| `starts-with`, `ends-with` | String prefix/suffix check |
| `is-json` | Parse response as JSON, check validity |
| `field-accuracy` | Parse JSON response, check field values against expected |
| `tool-trajectory` | Inspect transcript for tool calls, match against expected sequence/mode |
| `execution-metrics` | Read timing.json for token/cost/duration, compare thresholds |
| `latency`, `cost`, `token-usage` | Read timing.json, compare against thresholds |
| `llm-grader` / rubric | Claude reasons about response quality against the prompt/rubric |
| `code-grader` | Run script via Bash tool, capture exit code + output |
| `composite` | Evaluate sub-assertions, aggregate per config |

Output: AgentV JSONL format with `scores[]` array containing type, score, and assertions.

### 4. Update `SKILL.md`

Add "agent mode" run flow alongside existing CLI mode:

- Parse eval.yaml → extract tests with input + assertions
- For each test: spawn executor subagent (ad-hoc, no agent file needed)
- For each test: spawn grader subagent (reads agents/grader.md)
- Aggregate into results.jsonl
- Copy to `.agentv/results/raw/`

## Executor Subagent

The executor is spawned **ad-hoc** (no dedicated agent file), matching skill-creator's pattern:

```
Execute this task:
- Context: <optional — skill path, plugin path, or workspace description>
- Task: <input from eval.yaml>
- Save outputs to: .agentv/results/export/<timestamp>/test-<id>/outputs/
```

The executor runs in the **current workspace** — same CLAUDE.md, skills, MCP servers, plugins. The workspace IS the agent-under-test's environment. The "agent" being evaluated can be any of:

- A single skill
- A plugin (with skills, agents, hooks)
- The full workspace (CLAUDE.md + everything)
- An eval_set spanning multiple eval.yaml files

## Output Structure (aligned with PR #708)

Each grader writes directly to its own `test-<id>/grading.json` — no temporary workspace needed since test IDs are unique.

```
.agentv/results/
├── raw/
│   └── eval_<timestamp>.jsonl         ← AgentV JSONL (assembled from export/ in agent mode)
└── export/<timestamp>/                 ← skill-creator-compatible structure
    └── test-<test-id>/
        ├── outputs/                   ← executor subagent output files
        ├── timing.json                ← from subagent notification
        └── grading.json              ← grader output (skill-creator format, assertions not expectations)
```

One unified `export/` folder used by both modes:
- **Agent mode:** grader writes directly to `export/<timestamp>/`, orchestrator assembles JSONL from it
- **CLI mode:** `agentv results export` creates `export/<timestamp>/` from JSONL

The JSONL in `raw/` is the AgentV-specific artifact. The `export/` folder is the skill-creator-compatible view. `agentv results export` works unchanged.

## Concurrency Model

- Executor subagents can run in **parallel** (one per test)
- Grader subagents can run in **parallel** (one per test, after its executor completes)
- Each grader writes to its own `test-<id>/grading.json` — no concurrent file writes
- The orchestrator (single agent) assembles `results.jsonl` **after** all graders complete

## Scope

### In scope
- Parse eval.yaml (single file or eval_set with multiple files)
- Execute tests via subagents in current workspace
- Grade all assertion types (deterministic + LLM + code-grader)
- Produce AgentV JSONL output
- Capture timing data from subagent notifications

### Out of scope (future work)
- Multi-provider support (agent mode tests against current workspace only)
- Baseline/comparison runs (use agentv-bench's existing comparison workflow)
- Description optimization (unchanged, uses existing scripts)

## Zero CLI Dependency

The skill achieves zero CLI dependency by:

- **Parsing**: Reads eval.yaml files directly (the orchestrator/grader reads the file)
- **Execution**: Subagents run tasks, not `agentv eval`
- **Grading**: Claude does all grading natively — deterministic checks via string ops, LLM grading via Claude's own reasoning, code-grader via Bash
- **Output**: Orchestrator constructs JSONL by writing JSON lines to a file
