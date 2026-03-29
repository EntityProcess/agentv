---
name: agentv-bench
description: >-
  Run AgentV evaluations and optimize agents through eval-driven iteration. Use when asked to
  run `agentv eval`, execute an EVAL.yaml or evals.json file, benchmark agent performance across
  providers, analyze eval results, compare agent outputs, optimize prompts against evals, or
  improve agent performance. Also use for offline evaluation of recorded sessions (e.g.,
  copilot-log transcripts) and deterministic-only evals that need no LLM API key.
  Use this skill whenever the user mentions running evals, benchmarking, or optimizing any
  agent, prompt, or skill — even if they don't explicitly say "agentv".
  Do NOT use for writing or editing eval YAML files without running them — that belongs to
  agentv-eval-writer. Do NOT use for analyzing existing trace files or result JSONL without
  re-running evals — that belongs to agentv-trace-analyst.
---

# AgentV Bench


A skill for evaluating agents and iteratively improving them through data-driven optimization.

At a high level, the process goes like this:

- Understand what the agent does and what "good" looks like
- Write evaluation test cases (EVAL.yaml or evals.json)
- Run the agent on those test cases, grade the outputs
- Analyze the results — what's working, what's failing, and why
- Improve the agent's prompts/skills/config based on the analysis
- Repeat until you're satisfied

Your job when using this skill is to figure out where the user is in this process and then jump in and help them progress. Maybe they want to start from scratch — help them write evals, run them, and iterate. Maybe they already have results — jump straight to analysis and improvement.

Be flexible. If the user says "I don't need a full benchmark, just help me debug this failure", do that instead.

After the agent is working well, you can also run description optimization to improve skill triggering accuracy (see the Description Optimization section).

## Bundled scripts layer

This skill ships with a Python scripts layer in `plugins/agentv-dev/skills/agentv-bench/scripts/`. Requires Python 3.11+ and the `agentv` CLI installed. No extra dependencies — all scripts use the stdlib only.

### Eval pipeline scripts (subagent mode)

These scripts break the eval pipeline into discrete steps. The agent runs them in order, only handling LLM grading directly:

- `scripts/run_tests.py <eval-path> --out <dir>` — Extract inputs and invoke CLI targets in parallel. Writes `response.md` per test. For agent-as-target (`kind: "agent"`), only extracts inputs — executor subagents handle execution.
- `scripts/run_code_graders.py <dir>` — Run code-grader assertions on existing responses. Writes per-grader results.
- `scripts/bench.py <dir> < llm_scores.json` — Merge code-grader + LLM scores, compute weighted pass_rate, write `grading.json` + `index.jsonl` + `benchmark.json`.

### Subagent-mode workflow

```bash
# 1. Extract inputs, invoke CLI targets, run code graders (one command):
#    --out is optional; defaults to .agentv/results/runs/<timestamp>
agentv pipeline run evals/repro.eval.yaml

# 2. Subagent performs LLM grading (reads llm_graders/*.json, produces scores JSON)
# ... subagent reads prompts, grades responses, writes llm_scores.json ...

# 3. Merge all scores and produce final artifacts (writes index.jsonl for dashboard)
agentv pipeline bench <run-dir> --llm-scores llm_scores.json

# 4. Validate artifacts are dashboard-compatible
agentv results validate <run-dir>
```

### Skill management scripts
- `scripts/quick_validate.py` — validate SKILL.md structure and frontmatter
- `scripts/package_skill.py` — package skill into a distributable `.skill` zip
- `scripts/aggregate_benchmark.py` — aggregate grading results into benchmark statistics

## Communicating with the user

This skill is used by people across a wide range of familiarity with evaluation tooling. Pay attention to context cues:

- "evaluation" and "benchmark" are borderline but OK in most cases
- For "YAML", "evaluator", "assertion", "deterministic judge" — see serious cues from the user that they know what those mean before using them without explanation
- Briefly explain terms if in doubt

When presenting results, default to summary tables. Offer detail on request. In CI/headless mode, skip interactive prompts and exit with status codes.

---

## Step 1: Understand the Agent

Before running or optimizing, understand what you're working with.

1. **Read the agent's artifacts** — prompts, skills, configs, recent changes. Understand the full picture: what tools are available, what the expected input/output looks like, what constraints exist.

2. **Identify success criteria** — what does "good" look like for this agent? What are the edge cases? What would a failure look like? Talk to the user if this isn't clear from the artifacts alone.

3. **Understand the target harness** — which provider runs the agent (Claude, GPT, Copilot CLI, Gemini, custom CLI)? This affects what evaluator types are available and how to run tests. Targets are configured in `.agentv/targets.yaml` (canonical location, searched from the eval file directory upward). Sensitive values like `api_key` must use `${{ ENV_VAR }}` syntax — literal secrets are rejected as a security guardrail.

4. **Challenge assumptions** — if evals already exist, review their quality before running:
   - Are the test cases testing the right things?
   - Are assertions specific enough to catch real failures?
   - Are there ambiguous or contradictory test cases?
   - Flag eval issues before proceeding — running bad evals wastes time.

5. **Check integrity** — ensure task prompts (what the agent receives) are not also used as evaluator prompts (how outputs are scored). If a prompt file appears in both locations, note the overlap and optimize only for the task purpose.

---

## Step 2: Write Evaluations

AgentV supports two evaluation formats:

**EVAL.yaml** (native, full features) — supports workspaces, code graders, multi-turn conversations, tool trajectory scoring, workspace file tracking, multi-provider targets. Use this for agent evaluation.

```yaml
# example.eval.yaml
tests:
  - id: basic-code-review
    input: "Review this TypeScript file for bugs and suggest improvements"
    criteria: "Identifies the null pointer bug on line 12 and suggests a fix"
    assertions:
      - type: contains
        value: "null"
      - type: llm-grader
        prompt: "Did the review identify the bug and suggest a concrete fix?"

workspace:
  template: ./workspace-template
  hooks:
    before_each:
      reset: fast
```

Multi-skill evaluation is handled naturally via input messages — describe the task in the test input, and the agent uses whatever skills it needs.

**evals.json** (skill-creator compatible) — auto-promoted to EVAL-equivalent format:
- `prompt` → input messages
- `expected_output` → reference answer
- `assertions` → evaluators
- `files[]` paths resolved relative to the evals.json location

```json
{
  "skill_name": "my-agent",
  "evals": [
    {
      "id": 1,
      "prompt": "User's task prompt",
      "expected_output": "Description of expected result",
      "assertions": ["Output includes error handling", "Uses async/await"]
    }
  ]
}
```

### Writing good test cases

Start with 2-3 realistic test cases — the kind of thing a real user would actually say. Share them with the user before running: "Here are a few test cases I'd like to try. Do these look right, or do you want to add more?"

Good assertions are objectively verifiable and have descriptive names. Subjective quality ("the output is good") is better evaluated qualitatively — don't force assertions onto things that need human judgment.

**Evaluator types** (from cheapest to most expensive):
- `exact`, `contains`, `regex`, `is-json` — deterministic, zero cost, instant
- `field-accuracy` — checks JSON field values against expected
- `composite` — weighted combination of multiple evaluators
- `code-grader` — Python/TypeScript scripts via `defineCodeGrader()` (→ see `agentv-eval-writer` skill)
- `tool-trajectory` — evaluate tool call sequences and patterns
- `llm-grader` — LLM-graded with rubric (most expensive, use when semantic understanding needed)

Prefer deterministic evaluators over LLM graders whenever possible. If an assertion can be checked with `contains` or `regex`, don't use `llm-grader`.

---

## Step 3: Run and Grade

This section is one continuous sequence — don't stop partway through.

Each run produces a new `.agentv/results/runs/<timestamp>/` directory automatically. Use timestamps to identify iterations when comparing runs.

### Choosing a run mode

**User instruction takes priority.** If the user says "run in subagent mode", "use subagent mode", or "use CLI mode", use that mode directly.

If the user has not specified a mode, default to `subagent`.

### CLI resolution

The Python wrapper `scripts/agentv_cli.py` resolves the `agentv` command deterministically:

1. `AGENTV_CLI` environment variable (supports multi-word, e.g. `bun /path/to/cli.ts`)
2. `AGENTV_CLI` in nearest `.env` file (searching upward from cwd)
3. `agentv` on PATH

Use `scripts/agentv_cli.py` (or the wrapper scripts that call it) to invoke the CLI. The Python wrapper scripts (`scripts/run_tests.py`, etc.) pick up `AGENTV_CLI` automatically — no extra steps needed when calling them.

| `SUBAGENT_EVAL_MODE` | Mode | How |
|----------------------|------|-----|
| `subagent` (default) | **Subagent mode** | Subagent-driven eval — parses eval.yaml, spawns executor + grader subagents. Zero CLI dependency. |
| `cli` | **AgentV CLI** | `agentv eval <path>` — end-to-end, multi-provider |

Set `SUBAGENT_EVAL_MODE` in `.env` at the project root as the default when no mode is specified. If absent, default to `subagent`. **User instruction always overrides this.**

**`subagent`** — Parses eval.yaml directly, spawns executor subagents to run each test case in the current workspace, then spawns grader subagents to evaluate all assertion types natively. No CLI or external API calls required. See "Subagent mode: Running eval.yaml without CLI" below.

**`cli`** — AgentV CLI handles execution, grading, and artifact generation end-to-end. Works with all providers. Use when you need multi-provider benchmarking or CLI-specific features.

### Running evaluations

**AgentV CLI mode** (end-to-end, EVAL.yaml):
```bash
agentv eval <eval-path> --artifacts .agentv/artifacts/
```

**Subagent mode** — see "Subagent mode: Running eval.yaml without CLI" below. Parses eval.yaml directly and spawns executor/grader subagents. No CLI required.

**Spawn all runs in the same turn.** For each test case that needs both a "with change" and a "baseline" run, launch them simultaneously. Don't run one set first and come back for the other — launch everything at once so results arrive around the same time.

**Multi-target benchmarking:**
```bash
agentv eval <eval-path> --target claude --target gpt --target copilot
```

**Baseline strategy:**
- **New agent**: baseline is "no prompt" or minimal prompt — same eval, no agent-specific configuration
- **Improving existing**: snapshot the current version before editing (`cp -r <prompt-dir> <workspace>/prompt-snapshot/`), use as baseline throughout
- **Multi-target**: each target is its own baseline — no need for a separate "without" run

### While runs are in progress, draft evaluators

Don't just wait for runs to finish — use this time productively. If assertions don't exist yet, draft them now. If they exist, review them and explain what they check to the user.

Good assertions are *discriminating* — they pass when the agent genuinely succeeds and fail when it doesn't. An assertion that passes for both good and bad outputs is worse than no assertion.

### As runs complete, capture timing data

When each subagent task completes, you receive a notification containing `total_tokens` and `duration_ms`. **Save this data immediately** to `timing.json` in the run directory:

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

This is the only opportunity to capture this data — it comes through the task notification and isn't persisted elsewhere. Process each notification as it arrives.

### Grading

Once runs complete:

**Subagent mode grading** — dispatch `grader` subagent (read `agents/grader.md`). The grader evaluates all assertion types natively: deterministic checks (contains, regex, is-json, etc.) via direct string operations, LLM-graded assertions via Claude's own reasoning, and `code-grader` via Bash script execution. No CLI call required.

**CLI mode grading** — deterministic evaluators run automatically via CLI. LLM-graded assertions are handled by the configured LLM provider.

Both modes write **grading.json** per test with this structure:
```json
{
  "assertions": [
    {"text": "Response includes error handling", "passed": true, "evidence": "Lines 12-15 contain try/catch block"},
    {"text": "Uses async/await pattern", "passed": false, "evidence": "Uses .then() callback pattern instead"}
  ],
  "summary": {"passed": 1, "failed": 1, "total": 2, "pass_rate": 0.5}
}
```

The grading.json `assertions` array must use the fields `text`, `passed`, and `evidence` — downstream tooling depends on these exact field names.

### Workspace features (EVAL.yaml only)

- **Workspace isolation** — clone repos, run setup/teardown hooks (before_all, before_each, after_each, after_all)
- **Materialization modes** — `pooled` (reuse slots), `temp` (fresh per run), `static` (existing dir)
- **Multi-repo** — clone multiple repos with sparse checkout and shallow clone support
- **File change tracking** — grade by diffing workspace files before/after agent execution

### Artifacts

All artifacts use established schemas — do not modify the structure:

- **grading.json**: per-test `assertions` with `{text, passed, evidence}`, plus `summary`
- **timing.json**: `{total_tokens, duration_ms, total_duration_seconds}`
- **benchmark.json**: per-target aggregate `{pass_rate, time_seconds, tokens}` with `mean ± stddev`

Write artifacts to `.agentv/artifacts/` or the iteration directory.

### Subagent mode: Running eval.yaml without CLI

When `SUBAGENT_EVAL_MODE=subagent` (default), use the pipeline CLI subcommands (`pipeline input`, `pipeline grade`, `pipeline bench`) and Python wrapper scripts. This mode dispatches `executor` subagents to perform each test case, then `grader` subagents to evaluate the outputs.

**Executor subagent eligibility:** All providers except `cli` are eligible for executor subagents by default. To opt out a specific target, set `subagent_mode_allowed: false` in `.agentv/targets.yaml`:

```yaml
# .agentv/targets.yaml
targets:
  - name: my-target
    provider: openai
    model: ${{ OPENAI_MODEL }}
    api_key: ${{ OPENAI_API_KEY }}
    subagent_mode_allowed: false  # forces CLI invocation instead of executor subagent
```

When `subagent_mode_allowed: false`, the target falls back to CLI invocation via `agentv eval` even in subagent mode.

**Prerequisites:**
- The eval.yaml file exists and contains valid test definitions
- `agentv` CLI is installed (or run from source via `AGENTV_CLI=bun /path/to/cli.ts` in `.env`)
- Read `references/eval-yaml-spec.md` for the full schema

**Workspace matters when evals need it:** Some evals pass prompt files directly and don't require a specific workspace — those run fine from anywhere. But evals that test agent behavior in a workspace (accessing skills, modifying repos, using tools across multiple repos) require the user to be in the **target workspace** (e.g., a multi-repo workspace set up by allagents). If the eval references workspace files or expects the agent to use skills, check that the current directory is the target workspace, not just the eval repo — and warn the user if it's wrong.

**CLI targets: Single command**

For evals with CLI targets, `pipeline run` handles input extraction, target invocation, and code grading in one step. When `--out` is omitted, the output directory defaults to `.agentv/results/runs/<timestamp>` (same convention as `agentv eval`):

```bash
# Extract inputs, invoke all CLI targets in parallel, run code graders:
# Output goes to .agentv/results/runs/<timestamp>/ by default
agentv pipeline run evals/repro.eval.yaml
```

The run directory is printed to stdout. Then the agent performs LLM grading and merges scores:

```bash
agentv pipeline bench <run-dir> --llm-scores llm_scores.json

# Validate artifacts are dashboard-compatible:
agentv results validate <run-dir>
```

That's the entire pipeline: **2 commands** + LLM grading + optional validation.

**Non-CLI targets: Executor subagents**

When the target provider is not `cli`, check `manifest.json` → `target.subagent_mode_allowed`. If `true` (default for all non-CLI providers), the subagent IS the target. If `false` (user opted out via `subagent_mode_allowed: false` in `.agentv/targets.yaml`), fall back to `agentv eval` CLI mode instead.

For executor subagent targets, use `pipeline input` to extract inputs, then dispatch `executor` subagents to perform each test case:

```bash
# Step 1: Extract inputs (defaults to .agentv/results/runs/<timestamp>)
agentv pipeline input evals/repro.eval.yaml
```

This creates a run directory with per-test `input.json`, `invoke.json` (with `kind: "agent"`), `criteria.md`, and grader configs.

**Step 2: Dispatch executor subagents** — read `agents/executor.md`. Launch one `executor` subagent **per test case**, all in parallel. Each subagent receives the test directory path, reads `input.json`, performs the task using its own tools, and writes `response.md`. For example, 5 tests = 5 executor subagents launched simultaneously.

```
# Per executor subagent:
#   - Reads <run-dir>/<test-id>/input.json
#   - Performs the task
#   - Writes <run-dir>/<test-id>/response.md
```

**Step 3 onward: Grade and merge** — same as CLI targets:

```bash
# Step 3: Run code graders
agentv pipeline grade <run-dir>

# Step 4: Subagent does LLM grading, writes llm_scores.json (see below)

# Step 5: Merge scores (writes index.jsonl with full scores[] for dashboard)
agentv pipeline bench <run-dir> --llm-scores llm_scores.json

# Step 6: Validate
agentv results validate <run-dir>
```

**Step-by-step (fine-grained control for CLI targets)**

Use individual commands when you need control over each step with CLI targets:

```bash
# Step 1: Extract inputs (defaults to .agentv/results/runs/<timestamp>)
agentv pipeline input evals/repro.eval.yaml

# Step 2: run_tests.py invokes CLI targets (or use pipeline run instead)

# Step 3: Run code graders
agentv pipeline grade <run-dir>

# Step 4: Subagent does LLM grading, writes llm_scores.json

# Step 5: Merge scores (writes index.jsonl with full scores[] for dashboard)
agentv pipeline bench <run-dir> --llm-scores llm_scores.json

# Step 6: Validate
agentv results validate <run-dir>
```

**Step 3 (LLM grading): agent performs directly**

The agent reads `llm_graders/<name>.json` for each test, grades the response using the prompt content, and produces a scores JSON:

```json
{
  "test-01": {
    "relevance": {
      "score": 0.85,
      "assertions": [{"text": "Response is relevant", "passed": true, "evidence": "..."}]
    }
  }
}
```

Dispatch one `grader` subagent (read `agents/grader.md`) **per (test × LLM grader) pair**, all in parallel. For example, 5 tests × 2 LLM graders = 10 subagents launched simultaneously. Each subagent reads `<test-id>/llm_graders/<name>.json`, grades the corresponding `<test-id>/response.md` against the `prompt_content` criteria, and returns its score (0.0–1.0) and assertions. After all subagents complete, merge their results into a single `llm_scores.json` in the run directory.

**Note:** `pipeline bench` merges LLM scores into `index.jsonl` with a full `scores[]` array per entry, matching the CLI-mode schema. The web dashboard (`agentv results serve`) reads this format directly — no separate conversion script is needed. Run `agentv results validate <run-dir>` to verify compatibility.

**Note on Python wrapper scripts:** The `scripts/` directory contains Python wrappers (`run_tests.py`, `run_code_graders.py`, `bench.py`) that call the CLI commands. These are provided as an alternative but the direct CLI commands above are preferred — they work cross-platform without Python dependency issues.

**Output structure:**

The path hierarchy mirrors the CLI mode: `<evalset-name>` comes from the `name` field in the eval.yaml. The target is recorded in `manifest.json` — one run = one target.

```
.agentv/results/runs/<timestamp>/
├── manifest.json                    ← eval metadata, target, test_ids
├── index.jsonl                      ← per-test scores
├── benchmark.json                   ← aggregate statistics
└── <evalset-name>/                  ← from eval.yaml "name" field (omitted if absent)
    └── <test-id>/                   ← test case id
        ├── input.json               ← test input text + messages
        ├── invoke.json              ← target command or agent instructions
        ├── criteria.md              ← grading criteria
        ├── response.md              ← target/agent output
        ├── timing.json              ← execution timing
        ├── code_graders/<name>.json     ← code grader configs
        ├── llm_graders/<name>.json      ← LLM grader configs
        ├── code_grader_results/<name>.json ← code grader results
        └── grading.json             ← merged grading
```

---

## Step 4: Analyze Results

Once all runs are graded, analyze the results before attempting improvements.

### Pattern analysis

Read the JSONL results and look for:

- **Always-pass tests** — assertion too loose or non-discriminating. If it passes for both good and bad outputs, it's not testing anything.
- **Always-fail tests** — task impossible, eval broken, or assertion misconfigured. Don't optimize against broken evals.
- **Flaky tests** — non-deterministic results across runs. Investigate before treating failures as real.
- **Systematic failures** — same failure pattern across multiple tests. This usually points to a missing instruction or wrong approach.
- **Deterministic upgrade candidates** — `llm-grader` assertions that could be replaced with `contains`, `regex`, or `is-json` (cheaper, faster, more reliable).

### Dispatch subagents

- **Dispatch `analyzer`** (read `agents/analyzer.md`) for a structured quality audit: deterministic upgrade suggestions, weak assertion detection, cost/quality flags, and benchmark pattern analysis.

- **Dispatch `comparator`** (read `agents/comparator.md`) for blind N-way comparison between iterations or targets. The comparator blinds provider identities, generates task-specific rubrics, scores each output, then unblinds and attributes improvements.

### Trace analysis

Use CLI tools for deeper investigation:
```bash
agentv trace <results-file>          # Detailed execution trace inspection
agentv compare <file-a> <file-b>     # Structured diff between runs
```

Look for: tool call patterns, error recovery behavior, conversation flow, wasted steps.

### Present results to the user

Show a summary table:

```
| Test ID          | Score | Pass/Fail | Delta | Notes                    |
|------------------|-------|-----------|-------|--------------------------|
| basic-code-review| 0.85  | ✓ PASS    | +0.15 | Found the bug this time  |
| edge-case-empty  | 0.00  | ✗ FAIL    | —     | Crashed on empty input   |
```

Highlight:
- Current pass rate and delta from baseline
- Comparison results (which target/iteration won and why)
- Analyst observations the aggregate stats would hide

Ask: "How does this look? Anything you'd change about the evals or the approach?"

---

## Step 5: Improve

This is the heart of the loop. You've run the test cases, analyzed the results, and now you need to make the agent better.

### How to think about improvements

1. **Generalize from the analysis.** You're iterating on a small eval set, but the agent will be used on many different inputs. Don't overfit to specific test cases. Rather than fiddly patches or oppressively rigid MUSTs, try different approaches and see what works. It's cheap to experiment.

2. **Keep the prompt lean.** Read the execution transcripts, not just the final outputs. If the agent wastes time on unproductive steps, remove the instructions causing that. If it always ignores a section, that section isn't pulling its weight.

3. **Explain the why.** Today's LLMs are smart. They have good theory of mind and can go beyond rote instructions when given good reasoning. If you find yourself writing ALWAYS or NEVER in all caps, that's a yellow flag — reframe as an explanation of why the thing matters. That's more humane, powerful, and effective.

4. **Look for repeated work.** Read the transcripts from test runs and notice if the agent independently takes the same multi-step approach to something across cases. If all test runs result in writing the same helper script, bundle it. If every run makes the same mistake, the instruction is missing or unclear.

### Applying changes

- **Surgical edits**: ADD (new rule for a missing constraint), UPDATE (refine for clarity), DELETE (remove redundant or harmful rules), NEGATIVE CONSTRAINT (explicitly state what NOT to do)
- **One change per iteration** to isolate effects. If you change three things and the score improves, you don't know which change helped.
- **Variant tracking**: When a change helps some tests but hurts others, maintain 2-3 prompt variants. Compare variants to find the best overall approach before converging.
- **When converging**: Generalize specific patches into broad principles. Remove redundancy and contradictions. Ensure the prompt is clear, focused, and under 200 lines.

### Evaluation integrity

**Critical**: Only optimize **task prompts** (what the agent receives), never **judge prompts** (how evaluators score outputs). Modifying judge prompts games the evaluation without improving the agent.

If a prompt file is referenced in both task input and evaluator configs, optimize for the task purpose only. Document which prompts were modified in the optimization log.

### The iteration loop

After improving:

1. Apply your changes to the agent's prompts/skills/config
2. Re-run all test cases (agentv creates a new `.agentv/results/runs/<timestamp>/` directory automatically)
3. Compare against the previous iteration (Step 4)
4. Present results to the user
5. Stop when ANY of:
   - The user says they're happy
   - Feedback is all empty (everything looks good)
   - You're not making meaningful progress (no improvement for 2 consecutive iterations)
   - Target pass rate is reached
   - Maximum iterations exhausted

**Human checkpoints**: At iterations 3, 6, and 9, always present progress to the user regardless of automation settings. Push back if optimization is accumulating contradictory rules or overfitting to specific test cases.

---

## Entering Mid-Lifecycle

Users can start at any step by providing existing data:

| Entry point | Required input | Example prompt |
|------------|---------------|----------------|
| Step 1 (Understand) | `eval-path` | "Optimize my agent against evals/support.yaml" |
| Step 2 (Write Evals) | Agent artifacts | "Write evals for this agent" |
| Step 3 (Run + Grade) | `eval-path` | "Run this eval and show me results" |
| Step 4 (Analyze) | `results-path` | "Analyze why my agent is failing on these results" |
| Step 5 (Improve) | Analysis + strategy | "Apply these optimization suggestions" |

When entering mid-lifecycle, run only the requested step and subsequent steps. Don't re-run earlier steps unless the user requests a full loop.

---

## Advanced: Blind Comparison

For situations where you want a rigorous comparison between two versions (e.g., "is the new version actually better?"), dispatch the `comparator` subagent. It blinds identities, generates task-specific rubrics, scores outputs, then unblinds and explains why the winner won.

This is optional and requires subagents. The human review loop is usually sufficient.

---

## Description Optimization

The `description` field in a skill's SKILL.md frontmatter is the primary mechanism that determines whether Claude invokes the skill. After the agent/skill is working well, offer to optimize the description for better triggering accuracy.

**Provider compatibility**: Description optimization is specific to agents with skill-discovery mechanisms (e.g., Claude Code). Agents like Copilot and Codex don't have skill systems, so description optimization doesn't apply to them. The `skill-trigger` evaluator still works for these providers — it just checks whether the agent invoked the right tools, not whether it discovered the skill via description matching.

### Step 1: Generate trigger EVAL.yaml

Create 20 test cases:
- **10 should-trigger**: realistic prompts where this skill should activate — different phrasings, casual speech, uncommon use cases, edge cases where this skill competes with another but should win
- **10 should-not-trigger**: near-miss prompts that share keywords but actually need something different — adjacent domains, ambiguous phrasing where naive matching would trigger but shouldn't

Prompts must be realistic — include file paths, personal context, typos, casual speech. Not abstract requests like "format data" but concrete ones like "ok so my boss sent me Q4-sales-FINAL-v2.xlsx and she wants me to add a profit margin column..."

The should-not-trigger cases are the most valuable. "Write a fibonacci function" as a negative test for an eval skill is useless — it doesn't test anything. The negative cases should be genuinely tricky near-misses.

Write as EVAL.yaml with top-level input (the user prompt doesn't specify the skill name — it's a natural utterance):

```yaml
# trigger-eval.eval.yaml
tests:
  - id: should-trigger-casual-optimize
    input: "ok so I have this agent that keeps failing on the code review tasks, can you help me figure out why and fix it"
    assertions:
      - type: contains
        value: "agentv-bench"
  - id: should-not-trigger-build-error
    input: "my TypeScript build is failing with type errors in src/auth.ts"
    assertions:
      - type: not-contains
        value: "agentv-bench"
```

### Step 2: Review with user

Present the eval set. The user adjusts queries, toggles should-trigger, adds/removes cases. This step matters — bad eval queries lead to bad descriptions.

### Step 3: Iterate on description

Run the trigger eval, identify misfires, rewrite the description, re-run. Max 5 iterations. Select best description by held-out test accuracy (split 60% train / 40% test) to avoid overfitting.

Use the grader and analyzer subagents to identify trigger failures and propose description improvements — the same eval → grade → analyze → improve loop used for agent output quality.

### Step 4: Apply

Update the skill's SKILL.md frontmatter with the optimized description. Show the user before/after with accuracy scores.

---

## Environment Adaptation

**CI/headless mode**: Skip interactive prompts. Exit with pass/fail status code. Always generate artifacts for downstream consumption.

**No subagents available** (e.g., Claude.ai): Run test cases serially. Skip blind comparison. Present results directly in conversation — for each test case, show the prompt and output. Ask for feedback inline. Skip benchmarking (it relies on baseline comparisons that aren't meaningful without subagents).

**Note**: "Description Optimization" (iterating on SKILL.md descriptions for better triggering accuracy) requires an agent with a skill-discovery mechanism. Agents that don't have skill systems (Copilot, Codex) still benefit from evaluation for testing whether they invoke the right tools.

**Provider-specific notes**:
- **Copilot CLI**: Uses ACP protocol via `copilot --acp --stdio`
- **Claude SDK**: Requires `@anthropic-ai/claude-agent-sdk` installed
- **Codex**: Supports skills via `.agents/` or `.codex/` folders. Emits `command_execution` and `file_change` tool calls.
- **Custom CLI**: Needs `command` and output file pattern in target config
- **Target config**: Uses `${{ ENV_VAR }}` syntax (not `${ENV_VAR}`) for API keys

### Unsupported providers: use a code-grader

The built-in `skill-trigger` evaluator covers Claude, Copilot, Pi, Codex and VS Code out of the box. For providers with different tool-call formats, write a code-grader that inspects the agent's tool call trace.

A code-grader receives the full evaluation context including the agent's output messages and tool calls. You can inspect these to determine whether the skill was invoked:

```yaml
# Example: code-grader for Codex skill-trigger detection
tests:
  - id: should-trigger-codex
    input: "Analyze this CSV file"
    assertions:
      - type: code-grader
        path: ./judges/codex-skill-trigger.ts
```

```typescript
// judges/codex-skill-trigger.ts
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ output }) => {
  const skillName = 'csv-analyzer';
  const toolCalls = (output ?? []).flatMap((msg) => msg.toolCalls ?? []);
  const firstTool = toolCalls[0];

  if (!firstTool) {
    return { score: 0, reason: 'No tool calls recorded' };
  }

  // Codex reads skill files via shell commands
  if (firstTool.tool === 'command_execution') {
    const cmd = String(firstTool.input ?? '');
    if (cmd.includes(skillName)) {
      return { score: 1, reason: `Skill "${skillName}" triggered via command: ${cmd}` };
    }
  }

  // Check if skill file was read via file_change or other tools
  if (firstTool.tool === 'file_change') {
    const path = String((firstTool.input as Record<string, unknown>)?.path ?? '');
    if (path.includes(skillName)) {
      return { score: 1, reason: `Skill file accessed: ${path}` };
    }
  }

  return { score: 0, reason: `First tool was "${firstTool.tool}" — not a skill invocation for "${skillName}"` };
});
```

This approach is more flexible than config overrides — you can match any tool-call pattern, check multiple fields, and add provider-specific logic as needed.

---

## Subagent Reference

The `agents/` directory contains instructions for specialized subagents. Read them when you need to spawn the relevant subagent.

| Agent | File | Purpose | When to dispatch |
|-------|------|---------|-----------------|
| executor | `agents/executor.md` | Perform test case tasks as the target agent | Step 3 (agent targets — one per test case) |
| grader | `agents/grader.md` | Grade responses with per-assertion evidence | Step 3 (grading LLM-judged assertions) |
| comparator | `agents/comparator.md` | Blind N-way comparison + post-hoc analysis | Step 4 (comparing iterations/targets) |
| analyzer | `agents/analyzer.md` | Quality audit, deterministic upgrades, benchmarks | Step 4 (pattern analysis) |

The `references/` directory has additional documentation:
- `references/eval-yaml-spec.md` — Eval YAML schema and assertion grading recipes (read when running subagent-mode evals)
- `references/migrating-from-skill-creator.md` — Guide for users coming from Anthropic's skill-creator

---

Repeating the core loop for emphasis:

- Understand what the agent does
- Write evaluation test cases
- Run the agent and grade outputs
- Analyze results — surface patterns, dispatch analyst and comparator subagents
- Improve the agent based on analysis
- Repeat until you and the user are satisfied

Take your time with improvements. Read the transcripts. Understand why failures happened. Make changes that generalize beyond the test set. This is important work.
