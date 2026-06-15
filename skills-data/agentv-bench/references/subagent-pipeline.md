# Subagent Pipeline — Explicit Opt-In Eval Mode

This reference documents the detailed procedure for running evaluations in subagent mode
(`AGENT_EVAL_MODE=subagent`). The orchestrating skill dispatches `executor` subagents to
perform test cases and `grader` subagents to evaluate outputs.

Read this reference when executing Step 3 (Run and Grade) in subagent mode.

## When to use

- The user explicitly asks for subagent mode.
- There is no usable CLI/provider path for the environment.
- A special environment or provider needs isolation, or avoiding target-provider calls matters.

## Prerequisites

- The eval.yaml file exists and contains valid test definitions
- `agentv` CLI is installed (or run from source via `AGENTV_CLI=bun /path/to/cli.ts` in `.env`)
- Read `references/eval-yaml-spec.md` for the full schema

## Workspace Context

Some evals pass prompt files directly and don't require a specific workspace — those run fine
from anywhere. But evals that test agent behavior in a workspace (accessing skills, modifying
repos, using tools across multiple repos) require the user to be in the **target workspace**
(e.g., a multi-repo workspace set up by allagents). If the eval references workspace files or
expects the agent to use skills, check that the current directory is the target workspace, not
just the eval repo — and warn the user if it's wrong.

## Executor Subagent Eligibility

All providers except `cli` are eligible for executor subagents by default. To opt out a
specific target, set `subagent_mode_allowed: false` in `.agentv/targets.yaml`:

```yaml
# .agentv/targets.yaml
targets:
  - name: my-target
    provider: openai
    model: ${{ OPENAI_MODEL }}
    api_key: ${{ OPENAI_API_KEY }}
    subagent_mode_allowed: false  # forces CLI invocation instead of executor subagent
```

When `subagent_mode_allowed: false`, the target falls back to CLI invocation via `agentv eval`
even in subagent mode.

## CLI Targets: Single Command

For evals with CLI targets, `pipeline run` handles input extraction, target invocation, and
code grading in one step. When `--out` is omitted, the output directory defaults to
`.agentv/results/runs/<timestamp>` (same convention as `agentv eval`):

```bash
# Extract inputs and invoke all CLI targets in parallel:
agentv pipeline run evals/repro.eval.yaml

# Also run code graders inline (instead of using pipeline grade separately):
agentv pipeline run evals/repro.eval.yaml --grader-type code
```

By default, `pipeline run` extracts inputs and invokes targets only. Pass `--grader-type code`
to also run code-graders inline, or use `agentv pipeline grade <run-dir>` as a separate step.

The run directory is printed to stdout. Then continue to the grading and merge phases
described below.

## Non-CLI Targets: Executor Subagents

When the target provider is not `cli`, check `manifest.json` → `target.subagent_mode_allowed`.
If `true` (default for all non-CLI providers), the subagent IS the target. If `false` (user
opted out via `subagent_mode_allowed: false` in `.agentv/targets.yaml`), fall back to
`agentv eval` CLI mode instead.

### Step 1: Extract inputs

```bash
# Defaults to .agentv/results/runs/<timestamp>
agentv pipeline input evals/repro.eval.yaml
```

This creates a run directory with per-test `input.json`, `invoke.json`,
`criteria.md`, and grader configs.

### Step 2: Dispatch executor subagents

Read `agents/executor.md`. Launch one `executor` subagent **per test case**, all in parallel.
Each subagent receives the test directory path, reads `input.json`, performs the task using
its own tools, and writes `response.md`.

Example: 5 tests = 5 executor subagents launched simultaneously.

```
# Per executor subagent:
#   - Reads <run-dir>/<test-id>/input.json
#   - Performs the task
#   - Writes <run-dir>/<test-id>/response.md
```

### Capture timing data

When each subagent task completes, you receive a notification containing `total_tokens` and
`duration_ms`. Save this data immediately to `timing.json` in the run directory. See
`references/schemas.md` for the timing.json schema.

This is the only opportunity to capture this data — it comes through the task notification
and is not persisted elsewhere. Process each notification as it arrives.

### After executors complete: read results from disk

When all executor subagents have finished, **read `response.md` directly from disk** — do
NOT use `read_agent` to fetch results. The executors wrote their outputs to the run directory.

```bash
# Verify all responses exist:
for d in <run-dir>/<evalset>/*/; do
  echo "$(basename $d): $(ls "$d"/response.md 2>/dev/null && echo OK || echo MISSING)"
done
```

If any `response.md` is MISSING, re-run that specific executor subagent. Do not proceed to
grading until all responses are present.

### Step 3: Grade and merge

Subagent-mode grading has three phases. All three are required.

**Phase 1: Code graders** (deterministic)

```bash
agentv pipeline grade <run-dir>
```

This evaluates deterministic assertions against `response.md` files:
- `code-grader` scripts — external scripts executed against the response
- Built-in assertion types — `contains`, `contains-any`, `contains-all`, `icontains`, `regex`, `equals`, `starts-with`, `ends-with`, `is-json`, and variants

Both types are configured by `pipeline input` into `code_graders/<name>.json` and graded by
`pipeline grade`. Results are written to `<test-id>/code_grader_results/<name>.json`.
Alternatively, pass `--grader-type code` to `pipeline run` to run these inline.

Do not dispatch LLM grader subagents for tests that only have deterministic assertions. To
detect which tests need Phase 2, check whether `<test-id>/llm_graders/` contains any `.json`
config files. Tests with an empty or missing `llm_graders/` directory are done after Phase 1.

**Phase 2: LLM grading**

Dispatch one `grader` subagent per `(test, grader)` pair, all in parallel. Do not dispatch a
single grader for multiple tests.

Before dispatching graders, read `agents/grader.md` and embed its full content as the system
instructions in every grader subagent prompt. The grader is a `general-purpose` task agent;
there is no auto-resolved `grader` type.

Each grader subagent:
1. Reads `<test-id>/llm_graders/<name>.json`
2. Reads `<test-id>/response.md`
3. Grades the response against the prompt criteria
4. Writes `<run-dir>/<evalset>/<test-id>/llm_grader_results/<name>.json`
5. Returns score and per-assertion evidence to the orchestrator

Writing per-test result files is required. It makes grading resumable and keeps assertion
evidence durable across long runs.

The result file format is:

```json
{ "score": 0.85, "assertions": [{"text": "...", "passed": true, "evidence": "..."}] }
```

**Phase 3: Merge and validate**

```bash
agentv pipeline bench <run-dir>
agentv results validate <run-dir>
```

`pipeline bench` reads LLM grader results from `llm_grader_results/<name>.json` per test,
merges them with code-grader scores, computes weighted pass_rate, and writes `grading.json`,
`index.jsonl`, and `benchmark.json`.

If `pipeline bench` reports `pass_rate=0` across the board, first verify
`<test-id>/llm_grader_results/<name>.json` exists and is non-empty for each LLM-graded test.
Treat `pass_rate=0` as a real signal only after confirming grader results exist.

## Step-by-Step Fine-Grained Control (CLI targets)

Use individual commands when you need control over each step with CLI targets:

```bash
# Step 1: Extract inputs (defaults to .agentv/results/runs/<timestamp>)
agentv pipeline input evals/repro.eval.yaml

# Step 2: run_tests.py invokes CLI targets (or use pipeline run instead)

# Step 3: Run code graders
agentv pipeline grade <run-dir>

# Step 4: Subagent does LLM grading, writes results to llm_grader_results/<name>.json per test

# Step 5: Merge scores (writes index.jsonl with full scores[] for dashboard)
agentv pipeline bench <run-dir>

# Step 6: Validate
agentv results validate <run-dir>
```

## LLM Grading JSON Format

The agent reads `llm_graders/<name>.json` for each test, grades the response using the prompt
content, and writes one result file per grader:

```json
{ "score": 0.85, "assertions": [{"text": "Response is relevant", "passed": true, "evidence": "..."}] }
```

## Pipeline Bench and Dashboard

`pipeline bench` merges LLM scores into `index.jsonl` with a full `scores[]` array per entry,
matching the CLI-mode schema. The web dashboard (`agentv results serve`) reads this format
directly — no separate conversion script is needed. Run `agentv results validate <run-dir>`
to verify compatibility.

## Output Structure

The path hierarchy mirrors the CLI mode: `<evalset-name>` comes from the `name` field in
the eval.yaml. The target is recorded in `manifest.json` — one run = one target.

```
.agentv/results/runs/<experiment>/<timestamp>/
├── manifest.json                    ← eval metadata, target, test_ids
├── index.jsonl                      ← per-test scores
├── benchmark.json                   ← aggregate statistics
└── <evalset-name>/                  ← eval.yaml "name" field, or eval file basename if absent (same as CLI mode)
    └── <test-id>/                   ← test case id
        ├── input.json               ← test input text + messages
        ├── invoke.json              ← target command or agent instructions
        ├── criteria.md              ← grading criteria
        ├── response.md              ← target/agent output
        ├── timing.json              ← execution timing
        ├── code_graders/<name>.json     ← grader configs written by `pipeline input`: code-grader scripts AND built-in types (contains, regex, equals, etc.)
        ├── llm_graders/<name>.json      ← LLM grader configs
        ├── code_grader_results/<name>.json  ← code grader results
        ├── llm_grader_results/<name>.json   ← LLM grader results (written by grader subagents; one file per grader)
        └── grading.json              ← merged grading (written by `pipeline bench` — do NOT write here directly)
```
