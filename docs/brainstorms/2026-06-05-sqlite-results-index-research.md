---
date: 2026-06-05
topic: sqlite-results-index
type: research
---

# SQLite Results Index Research

## Summary

AgentV should treat any SQLite result index as a local, rebuildable projection over canonical run artifacts, not as the source of truth. The current git-native result storage design intentionally made the git tree and run artifacts canonical after the rejected append-only `index/runs.jsonl` approach.

The main benefit of SQLite is not just faster run-list rendering. It is high-volume aggregation across many runs: drift detection, per-test timelines, target/experiment comparisons, and tracker views should not have to repeatedly read every run's `index.jsonl` and scan each file for the relevant scores. SQLite gives AgentV a cheap query surface for "show me score movement for this test/suite/target over 1k-10k runs" while preserving artifact files as the durable record.

## Existing Issues And Research

- GitHub issue `#1259` is the main prior scaling issue. It identified `/api/runs` polling as O(N runs x manifest reads) and originally proposed an append-only run index.
- PR `#1260` implemented append-only `index/runs.jsonl`, then was closed/rejected because it introduced drift, migration, growth, and commit-SHA amend complexity.
- PR `#1261` merged the current git-native approach: `git ls-tree` plus `git cat-file --batch` over committed `summary.json` files, cursor pagination, lazy run materialization, and an `Agentv-Run:` commit trailer.
- PRs `#994`, `#1258`, `#1296`, and `#1297` cover remote result sync and per-project result repo configuration.
- PR `#741` moved canonical result consumers to run workspaces with `index.jsonl`; PR `#940` removed legacy flat manifest loading from canonical flows.
- PR `#1040` added mutable local `tags.json` sidecars for per-run comparison; remote runs remain read-only.
- Issue `#1139` wants a public eval tracker with historical trends. Issue `#1160` wants per-test score history from git baseline files. Both benefit from indexed queries, but neither requires changing canonical artifact storage.
- `docs/plans/git-native-results.md` explicitly says the git tree is the index and rejects a separate index file as canonical state.
- The ai-research-wiki had AgentV result storage summaries and run-bundle/baselines-as-code patterns, but no prior dedicated AgentV SQLite result-index design was found.

## Current Code Grounding

- Remote result repo listing is in `packages/core/src/evaluation/results-repo.ts`. `listGitRuns()` discovers remote runs from `index.jsonl` anchors and reads sibling `summary.json` metadata from the results ref when present.
- Dashboard result merge/list logic is in `apps/cli/src/commands/results/remote.ts`. It merges local run scans with remote git-native listing and uses a 60 second in-memory TTL cache.
- Dashboard handlers in `apps/cli/src/commands/results/serve.ts` still enrich many views by loading `index.jsonl` per run after listing. This affects run lists, experiments, targets, compare, and analytics.
- Local run discovery still uses `listResultFilesFromRunsDir()` in `apps/cli/src/commands/inspect/utils.ts`, which recursively scans `.agentv/results/runs/`.
- No SQLite dependency exists today. The CLI entry point is Node-compatible, so using `bun:sqlite` would be a portability decision, not a drop-in implementation detail.

## Design Options

### 1. SQLite As Local Projection

Canonical artifacts stay in local run workspaces and git-backed results repos. SQLite lives under `AGENTV_DATA_DIR/cache/results-index/` and is rebuilt from artifacts when missing or stale.

This fits current architecture best. It speeds Dashboard list views, but its higher-value role is aggregate analysis: trend lines, per-test drift, target comparisons, daily tracker summaries, and historical regression queries.

### 2. SQLite Committed Into Results Repos

This should be avoided. A committed SQLite database is binary, hard to review, prone to conflict, and recreates the rejected second-source-of-truth problem from PR `#1260`.

### 3. Git-Native Only, Further Optimized

Keep SQLite out for now and extend the current git-native path to batch-read remote `index.jsonl` blobs in addition to `summary.json`. This may be enough if profiling shows `git cat-file --batch` remains fast at the target scale.

### 4. Append-Only JSONL Index

Already tried in PR `#1260` and rejected.

## Recommended Minimal Approach

Build SQLite as a local, disposable projection:

- `results_index_meta(key, value)`
- `runs(project_id, source, run_id, manifest_path, summary_path, ref, benchmark_blob_sha, manifest_blob_sha, experiment, target, timestamp, test_count, pass_rate, avg_score, size_bytes, updated_at)`
- `run_tests(project_id, run_id, test_id, suite, category, target, score, execution_status, duration_ms, cost_usd, token_usage_json, scores_json)`
- Optional later: `run_scores(project_id, run_id, test_id, grader_name, grader_type, score, verdict, duration_ms)` if drift needs grader-level breakdowns instead of only top-level test scores.

Sync behavior:

1. On Dashboard startup and `POST /api/remote/sync`, fetch remote results repos.
2. Use `git ls-tree` with blob SHAs to detect changed remote `summary.json` and `index.jsonl` files.
3. Batch-read only changed blobs with `git cat-file --batch`.
4. Upsert run and test summary rows.
5. For local runs, scan `.agentv/results/runs/`, fingerprint `index.jsonl` by mtime/size or hash, and upsert changed rows.
6. Keep detail and file views reading canonical artifacts from disk/git materialization.

The index should be explicitly rebuildable. If deleted, a command or server startup path should recreate it from artifacts.

First query targets:

- Score trend for one `(project_id, suite, test_id, target)` across time.
- Mean score and pass-rate trend for one `(project_id, suite, target)` across time.
- Latest N runs for Dashboard without per-run manifest reads.
- Experiment x target aggregates for Dashboard analytics.
- Candidate drift report: tests whose recent rolling average regressed most against a baseline window.

## Risks And Migration

- Runtime dependency: avoid `bun:sqlite` unless AgentV commits to Bun-only execution for the indexed path. Prefer a Node-compatible SQLite dependency or an isolated adapter.
- Drift: store source fingerprints or git blob SHAs, and treat SQLite as a cache that can be dropped and rebuilt.
- Partial runs: tolerate incomplete `index.jsonl`; update rows on the next sync when the run finishes.
- Tags: local mutable `tags.json` needs its own fingerprint or should continue being read live until tag indexing is necessary.
- Scope creep: do not store full grading, input, output, or response artifacts in SQLite for the first version. Index summaries and score facts only.

## Next Beads To Create

- `spike(results): profile dashboard run queries at 1k/10k runs`
- `feat(results): add local rebuildable SQLite projection for run/test summaries`
- `feat(results): add drift query API over the results index`
- `refactor(dashboard): read run-list/experiments/targets/compare from results index`
- `test(results): fixture remote repo with changed blob SHA incremental sync`
- `docs(results): document SQLite index as rebuildable cache, not canonical artifact storage`
