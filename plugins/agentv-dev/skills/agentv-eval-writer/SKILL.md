---
name: agentv-eval-writer
description: >-
  Write, edit, review, and validate AgentV EVAL.yaml / .eval.yaml evaluation files.
  Use when asked to create new eval files, update or fix existing ones, add or remove test cases,
  configure graders (`llm-grader`, `code-grader`, `rubrics`), review whether an eval is correct or complete,
  convert between EVAL.yaml and evals.json using `agentv convert`, or generate eval test cases
  from chat transcripts (markdown conversation or JSON messages).
  Do NOT use for creating SKILL.md files, writing skill definitions, or running evals —
  running and benchmarking belongs to agentv-bench.
---

# AgentV Eval Writer

Comprehensive docs: https://agentv.dev

## Evaluation Types

AgentV evaluations measure **execution quality** — whether your agent or skill produces correct output when invoked.

For **trigger quality** (whether the right skill is triggered for the right prompts), see the [Evaluation Types guide](https://agentv.dev/guides/evaluation-types/). Do not use execution eval configs (`EVAL.yaml`, `evals.json`) for trigger evaluation — these are distinct concerns requiring different tooling and methodologies.

## Starting from evals.json?

If the project already has an Agent Skills `evals.json` file, use it as a starting point instead of writing YAML from scratch:

```bash
# Convert evals.json to AgentV EVAL YAML
agentv convert evals.json

# Run directly without converting (all commands accept evals.json)
agentv eval evals.json
```

The converter maps `prompt` → `input`, `expected_output` → `expected_output`, `assertions` → `assertions` (`llm-grader`), and resolves `files[]` paths. The generated YAML includes TODO comments for AgentV features to add (workspace setup, code graders, rubrics, required gates).

After converting, enhance the YAML with AgentV-specific capabilities shown below.

## From Chat Transcript

Convert a chat conversation into eval test cases without starting from scratch.

**Input formats:**

Markdown conversation:
```
User: How do I reset my password?
Assistant: Go to Settings > Security > Reset Password...
```

JSON messages:
```json
[{"role": "user", "content": "How do I reset my password?"},
 {"role": "assistant", "content": "Go to Settings > Security > Reset Password..."}]
```

**Select exchanges that make good test cases:**
- Factual Q&A — verifiable answers
- Task completion — user requests an action, agent performs it
- Edge cases — unusual inputs, error handling, boundary conditions
- Multi-turn reasoning — exchanges where earlier context matters

**Skip:** greetings, one-word acknowledgments, repeated exchanges

**Multi-turn format** (when context from prior turns matters):
```yaml
tests:
  - id: multi-turn-context
    criteria: "Agent remembers prior context"
    input:
      - role: user
        content: "My name is Alice"
      - role: assistant
        content: "Nice to meet you, Alice!"
      - role: user
        content: "What's my name?"
    expected_output: "Your name is Alice."
    assertions:
      - type: rubrics
        criteria:
          - Correctly recalls the user's name from earlier in the conversation
```

**Guidelines:** preserve exact wording in `expected_output`; aim for 5–15 tests per transcript; pick exchanges that test different capabilities.

## Quick Start

```yaml
description: Example eval
execution:
  target: default

tests:
  - id: greeting
    criteria: Friendly greeting
    input: "Say hello"
    expected_output: "Hello! How can I help you?"
    assertions:
      - type: rubrics
        criteria:
          - Greeting is friendly and warm
          - Offers to help
```

## Eval File Structure

**Required:** `tests` (array or string path)
**Optional:** `name`, `description`, `version`, `author`, `tags`, `license`, `requires`, `execution`, `suite`, `workspace`, `assertions`, `input`

**Test fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier |
| `criteria` | yes | What the response should accomplish |
| `input` / `input` | yes | Input to the agent |
| `expected_output` / `expected_output` | no | Gold-standard reference answer |
| `assertions` | no | Graders: deterministic checks, rubrics, and LLM/code graders |
| `rubrics` | no | **Deprecated** — use `assertions: [{type: rubrics, criteria: [...]}]` instead |
| `execution` | no | Per-case execution overrides |
| `workspace` | no | Per-case workspace config (overrides suite-level) |
| `metadata` | no | Arbitrary key-value pairs passed to setup/teardown scripts |
| `conversation_id` | no | Thread grouping |

**Shorthand aliases:**
- `input` (string) expands to `[{role: "user", content: "..."}]`
- `expected_output` (string/object) expands to `[{role: "assistant", content: ...}]`
- Canonical `input` / `expected_output` take precedence when both present

**Message format:** `{role, content}` where role is `system`, `user`, `assistant`, or `tool`
**Content types:** inline text, `{type: "file", value: "./path.md"}`
**File paths:** relative from eval file dir, or absolute with `/` prefix from repo root
**File handling by provider type:** LLM providers receive file content inlined in XML tags. Agent providers receive a preread block with `file://` URIs and must read files themselves. See [Coding Agents > Prompt format](https://agentv.dev/targets/coding-agents#prompt-format).

**JSONL format:** One test per line as JSON. Optional `.yaml` sidecar for shared defaults. See `examples/features/basic-jsonl/`.

**Environment variables:** All string fields support `${{ VAR }}` interpolation. Missing vars resolve to empty string. Works in eval files, external case files, and workspace configs. `.env` files are loaded automatically.

## Metadata

When `name` is present, the suite is parsed as a metadata-bearing eval:

```yaml
name: export-screening        # required, lowercase/hyphens, max 64 chars
description: Evaluates export control screening accuracy
version: "1.0"
author: acme-compliance
tags: [compliance, agents]
license: Apache-2.0
requires:
  agentv: ">=0.30.0"
```

## Suite-level Input

Prepend shared input messages to every test (like suite-level `assertions`). Avoids repeating the same prompt file in each test:

```yaml
input:
  - role: user
    content:
      - type: file
        value: ./system-prompt.md

tests: ./cases.yaml

# cases.yaml — each test only needs its own query
# - id: test-1
#   criteria: ...
#   input: "User question here"
```

Effective input: `[...suite input, ...test input]`. Skipped when `execution.skip_defaults: true`.
Accepts same formats as test `input` (string or message array).

## Tests as String Path

Point `tests` to an external file instead of inlining:

```yaml
name: my-eval
description: My evaluation suite
tests: ./cases.yaml           # relative to eval file dir
```

The external file can be YAML (array of test objects) or JSONL.

## Assertions Field

`assertions` defines graders at the suite level or per-test level. It is the canonical field for all graders:

```yaml
# Suite-level (appended to every test)
assertions:
  - type: is-json
    required: true
  - type: contains
    value: "status"

tests:
  - id: test-1
    criteria: Returns JSON
    input: Get status
    # Per-test assertions (runs before suite-level)
    assertions:
      - type: equals
        value: '{"status": "ok"}'
```

## How `criteria` and `assertions` Interact

`criteria` is a **data field** — it describes what the response should accomplish. It is **not** a grader. How it gets evaluated depends on whether `assertions` is present:

| Scenario | What happens | Warning? |
|----------|-------------|----------|
| `criteria` + **no `assertions`** | Implicit `llm-grader` runs automatically against `criteria` | No |
| `criteria` + **`assertions` with only deterministic graders** (contains, regex, etc.) | Only declared graders run. `criteria` is **not evaluated**. | Yes — warns that no grader will consume criteria |
| `criteria` + **`assertions` with a grader** (`llm-grader`, `code-grader`, `rubrics`) | Declared graders run. Graders receive `criteria` as input. | No |

### No assertions → implicit llm-grader

The simplest path. `criteria` is automatically evaluated by the default `llm-grader`:

```yaml
tests:
  - id: simple-eval
    criteria: Assistant correctly explains the bug and proposes a fix
    input: "Debug this function..."
    # No assertions → default llm-grader evaluates against criteria
```

### assertions present → no implicit grader

When `assertions` is defined, **only the declared graders run**. If you want an LLM grader alongside deterministic checks, declare it explicitly:

```yaml
tests:
  - id: mixed-eval
    criteria: Response is helpful and mentions the fix
    input: "Debug this function..."
    assertions:
      - type: llm-grader       # must be explicit when assertions is present
      - type: contains
        value: "fix"
```

**Common mistake:** defining `criteria` with only deterministic graders. The criteria will be ignored and a warning is emitted:

```yaml
tests:
  - id: bad-example
    criteria: Gives a thoughtful answer    # ⚠ NOT evaluated — no grader in assertions
    input: "What is 2+2?"
    assertions:
      - type: contains
        value: "4"
    # Warning: criteria is defined but no grader in assertions will evaluate it.
```

## Required Gates

Any grader can be marked `required` to enforce a minimum score:

```yaml
assertions:
  - type: contains
    value: "DENIED"
    required: true          # must score >= 0.8 (default)
  - type: rubrics
    required: 0.6           # must score >= 0.6 (custom threshold)
    criteria:
      - id: accuracy
        outcome: Identifies the denied party
        weight: 5.0
```

If a required grader scores below its threshold, the overall verdict is forced to `fail`.

## Workspace Setup/Teardown

Run scripts before/after each test. Define at suite level or override per case:

```yaml
workspace:
  template: ./workspace-templates/my-project
  setup:
    command: ["bun", "run", "setup.ts"]
    timeout_ms: 120000
  teardown:
    command: ["bun", "run", "teardown.ts"]

tests:
  - id: case-1
    input: Fix the bug
    criteria: Bug is fixed
    metadata:
      repo: sympy/sympy
    workspace:
      repos:
        - path: /testbed
          source:
            type: git
            url: https://github.com/sympy/sympy.git
          checkout:
            base_commit: "abc123"
      docker:
        image: swebench/sweb.eval.django__django:latest
```

**Lifecycle:** template copy → repo clone → setup → git baseline → agent → file changes → teardown → repo reset → cleanup
**Merge:** Case-level fields replace suite-level fields.
**Commands receive stdin JSON:** `{workspace_path, test_id, eval_run_id, case_input, case_metadata}`
**Setup failure:** aborts case. **Teardown failure:** non-fatal (warning).
For SWE-bench-style evals, keep operational checkout state under `workspace.repos[].checkout.base_commit`; treat `metadata.base_commit` as informational only.

### Repository Lifecycle

Clone repos into workspace automatically. For shared repo workspaces, pooling is the default:

```yaml
workspace:
  repos:
    - path: ./repo
      source:
        type: git
        url: https://github.com/org/repo.git
      checkout:
        ref: main
        ancestor: 1       # parent commit
      clone:
        depth: 10
  hooks:
    after_each:
      reset: fast          # none | fast | strict
  isolation: shared        # shared | per_test
  mode: pooled             # pooled | temp | static
  hooks:
    enabled: true            # set false to skip all hooks
```

- `source.type`: `git` (URL) or `local` (path)
- `checkout.resolve`: `remote` (ls-remote) or `local`
- `clone.depth`: shallow clone depth
- `clone.filter`: partial clone filter (e.g., `blob:none`)
- `clone.sparse`: sparse checkout paths array
- `mode`: `pooled` (default for shared repos), `temp`, or `static`
- `path`: workspace path used when `mode: static`; when empty/missing the workspace is auto-materialised (template copied + repos cloned); populated dirs are reused as-is
- `hooks.enabled`: boolean (default `true`); set `false` to skip all lifecycle hooks
- Pool reset defaults to `fast` (`git clean -fd`); use `--workspace-clean full` for strict reset (`git clean -fdx`)
- Pool entries are managed separately via `agentv workspace list` and `agentv workspace clean`
- `agentv workspace deps <eval-paths>` scans eval files and outputs a JSON manifest of required git repos (useful for CI pre-cloning)

See https://agentv.dev/targets/configuration/#repository-lifecycle

## Grader Types

Configure via `assertions` array. Multiple graders produce a weighted average score.

### code_grader
```yaml
- name: format_check
  type: code-grader
  command: [uv, run, validate.py]
  cwd: ./scripts          # optional working directory
  target: {}              # optional: enable LLM target proxy (max_calls: 50)
```
Contract: stdin JSON -> stdout JSON `{score, assertions: [{text, passed, evidence?}], reasoning}`
Input includes: `question`, `criteria`, `answer`, `reference_answer`, `output`, `trace`, `token_usage`, `cost_usd`, `duration_ms`, `start_time`, `end_time`, `file_changes`, `workspace_path`, `config`
When a workspace is configured, `workspace_path` is the absolute path to the workspace dir (also available as `AGENTV_WORKSPACE_PATH` env var). Use this for functional grading (e.g., running `npm test` in the workspace).
See docs at https://agentv.dev/evaluators/code-graders/

### llm_grader
```yaml
- name: quality
  type: llm-grader
  prompt: ./prompts/eval.md     # markdown template or command config
  target: grader_gpt_5_mini     # optional: override the grader target for this grader
  model: gpt-5-chat            # optional model override
  config:                       # passed to prompt templates as context.config
    strictness: high
```
Variables: `{{question}}`, `{{criteria}}`, `{{answer}}`, `{{reference_answer}}`, `{{input}}`, `{{expected_output}}`, `{{output}}`, `{{file_changes}}`
- Markdown templates: use `{{variable}}` syntax
- TypeScript templates: use `definePromptTemplate(fn)` from `@agentv/eval`, receives context object with all variables + `config`
- Use `target:` to run different `llm-grader` graders against different named LLM targets in the same eval (useful for grader panels / ensembles)

### composite
```yaml
- name: gate
  type: composite
  assertions:
    - name: safety
      type: llm-grader
      prompt: ./safety.md
    - name: quality
      type: llm-grader
  aggregator:
    type: weighted_average
    weights: { safety: 0.3, quality: 0.7 }
```
Aggregator types: `weighted_average`, `all_or_nothing`, `minimum`, `maximum`, `safety_gate`
- `safety_gate`: fails immediately if the named gate grader scores below threshold (default 1.0)

### tool_trajectory
```yaml
- name: tool_check
  type: tool-trajectory
  mode: any_order            # any_order | in_order | exact
  minimums:                  # for any_order
    knowledgeSearch: 2
  expected:                  # for in_order/exact
    - tool: knowledgeSearch
      args: { query: "search term" }   # partial deep equality match
    - tool: documentRetrieve
      args: any                        # any arguments accepted
      max_duration_ms: 5000            # per-tool latency assertion
    - tool: summarize                  # omit args to skip argument checking
```

### field_accuracy
```yaml
- name: fields
  type: field-accuracy
  match_type: exact          # exact | date | numeric_tolerance
  numeric_tolerance: 0.01    # for numeric_tolerance match_type
  aggregation: weighted_average  # weighted_average | all_or_nothing
```
Compares `output` fields against `expected_output` fields.

### latency
```yaml
- name: speed
  type: latency
  max_ms: 5000
```

### cost
```yaml
- name: budget
  type: cost
  max_usd: 0.10
```

### token_usage
```yaml
- name: tokens
  type: token-usage
  max_total_tokens: 4000
```

### execution_metrics
```yaml
- name: efficiency
  type: execution-metrics
  max_tool_calls: 10        # Maximum tool invocations
  max_llm_calls: 5          # Maximum LLM calls (assistant messages)
  max_tokens: 5000          # Maximum total tokens (input + output)
  max_cost_usd: 0.05        # Maximum cost in USD
  max_duration_ms: 30000    # Maximum execution duration
  target_exploration_ratio: 0.6   # Target ratio of read-only tool calls
  exploration_tolerance: 0.2      # Tolerance for ratio check (default: 0.2)
```
Declarative threshold-based checks on execution metrics. Only specified thresholds are checked.
Score is proportional: `passed / total` assertions. Missing data counts as a failed assertion.

### contains
```yaml
- type: contains
  value: "DENIED"
  required: true
```
Binary check: does output contain the substring? Name auto-generated if omitted.

### regex
```yaml
- type: regex
  value: "\\d{3}-\\d{2}-\\d{4}"
```
Binary check: does output match the regex pattern?

### equals
```yaml
- type: equals
  value: "42"
```
Binary check: does output exactly equal the value (both trimmed)?

### is_json
```yaml
- type: is-json
  required: true
```
Binary check: is the output valid JSON?

### rubrics
```yaml
- type: rubrics
  criteria:
    - id: accuracy
      outcome: Correctly identifies the denied party
      weight: 5.0
    - id: reasoning
      outcome: Provides clear reasoning
      weight: 3.0
```
LLM-judged structured evaluation with weighted criteria. Criteria items support `id`, `outcome`, `weight`, and `required` fields.

### rubrics (inline, deprecated)
Top-level `rubrics:` field is deprecated. Use `type: rubrics` under `assertions` instead.
See `references/rubric-evaluator.md` for score-range mode and scoring formula.

## Execution Error Tolerance

Control how the runner handles execution errors (infrastructure failures, not quality failures):

```yaml
execution:
  fail_on_error: false    # never halt (default)
  # fail_on_error: true   # halt on first execution error
```

When halted, remaining tests get `executionStatus: 'execution_error'` with `failureReasonCode: 'error_threshold_exceeded'`.

## Suite-Level Quality Threshold

Set a minimum mean score for the eval suite. If the mean quality score falls below the threshold, the CLI exits with code 1 — useful for CI/CD quality gates.

```yaml
execution:
  threshold: 0.8
```

CLI flag `--threshold 0.8` overrides the YAML value. Must be a number between 0 and 1. Mean score is computed from quality results only (execution errors excluded).

The threshold also controls JUnit XML pass/fail: tests with scores below the threshold are marked as `<failure>`. When no threshold is set, JUnit defaults to 0.5.

## CLI Commands

```bash
# Run evaluation (requires API keys)
agentv eval <file.yaml> [--test-id <id>] [--target <name>] [--dry-run] [--threshold <0-1>]

# Run with OTLP JSON file (importable by OTel backends)
agentv eval <file.yaml> --otel-file traces/eval.otlp.json

# Run a single assertion in isolation (no API keys needed)
agentv eval assert <grader-name> --agent-output "..." --agent-input "..."

# Import agent transcripts for offline grading
agentv import claude --session-id <uuid>

# Re-run only execution errors from a previous run
agentv eval <file.yaml> --retry-errors .agentv/results/runs/<timestamp>/index.jsonl

# Validate eval file
agentv validate <file.yaml>

# Compare results — N-way matrix from a canonical run manifest
agentv compare .agentv/results/runs/<timestamp>/index.jsonl
agentv compare .agentv/results/runs/<timestamp>/index.jsonl --baseline <target>                   # CI regression gate
agentv compare .agentv/results/runs/<timestamp>/index.jsonl --baseline <target> --candidate <target>  # pairwise
agentv compare .agentv/results/runs/<baseline-timestamp>/index.jsonl .agentv/results/runs/<candidate-timestamp>/index.jsonl

# Author assertions directly in the eval file
# Prefer simple assertions when they fit the criteria; use deterministic or LLM-based graders when needed
agentv validate <file.yaml>
```

## Code Judge SDK

Use `@agentv/eval` to build custom graders in TypeScript/JavaScript:

### defineAssertion (recommended for custom checks)
```typescript
#!/usr/bin/env bun
import { defineAssertion } from '@agentv/eval';

export default defineAssertion(({ answer, trace }) => ({
  pass: answer.length > 0 && (trace?.eventCount ?? 0) <= 10,
  reasoning: 'Checks content exists and is efficient',
}));
```

Assertions support both `pass: boolean` and `score: number` (0-1). If only `pass` is given, score is 1 (pass) or 0 (fail).

### defineCodeGrader (full control)
```typescript
#!/usr/bin/env bun
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ trace, answer }) => ({
  score: trace?.eventCount <= 5 ? 1.0 : 0.5,
  assertions: [
    { text: 'Efficient tool usage', passed: (trace?.eventCount ?? 0) <= 5 },
  ],
}));
```

Both are used via `type: code-grader` in YAML with `command: [bun, run, grader.ts]`.

### Convention-Based Discovery

Place assertion files in `.agentv/assertions/` — they auto-register by filename:

```
.agentv/assertions/word-count.ts  →  type: word-count
.agentv/assertions/sentiment.ts   →  type: sentiment
```

No `command:` needed in YAML — just use `type: <filename>`.

## Programmatic API

Use `evaluate()` from `@agentv/core` to run evals as a library:

```typescript
import { evaluate } from '@agentv/core';

const { results, summary } = await evaluate({
  tests: [
    {
      id: 'greeting',
      input: 'Say hello',
      assertions: [{ type: 'contains', value: 'hello' }],
    },
  ],
  target: { provider: 'mock_agent' },
});
console.log(`${summary.passed}/${summary.total} passed`);
```

Supports inline tests (no YAML) or file-based via `specFile`.

## defineConfig

Type-safe project configuration in `agentv.config.ts`:

```typescript
import { defineConfig } from '@agentv/core';

export default defineConfig({
  execution: { workers: 5, maxRetries: 2 },
  output: { format: 'jsonl', dir: './results' },
  limits: { maxCostUsd: 10.0 },
});
```

Auto-discovered from project root. Validated with Zod.

## Scaffold Commands

```bash
agentv create assertion <name>  # → .agentv/assertions/<name>.ts
agentv create eval <name>       # → evals/<name>.eval.yaml + .cases.jsonl
```

## Skill Improvement Workflow

For a complete guide to iterating on skills using evaluations — writing scenarios, running baselines, comparing results, and improving — see the [Skill Improvement Workflow](https://agentv.dev/guides/skill-improvement-workflow/) guide.
## Human Review Checkpoint

After running evals, perform a human review before iterating. Create `feedback.json` in the results directory:

```json
{
  "run_id": "2026-03-14T10-32-00_claude",
  "reviewer": "engineer-name",
  "timestamp": "2026-03-14T12:00:00Z",
  "overall_notes": "Summary of observations",
  "per_case": [
    {
      "test_id": "test-id",
      "verdict": "acceptable | needs_improvement | incorrect | flaky",
      "notes": "Why this verdict",
      "evaluator_overrides": { "code-grader:name": "Override note" },
      "workspace_notes": "Workspace state observations"
    }
  ]
}
```

Use `evaluator_overrides` for workspace evaluations to annotate specific grader results (e.g., "code-grader was too strict"). Use `workspace_notes` for observations about workspace state.

Review workflow: run evals → inspect results (`agentv inspect show`) → write feedback → tune prompts/graders → re-run.

Full guide: https://agentv.dev/guides/human-review/

## Schemas

- Eval file: `references/eval-schema.json`
- Config: `references/config-schema.json`
