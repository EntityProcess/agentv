# Dashboard UX parity with Vercel agent-eval Playground

Date: 2026-06-23

Beads:

- Parent: `av-2s7.16` - EPIC: Dashboard Vercel Playground UX parity
- First implementation slice: `av-2s7.16.1` - dashboard: add Vercel-like run overview scan surface
- Follow-up slices: `av-2s7.16.2` through `av-2s7.16.6`
- Research/doc task: `av-2s7.16.7`

## Product boundary

AgentV Dashboard is the supported zero-infra inspection path for AgentV run, trace, and session artifacts. Vercel `agent-eval` Playground is a public UX reference for result inspection polish, not a contract to copy wholesale.

Keep these boundaries:

- Preserve AgentV `project`, `experiment`, `benchmark`, run, case, and artifact terminology.
- Preserve AgentV case-local artifact direction under `.agentv/results/<experiment>/<timestamp>/<case>/...`.
- Do not make Phoenix a Dashboard runtime dependency or a completed-run storage projection target.
- Treat Vercel's `results/<experiment>/<timestamp>/<case>/run-N` layout as a useful comparison model for attempts, not as AgentV's required on-disk layout.
- Treat feedback as a retained AgentV optimization-loop primitive. Vercel Playground appears mostly read-only; that is not a reason to remove AgentV feedback.

## Sources reviewed

Local source:

- EntityProcess fork of Vercel `agent-eval`: `/home/entity/projects/EntityProcess/agent-eval`
- Vercel Playground package: `/home/entity/projects/EntityProcess/agent-eval/packages/playground`
- Local Next Evals OSS parity harness: `/home/entity/projects/EntityProcess/next-evals-oss-agentv`
- AgentV Dashboard: `apps/dashboard`
- AgentV Dashboard API/server: `apps/cli/src/commands/results/serve.ts`

Important files inspected:

- Vercel Playground:
  - `packages/playground/app/page.tsx`
  - `packages/playground/components/ExperimentDetail.tsx`
  - `packages/playground/components/RunResultCard.tsx`
  - `packages/playground/components/ComparePage.tsx`
  - `packages/playground/components/TranscriptViewer.tsx`
  - `packages/playground/lib/data.ts`
- Next eval parity fixtures:
  - `fixtures/sample-results/vercel/results`
  - `fixtures/sample-results/agentv/runs`
  - `docs/mapping.md`
- AgentV:
  - `apps/dashboard/src/routes/index.tsx`
  - `apps/dashboard/src/routes/runs/$runId.tsx`
  - `apps/dashboard/src/components/RunDetail.tsx`
  - `apps/dashboard/src/components/ResultTable.tsx`
  - `apps/dashboard/src/components/EvalDetail.tsx`
  - `apps/dashboard/src/components/TranscriptTimeline.tsx`
  - `apps/dashboard/src/components/FeedbackPanel.tsx`
  - `apps/dashboard/src/lib/api.ts`
  - `apps/dashboard/src/lib/types.ts`
  - `apps/cli/src/commands/results/serve.ts`
  - `apps/cli/src/commands/results/remote.ts`
  - `apps/web/src/content/docs/docs/guides/human-review.mdx`

## Browser dogfood

Browser automation used `agent-browser` only.

Local servers:

- Vercel Playground: `http://127.0.0.1:3123`
  - Command: `RESULTS_DIR=/home/entity/projects/EntityProcess/next-evals-oss-agentv/fixtures/sample-results/vercel/results EVALS_DIR=/home/entity/projects/EntityProcess/next-evals-oss-agentv/vercel/evals npx next dev -p 3123`
- AgentV Dashboard: `http://127.0.0.1:3124`
  - Command: `bun apps/cli/src/cli.ts dashboard --dir /tmp/agentv-dashboard-ux/agentv-project --single --port 3124`

Private evidence screenshots were saved under `/tmp/agentv-dashboard-ux/evidence/` and intentionally not committed.

Pages exercised:

- Vercel overview: `http://127.0.0.1:3123/`
- Vercel experiment detail: `http://127.0.0.1:3123/experiments/local-openai-codex/2026-06-22T00-00-00.000Z`
- Vercel transcript: `http://127.0.0.1:3123/transcript/local-openai-codex/2026-06-22T00-00-00.000Z/agentv-001-welcome-banner/run-1`
- Vercel compare: `http://127.0.0.1:3123/compare`
- AgentV overview/runs: `http://127.0.0.1:3124/`
- AgentV run detail: `http://127.0.0.1:3124/runs/agentv-parity::2026-06-22T00-00-00-000Z`
- AgentV eval detail: `http://127.0.0.1:3124/evals/agentv-parity::2026-06-22T00-00-00-000Z/agentv-001-welcome-banner`
- AgentV eval transcript tab
- AgentV eval feedback tab
- Vercel and AgentV mobile overview at `390x844`

## Vercel Playground observations

### Information architecture

Vercel Playground is compact:

- `/` is an overview with summary stats, recent experiments, eval fixture previews, and compare entrypoint.
- `/experiments` lists experiment runs.
- `/experiments/[name]/[timestamp]` shows one experiment run.
- `/compare` selects two experiment runs and compares them.
- `/transcript/[experiment]/[timestamp]/[evalName]/[run]` opens one attempt transcript.
- `/evals` lists fixtures.

The core mental model is experiment -> eval case -> `run-N` attempt -> transcript.

### Visual hierarchy and density

The overview makes the key state scannable immediately:

- Stats cards: experiments, total runs, eval fixtures, latest pass rate.
- Recent experiment cards: name, timestamp, pass rate, run count.
- Eval fixture cards: compact name/category information.
- Compare CTA: visible but not dominant.

The experiment detail keeps the same pattern:

- Breadcrumb.
- Summary cards: overall pass rate, evals passed, average duration, timestamp.
- Per-eval cards with a progress bar and direct `run-1` row.

The table density is low. It favors a first-read summary over operational controls.

### Navigation

The strongest interaction is the short path from experiment detail to a specific attempt transcript. Users can move:

experiment list -> experiment detail -> case card -> run attempt -> transcript.

Compare is also intentionally narrow: choose left and right runs, then see summary deltas and per-eval differences. When only one run is available, the page gives a clear insufficient-data state.

### Transcript

The Vercel transcript component has useful timeline/raw concepts and event-type grouping. On the local minimal fixture, however, the transcript route rendered a browser-visible client-side application error. AgentV should copy the timeline/raw affordance, not the failure behavior.

### Feedback

No feedback/comment/review-write surface was found in the Playground package source or browser UI. Searches for feedback/comment/review only found code comments and hover-feedback instructions, not a result annotation feature. Vercel Playground should be treated as read-only inspection.

## AgentV Dashboard observations

### Information architecture

AgentV is already broader and more useful for repo-native evaluation:

- Project registry and run history.
- Local and remote result sources.
- Run detail with summary, category breakdown, run log, and canonical result table.
- Row detail/full eval route with checks, transcript, source, files, and feedback.
- Compare and analytics surfaces.
- Tags and remote mutable metadata overlays.
- Raw artifact fallback paths.

The issue is not missing capability. The issue is that the first viewport often feels like an operations console before it feels like a result-inspection summary.

### Visual hierarchy and density

Desktop run detail currently surfaces many controls early:

- Run metadata and `Run evals`.
- Inline summary stats.
- Category breakdown.
- Result table presets and display/filter controls.
- Reviewed/unreviewed state derived from feedback.
- Run log.

This is powerful, but compared with Vercel's experiment detail it delays the simple answer to "what happened, what failed, and where do I click next?"

On mobile, AgentV's run card layout is readable, but remote sync/configuration and selection/combine controls can take too much first-screen space before the user reaches result content.

### Navigation

AgentV has the right deeper routes:

- run -> row detail panel
- run -> full eval page
- eval -> checks/transcript/source/files/feedback

The main gap is a clearer default case/attempt path. Vercel makes "this eval case has `run-1`; click it" obvious. AgentV should adapt that into:

run -> case -> attempt/repeat -> checks/transcript/logs/source/files/feedback.

This matters for repeat runs and flaky evals. AgentV should avoid overloading `pass_rate` to mean both quality pass rate and repeat-attempt success rate. Use explicit repeat/flaky fields when they exist.

### Artifact assumptions

Vercel sample layout:

```text
results/<experiment>/<timestamp>/<case>/run-N/result.json
results/<experiment>/<timestamp>/<case>/run-N/transcript.json
results/<experiment>/<timestamp>/summary.json
```

AgentV parity sample layout:

```text
.agentv/results/runs/<experiment>/<timestamp>/index.jsonl
.agentv/results/runs/<experiment>/<timestamp>/<case>/<target>/grading.json
.agentv/results/runs/<experiment>/<timestamp>/<case>/<target>/timing.json
.agentv/results/runs/<experiment>/<timestamp>/<case>/<target>/input.md
.agentv/results/runs/<experiment>/<timestamp>/<case>/<target>/outputs/response.md
.agentv/results/runs/<experiment>/<timestamp>/<case>/<target>/transcript.jsonl
```

The UI should adapt Vercel's case/attempt readability while keeping AgentV's explicit manifest paths and case-local sidecars.

### Missing artifact behavior

AgentV handled the minimal invalid transcript fixture better than Vercel. The transcript tab showed a targeted parse error and linked to the raw JSONL in Files. That behavior should be preserved and polished.

Vercel's local transcript route crashed for the same minimal sample. That is a useful negative reference: timeline/raw UI is worth adapting; brittle transcript assumptions are not.

## Feedback audit and recommendation

### Current behavior

Dashboard feedback is implemented and should be kept.

Current data shape:

```json
{
  "reviews": [
    {
      "test_id": "agentv-001-welcome-banner",
      "comment": "Qualitative review note.",
      "updated_at": "2026-06-23T00:00:00.000Z"
    }
  ]
}
```

Source audit:

- `FeedbackPanel` loads `useFeedback(projectId)` and posts `{ reviews: [{ test_id, comment }] }`.
- The CLI server persists `feedback.json`.
- Writes are rejected in read-only Dashboard mode.
- Duplicate `test_id` entries are overwritten in place with the latest comment and timestamp.
- `ResultTable` uses feedback only to derive reviewed/unreviewed state.
- There is no event log, multi-reviewer log, or visible remote dirty/sync state specifically for feedback today.
- The human review docs currently describe a richer schema (`run_id`, `reviewer`, `overall_notes`, `per_case`) than the Dashboard API actually writes. That mismatch should be resolved before expanding the feature.

Storage behavior in the audited code:

- Single-run/unscoped Dashboard writes beside the selected run directory.
- Project-scoped Dashboard writes to `.agentv/results/feedback.json` when that directory exists, otherwise to the project root.
- Remote run tags already have a richer mutable metadata overlay and dirty/sync state under `.agentv/results/metadata/runs/.../tags.json`.

### Product recommendation

Keep feedback as an AgentV differentiator for human-assisted optimization workflows. It closes a loop Vercel Playground does not attempt:

read result -> inspect trace/source/output -> add human feedback -> commit/sync as Git-backed evaluation context -> let agents or humans optimize prompts, graders, datasets, or test cases.

Do not remove feedback for now.

Recommended simplification is UX polish, not deletion:

- Rename/copy should make the purpose explicit: feedback is a review note for optimization, not a generic comment thread.
- Show save state and error state more clearly.
- Preserve unsaved drafts if a save or sync fails.
- If project remote sync is configured, distinguish local sidecar save from remote Git sync only when that distinction matters.
- Align docs and API around one small schema before adding richer fields.
- Keep "reviewed/unreviewed" as a useful table filter, but make the relationship to feedback clearer.

### Git write model

Design assumption: feedback is Git-backed state. In local workflows, Dashboard writes the feedback sidecar into the results workspace and the normal results Git workflow pushes it. In hosted/server deployments, feedback writes should be server-mediated, so normal multi-user conflicts should be rare or avoidable.

If a Git push conflict still occurs, conflict risk is not a reason to remove feedback. The UX should:

- Keep the user's draft/comment locally visible.
- Report that the feedback was saved locally or is pending remote sync, depending on the actual state.
- Tell the user/project sync flow that the remote branch needs reconciliation.
- Avoid destructive overwrite or silent discard.

A feedback log/event-log may be useful later if direct Git-backed feedback proves insufficient for multi-reviewer workflows, audit history, or agent optimization traces. That should stay a future Bead, not part of the current parity polish.

## Tags, source metadata, traces, provider logs, and repeats

AgentV should keep surfaces Vercel lacks:

- Tags for mutable run grouping and compare filters.
- Source metadata for repo/file/test provenance.
- Trace sessions and transcripts as first-class artifacts.
- Provider logs and raw files where indexed.
- Repeat-run summaries and future flaky attempt affordances.
- Feedback/review state.

The UX improvement is to stage these capabilities by user question:

1. What happened in this run?
2. Which cases failed or changed?
3. Which attempt/transcript/source explains it?
4. What human feedback or tags should guide the next iteration?
5. How does this compare to baseline or prior runs?

## Empty, loading, error, and responsive states

Copy/adapt from Vercel:

- Clear insufficient-data state in compare.
- Compact empty states that explain the next action.
- Summary-first cards that work on mobile.

Keep/improve from AgentV:

- Missing transcript and invalid transcript states with raw file links.
- Read-only mode blocking writes.
- Remote sync blocked/conflicted states.
- Artifact fallback links.

Avoid:

- Skeletons that dominate screenshots longer than necessary.
- Administrative controls above result state in single-run mobile views.
- Generic error text when the Dashboard knows the missing artifact or parse failure reason.

## Roadmap

### `av-2s7.16.1` - overview scan surface

Recommended first implementation slice.

Add Vercel-like summary cards and recent/run scan surfaces to project/run views. Prioritize pass rate, failure count, total cases, execution errors, latest run, and repeat/reliability placeholders where data exists. On mobile, put result state before remote/configuration/selection administration.

This is the best first slice because it improves perceived quality without changing artifact contracts.

### `av-2s7.16.2` - run-to-case artifact drilldown

Adapt Vercel's case card plus `run-N` attempt row into AgentV's run -> case -> attempt/repeat -> checks/transcript/source/files/feedback IA. Preserve the dense table as an expert mode, but make the case path easier to find.

### `av-2s7.16.3` - transcript/log viewer polish

Add a clearer timeline/raw viewer and provider log discovery while keeping AgentV's strict parse states and raw file fallback.

### `av-2s7.16.4` - feedback optimization loop UX

Keep feedback. Polish save/sync/error semantics, align docs/schema, and document Git/server-mediated write behavior. Do not build an event log unless direct sidecar feedback fails a concrete workflow.

### `av-2s7.16.5` - compare flow

Simplify run selection and summary deltas before per-case details. Reuse existing compare implementation and tags.

### `av-2s7.16.6` - empty/loading/error/mobile states

Run a focused desktop/mobile dogfood matrix over no runs, one run, missing transcript, invalid transcript, remote unavailable, sync conflict, and compare-insufficient states.

## Copy, adapt, do not copy

Copy:

- Summary-first overview cards.
- Recent experiment/run cards.
- Per-case card with compact attempt rows.
- Simple compare selection and insufficient-data state.
- Timeline/raw transcript affordance.

Adapt:

- Vercel `run-N` attempts into AgentV repeat/flaky attempt language.
- Vercel experiment detail into AgentV project/run/case terminology.
- Vercel pass-rate cards into AgentV quality pass rate plus explicit repeat reliability.
- Vercel minimal visual hierarchy into AgentV's richer artifact inspector.

Do not copy:

- Read-only-only result model.
- Brittle transcript assumptions that crash on minimal artifacts.
- Vercel storage layout as AgentV's required on-disk shape.
- Any Phoenix runtime dependency or completed-run Phoenix projection.
- Enterprise/hosted concepts that do not exist in AgentV's local-first product model.

## Validation performed

Commands:

- `command -v agent-browser`
- `agent-browser skills get core --full`
- `bun install`
- `bun --filter @agentv/core build`
- `bun --filter @agentv/sdk build`
- `cd apps/dashboard && bun run build`
- `bun apps/cli/src/cli.ts dashboard --dir /tmp/agentv-dashboard-ux/agentv-project --single --port 3124`
- `agent-browser` sessions for Vercel and AgentV desktop/mobile pages listed above

No product code implementation was done in this pass. The UX change is intentionally split into Beads because the right first PR should be a small, reviewable slice over existing Dashboard design patterns.
