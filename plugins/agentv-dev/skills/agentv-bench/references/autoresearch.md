# Autoresearch Mode

Autoresearch is an unattended eval-improve loop that runs multiple optimize cycles without human intervention. The user triggers it with natural language (e.g., "run autoresearch on this skill", "optimize this skill unattended"). No YAML schema changes or CLI flags are needed.

## Automated Keep/Discard

After each iteration, you can automatically decide whether to keep or discard the change using structured comparison output. This replaces manual judgment at steps 3–4 of the iteration loop (Step 5 in SKILL.md), except at human checkpoint iterations (3, 6, 9) where you must still present results to the user.

### 1. Run the comparison

After re-running test cases, compare the new results against the previous iteration's baseline:

```bash
agentv compare <baseline>.jsonl <candidate>.jsonl --json
```

Where `<baseline>.jsonl` is the `index.jsonl` from the previous best iteration and `<candidate>.jsonl` is the `index.jsonl` from the run you just completed.

### 2. Parse the output

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

### 3. Apply decision rules

Use these rules in order:

| Condition | Decision | Action |
|-----------|----------|--------|
| `wins > losses` | **KEEP** | Promote the candidate to the new baseline. Copy or note its `index.jsonl` path as the baseline for the next iteration. |
| `wins <= losses` | **DISCARD** | Revert the prompt/skill/config change. The previous baseline remains. Try a different mutation on the next iteration. |
| `mean_delta == 0` AND candidate prompt is shorter (fewer lines) | **KEEP** | Simpler prompts are preferred when performance is equal. Promote the candidate as the new baseline. |

When `mean_delta == 0` and the candidate prompt is *not* shorter, treat it as a **DISCARD** — there's no reason to keep a change that adds complexity without improving results.

### 4. Log the decision

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

### 5. Integration with the iteration loop

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

## Prerequisites

- An eval file (`EVAL.yaml` or `evals.json`) must exist for the artifact being optimized.
- The artifact must be a file or directory (SKILL.md, prompt template, agent config, or a directory of related files like a skill with references/).
- The user should have run at least one interactive eval cycle to build confidence in eval quality before going unattended.

## The loop

```
1. RUN EVAL   — agentv eval with current artifact
2. ANALYZE    — dispatch analyzer subagent on results
3. DECIDE     — if score > best_score: KEEP, else DROP (automated keep/discard above)
4. MUTATE     — dispatch mutator subagent with failure analysis (agents/mutator.md)
5. GOTO 1     — until convergence or max_cycles
```

## Experiment naming

Derive the experiment name from the artifact: `autoresearch-<name>` (e.g., `autoresearch-pdf-skill`). The user can also provide a custom name.

## Artifact mutation flow

The mutator rewrites artifacts in the working tree in place. **Git is used for versioning** — HEAD always contains the best-known version:

1. Record the starting commit SHA before the first cycle: `initial_sha=$(git rev-parse HEAD)`.
2. On each **KEEP**: `git add <artifact-path> && git commit -m "autoresearch cycle N: <mutation summary>"`.
3. On each **DROP**: `git checkout -- <artifact-path>` (restores working tree to HEAD, the last KEEP commit).
4. The eval always runs against the real file path — no temp files or indirection.
5. The mutator can reference the original via `git show <initial_sha>:<path>`.

## How the skill invokes eval

Shell out to `agentv eval <eval-path> --experiment autoresearch-<name>` via the Bash tool, same as the existing interactive bench workflow.

## Artifact layout

Each cycle is a standard eval run. Autoresearch session metadata lives in `_autoresearch/` within the experiment directory:

```
.agentv/results/runs/<experiment>/
  _autoresearch/
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

No `original.md` or `best.md` files — git history serves as the backup. The `_` prefix convention distinguishes workflow folders from timestamped run dirs.

## iterations.jsonl

One JSON object per line, one line per cycle:

```jsonl
{"cycle":1,"score":0.65,"decision":"keep","cost_usd":0.12,"assertions":{"IDENTIFIES_BUG":0.8,"SUGGESTS_FIX":0.4},"mutation":"added explicit null-check instruction","run_dir":"2026-04-15T10-30-00","timestamp":"2026-04-15T10:32:15Z"}
```

Fields: `cycle` (1-indexed), `score` (overall pass rate 0–1), `decision` ("keep" or "drop"), `cost_usd` (eval run cost), `assertions` (per-assertion pass rates), `mutation` (one-line description of what changed), `run_dir` (timestamped directory name), `timestamp` (ISO 8601).

## trajectory.html

A standalone HTML chart file with embedded Chart.js. Copy the template from `scripts/trajectory.html` into the `_autoresearch/` directory. It fetches `iterations.jsonl` from the same directory on each auto-refresh — no data injection needed. Shows:

- Score over iterations (line chart) with KEEP (green) / DISCARD (red) markers
- Per-assertion pass rates over iterations
- Cumulative cost across iterations
- Best vs original score summary

Auto-refreshes every 2 seconds during the loop. Becomes static after completion (remove the auto-refresh meta tag on final update).

## Convergence

Stop after **3** consecutive cycles with no improvement (no KEEP). Also stop at **max_cycles** (default 10). Either limit can be overridden by the user.

## Human checkpoints

Autoresearch mode **skips** human checkpoints at iterations 3/6/9. The user opted in to unattended operation by requesting autoresearch.

## Context hygiene

The orchestrator must run indefinitely without exhausting its context window. To do this:

- **Never read eval results, artifacts, or transcripts into your own context.** Use bash commands (jq, agentv CLI) that output small structured summaries.
- **Delegate all heavy reading to subagents.** The mutator reads artifacts, grading results, and transcripts from disk — you pass it paths, not content.
- **Use bash for all file I/O** in the loop body: appending to `iterations.jsonl`, git operations, score extraction. The only tool calls per cycle should be bash commands and one subagent dispatch (mutator).
- **trajectory.html auto-loads `iterations.jsonl`** via fetch — no need to read or update the HTML file after initial copy.

## Procedure

Follow this step-by-step procedure to execute autoresearch:

### 1. Setup

1. Determine the **artifact path** (file or directory to optimize) and **eval path** (EVAL.yaml or evals.json).
2. Detect **artifact mode**: `file` if the artifact path is a file, `directory` if it's a directory.
3. Derive the **experiment name**: `autoresearch-<name>` from the artifact filename/dirname, or use a user-provided name.
4. Set the experiment directory: `.agentv/results/runs/<experiment>/`.
5. Create the `_autoresearch/` subdirectory inside the experiment directory.
6. Record `initial_sha=$(git rev-parse HEAD)` — the commit before any mutations.
7. Copy `scripts/trajectory.html` to `_autoresearch/trajectory.html`.
8. Initialize variables:
   - `best_score = 0`
   - `convergence_count = 0`
   - `cycle = 1`
   - `max_cycles = 10` (or user-specified)
   - `max_convergence = 3` (or user-specified)

### 2. Main loop

Repeat while `cycle <= max_cycles` and `convergence_count < max_convergence`:

**a. Run eval**

```bash
agentv eval <eval-path> --experiment autoresearch-<name>
```

**b. Extract scores (bash only — do NOT read result files into your context)**

Find the latest timestamped directory in the experiment folder. Use bash/jq to extract small structured values:

```bash
# Find latest run dir
RUN_DIR=$(ls -td <experiment-dir>/20*/ | head -1)

# Overall score (mean of all scores in index.jsonl)
SCORE=$(jq -sr '[.[].scores[].score] | add / length' "$RUN_DIR/index.jsonl")

# Per-assertion pass rates as JSON object
PASS_RATES=$(jq -sr '[.[].scores[]] | group_by(.type) | map({key: .[0].type, value: (map(.score) | add / length)}) | from_entries' "$RUN_DIR/index.jsonl")

# Cost (if timing.json exists)
COST=$(jq -r '.cost_usd // 0' "$RUN_DIR/timing.json" 2>/dev/null || echo 0)
```

Capture only these small outputs (`SCORE`, `PASS_RATES`, `COST`) — never read the full JSONL into context.

**c. Update iterations.jsonl (bash only)**

After the KEEP/DROP decision (step e), append one JSON line via bash:

```bash
echo '{"cycle":'$CYCLE',"score":'$SCORE',"decision":"'$DECISION'","cost_usd":'$COST',"assertions":'$PASS_RATES',"mutation":"'"$MUTATION_DESC"'","run_dir":"'"$(basename $RUN_DIR)"'","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> <experiment-dir>/_autoresearch/iterations.jsonl
```

**d. trajectory.html — no action needed**

The trajectory chart fetches `iterations.jsonl` directly via HTTP on each auto-refresh. No file manipulation required after the initial copy in setup.

**e. Decide: KEEP or DROP**

Apply the automated keep/discard rules from the section above:

1. Run `agentv compare <baseline>.jsonl <candidate>.jsonl --json` where `<baseline>` is the best iteration's `index.jsonl` (or the first run's `index.jsonl` for cycle 1) and `<candidate>` is this cycle's `index.jsonl`.
2. If `wins > losses` → **KEEP**.
3. If `wins <= losses` → **DISCARD**.
4. If `mean_delta == 0` and the artifact is simpler → **KEEP** (simpler is better at equal performance). Simplicity: for files, compare line count; for directories, compare total size via `du -sb`.

For cycle 1, there is no baseline to compare against — always **KEEP** the first cycle.

**f. If KEEP**

- Update `best_score` to this cycle's score.
- Commit the artifact: `git add <artifact-path> && git commit -m "autoresearch cycle N: <mutation summary>"`.
- Record the current `index.jsonl` path as the new baseline for future comparisons.
- Reset `convergence_count = 0`.

**g. If DROP**

- Revert the working tree to HEAD: `git checkout -- <artifact-path>` (for files) or `git checkout -- <artifact-path>/` (for directories).
- Increment `convergence_count`.

**h. Check stop conditions**

If `convergence_count >= max_convergence` or `cycle >= max_cycles` → break out of the loop.

**i. Mutate**

Dispatch the **mutator** subagent (`agents/mutator.md`) with:
- `artifact-path`: the file or directory to mutate
- `artifact-mode`: `file` or `directory`
- `initial-sha`: the starting commit SHA (for referencing the original via `git show`)
- `pass-rates`: the `$PASS_RATES` JSON object from step (b) (small — just assertion names and rates)
- `run-dir`: path to this cycle's run directory (the mutator reads `grading.json` and transcripts itself)
- `iterations-path`: path to `_autoresearch/iterations.jsonl` (the mutator reads mutation history itself)
- For directory mode: `focus-files` (optional — files most likely contributing to failures, derived from assertion names)

**Do NOT pass failure descriptions, transcripts, or grading content** to the mutator — pass paths and let it read what it needs from disk. This keeps the orchestrator's context clean.

The mutator rewrites artifacts in place. Verify the artifact was modified (e.g., `git diff --stat`) before continuing.

**j. Continue**

Increment `cycle` and return to step (a).

### 3. Completion

1. Finalize `trajectory.html`: remove the line containing `<!-- __AUTO_REFRESH__ -->` (which includes the `<meta http-equiv="refresh">` tag) so the chart becomes static.
2. Log a final summary:
   - Total cycles run
   - Final best score vs original score (cycle 1)
   - Number of KEEPs and DROPs
   - Total cost across all cycles
   - The optimized artifact is in the working tree (and the latest commit)
   - Run `git diff <initial_sha>` to see total changes from the original
   - Run `git log --oneline <initial_sha>..HEAD` to see the mutation history
   - Path to `_autoresearch/trajectory.html` (the score chart)
3. Present results to the user with a recommendation: adopt the optimized version, revert to original (`git checkout <initial_sha> -- <artifact-path>`), or continue iterating interactively.

## Interactive/autonomous hybrid

Users can start in interactive mode (the existing Step 3–5 loop with human checkpoints), build confidence in their eval quality, and then switch to autoresearch mode to run unattended. The two modes share the same eval infrastructure and artifact layout — autoresearch simply automates the keep/discard decisions and removes human checkpoints.

## Model empathy recommendation

For best results, use same-model pairings: the meta-agent running autoresearch should match the model used by the task agent being evaluated (e.g., Claude optimizing a Claude agent, GPT optimizing a GPT agent). Per AutoAgent research findings, same-model pairings produce better mutations because the optimizer has implicit knowledge of how the target model interprets instructions.
