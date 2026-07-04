# Eval YAML Spec — Schema and Assertion Grading Recipes

This reference documents the eval.yaml schema and grading recipes for every assertion type.
The grader agent uses this to evaluate assertions without the CLI.

## 1. Eval YAML Structure

### Top-level fields

- `name` (string, optional) — eval name
- `description` (string, optional) — description
- `execution` (object, optional) — `target`, `model`, etc.
- `workspace` (object, optional) — workspace config (template, repos, hooks)
- `input` (string | object | Message | Message[], optional) — suite-level input prepended to each test. String/block shorthand expands to a user message.
- `tests` (array, required) — test cases

### Per-test fields

- `id` (string, required) — unique test identifier
- `input` (string | object | Message | Message[], required) — task input. String shorthand expands to `[{role: user, content: "..."}]`; object shorthand preserves structured user content when the object has no top-level `role`. Top-level `role` is reserved for message objects.
- `expected_output` (string | Message[], optional) — passive reference answer. String shorthand expands to `[{role: assistant, content: "..."}]`. It is available to declared graders, but does not add an implicit grader when `assertions` is present.
- `criteria` (string, optional) — human-readable success criteria
- `assertions` (array, optional) — grader assertions
- `conversation_id` (string, optional) — groups related tests
- `execution` (object, optional) — per-test execution override

If `assertions` already state the grading contract, omit `criteria` instead of
duplicating the same rubric. Prefer plain assertion strings for semantic checks
when the default LLM rubric grader can judge them; use multiple named
`type: llm-rubric` blocks only for custom prompts, custom grader targets, or
intentional grader panels. Write `expected_output` as a golden/reference answer,
not as criteria or scoring instructions.

For historical or repo-state evals, materialize the repository under
`workspace.repos[]` and pin `commit` to the commit under test. A SHA in prompt
prose or metadata is context only; it does not give the agent an actual
checkout.

## 2. Assertion Types and Grading Recipes

### Default grader contract

When a test has no `assertions`, AgentV uses the default `llm-rubric` with the case context,
including `criteria` and `expected_output` when present.

When `assertions` is present, the list is explicit: run only the declared
assertions/graders. `expected_output` remains reference data for graders that consume it,
such as `llm-rubric`, `script`, or `field-accuracy`; it does not trigger an additional
default `llm-rubric`.
When the declared assertion strings fully express the semantic contract, do not
also add a duplicate `criteria` block.

For each assertion type: YAML config fields, grading recipe (exact pseudocode for deterministic types), and PASS/FAIL conditions.

### Deterministic assertions (zero-cost, instant)

#### `contains`

- **Fields:** `value` (string, required)
- **Recipe:**
  ```
  response.toLowerCase().includes(value.toLowerCase())
  ```
  Note: case-insensitive by default in AgentV. If `case_sensitive: true`, use exact match.
- **PASS:** substring found. **FAIL:** substring not found.

#### `contains-any`

- **Fields:** `value` (string[], required)
- **Recipe:**
  ```
  value.some(v => response.toLowerCase().includes(v.toLowerCase()))
  ```
- **PASS:** at least one substring found.

#### `contains-all`

- **Fields:** `value` (string[], required)
- **Recipe:**
  ```
  value.every(v => response.toLowerCase().includes(v.toLowerCase()))
  ```
- **PASS:** all substrings found.

#### `icontains` / `icontains-any` / `icontains-all`

Same as contains variants but explicitly case-insensitive.

#### `equals`

- **Fields:** `value` (string, required)
- **Recipe:**
  ```
  response.trim() === value.trim()
  ```
- **PASS:** exact match after trimming.

#### `regex`

- **Fields:** `value` (string, required — a regex pattern)
- **Recipe:**
  ```
  new RegExp(value).test(response)
  ```
- **PASS:** pattern matches.

#### `starts-with`

- **Fields:** `value` (string, required)
- **Recipe:**
  ```
  response.startsWith(value)
  ```
  (or case-insensitive variant)
- **PASS:** response starts with value.

#### `ends-with`

- **Fields:** `value` (string, required)
- **Recipe:**
  ```
  response.endsWith(value)
  ```
  (or case-insensitive variant)
- **PASS:** response ends with value.

#### `is-json`

- **Fields:** none required
- **Recipe:**
  ```
  try { JSON.parse(response); return true } catch { return false }
  ```
- **PASS:** response is valid JSON. **FAIL:** parse error.

#### `field-accuracy`

- **Fields:** `expected` (object, required — JSON object with field paths and expected values)
- **Recipe:** Parse response as JSON. For each field path in `expected`, check if the value matches.
- **PASS:** all fields match. Partial score = `matched_fields / total_fields`.

### Metric assertions (require timing.json)

#### `latency`

- **Fields:** `threshold` (number, required — max duration in ms)
- **Recipe:** Read `timing.json`. Compare `duration_ms` against threshold.
- **PASS:** `duration_ms <= threshold`.

#### `cost`

- **Fields:** `threshold` (number, required — max cost in USD)
- **Recipe:** Read timing/token data. Compare cost against threshold.
- **PASS:** `cost <= threshold`.

#### `token-usage`

- **Fields:** `threshold` (number, required — max tokens)
- **Recipe:** Read `timing.json`. Compare `total_tokens` against threshold.
- **PASS:** `total_tokens <= threshold`.

#### `execution-metrics`

- **Fields:** Various threshold fields for tool calls, output chars, etc.
- **Recipe:** Read timing.json, compare each metric against its threshold.

### Tool inspection assertions

#### `tool-trajectory`

- **Fields:** `expected` (array of expected tool calls), `mode` (string: `any_order` | `in_order` | `exact` | `subset` | `superset`)
- **Recipe:** Inspect AgentV-normalized transcript/tool-call data. Match against expected based on mode.
- **PASS:** tool calls match expected pattern per mode.
- **Boundary:** This is an AgentV extension. Promptfoo `trajectory:*`, `tool-call-f1`, `skill-used`, and `trace-*` assertion names are rejected until implemented directly.

#### `skill-trigger`

- **Fields:** `skill_name` (string, required)
- **Recipe:** Check if the agent invoked the named skill in its tool calls.
- **PASS:** skill was triggered.

### LLM-judged assertions (require Claude reasoning)

#### `llm-rubric`

- **Fields:** `value` (free-form or structured criteria), `rubrics` (itemized criteria), or `prompt` / exported `prompt_content` (custom grading prompt)
- **Recipe:** Read the rubric value, rubric items, or prompt. Evaluate the response against those criteria using your own reasoning. Produce score (0.0-1.0) with evidence.
- **PASS:** score >= 0.5 (configurable via `threshold`).

#### `rubric` / `rubrics`

- **Fields:** `rubric_items` or `criteria` (array of rubric items with descriptions and weights)
- **Recipe:** For each rubric item, evaluate the response. Score each item 0.0-1.0. Aggregate as weighted average.
- **PASS:** aggregate score >= threshold.

### Script-based assertions

#### `script-grader`

- **Fields:** `path` (string, required — path to script), `command` (string[], optional — custom command)
- **Script SDK:** Use `defineScriptGrader` from `@agentv/sdk`:
  ```typescript
  import { defineScriptGrader } from '@agentv/sdk';
  export default defineScriptGrader(({ output, trace }) => ({
    score: (output ?? '').includes('expected') ? 1 : 0,
    assert: [{ text: 'Contains expected', passed: (output ?? '').includes('expected') }],
  }));
  ```
- **Recipe:** The CLI runs the script, passing canonical JSON on stdin (`{output, input, expected_output, ...}`). Script returns `{"score": N, "assertions": [...]}`
- **PASS:** score >= 0.5 (or as configured).

### Assertion groups

#### `assert-set`

- **Fields:** `assert` (array of child assertions), `threshold` (number, optional), `config` (object, optional), child `weight` fields.
- **Recipe:** Evaluate each child assertion and compute a weighted average.
- **PASS:** without `threshold`, every nonzero-weight child must pass. With `threshold`, the weighted score must meet the threshold.
- **Config:** parent `config` is inherited by children. Child `config` keys override parent keys.

## 3. Negate Support

When `negate: true` is set on any assertion, invert the pass/fail result:

- A passing check becomes a failure
- A failing check becomes a pass
- Score is inverted: `1.0 - score`

## 4. Common Assertion Fields

All assertion types support:

- `name` (string, optional) — human-readable name
- `type` (string, required) — the assertion type
- `weight` (number, optional, default 1.0) — weight in score aggregation
- `negate` (boolean, optional) — invert result
- `threshold` (number, optional) — minimum score to pass (for LLM types)

## 5. AgentV JSONL Output Format

Each line in the results JSONL file is an `EvaluationResult` object. In JSONL, field names use snake_case (applied by `toSnakeCaseDeep()`).

### Required fields

- `timestamp` (string, ISO-8601)
- `test_id` (string)
- `score` (number, 0.0-1.0, weighted average of all assertion scores)
- `assertions` (array of `{text, passed, evidence?}`)
- `output` (string) — final answer/scored result; transcript evidence is available through captured trace/messages when present
- `execution_status` (string: `ok` | `quality_failure` | `execution_error`)

### Optional fields

- `scores` (array of EvaluatorResult) — per-grader breakdown
- `input` (Message[]) — input messages
- `token_usage` (object: `{prompt_tokens, completion_tokens, total_tokens}`)
- `cost_usd` (number)
- `duration_ms` (number)
- `target` (string)
- `eval_set` (string)
- `error` (string)
- `file_changes` (string — unified diff)
- `mode` (string — `agent` for agent mode)

### `scores[]` entries (EvaluatorResult)

- `name` (string) — grader name
- `type` (string) — grader kind (kebab-case)
- `score` (number, 0.0-1.0)
- `assertions` (array of `{text, passed, evidence?}`)
- `weight` (number, optional)
- `verdict` (string: `pass` | `fail` | `skip`)
- `details` (object, optional — structured data from script graders)
- `reasoning` (string, optional)

## 6. Eval Set Support

An eval_set references multiple eval.yaml files:

```yaml
# eval_set.yaml
eval_set:
  - path: ./basic.eval.yaml
  - path: ./advanced.eval.yaml
```

Process each file's tests independently, then aggregate results.

## 7. Agent-Mode Pipeline CLI Commands

These CLI subcommands break the monolithic `eval run` into discrete steps for agent-mode execution. The agent handles LLM grading between steps.

### `agentv pipeline input <eval-path> --out <dir>`

Extracts inputs, target commands, and grader configs from an eval YAML file.

**Output structure:**
```
<out-dir>/
├── manifest.json
├── <test-id>/
│   ├── input.json              ← {input, input_files, metadata}
│   ├── invoke.json             ← {kind, command?, cwd?, timeout_ms?}
│   ├── criteria.md             ← human-readable success criteria
│   ├── expected_output.json    ← (if present)
│   ├── script_graders/<name>.json   ← {name, command, weight, config?}
│   └── llm_graders/<name>.json    ← {name, type, weight, threshold?, prompt_content, value?, rubrics?}
```

**`manifest.json` format:**
```json
{
  "eval_file": "path/to/eval.yaml",
  "timestamp": "2026-03-24T...",
  "target": {"name": "target-name", "kind": "cli", "subagent_mode_allowed": false},
  "test_ids": ["test-01", "test-02"]
}
```

**`invoke.json` kinds:**
- `kind: "cli"` — has `command`, `cwd`, `timeout_ms`. Use the command to run the target.
- `kind: "agent"` — non-CLI provider. Check `manifest.json` `target.subagent_mode_allowed` to decide whether to dispatch executor subagents or fall back to `agentv eval` CLI.

### `agentv pipeline grade <export-dir>`

Runs script-grader assertions against `response.md` files in each test directory.

**Prerequisites:** `pipeline input` has been run and `response.md` exists in each test dir.

**Output:** `<test-id>/script_grader_results/<name>.json` for each script grader, containing:
```json
{
  "name": "grader-name",
  "type": "script-grader",
  "score": 1.0,
  "weight": 1.0,
  "assertions": [{"text": "...", "passed": true}]
}
```

### `agentv pipeline bench <export-dir>`

Merges script-grader results with LLM grader scores and produces final artifacts.

LLM grader results are read from disk at `<test-id>/llm_grader_results/<name>.json` per test.

**LLM grader result file format** (`llm_grader_results/<name>.json`):
```json
{ "score": 0.85, "assertions": [{"text": "...", "passed": true, "evidence": "..."}] }
```

**Output:**
- `<test-id>/run-1/grading.json` — merged grading with `graders`, `assertions`, `summary.pass_rate`
- `index.jsonl` — one JSON line per test: `{test_id, score, pass, graders: [...]}`
- `summary.json` — aggregate stats: `{metadata: {targets}, run_summary: {<target>: {mean, stddev, n}}}`

### Agent-Mode Workflow

```
1. agentv pipeline input eval.yaml --out ./export
2. (Agent runs targets or reads response.md)
3. agentv pipeline grade ./export
4. (Agent does LLM grading, produces scores JSON)
5. echo '<scores>' | agentv pipeline bench ./export
```
