---
date: 2026-06-14
topic: static-results-dashboard
type: recommendation
---

# Static Results Dashboard Recommendation

## Summary

AgentV should keep `agentv results report` focused on one run and add any future multi-run GitHub Pages export as a separate `agentv results dashboard` command. The dashboard should be a read-only static index over existing run artifacts, with relative links to single-run reports for drill-down.

---

## Problem Frame

Public benchmark repositories need a URL that explains quality movement over time without asking readers to clone artifacts, run `agentv dashboard`, or interpret raw `index.jsonl`. The existing single-run report solves the case-level review problem, but it does not answer longitudinal questions such as whether pass rate drifted, which target regressed, or whether a release improved a benchmark pack.

AgentV already has the core primitives for those questions: canonical run workspaces, `agentv trend` for score drift, `agentv compare` for pairwise and target matrix deltas, and Dashboard analytics for run lists, score distribution, normalized gain, tag heatmaps, and trend charts. The static dashboard should compose those existing primitives into a publishable artifact rather than creating a second hosted Dashboard.

---

## Key Decisions

- **New command, not `results report` mode expansion.** `results report` has a clear one-run contract and one default output file. A multi-run dashboard has different source semantics, writes an index plus optional per-run pages, and should not add a second mode to the report command.
- **Run artifacts remain canonical.** The static dashboard reads existing `.agentv/results/runs/**/index.jsonl` and summary artifacts from public result repos. It does not introduce a committed database, service worker, or new canonical index.
- **Static-first output.** The primary artifact is `docs/index.html` with inline data and no backend. Optional drill-down pages use safe relative links, such as `docs/runs/<run-slug>.html`.
- **Graceful sparse data.** Legal currently has one published live run, while financial has multiple useful runs. Trend and comparison panels should render when data supports them and otherwise show an explanatory empty state.

---

## Requirements

**Inputs**

- R1. The dashboard command accepts one or more result repo roots, run workspace directories, or `index.jsonl` manifests.
- R2. The command discovers canonical run workspaces under `.agentv/results/runs/` when given a repo root.
- R3. The command uses existing run metadata and `index.jsonl` rows without requiring a live Dashboard or remote API.
- R4. Optional filtering supports suite, target, experiment, tags, and latest-N run selection when those fields exist in artifacts.

**Output**

- R5. The default output is a GitHub Pages-friendly `docs/index.html` that is read-only and self-contained.
- R6. Per-run drill-down links are relative and can point to generated single-run report pages.
- R7. The generated HTML uses the existing Dashboard/report visual language: dark surface hierarchy, summary cards, pass/fail tones, score distribution, run table, and expandable details through linked reports.
- R8. The output includes no external scripts, no external stylesheets, no local endpoint references, and no local filesystem paths.

**Analysis**

- R9. The dashboard summarizes total runs, latest run, pass rate, mean score, failures, errors, duration, token usage, and cost when present.
- R10. The dashboard shows pass-rate and mean-score trend lines across runs when at least two comparable runs exist.
- R11. The dashboard shows score distributions for the selected run set.
- R12. The dashboard shows target/model comparison tables when multiple targets are present.
- R13. The dashboard surfaces release/regression signals by highlighting latest-run deltas against a selected baseline or previous run.

**Publication**

- R14. The command supports a public results repository workflow where `docs/index.html` is committed with run artifacts and served by GitHub Pages.
- R15. The command can optionally generate single-run report pages for every included run by reusing the existing report renderer.
- R16. The command emits enough terminal output for automation to record the generated files and source run count.

---

## MVP for Legal and Financial Demos

The first useful version does not need a full Dashboard clone. It needs:

1. `agentv results dashboard <results-repo-root> --out docs/index.html --reports docs/runs/`
2. A static overview with cards for runs, tests, latest pass rate, mean score, failures, and errors.
3. A run table with date, experiment/run ID, target, tests, pass rate, mean score, and a relative `runs/<slug>.html` report link.
4. A score distribution histogram over the selected runs.
5. A pass-rate trend chart when at least two comparable runs exist.
6. A target comparison table when at least two targets exist.
7. Empty states that explain why legal has no trend yet if only one legal run is published.

For the current legal and financial publication task, the existing `agentv results report` primitive is enough: publish `docs/index.html` in the legal results repo, and publish `docs/index.html` plus `docs/dexter-baseline.html` in the financial results repo. The multi-run dashboard should be a follow-up because it would add a new command, source discovery rules, and aggregation behavior beyond this issue's smallest GitHub Pages-ready path.

---

## URL and Layout Shape

```text
docs/
  index.html                       # multi-run static dashboard
  runs/
    <experiment>-<timestamp>.html   # generated with the single-run report renderer
```

Suggested tabs or sections for `docs/index.html`:

- **Overview** — cards, latest run, selected filters, and publication timestamp.
- **Trends** — pass-rate and mean-score lines, with sparse-data empty states.
- **Compare** — target/model matrix and latest-vs-baseline deltas.
- **Runs** — sortable run table with relative links to generated single-run reports.

---

## Scope Boundaries

- Do not build a second live Dashboard app.
- Do not require a server, database, API route, or GitHub Actions service to view the output.
- Do not commit a generated SQLite database or append-only aggregate index as canonical state.
- Do not replace `agentv trend`, `agentv compare`, or Dashboard analytics; reuse their concepts and data shapes.
- Do not add statistical claims beyond descriptive trend/delta summaries in the MVP.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5.** Given a public results repo root, when the command runs with `--out docs/index.html`, then a static dashboard file is generated from discovered run workspaces.
- AE2. **Covers R6, R15.** Given `--reports docs/runs/`, when the command includes a run, then the run table links to a relative single-run report page.
- AE3. **Covers R10.** Given fewer than two comparable legal runs, when the dashboard renders, then the trend panel explains that more runs are required instead of showing a misleading chart.
- AE4. **Covers R8, R14.** Given the generated `docs/` directory is scanned, then no external scripts, local endpoints, local filesystem paths, or secrets are present.
- AE5. **Covers R12, R13.** Given financial runs include multiple targets or a baseline/candidate pair, when the dashboard renders, then target comparison or latest-vs-baseline deltas are visible without running the live Dashboard.

---

## Sources

- `apps/cli/src/commands/results/report.ts` — existing one-run static HTML report writer.
- `apps/cli/src/commands/results/report-template.ts` — existing Dashboard-themed static report visual language.
- `apps/cli/src/commands/trend/index.ts` — existing multi-run trend analysis over run manifests.
- `apps/cli/src/commands/compare/index.ts` — existing pairwise and target-matrix comparison logic.
- `apps/web/src/content/docs/docs/tools/dashboard.mdx` — current Dashboard analytics behavior to mirror at static-export scope.
- `apps/web/src/content/docs/docs/tools/results.mdx` — current single-run report docs and GitHub Pages workflow.
