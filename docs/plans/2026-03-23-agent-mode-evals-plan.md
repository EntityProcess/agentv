# Agent-Mode Evals Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable agentv-bench skill to run eval.yaml evaluations entirely via Claude Code subagents — zero dependency on agentv CLI.

**Architecture:** The agentv-bench SKILL.md orchestrates eval execution by parsing eval.yaml, spawning ad-hoc executor subagents (one per test), then spawning grader subagents that evaluate all assertion types natively. Results are written as AgentV JSONL to `.agentv/results/raw/`.

**Tech Stack:** Claude Code skills/agents (markdown), Python scripts (stdlib only)

**Design doc:** `docs/plans/2026-03-23-agent-mode-evals-design.md`

---

### Task 1: Move plugin-level agents under agentv-bench skill

**Files:**
- Move: `plugins/agentv-dev/agents/eval-grader.md` → `plugins/agentv-dev/skills/agentv-bench/agents/grader.md`
- Move: `plugins/agentv-dev/agents/eval-comparator.md` → `plugins/agentv-dev/skills/agentv-bench/agents/comparator.md`
- Move: `plugins/agentv-dev/agents/eval-analyzer.md` → `plugins/agentv-dev/skills/agentv-bench/agents/analyzer.md`
- Delete: `plugins/agentv-dev/agents/` directory (entire folder, now empty)

**Step 1: Move the three agent files**

```bash
# Move plugin-level agents to skill-level, replacing the simpler versions
cp plugins/agentv-dev/agents/eval-grader.md plugins/agentv-dev/skills/agentv-bench/agents/grader.md
cp plugins/agentv-dev/agents/eval-comparator.md plugins/agentv-dev/skills/agentv-bench/agents/comparator.md
cp plugins/agentv-dev/agents/eval-analyzer.md plugins/agentv-dev/skills/agentv-bench/agents/analyzer.md
```

**Step 2: Remove the `name:` prefix from frontmatter**

The plugin-level agents use prefixed names (`eval-grader`, `eval-comparator`, `eval-analyzer`). Under the skill, they should use short names (`grader`, `comparator`, `analyzer`). Update the `name:` field in each file's YAML frontmatter.

**Step 3: Update SKILL.md agent references**

In `plugins/agentv-dev/skills/agentv-bench/SKILL.md`, update the subagent reference table (around line 539) to point to the new local paths:

Old:
```
| eval-grader | `agents/eval-grader.md` | Grade responses with per-assertion evidence | Step 3 |
| eval-comparator | `agents/eval-comparator.md` | Blind N-way comparison | Step 4 |
| eval-analyzer | `agents/eval-analyzer.md` | Quality audit | Step 4 |
```

New:
```
| grader | `agents/grader.md` | Grade responses with per-assertion evidence | Step 3 |
| comparator | `agents/comparator.md` | Blind N-way comparison | Step 4 |
| analyzer | `agents/analyzer.md` | Quality audit | Step 4 |
```

Also update any inline references in the SKILL.md body that say `eval-grader` → `grader`, etc.

**Step 4: Delete the plugin-level agents directory**

```bash
rm -rf plugins/agentv-dev/agents/
```

**Step 5: Verify no broken references**

```bash
# Search for any remaining references to the old paths
grep -r "eval-grader" plugins/agentv-dev/ --include="*.md"
grep -r "eval-comparator" plugins/agentv-dev/ --include="*.md"
grep -r "eval-analyzer" plugins/agentv-dev/ --include="*.md"
grep -r "agents/eval-" plugins/agentv-dev/ --include="*.md"
```

Expected: No results (all references updated).

**Step 6: Commit**

```bash
git add plugins/agentv-dev/
git commit -m "refactor(bench): move plugin-level agents under agentv-bench skill

Aligns with skill-creator pattern where agents live under the skill directory.
Replaces simpler skill-level agents with the comprehensive plugin-level versions."
```

---

### Task 2: Create `references/eval-yaml-spec.md`

**Files:**
- Create: `plugins/agentv-dev/skills/agentv-bench/references/eval-yaml-spec.md`

This reference file documents the eval.yaml schema and assertion grading recipes so the grader agent can handle all assertion types without the CLI.

**Step 1: Write the eval-yaml-spec.md**

The file should contain:

1. **Eval YAML structure** — top-level fields (`name`, `description`, `tests[]`, `workspace`, `input`, `input_files`), test fields (`id`, `input`, `expected_output`, `criteria`, `assertions[]`).

2. **Assertion type mapping** — for each assertion type, document:
   - The YAML config fields
   - Exactly how to evaluate it (deterministic recipe or LLM judgment instructions)
   - What constitutes PASS/FAIL
   - Example YAML + expected grading behavior

3. **Deterministic assertion recipes** — exact pseudocode for:
   - `contains`: `response.includes(value)` (case-sensitive unless config says otherwise)
   - `equals`: `response.trim() === value.trim()`
   - `regex`: `new RegExp(value).test(response)`
   - `starts-with`: `response.startsWith(value)`
   - `ends-with`: `response.endsWith(value)`
   - `is-json`: `try { JSON.parse(response); return true } catch { return false }`
   - `field-accuracy`: parse JSON, check each field path against expected value
   - `tool-trajectory`: inspect tool calls in transcript, match against expected sequence/mode
   - `execution-metrics`: compare timing.json values against thresholds
   - `latency`/`cost`/`token-usage`: compare timing.json values against configured limits

4. **LLM-judged assertion instructions** — for `llm-grader` and `rubric` types:
   - Read the `prompt` field (for llm-grader) or rubric criteria
   - Evaluate the response using Claude's own reasoning
   - Produce score (0.0-1.0) with per-assertion evidence

5. **Code-grader instructions** — for `code-grader`:
   - Run the script via Bash: `bun <script-path>` or `python <script-path>`
   - Pass the response as stdin or via file
   - Parse stdout for `{"score": N, "reason": "..."}` JSON

6. **Composite assertion instructions** — evaluate sub-assertions, aggregate per config (weighted_average, threshold, etc.)

7. **Negate support** — when `negate: true`, invert the pass/fail result

8. **AgentV JSONL output format** — the exact shape of `EvaluationResult` that the grader must produce, matching `packages/core/src/evaluation/types.ts`:
   - Required fields: `timestamp`, `testId` (→ `test_id` in JSONL), `score`, `assertions`, `output`, `executionStatus` (→ `execution_status`)
   - Optional fields: `scores[]`, `input`, `tokenUsage`, `costUsd`, `durationMs`, `mode`
   - `scores[]` entries: `name`, `type`, `score`, `assertions[]`, `weight`, `verdict`
   - Note: JSONL uses snake_case (the CLI applies `toSnakeCaseDeep()`)

Source the schema details from:
- `plugins/agentv-dev/skills/agentv-eval-builder/references/eval-schema.json` (assertion types and fields)
- `packages/core/src/evaluation/types.ts:903-993` (EvaluationResult and EvaluatorResult interfaces)
- Example eval files at `examples/features/basic/evals/dataset.eval.yaml` and `examples/features/rubric/evals/dataset.eval.yaml`

**Step 2: Add a pointer in SKILL.md**

Add to the references section at the bottom of SKILL.md:
```
- `references/eval-yaml-spec.md` — Eval YAML schema and assertion grading recipes (read when running agent-mode evals)
```

**Step 3: Commit**

```bash
git add plugins/agentv-dev/skills/agentv-bench/references/eval-yaml-spec.md
git add plugins/agentv-dev/skills/agentv-bench/SKILL.md
git commit -m "docs(bench): add eval-yaml-spec reference for agent-mode grading

Documents eval.yaml schema, assertion type grading recipes, deterministic
evaluation pseudocode, and AgentV JSONL output format."
```

---

### Task 3: Rewrite `agents/grader.md` for zero-CLI grading

**Files:**
- Modify: `plugins/agentv-dev/skills/agentv-bench/agents/grader.md`

The current grader depends on `agentv prompt eval judge` (CLI call) in Step 1. Rewrite to handle all assertion types natively.

**Step 1: Rewrite the grader process**

Replace the current Step 1 (`Run the Judge Command`) with native eval.yaml parsing:

New process:
1. **Read the eval.yaml** and find the test by `test-id`
2. **Read the candidate response** from `response-file`
3. **Read the assertion definitions** from the test's `assertions[]` array
4. **For each assertion, evaluate natively:**
   - Deterministic types → run the check directly (refer to `references/eval-yaml-spec.md`)
   - LLM-judged types → act as the LLM judge (read prompt/rubric, reason about response)
   - Code-grader → run the script via Bash, parse JSON output
   - Composite → evaluate sub-assertions, aggregate
5. **Apply negate** — if `negate: true`, invert pass/fail
6. **Calculate weighted score** — aggregate all assertion scores using weights
7. **Extract and verify claims** (keep existing Step 4)
8. **Read user notes** (keep existing Step 5)
9. **Critique the evals** (keep existing Step 6)
10. **Write result** to `grading/<test-id>.json`

**Step 2: Update parameters**

Old parameters: `eval-path`, `test-id`, `answer-file`, `results-file`

New parameters:
- `eval-path`: Path to the eval YAML file
- `test-id`: The test case ID
- `response-file`: Path to the executor's response.md
- `bench-dir`: Path to the bench run directory (e.g., `.agentv/results/export/<ts>/`)
- `timing-file`: Path to timing.json (for execution-metrics/latency/cost assertions)

**Step 3: Update output format**

The grader writes to `{outputs_dir}/../grading.json` (same relative path convention as skill-creator).
The format aligns with skill-creator's `grading.json` — the only difference is `assertions` instead
of `expectations`:

```json
{
  "assertions": [
    {
      "text": "Response contains 'hello'",
      "passed": true,
      "evidence": "Found in paragraph 2: 'hello world'"
    }
  ],
  "summary": {
    "passed": 1,
    "failed": 0,
    "total": 1,
    "pass_rate": 1.0
  },
  "execution_metrics": {
    "tool_calls": { "Read": 3, "Bash": 2 },
    "total_tool_calls": 5,
    "output_chars": 1200,
    "transcript_chars": 800
  },
  "timing": {
    "executor_duration_seconds": 12.5,
    "total_duration_seconds": 15.0
  },
  "claims": [
    {
      "claim": "Used async/await pattern",
      "type": "process",
      "verified": true,
      "evidence": "Line 15 of output uses await fetch()"
    }
  ],
  "user_notes_summary": null,
  "eval_feedback": {
    "suggestions": [],
    "overall": "No suggestions, evals look solid."
  }
}
```

The orchestrator then transforms each `grading.json` into an AgentV `EvaluationResult` JSONL line
(mapping `assertions` → `assertions`, adding `test_id`, `score`, `scores[]`, `execution_status`, etc.)
when assembling `results.jsonl`.
```

**Step 4: Add reference to eval-yaml-spec.md**

Include in the grader's instructions:
```
When evaluating deterministic assertions, refer to `references/eval-yaml-spec.md`
for the exact matching logic for each assertion type.
```

**Step 5: Keep existing quality sections**

Preserve the following from the current grader (they don't depend on CLI):
- Structured evidence per assertion (Step 3)
- Extract and verify claims (Step 4)
- Read user notes (Step 5)
- Critique the evals (Step 6)
- Grading standards: Surface vs Substance
- Judging guidelines

**Step 6: Commit**

```bash
git add plugins/agentv-dev/skills/agentv-bench/agents/grader.md
git commit -m "feat(bench): rewrite grader for zero-CLI agent-mode evaluation

Grader now handles all assertion types natively:
- Deterministic (contains, regex, equals, is-json, etc.) via direct string ops
- LLM-judged (llm-grader, rubric) via Claude's own reasoning
- Code-grader via Bash script execution
- Composite via sub-assertion aggregation

No longer depends on 'agentv prompt eval judge' CLI command."
```

---

### Task 4: Update SKILL.md with agent-mode eval workflow

**Files:**
- Modify: `plugins/agentv-dev/skills/agentv-bench/SKILL.md`

**Step 1: Add agent-mode eval section**

Add a new section after "Step 3: Run and Grade" (or integrate into it) that describes the agent-mode flow for running eval.yaml files without the CLI:

```markdown
### Agent mode: Running eval.yaml without CLI

When `AGENT_EVAL_MODE=agent` (default) or when the AgentV CLI is not available, run eval.yaml
files directly using subagents. This mode has zero dependency on the agentv CLI.

**Prerequisites:**
- The eval.yaml file exists and contains valid test definitions
- Read `references/eval-yaml-spec.md` for the full schema

**Step 1: Parse the eval.yaml**

Read the eval file. Extract:
- Top-level `input` (default for all tests if per-test input is absent)
- `tests[]` array — each test has `id`, `input`, `assertions[]`, optional `expected_output`, `criteria`
- `workspace` config (if present — for workspace setup/teardown)

**Step 2: Spawn executor subagents (parallel)**

For each test, spawn an ad-hoc executor subagent in the same turn:

```
Execute this task:
- Context: <optional — skill path, plugin path, or workspace description>
- Task: <test.input or top-level input>
- Save your complete response to: .agentv/results/export/<timestamp>/test-<test-id>/response.md
- Save any output files to: .agentv/results/export/<timestamp>/test-<test-id>/outputs/
```

The executor runs in the current workspace — it inherits all CLAUDE.md instructions, skills, plugins,
and MCP servers. The workspace IS the agent-under-test environment. The "agent" being evaluated can be
a single skill, a plugin, the full workspace, or an eval_set spanning multiple eval files.

**Step 3: Capture timing as executors complete**

When each executor subagent completes, save timing data immediately to
`.agentv/results/export/<timestamp>/test-<test-id>/timing.json`:

```json
{
  "total_tokens": <from notification>,
  "duration_ms": <from notification>,
  "total_duration_seconds": <duration_ms / 1000>
}
```

**Step 4: Spawn grader subagents (parallel)**

After an executor completes, spawn a grader subagent (read `agents/grader.md`):

```
Grade this test case:
- eval-path: <path to eval.yaml>
- test-id: <test-id>
- response-file: .agentv/results/export/<timestamp>/test-<test-id>/response.md
- bench-dir: .agentv/results/export/<timestamp>/
- timing-file: .agentv/results/export/<timestamp>/test-<test-id>/timing.json
Write result to: .agentv/results/export/<timestamp>/grading/<test-id>.json
```

**Step 5: Assemble results.jsonl**

After all graders complete, read each `test-<id>/grading/<test-id>.json` and write one JSONL line per test
to `.agentv/results/raw/eval_<timestamp>.jsonl`. Each line is the grading/<test-id>.json content
(already in AgentV EvaluationResult format).
```

**Step 2: Update the run mode table**

Change the mode table (around line 183) to reflect that agent mode no longer uses `run_eval.py`:

Old:
```
| `agent` (legacy) | **Agent mode** | `python scripts/run_eval.py` (calls `claude -p`, Claude-only) |
```

New:
```
| `agent` (default) | **Agent mode** | Subagent-driven eval — parses eval.yaml, spawns executor + grader subagents. Zero CLI dependency. |
```

**Step 3: Update grading section**

In the grading subsection (around line 242-261), add that in agent mode the grader handles ALL assertion types natively (no distinction between deterministic and LLM-judged — the grader does both):

```markdown
**Agent mode grading** — dispatch `grader` subagent (read `agents/grader.md`). The grader evaluates
all assertion types natively: deterministic checks (contains, regex, is-json, etc.) via direct
string operations, LLM-judged assertions via Claude's own reasoning, and code-grader via Bash
script execution. No CLI call required.
```

**Step 4: Commit**

```bash
git add plugins/agentv-dev/skills/agentv-bench/SKILL.md
git commit -m "feat(bench): add agent-mode eval workflow to SKILL.md

Adds subagent-driven eval execution flow that parses eval.yaml directly,
spawns executor subagents per test, and grader subagents for all assertion
types. Results written to .agentv/results/raw/ for downstream tooling
compatibility."
```

---

### Task 5: Manual UAT — Red/Green Verification

**Files:**
- Test with: An example eval.yaml file (e.g., `examples/features/basic/evals/dataset.eval.yaml` or a simple custom one)

**Step 1: Red test — verify agent mode doesn't work yet on main**

Before the changes, confirm that invoking agentv-bench with "run this eval.yaml in agent mode" either falls back to CLI or doesn't produce results.

**Step 2: Green test — verify agent mode works with changes**

After all changes are applied:

1. Create a simple test eval:
```yaml
# test-agent-mode.eval.yaml
name: agent-mode-smoke-test
tests:
  - id: greeting
    input: "Say hello world"
    assertions:
      - type: contains
        value: "hello"
      - type: contains
        value: "world"
  - id: json-output
    input: "Return a JSON object with keys 'name' and 'age'"
    assertions:
      - type: is-json
```

2. Invoke the agentv-bench skill:
```
Run test-agent-mode.eval.yaml in agent mode
```

3. Verify:
   - Executor subagents were spawned (one per test)
   - Timing was captured from subagent notifications
   - Grader subagents were spawned after executors completed
   - `grading/<test-id>.json` files exist under `export/<timestamp>/grading/` with correct assertion results
   - `results.jsonl` was assembled in `.agentv/results/raw/`
   - JSONL format matches AgentV schema (has `test_id`, `score`, `assertions`, `scores[]`, `execution_status`)

4. Run `agentv results export` on the JSONL to verify downstream compatibility:
```bash
bun apps/cli/src/cli.ts results export
```

**Step 3: Document results**

Capture red/green evidence for the PR.

**Step 4: Commit**

```bash
git add test-agent-mode.eval.yaml
git commit -m "test(bench): add smoke test eval for agent-mode verification"
```

---

### Task 6: Clean up and finalize

**Files:**
- Delete: `docs/plans/2026-03-23-agent-mode-evals-design.md` (incorporate into official docs)
- Delete: `docs/plans/2026-03-23-agent-mode-evals-plan.md` (task complete)

**Step 1: Update references/migrating-from-skill-creator.md if needed**

Check if the migration guide references the old agent paths or CLI-dependent workflows. Update as needed.

**Step 2: Delete plan files**

Per CLAUDE.md guidelines: "Once development concludes, delete the plan file."

```bash
rm docs/plans/2026-03-23-agent-mode-evals-design.md
rm docs/plans/2026-03-23-agent-mode-evals-plan.md
```

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore(bench): clean up design/plan docs after agent-mode implementation"
```
