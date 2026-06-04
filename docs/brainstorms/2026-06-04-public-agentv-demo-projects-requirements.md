---
date: 2026-06-04
topic: public-agentv-demo-projects
---

# Public AgentV Demo Projects Requirements

## Summary

Create two public companion projects that can replace private WiseTech eval repos in AgentV Dashboard demos. `dexter-evals` should prove AgentV can run a real domain-agent eval project derived from Dexter's public evaluation pattern. `swe-evals` should prove AgentV can run a public coding-agent harness demo with previous-commit checkout, plugin variants, repeatable Codex-vs-Pi comparisons, and remote result sync through companion results repositories.

---

## Problem Frame

AgentV currently has strong in-repo examples, but the deployed Dashboard story depends on private projects such as `WTG.AI.Prompts` and `WiseTechAcademy.Evals`. That makes public demos hard to reproduce and makes it difficult to show AgentV's multi-project Dashboard behavior without private credentials and private repositories.

The public substitutes need to demonstrate the same practical value: registered projects with real eval suites, real setup constraints, provider configuration, and artifacts that make the Dashboard feel like a multi-project eval environment rather than a toy example browser.

---

## Key Decisions

- **Public external projects, not just more nested examples.** The projects should behave like separate repos registered in the Dashboard, because the demo needs to prove AgentV handles multiple real project boundaries.
- **Remote result sync is part of the demo.** Each public eval project should have a matching public results repository so the Dashboard can demonstrate source-project registration plus remote results synchronization.
- **Dashboard demo first.** V1 optimizes for public reproducibility and useful visible results, not leaderboard-grade SWE-bench parity or broad statistical claims.
- **Dexter is adapted from its own eval pattern.** `dexter-evals` should use Dexter's existing evaluation shape as source material: install Dexter, configure provider access, run or adapt its financial-question eval flow, and capture what AgentV makes easier or harder.
- **SWE task selection is a research step.** `swe-evals` should not casually pick repositories. It should choose tasks from SWE-bench, Multi-SWE-bench, and Marginlab-style drift-tracking patterns using explicit selection criteria.
- **Secrets stay local.** Public repos can include templates that reference environment variables, but provider endpoints, Azure credentials, Bitwarden-derived values, and `.env` files must not be committed.

---

## Actors

- A1. **AgentV maintainer** creates and maintains the public demo repos, setup flow, and Dashboard registration path.
- A2. **Demo operator** runs the setup locally or in deployment and verifies the Dashboard shows `agentv`, `dexter-evals`, and `swe-evals`.
- A3. **Coding-agent provider** runs target tasks, initially focused on Codex and Pi.
- A4. **Reviewer or evaluator** reads the Dashboard, result artifacts, and comparison outputs to understand whether the setup is credible.
- A5. **Upstream project maintainer** may receive AgentV improvement issues or PRs when adapting Dexter or SWE-style tasks exposes framework friction.

---

## Requirements

**Public Project Shape**

- R1. The demo must include two public companion projects: `dexter-evals` and `swe-evals`.
- R2. Each project must be independently cloneable and registerable as an AgentV Dashboard project.
- R3. The public Dashboard setup must show the AgentV examples project plus both companion projects, replacing the private WiseTech-only demo dependency.
- R4. Each project must include a small eval suite that can run end to end with public code and locally supplied credentials.
- R5. Each project must have a matching public results repo, such as `dexter-evals-results` and `swe-evals-results`, configured for Dashboard remote result sync.

**Dexter Evals**

- R6. `dexter-evals` must document Dexter installation as a prerequisite for meaningful demo data.
- R7. `dexter-evals` must configure Dexter and AgentV provider access through local environment variables or local secret-loading steps.
- R8. `dexter-evals` must adapt Dexter's public evaluation pattern rather than inventing a synthetic finance suite from scratch.
- R9. The Dexter adaptation must capture at least one AgentV-relevant improvement opportunity when the source eval format, dataset shape, rubric metadata, or provider configuration creates friction.
- R10. The public repo must be clear that it is an AgentV eval project for Dexter, not an ownership fork of Dexter itself.

**SWE Evals**

- R11. `swe-evals` must demonstrate configuring the coding-agent harness, including baseline and plugin-enabled variants.
- R12. `swe-evals` must include baseline, `compound-engineering`, and `superpowers` variants as the first plugin comparison set.
- R13. `swe-evals` must demonstrate checking out a previous commit of an external public repo before asking the agent to fix a task.
- R14. `swe-evals` must initially focus provider comparison on Codex vs Pi.
- R15. `swe-evals` must choose its initial task pack from researched public sources, not ad hoc examples.
- R16. The initial task pack must favor repositories with low setup cost, reliable tests, clear previous-commit checkout, and strong demo clarity.
- R17. The project must preserve a path to repeat the same task pack over time for quality-drift checks, inspired by Marginlab's Claude Code tracker.

**Provider and Secret Handling**

- R18. Public `targets.yaml` templates may reference an OpenAI-compatible endpoint through environment variables.
- R19. Azure endpoint configuration may be loaded from Bitwarden Secrets Manager during local setup or deployment, but the resolved values must remain uncommitted.
- R20. Public repos must ship public-safe `.env.example` and target templates that explain required variables without exposing real credentials.
- R21. Setup scripts must fail with actionable messages when required provider or data-access configuration is missing.

**Demo and Deployment**

- R22. The setup path must support registering both public repos into the AgentV Dashboard project registry.
- R23. The setup path must avoid recloning unnecessarily when a repo already exists locally and can be updated safely.
- R24. Docker deployment may be provided for the complete eval environment, but it should not obscure the local setup path.
- R25. The demo must produce visible results that make the Dashboard useful: project entries, runs, target names, scores, and comparison-relevant metadata.
- R26. The demo must demonstrate remote result sync by pushing or pulling result artifacts through the public companion results repos.

---

## Source Selection For `swe-evals`

The initial candidate pool should be researched and narrowed during planning. The current preferred candidates are:

| Candidate repo | Why it is attractive for v1 | Risk |
|---|---|---|
| `iamkun/dayjs` | Small, familiar JavaScript library with many Multi-SWE-bench instances and likely cheap tests. | Need to validate specific task setup and test stability. |
| `expressjs/express` | Recognizable, small JavaScript web framework with strong demo value. | Some tasks may need version-specific Node/test setup. |
| `axios/axios` | Familiar JavaScript API surface and public issue history. | Must choose a task with a small, reliable test target. |
| `darkreader/darkreader` | Smaller TypeScript candidate for showing TS harness setup without huge repo cost. | Fewer available instances than larger TS repos. |
| `sharkdp/fd` or `tokio-rs/bytes` | Optional Rust stretch case if non-JS coverage stays cheap. | Rust setup may increase demo cost and runtime. |

Avoid for v1 unless research proves a task is unusually cheap: `mui/material-ui`, `vuejs/core`, `sveltejs/svelte`, `cli/cli`, large Rust repos, and other projects where install time or test runtime would dominate the demo.

---

## Key Flows

- F1. Public Dashboard setup
  - **Trigger:** A demo operator wants a public multi-project AgentV Dashboard.
  - **Actors:** A1, A2
  - **Steps:** The operator runs setup, public repos are cloned or updated, local provider config is injected, projects are registered, and the Dashboard starts.
  - **Outcome:** Dashboard shows AgentV examples, `dexter-evals`, and `swe-evals` as separate projects with runnable or recent eval results sourced from local runs or remote results repos.
  - **Covered by:** R1, R2, R3, R5, R22, R23, R25, R26

- F2. Dexter domain eval run
  - **Trigger:** The operator wants to show a non-SWE domain eval project.
  - **Actors:** A1, A2, A3, A5
  - **Steps:** Dexter is installed, provider settings are loaded locally, a small Dexter-derived eval run executes, and AgentV records results.
  - **Outcome:** The demo shows real domain-agent eval output and any AgentV adaptation friction is captured for upstream improvement.
  - **Covered by:** R6, R7, R8, R9, R10, R18, R19, R20, R21

- F3. SWE harness comparison run
  - **Trigger:** The operator wants to show coding-agent harness behavior.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** A selected public repo is checked out at a previous commit, baseline and plugin variants are configured, Codex and Pi run the same task pack, and AgentV captures scores and run metadata.
  - **Outcome:** The demo shows how harness configuration, plugins, providers, and previous-commit checkout affect results.
  - **Covered by:** R11, R12, R13, R14, R15, R16, R17

- F4. Repeatable drift check
  - **Trigger:** The maintainer wants to see whether provider behavior changed over time.
  - **Actors:** A1, A3, A4
  - **Steps:** The same small task pack is rerun later with the same documented setup and compared against prior run artifacts.
  - **Outcome:** The project can surface directional quality drift without claiming leaderboard-grade significance.
  - **Covered by:** R14, R17, R25, R26

---

## Acceptance Examples

- AE1. **Covers R3, R5, R22, R25, R26.** Given a public demo environment with local provider configuration, when the setup is run and the Dashboard starts, then `agentv`, `dexter-evals`, and `swe-evals` appear as separate projects with remote-sync-capable result configuration.
- AE2. **Covers R6, R7, R21.** Given Dexter is not installed or required provider variables are missing, when the `dexter-evals` setup is run, then it fails with an actionable prerequisite message rather than producing empty or fake results.
- AE3. **Covers R11, R12, R13.** Given `swe-evals` runs a selected task, when the baseline and plugin variants execute, then each variant starts from the same previous external repo commit and records which harness configuration was used.
- AE4. **Covers R18, R19, R20.** Given the public repos are inspected, then no committed file contains real provider endpoints, API keys, Azure credentials, or Bitwarden-derived secret values.
- AE5. **Covers R15, R16, R17.** Given the `swe-evals` task pack is reviewed, then each included task has a documented source, selection rationale, previous commit, expected verification signal, and suitability for repeated runs.
- AE6. **Covers R5, R26.** Given a run has completed in either public companion project, when remote result sync is triggered, then the matching public results repo receives or serves the run artifacts used by the Dashboard.

---

## Success Criteria

- The public demo can be run without access to `WTG.AI.Prompts` or `WiseTechAcademy.Evals`.
- The Dashboard shows two public projects beyond the AgentV examples project.
- Each public companion project has a matching public results repo configured for remote sync.
- `dexter-evals` produces real eval data when Dexter and local provider credentials are configured.
- `swe-evals` runs at least one previous-commit external-repo task across baseline and plugin variants.
- Codex-vs-Pi comparison is visible in output artifacts or Dashboard metadata.
- Remote-synced result artifacts are visible in the Dashboard demo path.
- Setup instructions distinguish public repo content from local/private configuration.
- Any AgentV product friction discovered while adapting Dexter or SWE-style tasks is captured as upstream AgentV follow-up work.

---

## Scope Boundaries

Deferred for later:

- Full SWE-bench, Multi-SWE-bench, or SWE-Bench-Pro harness parity.
- Broad provider matrix covering Claude, Copilot CLI, and additional providers beyond Codex and Pi.
- Public leaderboard or statistically rigorous quality-drift claims.
- Large multi-language task packs.
- Automated publication of drift alerts.

Outside this product's identity:

- Committing private provider config, `.env` files, real endpoint secrets, or Bitwarden-derived values.
- Replacing Dexter's own LangSmith eval runner upstream.
- Turning AgentV itself into a hosted benchmark SaaS.

---

## Dependencies And Assumptions

- Dexter remains public and installable enough for a demo-oriented eval project.
- The demo operator can provide either an OpenAI-compatible endpoint or Azure credentials through local secret handling.
- Bitwarden Secrets Manager may be used locally or in deployment, but only as a secret source, not as committed configuration.
- Public SWE-style tasks can be found that are cheap enough to run in a demo while still exercising previous-commit checkout and verification.
- AgentV's existing workspace lifecycle, target hooks, and comparison artifacts are sufficient for v1 without adding new core primitives.

---

## Outstanding Questions

Deferred to Planning:

- Which exact Dexter version or commit should `dexter-evals` pin for the first public demo?
- Which 3-5 SWE-style task instances should ship in the initial `swe-evals` task pack?
- What exact public results repo names should be created for `dexter-evals` and `swe-evals`?
- Should the public setup script live in AgentV, a separate deployment repo, or both?
- Should Docker be required for `swe-evals`, or should Docker be optional while local setup remains primary?
- How should upstream AgentV improvement opportunities be tracked when the demo exposes framework friction?

---

## Sources And Research

- `examples/showcase/bug-fix-benchmark/README.md` and `examples/showcase/bug-fix-benchmark/evals/bug-fixes.eval.yaml` show the existing AgentV pattern for baseline and plugin-variant coding-agent evals.
- `examples/features/agent-skills-evals/` shows multi-provider skill-trigger eval patterns already present in AgentV examples.
- `agentv-deploy/README.md` and `agentv-deploy/docker-entrypoint.sh` show the current private-project deployment shape that the public projects should replace or mirror.
- `ai-research-wiki/entities/dexter.md` and `ai-research-wiki/raw/articles/dexter-evals.md` summarize Dexter's existing eval runner, dataset, and rubric pattern.
- `ai-research-wiki/concepts/paired-baseline-skill-eval.md` supports paired baseline-vs-plugin comparison as the right way to measure plugin value.
- `ai-research-wiki/concepts/variant-systems.md` supports treating provider and plugin configuration as the unit of comparison.
- `ai-research-wiki/comparisons/agentv-vs-swe-bench.md` and `ai-research-wiki/entities/swe-bench.md` frame SWE-bench as benchmark infrastructure that AgentV can host patterns from without becoming SWE-bench.
- Dexter README "How to Evaluate" documents its public eval flow with `bun run src/evals/run.ts` and `--sample`.
- SWE-bench Lite and Multi-SWE-bench public dataset pages document task fields such as previous commits, issue statements, fail-to-pass tests, and pass-to-pass tests.
- Marginlab's Claude Code tracker provides the drift-tracking pattern: repeated runs on a curated SWE task pack, daily/weekly/monthly windows, and clear separation between baseline collection and degradation detection.
