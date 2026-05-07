# 1222 — Stop run + partial-run resumability (simplified scope)

## Scope

Make Ctrl+C / DELETE work. No staged shutdown, no new status words, no
AbortSignal threading.

1. **CLI** — Ctrl+C → install `process.on('SIGINT'|'SIGTERM')` that kills
   tracked child processes, then exits. Partial `index.jsonl` is already
   row-by-row durable; whatever finished is preserved.
2. **Studio API** — `DELETE /api/eval/run/:id` (and benchmark-scoped
   variant) calls `child.kill('SIGTERM')` on the spawned CLI. Existing
   `child.on('close')` flips `running → failed` once the process exits.
   No new `'stopping'` state on the server.
3. **Studio UI** — Red Stop button on `/jobs/:runId` while
   `status ∈ {starting, running}` and not read-only. On click, optimistic
   local "Stopping…" label until the next status poll flips to terminal.
4. **Resume detection for partial runs** — Persist `planned_test_count` in
   `benchmark.json.metadata` at run start (early write), updated at end.
   Run-detail API surfaces the number; Studio computes
   `shouldShowResumeActions(results, isReadOnly, plannedTestCount?)` as
   `executionError OR results.length < plannedTestCount`. No
   `is_resumable` / `resume_reason` flags.

## Files touched

### CLI signal handler
- `packages/core/src/runtime/child-tracker.ts` — *new*. Singleton
  `Set<ChildProcess>`; `trackChild(child)` and `killAll(signal)`.
- `packages/core/src/evaluation/providers/{claude-cli,codex-cli,pi-cli}.ts`
  + `copilot-utils.ts` — call `trackChild(child)` after each `spawn(...)`.
  No need to untrack on close: `kill()` is a no-op on dead PIDs and the
  registry is short-lived.
- `apps/cli/src/cli.ts` — install SIGINT/SIGTERM handlers that call
  `killAll('SIGTERM')` then `process.exit(130)` / `143`. Idempotent on
  re-entry; second signal hard-exits (`process.exit(1)`).

### Studio DELETE endpoint
- `apps/cli/src/commands/results/eval-runner.ts` — add
  `app.delete('/api/eval/run/:id', ...)` and
  `app.delete('/api/benchmarks/:benchmarkId/eval/run/:id', ...)`.
  - 404 if id unknown
  - 403 in read-only mode
  - 200 `{stopped: true}` after `child.kill('SIGTERM')`
  - 200 `{stopped: false, reason: 'already_terminal'}` if already done
  - No status mutation here; close handler does it.

### Studio Stop button
- `apps/studio/src/components/StopRunButton.tsx` — *new*. Renders the red
  destructive button when `status` is non-terminal; calls DELETE with the
  benchmark-scoped path when `benchmarkId` is set; sets local
  `stopping=true` state to flip the label optimistically.
- `apps/studio/src/components/stop-run-helpers.ts` — *new*. Pure
  `shouldShowStopButton(status, isReadOnly)` for unit testing.
- `apps/studio/src/lib/api.ts` — add `stopEvalRun(id, benchmarkId?)`.
- `apps/studio/src/routes/jobs/$runId.tsx` — wire `<StopRunButton />` into
  the header.

### Resume — planned_test_count
- `apps/cli/src/commands/eval/artifact-writer.ts`
  - Extend `BenchmarkArtifact.metadata` with optional
    `planned_test_count?: number`.
  - Add `writeInitialBenchmarkArtifact(runDir, { evalFile, targets,
    plannedTestCount, experiment })` that writes a stub at run start
    (`run_summary: {}`, `metadata` pre-filled).
- `apps/cli/src/commands/eval/run-eval.ts` — call the initial writer
  immediately after the run dir is created, **before** dispatching tests.
  At end of run, the existing `writeArtifactsFromResults` /
  `aggregateRunDir` overwrites the file with full data and the same
  `planned_test_count`.
- `apps/cli/src/commands/results/serve.ts` — `deriveResumeMeta` already
  reads `metadata.eval_file`; extend to also surface
  `planned_test_count`. Run-detail response gains `planned_test_count`.
- `apps/studio/src/lib/types.ts` — add optional
  `planned_test_count?: number` to the run-detail response type.
- `apps/studio/src/components/resume-run-helpers.ts` — extend
  `shouldShowResumeActions` to also return true when
  `plannedTestCount && results.length < plannedTestCount`.
- `apps/studio/src/components/ResumeRunActions.tsx` and the two run
  detail routes — pass `plannedTestCount` through.

### Tests (narrow)
- `apps/cli/test/commands/results/serve.test.ts` (or co-located) — DELETE
  endpoint: 404 unknown, 403 read-only, 200 happy path with a fake child
  whose `kill` is observable.
- `apps/studio/src/components/resume-run-helpers.test.ts` — case where
  every result is `ok` but `results.length < plannedTestCount` → button
  visible.
- `apps/studio/src/components/stop-run-helpers.test.ts` — visibility
  matrix.
- Skip: integration test that signals a real eval. Manual UAT is enough.

## Non-goals

- "Pause" / resume-from-mid-test semantics.
- Per-test SIGINT to graders.
- Multi-job orchestration / job queue.
- A "stopping" status word — UI handles the optimistic flicker locally.

## Acceptance signals

- [ ] CLI: `Ctrl+C` during a multi-test eval kills all spawned providers
      and the partial `index.jsonl` is preserved.
- [ ] Server: `DELETE /api/eval/run/:id` returns 200 in normal mode, 403
      in read-only, 404 for unknown id.
- [ ] UI: Stop button appears while running, hidden in read-only, hidden
      when terminal. Optimistic "Stopping…" label appears until status
      poll flips.
- [ ] UI: A run with 5 of 10 tests `ok` and 5 missing shows Resume.
- [ ] UI: A complete passing run does *not* show Resume.

## Out-of-scope cleanups noted

The benchmark.json write happens entirely at end-of-run today. Writing a
stub at start means a run that crashes before the first test still has a
metadata file on disk — that may obsolete some of the fallback logic in
`deriveResumeMeta`. We are not consolidating that here; this PR only adds
the early-write call.
