---
name: agentv-bench
description: >-
  Run AgentV evaluations and optimize agents through eval-driven iteration.
  Triggers: run evals, benchmark agents, optimize prompts/skills against evals, compare
  agent outputs across providers, analyze eval results, offline evaluation of recorded sessions,
  run autoresearch, optimize unattended, run overnight optimization loop.
  Not for: writing/editing eval YAML without running (use agentv-eval-writer),
  analyzing existing traces/JSONL without re-running (use agentv-trace-analyst).
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

After the agent is working well, you can also run description optimization to improve skill triggering accuracy (see `references/description-optimization.md`).

## Communicating with the user

This skill is used by people across a wide range of familiarity with evaluation tooling. Pay attention to context cues:

- "evaluation" and "benchmark" are borderline but OK in most cases
- For "YAML", "grader", "assertion", "deterministic judge" — see serious cues from the user that they know what those mean before using them without explanation
- Briefly explain terms if in doubt

When presenting results, default to summary tables. Offer detail on request. In CI/headless mode, skip interactive prompts and exit with status codes.

---

## Step 1: Understand the Agent

Before running or optimizing, understand what you're working with.

1. **Read the agent's artifacts** — prompts, skills, configs, recent changes. Understand the full picture: what tools are available, what the expected input/output looks like, what constraints exist.

2. **Identify success criteria** — what does "good" look like for this agent? What are the edge cases? What would a failure look like? Talk to the user if this isn't clear from the artifacts alone.

3. **Understand the target harness** — which provider runs the agent (Claude, GPT, Copilot CLI, Gemini, custom CLI)? This affects what grader types are available and how to run tests. Targets are configured in `.agentv/targets.yaml` (canonical location, searched from the eval file directory upward). Sensitive values like `api_key` must use `${{ ENV_VAR }}` syntax — literal secrets are rejected as a security guardrail.

4. **Challenge assumptions** — if evals already exist, review their quality before running:
   - Are the test cases testing the right things?
   - Are assertions specific enough to catch real failures?
   - Are there ambiguous or contradictory test cases?
   - Flag eval issues before proceeding — running bad evals wastes time.

5. **Check integrity** — ensure task prompts (what the agent receives) are not also used as grader prompts (how outputs are scored). If a prompt file appears in both locations, note the overlap and optimize only for the task purpose.

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
      - Review identifies the null pointer bug and suggests a concrete fix

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
- `assertions` → graders
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

**Grader types** (cheapest to most expensive): `exact`, `contains`, `regex`, `is-json`, `field-accuracy`, `composite`, `code-grader`, `tool-trajectory`, `llm-grader`. See `references/eval-yaml-spec.md` for full config and grading recipes for each type.

Prefer deterministic graders over LLM graders whenever possible. If an assertion can be checked with `contains` or `regex`, don't use `llm-grader`.

---

## Step 3: Run and Grade

This section is one continuous sequence — don't stop partway through.

Each run produces a new `.agentv/results/runs/<timestamp>/` directory automatically. Use timestamps to identify iterations when comparing runs.

### Choosing a run mode

**User instruction takes priority.** If the user says "run in subagent mode", "use subagent mode", or "use CLI mode", use that mode directly.

If the user has not specified a mode, default to `subagent`.

| `SUBAGENT_EVAL_MODE` | Mode | How |
|----------------------|------|-----|
| `subagent` (default) | **Subagent mode** | Subagent-driven eval — parses eval.yaml, spawns executor + grader subagents. Zero CLI dependency. |
| `cli` | **AgentV CLI** | `agentv eval <path>` — end-to-end, multi-provider |

Set `SUBAGENT_EVAL_MODE` in `.env` at the project root as the default when no mode is specified. If absent, default to `subagent`. **User instruction always overrides this.**

**`subagent`** — Parses eval.yaml directly, spawns executor subagents to run each test case in the current workspace, then spawns grader subagents to evaluate all assertion types natively. No CLI or external API calls required. Read `references/subagent-pipeline.md` for the detailed procedure.

**`cli`** — AgentV CLI handles execution, grading, and artifact generation end-to-end. Works with all providers. Use when you need multi-provider benchmarking or CLI-specific features.

### Running evaluations

**AgentV CLI mode** (end-to-end, EVAL.yaml):
```bash
agentv eval <eval-path> --output .agentv/artifacts/
```

**Subagent mode** — read `references/subagent-pipeline.md` for the detailed procedure. In brief: use `pipeline input` to extract inputs, dispatch one `executor` subagent per test case (all in parallel), then proceed to grading below.

**Spawn all runs in the same turn.** For each test case that needs both a "with change" and a "baseline" run, launch them simultaneously. Don't run one set first and come back for the other — launch everything at once so results arrive around the same time.

**Multi-target benchmarking:**
```bash
agentv eval <eval-path> --target claude --target gpt --target copilot
```

**Baseline strategy:**
- **New agent**: baseline is "no prompt" or minimal prompt — same eval, no agent-specific configuration
- **Improving existing**: snapshot the current version before editing (`cp -r <prompt-dir> <workspace>/prompt-snapshot/`), use as baseline throughout
- **Multi-target**: each target is its own baseline — no need for a separate "without" run

### While runs are in progress, draft graders

Don't just wait for runs to finish — use this time productively. If assertions don't exist yet, draft them now. If they exist, review them and explain what they check to the user.

Good assertions are *discriminating* — they pass when the agent genuinely succeeds and fail when it doesn't. An assertion that passes for both good and bad outputs is worse than no assertion.

### As runs complete, capture timing data

When each subagent task completes, you receive a notification containing `total_tokens` and `duration_ms`. **Save this data immediately** to `timing.json` in the run directory. See `references/schemas.md` for the timing.json schema.

This is the only opportunity to capture this data — it comes through the task notification and isn't persisted elsewhere. Process each notification as it arrives.

### Grading

**In CLI mode**, `agentv eval` handles all grading end-to-end — no manual phases needed.

**In subagent mode**, grading has three phases. **All three are required — do not stop after phase 1.**

**Phase 1: Code graders** (deterministic, zero-cost)

```bash
agentv pipeline grade <run-dir>
```

This runs all `code-grader` assertions against the `response.md` files. Results are written to `<test-id>/code_grader_results/<name>.json`. Alternatively, pass `--grader-type code` to `pipeline run` to run code graders inline.

**Phase 2: LLM grading** (semantic — do NOT skip this phase)

Dispatch one `grader` subagent per (test × LLM grader) pair, **all in parallel**. Do not write a script to call an LLM API instead — the grader subagents use their own reasoning, which IS the LLM grading.
Example: 5 tests × 2 LLM graders = 10 grader subagents launched simultaneously.

**Do NOT dispatch a single grader for multiple tests.** Each subagent grades exactly one (test, grader) pair.

Each grader subagent (read `agents/grader.md`):
1. Reads `<test-id>/llm_graders/<name>.json` for the grading prompt
2. Reads `<test-id>/response.md` for the candidate output
3. Grades the response against the prompt criteria
4. **Writes its result to disk**: `<run-dir>/<evalset>/<test-id>/llm_grader_results/<name>.json`
5. Returns score (0.0–1.0) and per-assertion evidence to the orchestrator

**Writing to disk is critical.** Assertion arrays are lost if accumulated only in the orchestrator's context across multiple batches (context summarization drops detail). Writing per-test results to `llm_grader_results/<name>.json` makes grading resumable and assertion evidence durable.

The result file format is:
```json
{ "score": 0.85, "assertions": [{"text": "...", "passed": true, "evidence": "..."}] }
```

After **all** grader subagents complete, run Phase 3 directly.

**Phase 3: Merge and validate**

```bash
agentv pipeline bench <run-dir>
agentv results validate <run-dir>
```

`pipeline bench` reads LLM grader results from `llm_grader_results/<name>.json` per test automatically, merges with code-grader scores, computes weighted pass_rate, and writes `grading.json` + `index.jsonl` + `benchmark.json`.

### Artifacts

All artifacts use established schemas — see `references/schemas.md` for the full definitions. Do not modify the structure. Key artifacts per run:
- **grading.json**: per-test assertions with `{text, passed, evidence}`, plus summary
- **timing.json**: `{total_tokens, duration_ms, total_duration_seconds}`
- **benchmark.json**: per-target aggregate `{pass_rate, time_seconds, tokens}`

Write artifacts to `.agentv/artifacts/` or the iteration directory.

### Workspace features (EVAL.yaml only)

- **Workspace isolation** — clone repos, run setup/teardown hooks (before_all, before_each, after_each, after_all)
- **Materialization modes** — `pooled` (reuse slots), `temp` (fresh per run), `static` (existing dir)
- **Multi-repo** — clone multiple repos with sparse checkout and shallow clone support
- **File change tracking** — grade by diffing workspace files before/after agent execution

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
agentv inspect <results-file>          # Detailed execution trace inspection
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

**Critical**: Only optimize **task prompts** (what the agent receives), never **judge prompts** (how graders score outputs). Modifying judge prompts games the evaluation without improving the agent.

If a prompt file is referenced in both task input and grader configs, optimize for the task purpose only. Document which prompts were modified in the optimization log.

### The iteration loop

After improving:

1. Apply your changes to the agent's prompts/skills/config
2. Re-run all test cases (agentv creates a new `.agentv/results/runs/<timestamp>/` directory automatically)
3. Compare against the previous iteration (Step 4). If running in automated mode, use the **automated keep/discard** logic below instead of manual judgment — it will decide whether to keep or revert the change for you.
4. Present results to the user (or log the decision if running automated keep/discard)
5. Stop when ANY of:
   - The user says they're happy
   - Feedback is all empty (everything looks good)
   - You're not making meaningful progress (no improvement for 2 consecutive iterations)
   - Target pass rate is reached
   - Maximum iterations exhausted

**Human checkpoints**: At iterations 3, 6, and 9, always present progress to the user regardless of automation settings. Push back if optimization is accumulating contradictory rules or overfitting to specific test cases.

### Automated keep/discard

After each iteration, you can automatically decide whether to keep or discard the change using structured comparison output. This replaces manual judgment at steps 3–4 of the iteration loop above, except at human checkpoint iterations (3, 6, 9) where you must still present results to the user.

#### 1. Run the comparison

After re-running test cases, compare the new results against the previous iteration's baseline:

```bash
agentv compare <baseline>.jsonl <candidate>.jsonl --json
```

Where `<baseline>.jsonl` is the `index.jsonl` from the previous best iteration and `<candidate>.jsonl` is the `index.jsonl` from the run you just completed.

#### 2. Parse the output

The `--json` flag produces structured output:

```json
{
  "summary": {
    "wins": 3,
    "losses": 1,
    "ties": 6,
    "mean_delta": 0.05
  }
}
```

- **wins**: number of test cases where the candidate scored higher than the baseline
- **losses**: number of test cases where the candidate scored lower
- **ties**: number of test cases with no score change
- **mean_delta**: average score difference across all test cases (positive = candidate is better)

#### 3. Apply decision rules

Use these rules in order:

| Condition | Decision | Action |
|-----------|----------|--------|
| `wins > losses` | **KEEP** | Promote the candidate to the new baseline. Copy or note its `index.jsonl` path as the baseline for the next iteration. |
| `wins <= losses` | **DISCARD** | Revert the prompt/skill/config change. The previous baseline remains. Try a different mutation on the next iteration. |
| `mean_delta == 0` AND candidate prompt is shorter (fewer lines) | **KEEP** | Simpler prompts are preferred when performance is equal. Promote the candidate as the new baseline. |

When `mean_delta == 0` and the candidate prompt is *not* shorter, treat it as a **DISCARD** — there's no reason to keep a change that adds complexity without improving results.

#### 4. Log the decision

Before proceeding to the next iteration, log the decision and rationale so the user can review later:

```
Iteration 2: KEEP
  wins=3, losses=1, ties=6, meanDelta=+0.05
  Rationale: candidate wins outweigh losses (3 > 1)
  Baseline promoted: .agentv/results/runs/20250101-120000/index.jsonl
```

```
Iteration 3: DISCARD
  wins=1, losses=2, ties=7, meanDelta=-0.03
  Rationale: candidate losses outweigh wins (2 > 1)
  Reverted to baseline: .agentv/results/runs/20250101-110000/index.jsonl
  Next: try a different mutation
```

Include this log in your progress summary. At human checkpoints (iterations 3, 6, 9), present the full log of automated decisions since the last checkpoint alongside the current results.

#### 5. Integration with the iteration loop

The automated keep/discard replaces the manual compare-and-present cycle (steps 3–4) during non-checkpoint iterations. The full flow becomes:

1. Apply change to prompts/skills/config
2. Re-run all test cases
3. Run `agentv compare baseline.jsonl candidate.jsonl --json`
4. Apply keep/discard rules → promote or revert
5. Log the decision
6. If this is iteration 3, 6, or 9 → present progress to the user (human checkpoint)
7. Check stop conditions → continue or stop

Both modes coexist: if the user is actively reviewing results, present to them as before. If the user has asked you to iterate autonomously, use automated keep/discard and only pause at human checkpoints.

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

After the agent is working well, offer to optimize the skill's `description` field for better triggering accuracy. Read `references/description-optimization.md` for the full procedure (generate trigger EVAL.yaml, review with user, iterate, apply).

---

## Autoresearch Mode

Autoresearch is an unattended eval-improve loop that runs multiple optimize cycles without human intervention. The user triggers it with natural language (e.g., "run autoresearch on this skill", "optimize this skill unattended"). No YAML schema changes or CLI flags are needed.

### Prerequisites

- An eval file (`EVAL.yaml` or `evals.json`) must exist for the artifact being optimized.
- The artifact must be a single file (SKILL.md, prompt template, or agent config).
- The user should have run at least one interactive eval cycle to build confidence in eval quality before going unattended.

### The loop

```
1. RUN EVAL   — agentv eval with current artifact
2. ANALYZE    — dispatch analyzer subagent on results
3. DECIDE     — if score > best_score: KEEP, else DROP (automated keep/discard from Step 5)
4. MUTATE     — dispatch mutator subagent with failure analysis (agents/mutator.md)
5. GOTO 1     — until convergence or max_cycles
```

### Experiment naming

Derive the experiment name from the artifact: `autoresearch-<name>` (e.g., `autoresearch-pdf-skill`). The user can also provide a custom name.

### Artifact mutation flow

The mutator rewrites the **actual file on disk** in place. The autoresearch loop manages backups:

1. Before the first cycle, copy the artifact to `_autoresearch/original.md`.
2. On each KEEP, copy the current artifact to `_autoresearch/best.md`.
3. On each DROP, restore `_autoresearch/best.md` back to the artifact path.
4. The eval always runs against the real file path — no temp files or indirection.

### How the skill invokes eval

Shell out to `agentv eval <eval-path> --experiment autoresearch-<name>` via the Bash tool, same as the existing interactive bench workflow.

### Artifact layout

Each cycle is a standard eval run. Autoresearch session metadata lives in `_autoresearch/` within the experiment directory:

```
.agentv/results/runs/<experiment>/
  _autoresearch/                     # experiment-level outputs (not hidden)
    original.md                    # snapshot of artifact before first mutation
    best.md                        # current best-scoring version (updated on KEEP)
    iterations.jsonl               # one line per cycle — data for chart + mutator
    trajectory.html                # live-updating score trajectory chart
  2026-04-15T10-30-00/             # cycle 1 — standard run artifacts
    index.jsonl
    grading.json
    timing.json
    benchmark.json
    report.html
  2026-04-15T10-35-00/             # cycle 2 — standard run artifacts
    ...
```

The `_` prefix convention distinguishes workflow folders from timestamped run dirs.

### iterations.jsonl

One JSON object per line, one line per cycle:

```jsonl
{"cycle":1,"score":0.65,"decision":"keep","cost_usd":0.12,"assertions":{"IDENTIFIES_BUG":0.8,"SUGGESTS_FIX":0.4},"mutation":"added explicit null-check instruction","run_dir":"2026-04-15T10-30-00","timestamp":"2026-04-15T10:32:15Z"}
```

Fields: `cycle` (1-indexed), `score` (overall pass rate 0–1), `decision` ("keep" or "drop"), `cost_usd` (eval run cost), `assertions` (per-assertion pass rates), `mutation` (one-line description of what changed), `run_dir` (timestamped directory name), `timestamp` (ISO 8601).

### trajectory.html

A standalone HTML chart file with embedded Chart.js. Copy the template from `scripts/trajectory.html`, replace placeholders with data, and update after each cycle. Shows:

- Score over iterations (line chart) with KEEP (green) / DISCARD (red) markers
- Per-assertion pass rates over iterations
- Cumulative cost across iterations
- Best vs original score summary

Auto-refreshes every 2 seconds during the loop. Becomes static after completion (remove the auto-refresh meta tag on final update).

### Convergence

Stop after **3** consecutive cycles with no improvement (no KEEP). Also stop at **max_cycles** (default 10). Either limit can be overridden by the user.

### Human checkpoints

Autoresearch mode **skips** human checkpoints at iterations 3/6/9. The user opted in to unattended operation by requesting autoresearch.

### Procedure

Follow this step-by-step procedure to execute autoresearch:

#### 1. Setup

1. Determine the **artifact path** (the file to optimize) and **eval path** (EVAL.yaml or evals.json).
2. Derive the **experiment name**: `autoresearch-<name>` from the artifact filename (strip extension), or use a user-provided name.
3. Set the experiment directory: `.agentv/results/runs/<experiment>/`.
4. Create the `_autoresearch/` subdirectory inside the experiment directory.
5. Copy the artifact to `_autoresearch/original.md` (preserve the original before any mutations).
6. Copy `scripts/trajectory.html` to `_autoresearch/trajectory.html`.
7. Initialize variables:
   - `best_score = 0`
   - `convergence_count = 0`
   - `cycle = 1`
   - `max_cycles = 10` (or user-specified)
   - `max_convergence = 3` (or user-specified)

#### 2. Main loop

Repeat while `cycle <= max_cycles` and `convergence_count < max_convergence`:

**a. Run eval**

```bash
agentv eval <eval-path> --experiment autoresearch-<name>
```

**b. Read results**

Find the latest timestamped directory in the experiment folder. Parse `index.jsonl` to compute:
- Overall score (mean pass rate across all test cases and assertions)
- Per-assertion pass rates (group by assertion name, compute pass rate for each)
- Cost from `timing.json` if available

**c. Update iterations.jsonl**

Append one JSON line with this cycle's data (cycle number, score, per-assertion rates, mutation description, run directory name, timestamp). Set `decision` to "keep" or "drop" after the next step — write the line after the decision is made.

**d. Update trajectory.html**

Read `_autoresearch/iterations.jsonl`, serialize as JSON array, and replace the `__ITERATIONS_DATA__` placeholder in `_autoresearch/trajectory.html` with the data. Write the updated file back.

**e. Decide: KEEP or DROP**

Apply the automated keep/discard rules from Step 5:

1. Run `agentv compare <baseline>.jsonl <candidate>.jsonl --json` where `<baseline>` is the best iteration's `index.jsonl` (or the first run's `index.jsonl` for cycle 1) and `<candidate>` is this cycle's `index.jsonl`.
2. If `wins > losses` → **KEEP**.
3. If `wins <= losses` → **DISCARD**.
4. If `mean_delta == 0` and the artifact is shorter → **KEEP** (simpler is better at equal performance).

For cycle 1, there is no baseline to compare against — always **KEEP** the first cycle.

**f. If KEEP**

- Update `best_score` to this cycle's score.
- Copy the current artifact to `_autoresearch/best.md`.
- Record the current `index.jsonl` path as the new baseline for future comparisons.
- Reset `convergence_count = 0`.

**g. If DROP**

- Restore `_autoresearch/best.md` back to the artifact path (overwrite the failed mutation).
- Increment `convergence_count`.

**h. Check stop conditions**

If `convergence_count >= max_convergence` or `cycle >= max_cycles` → break out of the loop.

**i. Mutate**

Dispatch the **mutator** subagent (`agents/mutator.md`) with:
- The current artifact path
- Per-assertion pass rates from this cycle
- Failure descriptions (test cases that scored below 1.0, with their transcripts or grading rationale)
- The mutation history from `iterations.jsonl` (so it avoids repeating failed strategies)

The mutator rewrites the artifact file in place. Verify the file was modified before continuing.

**j. Continue**

Increment `cycle` and return to step (a).

#### 3. Completion

1. Finalize `trajectory.html`: remove the auto-refresh `<meta>` tag so the chart becomes static.
2. Log a final summary:
   - Total cycles run
   - Final best score vs original score (cycle 1)
   - Number of KEEPs and DROPs
   - Total cost across all cycles
   - Path to `_autoresearch/best.md` (the best artifact version)
   - Path to `_autoresearch/trajectory.html` (the score chart)
3. Present results to the user with a recommendation: adopt the best version, revert to original, or continue iterating interactively.

### Interactive/autonomous hybrid

Users can start in interactive mode (the existing Step 3–5 loop with human checkpoints), build confidence in their eval quality, and then switch to autoresearch mode to run unattended. The two modes share the same eval infrastructure and artifact layout — autoresearch simply automates the keep/discard decisions and removes human checkpoints.

### Model empathy recommendation

For best results, use same-model pairings: the meta-agent running autoresearch should match the model used by the task agent being evaluated (e.g., Claude optimizing a Claude agent, GPT optimizing a GPT agent). Per AutoAgent research findings, same-model pairings produce better mutations because the optimizer has implicit knowledge of how the target model interprets instructions.

---

## Environment Adaptation

For provider-specific notes (Copilot, Codex, Claude SDK, custom CLI), CI/headless mode behavior, and fallback strategies when subagents aren't available, read `references/environment-adaptation.md`.

---

## Subagent Reference

The `agents/` directory contains instructions for specialized subagents. Read them when you need to spawn the relevant subagent.

| Agent | File | Purpose | When to dispatch |
|-------|------|---------|-----------------|
| executor | `agents/executor.md` | Perform test case tasks as the target agent | Step 3 (agent targets — one per test case) |
| grader | `agents/grader.md` | Grade responses with per-assertion evidence | Step 3 (grading — one per test × LLM grader pair) |
| comparator | `agents/comparator.md` | Blind N-way comparison + post-hoc analysis | Step 4 (comparing iterations/targets) |
| analyzer | `agents/analyzer.md` | Quality audit, deterministic upgrades, benchmarks | Step 4 (pattern analysis) |
| mutator | `agents/mutator.md` | Rewrite artifact from failure analysis | Step 5 (autoresearch — dispatched per cycle) |

The `references/` directory has additional documentation:
- `references/eval-yaml-spec.md` — Eval YAML schema and assertion grading recipes
- `references/subagent-pipeline.md` — Detailed subagent-mode pipeline commands and output structure
- `references/description-optimization.md` — Skill description optimization workflow
- `references/environment-adaptation.md` — Provider-specific notes and CI/headless behavior
- `references/schemas.md` — JSON schemas for all artifacts (grading.json, benchmark.json, etc.)
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
