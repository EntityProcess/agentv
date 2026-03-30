# Eval YAML Spec — Schema and Assertion Grading Recipes

This reference documents the eval.yaml schema and grading recipes for every assertion type.
The grader agent uses this to evaluate assertions without the CLI.

## 1. Eval YAML Structure

### Top-level fields

- `name` (string, optional) — eval name
- `description` (string, optional) — description
- `execution` (object, optional) — `target`, `model`, etc.
- `workspace` (object, optional) — workspace config (template, hooks)
- `tests` (array, required) — test cases

### Per-test fields

- `id` (string, required) — unique test identifier
- `input` (string | Message[], required) — task input. String shorthand expands to `[{role: user, content: "..."}]`
- `expected_output` (string | Message[], optional) — reference answer. String shorthand expands to `[{role: assistant, content: "..."}]`
- `criteria` (string, optional) — human-readable success criteria
- `assertions` (array, optional) — evaluator assertions
- `conversation_id` (string, optional) — groups related tests
- `execution` (object, optional) — per-test execution override

## 2. Assertion Types and Grading Recipes

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

- **Fields:** `expected` (array of expected tool calls), `mode` (string: `exact` | `contains` | `order`)
- **Recipe:** Inspect transcript for tool call sequence. Match against expected based on mode.
- **PASS:** tool calls match expected pattern per mode.

#### `skill-trigger`

- **Fields:** `skill_name` (string, required)
- **Recipe:** Check if the agent invoked the named skill in its tool calls.
- **PASS:** skill was triggered.

### LLM-judged assertions (require Claude reasoning)

#### `llm-grader`

- **Fields:** `prompt` (string, required — either inline text or path to .md file)
- **Recipe:** Read the prompt. Evaluate the response against the criteria using your own reasoning. Produce score (0.0-1.0) with evidence.
- **PASS:** score >= 0.5 (configurable via `threshold`).

#### `rubric` / `rubrics`

- **Fields:** `rubric_items` or `criteria` (array of rubric items with descriptions and weights)
- **Recipe:** For each rubric item, evaluate the response. Score each item 0.0-1.0. Aggregate as weighted average.
- **PASS:** aggregate score >= threshold.

### Script-based assertions

#### `code-grader`

- **Fields:** `path` (string, required — path to script), `command` (string[], optional — custom command)
- **Script SDK:** Use `defineCodeGrader` from `@agentv/eval`:
  ```typescript
  import { defineCodeGrader } from '@agentv/eval';
  export default defineCodeGrader(({ outputText, trace }) => ({
    score: outputText.includes('expected') ? 1 : 0,
    assertions: [{ text: 'Contains expected', passed: outputText.includes('expected') }],
  }));
  ```
- **Recipe:** The CLI runs the script, passing context as JSON on stdin (`{output, outputText, input, inputText, ...}`). Script returns `{"score": N, "assertions": [...]}`
- **PASS:** score >= 0.5 (or as configured).

### Composite assertion

#### `composite`

- **Fields:** `assertions` (array of sub-assertions), `aggregation` (string: `weighted_average` | `min` | `max` | `all_pass`)
- **Recipe:** Evaluate each sub-assertion. Aggregate scores per aggregation mode.
- **PASS:** depends on aggregation mode.

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
- `output` (Message[]) — agent output messages
- `execution_status` (string: `ok` | `quality_failure` | `execution_error`)

### Optional fields

- `scores` (array of EvaluatorResult) — per-evaluator breakdown
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

- `name` (string) — evaluator name
- `type` (string) — evaluator kind (kebab-case)
- `score` (number, 0.0-1.0)
- `assertions` (array of `{text, passed, evidence?}`)
- `weight` (number, optional)
- `verdict` (string: `pass` | `fail` | `skip`)
- `details` (object, optional — structured data from code graders)
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
│   ├── code_graders/<name>.json   ← {name, command, weight, config?}
│   └── llm_graders/<name>.json    ← {name, weight, threshold?, prompt_content}
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

Runs code-grader assertions against `response.md` files in each test directory.

**Prerequisites:** `pipeline input` has been run and `response.md` exists in each test dir.

**Output:** `<test-id>/code_grader_results/<name>.json` for each code grader, containing:
```json
{
  "name": "grader-name",
  "type": "code-grader",
  "score": 1.0,
  "weight": 1.0,
  "assertions": [{"text": "...", "passed": true}]
}
```

### `agentv pipeline bench <export-dir>`

Merges code-grader results with LLM grader scores and produces final artifacts.

LLM grader results are read from disk at `<test-id>/llm_grader_results/<name>.json` per test.

**LLM grader result file format** (`llm_grader_results/<name>.json`):
```json
{ "score": 0.85, "assertions": [{"text": "...", "passed": true, "evidence": "..."}] }
```

**Output:**
- `<test-id>/grading.json` — merged grading with `evaluators`, `assertions`, `summary.pass_rate`
- `index.jsonl` — one JSON line per test: `{test_id, score, pass, evaluators: [...]}`
- `benchmark.json` — aggregate stats: `{metadata: {targets}, run_summary: {<target>: {mean, stddev, n}}}`

### Agent-Mode Workflow

```
1. agentv pipeline input eval.yaml --out ./export
2. (Agent runs targets or reads response.md)
3. agentv pipeline grade ./export
4. (Agent does LLM grading, produces scores JSON)
5. echo '<scores>' | agentv pipeline bench ./export
```
