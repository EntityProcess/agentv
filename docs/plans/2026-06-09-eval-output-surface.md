# Eval Output Surface Decision

Date: 2026-06-09
Bead: `av-eval-output-config-surface-4e2`

## Audit

The eval run command currently exposes several overlapping ways to choose where results go:

- `--output <dir>` / `-o <dir>` is the canonical run artifact directory. It writes `index.jsonl`, `benchmark.json`, `timing.json`, run source metadata, and per-test artifacts under that directory.
- `agentv.config.ts` `output.dir` exists, but current CLI normalization routes it through the legacy `outPath` branch, so it behaves like a file path rather than the documented output directory.
- `agentv.config.ts` `output.format` is accepted by `defineConfig()` but eval runs ignore it.
- `--out <path>` is deprecated and currently treated as a file path whose dirname becomes the artifact directory.
- `--artifacts <dir>` is deprecated and currently aliases the artifact directory.
- `--output-format` is deprecated and ignored because run directories always use `index.jsonl`.
- `--benchmark-json` was a deprecated extra Agent Skills compatibility output path outside this cleanup's requested removal set; a follow-up cleanup removes that flag and keeps the run directory `benchmark.json` as canonical.
- Dashboard launch paths already pass `--output <dir>` and expect `<dir>/index.jsonl`.
- Repository docs/examples still contain old `agentv eval --out <file>` guidance in compare workflows, grader-score helper comments, and local scripts.

Known external consumers:

- `WiseTechGlobal/sdd` `.github/workflows/sdd-eval.yml` uses `-o .agentv/ci-results/junit.xml` plus `--artifacts .agentv/ci-results/artifacts`.
- `WiseTechGlobal/WTG.AI.Prompts` `.github/workflows/evals.yml` and `.copilot/workflows/evals.yml` already use `--output .agentv/results/artifacts`.
- A broader WiseTechGlobal scan found docs using `agentv eval -o <file>.jsonl`; no `agentv eval --output-format` consumers were found.

Pipeline subcommands such as `agentv pipeline input --out <dir>` are distinct and remain out of scope.

## Contract

The eval run output contract is:

- `--output <dir>` sets the run artifact directory.
- `agentv.config.ts` `output.dir` is the same directory fallback when `--output` is omitted.
- If neither is provided, AgentV writes `.agentv/results/runs/<experiment>/<timestamp>/`.
- The canonical result manifest is always `<run-dir>/index.jsonl`.
- `--output` is not a file-output flag. File-looking values such as `results.jsonl`, `report.html`, and `junit.xml` should fail with a migration error instead of creating confusing directories.
- `-o` remains a compatibility short alias for `--output <dir>`, not a JUnit flag.

## Breaking Cleanup

This change is a breaking prerelease cleanup and bumps published AgentV packages from `4.32.0-next.1` to `4.32.0-next.2`.

Removed now:

- `agentv eval --out <path>`
- `agentv eval --artifacts <dir>`
- `agentv eval --output-format <format>`
- `agentv.config.ts` `output.format`

Warned/scheduled:

- `--benchmark-json` is removed by the follow-up cleanup after auditing for consumers; use `--output <dir>` and read `<dir>/benchmark.json` instead of requesting a second benchmark file.

## Migration

For old flat JSONL output:

```bash
# Before
agentv eval evals/my-eval.yaml --out results.jsonl

# After: canonical run directory only
agentv eval evals/my-eval.yaml --output results

# Read canonical JSONL from results/index.jsonl
cat results/index.jsonl
```

For JUnit XML:

```bash
# Before
agentv eval evals/my-eval.yaml -o results.xml --artifacts .agentv/results/artifacts

# After: write the canonical run directory
agentv eval evals/my-eval.yaml --output .agentv/results/artifacts
```

For config files:

```typescript
export default defineConfig({
  output: { dir: './results' },
});
```

`output.format` has no replacement. The run directory always uses `index.jsonl`.
