# AgentV Optimizer Scripts Layer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bun-based `scripts/` and `eval-viewer/` layer to `plugins/agentv-dev/skills/agentv-optimizer` that mirrors `skill-creator` structurally while delegating execution and grading primitives to AgentV.

**Architecture:** Build a self-contained Bun mini-project inside the skill, following the `dev-browser` packaging pattern. Scripts must shell out to `agentv` wherever possible and consume AgentV artifacts directly; only add a minimal CLI/core primitive if wrapper tests prove a real gap that cannot be solved cleanly in the scripts layer.

**Tech Stack:** Bun, TypeScript, Vitest, AgentV CLI/core, Biome

---

## File Structure

### Skill bundle files

- Create: `plugins/agentv-dev/skills/agentv-optimizer/package.json`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/bun.lock`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/tsconfig.json`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/vitest.config.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/quick-validate.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/run-eval.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/prompt-eval.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/convert-evals.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/compare-runs.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/run-loop.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/aggregate-benchmark.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/generate-report.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/improve-description.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/cli.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/paths.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/command-runner.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/artifact-readers.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/aggregate-benchmark.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/generate-report.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/run-loop.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/description-optimizer.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/paths.test.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/command-runner.test.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/artifact-readers.test.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/run-loop.test.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/aggregate-benchmark.test.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/generate-report.test.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/generate-review.test.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/description-optimizer.test.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/benchmark.json`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/grading.json`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/timing.json`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/results.jsonl`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/eval-viewer/generate-review.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/eval-viewer/viewer.html`

### Skill/docs references

- Modify: `plugins/agentv-dev/skills/agentv-optimizer/SKILL.md`
- Modify: `plugins/agentv-dev/skills/agentv-optimizer/references/migrating-from-skill-creator.md`
- Modify: `plugins/agentv-dev/skills/agentv-eval-builder/SKILL.md`
- Modify: `apps/web/src/content/docs/guides/skill-improvement-workflow.mdx`
- Modify: `apps/web/src/content/docs/guides/agent-skills-evals.mdx`

### Minimal core/CLI extension only if wrapper tests prove it is required

- Modify if needed: `apps/cli/src/commands/eval/commands/prompt/index.ts`
- Modify if needed: `apps/cli/src/commands/eval/commands/prompt/overview.ts`
- Modify if needed: `apps/cli/src/commands/eval/commands/prompt/input.ts`
- Modify if needed: `apps/cli/src/commands/eval/commands/prompt/judge.ts`
- Test if needed: `apps/cli/test/commands/eval/prompt-overview-mode.test.ts`

## Chunk 1: Bundle scaffolding, wrapper scripts, and reporting layer

### Task 1: Scaffold the Bun mini-project inside the skill

**Files:**
- Create: `plugins/agentv-dev/skills/agentv-optimizer/package.json`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/bun.lock`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/tsconfig.json`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/vitest.config.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/cli.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/paths.ts`
- Test: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/paths.test.ts`

- [ ] **Step 1: Create the minimal Bun test harness files**

Create only:
- `package.json`
- `tsconfig.json`
- `vitest.config.ts`

Do not create `src/cli.ts` or `src/paths.ts` yet.

- [ ] **Step 2: Write the failing path-resolution test**

```ts
import { describe, expect, it } from "vitest";
import { createAgentvCliInvocation } from "../cli";
import { resolveSkillRoot, resolveRepoRoot, resolveAgentvCommand } from "../paths";

describe("paths", () => {
  it("resolves skill root, repo root, and an agentv command without hardcoded relative cwd assumptions", () => {
    expect(resolveSkillRoot().endsWith("plugins/agentv-dev/skills/agentv-optimizer")).toBe(true);
    expect(resolveRepoRoot().endsWith("/agentv")).toBe(true);
    expect(resolveAgentvCommand()[0]).toBe("bun");
    expect(resolveAgentvCommand()[1]).toContain("apps/cli/src/cli.ts");
    expect(createAgentvCliInvocation(["eval", "examples/sample.eval.yaml"]).slice(-2)).toEqual([
      "eval",
      "examples/sample.eval.yaml",
    ]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun install
bun test src/__tests__/paths.test.ts
```

Expected: FAIL because the local Bun bundle now has dependencies, but `paths.ts` and `src/cli.ts` do not exist yet.

- [ ] **Step 4: Add the missing scaffold implementation**

Add `src/cli.ts` as a shared entry helper and `paths.ts` that resolves:
- skill root
- repository root
- absolute `agentv` source command

The shared CLI helper should append argv onto the resolved command tuple so wrappers can run from the skill directory:

```ts
export function resolveAgentvCommand(): string[] {
  return ["bun", `${resolveRepoRoot()}/apps/cli/src/cli.ts`];
}

export function createAgentvCliInvocation(args: string[]): string[] {
  return [...resolveAgentvCommand(), ...args];
}
```

- [ ] **Step 5: Re-run the test and verify `bun.lock`**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun test src/__tests__/paths.test.ts
test -f bun.lock
```

Expected: PASS, and `bun.lock` exists from the earlier install step.

- [ ] **Step 6: Commit the scaffold**

```bash
git add plugins/agentv-dev/skills/agentv-optimizer/package.json \
        plugins/agentv-dev/skills/agentv-optimizer/bun.lock \
        plugins/agentv-dev/skills/agentv-optimizer/tsconfig.json \
        plugins/agentv-dev/skills/agentv-optimizer/vitest.config.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/cli.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/paths.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/paths.test.ts
git commit -m $'feat: scaffold optimizer scripts bundle\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
```

### Task 2: Add provider-agnostic wrapper scripts for eval, prompt, convert, and validation

**Files:**
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/quick-validate.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/run-eval.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/prompt-eval.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/convert-evals.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/compare-runs.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/command-runner.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/artifact-readers.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/benchmark.json`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/grading.json`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/timing.json`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/results.jsonl`
- Test: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/command-runner.test.ts`
- Test: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/artifact-readers.test.ts`

- [ ] **Step 0: Capture real AgentV artifacts for fixtures**

Run the primary repo-local example `examples/features/basic/evals/dataset.eval.yaml`. If it does not emit the full fixture set, use the exact fallback `examples/features/agent-skills-evals/evals.json` instead. Then copy those emitted files into `src/__fixtures__/`.

```bash
cd /home/christso/projects/agentv/.worktrees/optimizer-scripts-layer
mkdir -p /tmp/agentv-optimizer-fixtures
# Primary source: examples/features/basic/evals/dataset.eval.yaml
# Fallback source: examples/features/agent-skills-evals/evals.json
bun apps/cli/src/cli.ts eval examples/features/basic/evals/dataset.eval.yaml \
  --artifacts /tmp/agentv-optimizer-fixtures
if [ ! -f /tmp/agentv-optimizer-fixtures/benchmark.json ] || \
   [ ! -f /tmp/agentv-optimizer-fixtures/grading.json ] || \
   [ ! -f /tmp/agentv-optimizer-fixtures/results.jsonl ] || \
   [ ! -f /tmp/agentv-optimizer-fixtures/timing.json ]; then
  rm -rf /tmp/agentv-optimizer-fixtures
  mkdir -p /tmp/agentv-optimizer-fixtures
  bun apps/cli/src/cli.ts eval examples/features/agent-skills-evals/evals.json \
    --artifacts /tmp/agentv-optimizer-fixtures
fi
cp /tmp/agentv-optimizer-fixtures/benchmark.json plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/benchmark.json
cp /tmp/agentv-optimizer-fixtures/grading.json plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/grading.json
cp /tmp/agentv-optimizer-fixtures/results.jsonl plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/results.jsonl
cp /tmp/agentv-optimizer-fixtures/timing.json plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/timing.json
```

Expected: fixture files come from actual AgentV output generated from repo-local examples, not invented schemas.

- [ ] **Step 1: Write separate failing tests for command assembly and artifact reading**

In `src/__tests__/command-runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRunEvalCommand, buildPromptEvalCommand, buildConvertCommand, buildCompareCommand } from "../command-runner";

describe("command runner", () => {
  it("builds an agentv eval command without embedding provider-specific logic", () => {
    expect(buildRunEvalCommand({
      evalPath: "evals.json",
      target: "copilot-haiku",
      artifactsDir: ".agentv/artifacts"
    })).toEqual([
      "bun",
      expect.stringContaining("apps/cli/src/cli.ts"),
      "eval",
      "evals.json",
      "--target",
      "copilot-haiku",
      "--artifacts",
      ".agentv/artifacts",
    ]);
  });

  it("builds prompt, convert, and compare commands as thin wrappers", () => {
    expect(buildPromptEvalCommand(["overview", "evals.json"])).toContain("prompt");
    expect(buildPromptEvalCommand(["input", "evals.json", "--test-id", "1"])).toContain("input");
    expect(buildPromptEvalCommand(["judge", "evals.json", "--test-id", "1"])).toContain("judge");
    expect(buildConvertCommand(["evals.json", "-o", "eval.yaml"])).toContain("convert");
    expect(buildCompareCommand(["before.jsonl", "after.jsonl"])).toContain("compare");
  });
});
```

In `src/__tests__/artifact-readers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readBenchmarkSummary } from "../artifact-readers";

describe("artifact readers", () => {
  it("reads aggregate benchmark data from AgentV artifacts", () => {
    expect(Object.keys(readBenchmarkSummary("src/__fixtures__/benchmark.json").targets).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun test src/__tests__/command-runner.test.ts src/__tests__/artifact-readers.test.ts
```

Expected: FAIL because the wrappers, fixtures, and readers do not exist yet.

- [ ] **Step 3: Implement thin wrappers over `agentv`**

Implement:
- `quick-validate.ts` → validates bundle structure, with a wrapper-stage mode for early checks and a full-bundle mode for final verification
- `run-eval.ts` → shells out to `agentv eval ...`
- `prompt-eval.ts` → shells out to `agentv prompt eval overview|input|judge ...`
- `convert-evals.ts` → shells out to `agentv convert ...`
- `compare-runs.ts` → shells out to `agentv compare ...`
- `command-runner.ts` → builds absolute commands and runs them via Bun subprocess APIs
- `artifact-readers.ts` → parses existing AgentV artifacts, not bespoke formats

Do **not** add provider-specific branching beyond forwarding `--target`, `--targets`, mode flags, subcommands, and artifact paths.

- [ ] **Step 4: Re-run focused tests**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun test src/__tests__/command-runner.test.ts src/__tests__/artifact-readers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Smoke-test each wrapper against repo-local examples**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun scripts/quick-validate.ts --scope wrappers
bun scripts/run-eval.ts --eval-path ../../../../examples/features/basic/evals/dataset.eval.yaml --dry-run
bun scripts/convert-evals.ts --eval-path ../../../../examples/features/agent-skills-evals/evals.json --out /tmp/agentv-converted.eval.yaml
bun scripts/prompt-eval.ts overview ../../../../examples/features/agent-skills-evals/evals.json
bun scripts/prompt-eval.ts input ../../../../examples/features/agent-skills-evals/evals.json --test-id 1
bun scripts/prompt-eval.ts judge ../../../../examples/features/agent-skills-evals/evals.json --test-id 1
bun scripts/compare-runs.ts src/__fixtures__/results.jsonl src/__fixtures__/results.jsonl
```

Expected:
- `quick-validate.ts --scope wrappers` exits 0 after validating only wrapper-stage prerequisites.
- `run-eval.ts ...dataset.eval.yaml --dry-run` exits 0 and prints the delegated `agentv eval ... --dry-run` command/request.
- `convert-evals.ts ... --out /tmp/agentv-converted.eval.yaml` exits 0 and writes `/tmp/agentv-converted.eval.yaml`.
- `prompt-eval.ts overview ...` exits 0 and prints the delegated `agentv prompt eval overview ...` command/request.
- `prompt-eval.ts input ... --test-id 1` exits 0 and prints the delegated `agentv prompt eval input ... --test-id 1` command/request.
- `prompt-eval.ts judge ... --test-id 1` exits 0 and prints the delegated `agentv prompt eval judge ... --test-id 1` command/request.
- `compare-runs.ts ...` exits 0 and prints or delegates the `agentv compare ...` invocation without reimplementing comparison semantics.

- [ ] **Step 6: Commit the wrappers**

```bash
git add plugins/agentv-dev/skills/agentv-optimizer/scripts/quick-validate.ts \
        plugins/agentv-dev/skills/agentv-optimizer/scripts/run-eval.ts \
        plugins/agentv-dev/skills/agentv-optimizer/scripts/prompt-eval.ts \
        plugins/agentv-dev/skills/agentv-optimizer/scripts/convert-evals.ts \
        plugins/agentv-dev/skills/agentv-optimizer/scripts/compare-runs.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/command-runner.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/artifact-readers.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/benchmark.json \
        plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/grading.json \
        plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/timing.json \
        plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/results.jsonl \
        plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/command-runner.test.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/artifact-readers.test.ts
git commit -m $'feat: add optimizer command wrapper scripts\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
```

- [ ] **Step 7: Push the first working branch state and open the draft PR**

```bash
git push -u origin feat/optimizer-scripts-layer
cat > /tmp/agentv-optimizer-scripts-pr.md <<'EOF'
## Summary
- add a Bun-based scripts layer and eval-viewer to `agentv-optimizer`
- keep execution, grading, and code-judge logic in AgentV core/CLI
- update docs/skill references for the new wrapper workflow
EOF
gh pr create --draft --title "feat: add optimizer scripts layer" --body-file /tmp/agentv-optimizer-scripts-pr.md
```

Expected: a draft PR is open as soon as the first working branch state is pushed.

### Task 3: Add the iterative loop, benchmark aggregation, and report/viewer layer

**Files:**
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/run-loop.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/aggregate-benchmark.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/generate-report.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/run-loop.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/aggregate-benchmark.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/generate-report.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/eval-viewer/generate-review.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/eval-viewer/viewer.html`
- Test: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/run-loop.test.ts`
- Test: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/aggregate-benchmark.test.ts`
- Test: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/generate-report.test.ts`
- Test: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/generate-review.test.ts`

- [ ] **Step 1: Write one failing test file per concern**

Create these focused tests:

- `src/__tests__/run-loop.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { planLoopCommands } from "../run-loop";

describe("run loop", () => {
  it("plans iteration commands without owning evaluator execution", () => {
    const plan = planLoopCommands({
      evalPath: "examples/features/basic/evals/dataset.eval.yaml",
      iterations: 2,
    });
    expect(plan.commands).toHaveLength(2);
    expect(plan.commands[0]).toEqual(
      expect.arrayContaining(["bun", expect.stringContaining("apps/cli/src/cli.ts"), "eval"]),
    );
  });
});
```

- `src/__tests__/aggregate-benchmark.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { aggregateBenchmarks } from "../aggregate-benchmark";

describe("aggregate benchmark", () => {
  it("aggregates pass-rate and timing metrics from benchmark artifacts", () => {
    const summary = aggregateBenchmarks({
      benchmarkPath: "src/__fixtures__/benchmark.json",
      timingPath: "src/__fixtures__/timing.json",
      resultsPath: "src/__fixtures__/results.jsonl",
    });
    expect(Object.keys(summary.targets).length).toBeGreaterThan(0);
  });
});
```

- `src/__tests__/generate-report.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { buildReviewModel } from "../generate-report";

describe("generate report", () => {
  it("builds a review model from existing AgentV artifacts", () => {
    const review = buildReviewModel({
      gradingPath: "src/__fixtures__/grading.json",
      benchmarkPath: "src/__fixtures__/benchmark.json",
      timingPath: "src/__fixtures__/timing.json",
      resultsPath: "src/__fixtures__/results.jsonl",
    });
    expect(review.sections.length).toBeGreaterThan(0);
    expect(review.testCases.length).toBeGreaterThan(0);
  });
});
```

- `src/__tests__/generate-review.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { renderReviewHtml } from "../../eval-viewer/generate-review";

describe("generate review", () => {
  it("renders review html from the report model", () => {
    const html = renderReviewHtml({
      title: "Optimizer Review",
      sections: [{ heading: "Summary", body: "Pass rate improved" }],
      testCases: [{ id: "case-1", status: "pass", summary: "baseline" }],
    });
    expect(html).toContain("Optimizer Review");
    expect(html).toContain("case-1");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun test src/__tests__/run-loop.test.ts src/__tests__/aggregate-benchmark.test.ts \
  src/__tests__/generate-report.test.ts src/__tests__/generate-review.test.ts
```

Expected: FAIL because the loop/report modules, viewer renderer, and fixtures do not exist yet.

- [ ] **Step 3: Implement the loop-planning helper and wrapper**

Implementation rules:
- `src/run-loop.ts`, `src/aggregate-benchmark.ts`, and `src/generate-report.ts` hold reusable logic only
- `scripts/run-loop.ts`, `scripts/aggregate-benchmark.ts`, and `scripts/generate-report.ts` are thin CLI entrypoints that parse args, call the matching `src/*` helper, and print results
- `run-loop.ts` composes existing wrapper scripts/commands into a loop; it does not own evaluator execution
- the helper returns explicit argv arrays that remain provider-agnostic and match the `command-runner.ts` convention
- the script executes or prints those plans without parsing evaluator internals

- [ ] **Step 4: Re-run the loop-planning test**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun test src/__tests__/run-loop.test.ts
```

Expected: PASS.

- [ ] **Step 5: Implement aggregation, report-model, and viewer helpers**

Implementation rules:
- `aggregate-benchmark.ts` reads `benchmark.json`, `timing.json`, and results JSONL
- the helper accepts explicit `benchmarkPath`, `timingPath`, and `resultsPath` inputs so results JSONL is always part of the aggregation contract
- `generate-report.ts` builds a presentation model from AgentV artifacts, including per-test rows from results JSONL
- `eval-viewer/generate-review.ts` renders a static review page from that model
- `eval-viewer/viewer.html` is a thin viewer shell for AgentV artifacts, not a second artifact format

- [ ] **Step 6: Re-run the aggregation/report/viewer tests**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun test src/__tests__/aggregate-benchmark.test.ts src/__tests__/generate-report.test.ts \
  src/__tests__/generate-review.test.ts
```

Expected: PASS.

- [ ] **Step 7: Smoke-test each planned file**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun scripts/aggregate-benchmark.ts --benchmark src/__fixtures__/benchmark.json --timing src/__fixtures__/timing.json
bun scripts/aggregate-benchmark.ts --benchmark src/__fixtures__/benchmark.json --timing src/__fixtures__/timing.json --results src/__fixtures__/results.jsonl
bun scripts/generate-report.ts --artifacts src/__fixtures__ --out /tmp/agentv-optimizer-review.html
bun scripts/run-loop.ts --eval-path ../../../../examples/features/basic/evals/dataset.eval.yaml --dry-run --iterations 1
bun eval-viewer/generate-review.ts --artifacts src/__fixtures__ --out /tmp/agentv-optimizer-viewer.html
test -f /tmp/agentv-optimizer-review.html
test -f /tmp/agentv-optimizer-viewer.html
grep -nE "<!DOCTYPE html|<html|<body" /tmp/agentv-optimizer-review.html /tmp/agentv-optimizer-viewer.html
grep -nE 'id="agentv-optimizer-viewer"' eval-viewer/viewer.html
grep -nE 'id="agentv-optimizer-viewer"' /tmp/agentv-optimizer-viewer.html
```

Expected: aggregation/report/loop/viewer files are each exercised at least once; aggregation explicitly consumes `results.jsonl`, generated HTML is structurally valid, and the viewer output preserves the `id="agentv-optimizer-viewer"` shell marker sourced from `viewer.html`.

- [ ] **Step 8: Commit the loop/report layer**

```bash
git add plugins/agentv-dev/skills/agentv-optimizer/scripts/run-loop.ts \
        plugins/agentv-dev/skills/agentv-optimizer/scripts/aggregate-benchmark.ts \
        plugins/agentv-dev/skills/agentv-optimizer/scripts/generate-report.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/run-loop.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/aggregate-benchmark.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/generate-report.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/timing.json \
        plugins/agentv-dev/skills/agentv-optimizer/src/__fixtures__/results.jsonl \
        plugins/agentv-dev/skills/agentv-optimizer/eval-viewer/generate-review.ts \
        plugins/agentv-dev/skills/agentv-optimizer/eval-viewer/viewer.html \
        plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/run-loop.test.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/aggregate-benchmark.test.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/generate-report.test.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/generate-review.test.ts
git commit -m $'feat: add optimizer reporting and loop scripts\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
```

- [ ] **Step 9: Push the latest commits to the existing draft PR**

```bash
git push
```

Expected: the existing draft PR is updated with the loop/report layer changes.

## Chunk 2: Description improvement, docs, and minimal core-gap closure

### Task 4: Add the description-improvement script without embedding provider logic

**Files:**
- Create: `plugins/agentv-dev/skills/agentv-optimizer/scripts/improve-description.ts`
- Create: `plugins/agentv-dev/skills/agentv-optimizer/src/description-optimizer.ts`
- Test: `plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/description-optimizer.test.ts`

- [ ] **Step 1: Write a failing test for description optimization planning**

```ts
import { describe, expect, it } from "vitest";
import { buildDescriptionImprovementPlan } from "../description-optimizer";

describe("description optimizer", () => {
  it("turns trigger observations into provider-agnostic follow-up prompts and diffs", () => {
    const plan = buildDescriptionImprovementPlan({
      triggerMisses: ["review this diff"],
      falseTriggers: ["write a test"],
    });
    expect(plan.nextExperiments.length).toBeGreaterThan(0);
    expect(plan.nextExperiments[0].prompt).toContain("review this diff");
    expect(plan.diffPreview).not.toContain("claude");
    expect(plan.diffPreview).not.toContain("copilot");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun test src/__tests__/description-optimizer.test.ts
```

Expected: FAIL because the script/module do not exist yet.

- [ ] **Step 3: Implement the script as orchestration glue**

The script should:
- consume observed trigger data / benchmark summaries
- propose candidate description changes and experiment prompts
- emit follow-up instructions compatible with any AgentV target or host harness

The script should **not** directly implement routing-model evaluation or hardcode Claude/Copilot/Codex-specific APIs.

- [ ] **Step 4: Re-run the test**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun test src/__tests__/description-optimizer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Smoke-test the description script**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun scripts/improve-description.ts --benchmark src/__fixtures__/benchmark.json --grading src/__fixtures__/grading.json
```

Expected: prints provider-agnostic description-improvement recommendations based on artifacts.

- [ ] **Step 6: Commit the description script**

```bash
git add plugins/agentv-dev/skills/agentv-optimizer/scripts/improve-description.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/description-optimizer.ts \
        plugins/agentv-dev/skills/agentv-optimizer/src/__tests__/description-optimizer.test.ts
git commit -m $'feat: add optimizer description improvement script\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
```

### Task 5: Update skill/docs to point at the new scripts layer

**Files:**
- Modify: `plugins/agentv-dev/skills/agentv-optimizer/SKILL.md`
- Modify: `plugins/agentv-dev/skills/agentv-optimizer/references/migrating-from-skill-creator.md`
- Modify: `plugins/agentv-dev/skills/agentv-eval-builder/SKILL.md`
- Modify: `apps/web/src/content/docs/guides/skill-improvement-workflow.mdx`
- Modify: `apps/web/src/content/docs/guides/agent-skills-evals.mdx`

- [ ] **Step 1: Use this checklist as the acceptance gate for the doc edits**

Confirm during Steps 2-3 that the edited docs satisfy every item in this checklist:

```md
- `agentv-optimizer` documents the bundled scripts and when to use each one
- docs use current `agentv prompt eval overview/input/judge` syntax
- migration docs explain that scripts wrap AgentV artifacts rather than replacing them
- docs explain that scripts call `agentv` wherever possible
```

- [ ] **Step 2: Update the skill and docs**

Make the docs explain:
- how to bootstrap the Bun bundle
- which script maps to which part of the workflow
- that scripts call `agentv` wherever possible
- that code-judge execution remains in AgentV core

- [ ] **Step 3: Verify the stale references are gone**

Run:
```bash
cd /home/christso/projects/agentv/.worktrees/optimizer-scripts-layer
if grep -nE "agentv eval run|agentv prompt eval evals\\.json" \
  apps/web/src/content/docs/guides/skill-improvement-workflow.mdx \
  apps/web/src/content/docs/guides/agent-skills-evals.mdx \
  plugins/agentv-dev/skills/agentv-optimizer/SKILL.md \
  plugins/agentv-dev/skills/agentv-optimizer/references/migrating-from-skill-creator.md \
  plugins/agentv-dev/skills/agentv-eval-builder/SKILL.md; then
  exit 1
fi
grep -nE "quick-validate|run-eval|prompt-eval|convert-evals|compare-runs|run-loop|aggregate-benchmark|generate-report|improve-description" \
  plugins/agentv-dev/skills/agentv-optimizer/SKILL.md \
  plugins/agentv-dev/skills/agentv-optimizer/references/migrating-from-skill-creator.md \
  plugins/agentv-dev/skills/agentv-eval-builder/SKILL.md \
  apps/web/src/content/docs/guides/skill-improvement-workflow.mdx \
  apps/web/src/content/docs/guides/agent-skills-evals.mdx
```

Expected: no stale matches remain, and the new scripts/workflow names are present in the updated docs/skill references.

- [ ] **Step 4: Commit the docs updates**

```bash
git add plugins/agentv-dev/skills/agentv-optimizer/SKILL.md \
        plugins/agentv-dev/skills/agentv-optimizer/references/migrating-from-skill-creator.md \
        plugins/agentv-dev/skills/agentv-eval-builder/SKILL.md \
        apps/web/src/content/docs/guides/skill-improvement-workflow.mdx \
        apps/web/src/content/docs/guides/agent-skills-evals.mdx
git commit -m $'docs: add optimizer scripts layer guidance\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
```

### Task 6: Add a minimal CLI/core primitive only if wrapper tests prove a real gap

**Files:**
- Modify if needed: exact file(s) identified in Step 1 under `apps/cli/src/commands/eval/` or the narrowest adjacent eval support module
- Test if needed: exact failing regression test path identified in Step 1 under `apps/cli/test/commands/eval/`

- [ ] **Step 1: Identify the missing primitive with a failing integration test**

Only do this task if one of Tasks 2–4 reveals that a script must parse unstable human text or cannot get a stable AgentV primitive.

Objective decision gate:
- proceed with this task only if at least one wrapper test or smoke test fails because it must regex-match human-oriented CLI prose, cannot request a required prompt-eval subcommand, or cannot obtain a stable artifact/path surface from existing AgentV outputs
- otherwise record the no-gap result and skip the remaining steps

In this step, choose the exact CLI/core file(s) and one exact regression test path that match the discovered missing primitive. Write the failing regression test first and record the chosen path(s) in your shell:

```bash
# Example if the missing primitive is in prompt overview output:
TARGET_TEST=apps/cli/test/commands/eval/prompt-overview-mode.test.ts
TARGET_FILES="apps/cli/src/commands/eval/commands/prompt/overview.ts"

# Example if the missing primitive is in prompt input output:
# TARGET_TEST=apps/cli/test/commands/eval/prompt-input-mode.test.ts
# TARGET_FILES="apps/cli/src/commands/eval/commands/prompt/input.ts"
```

If no gap is found, write `No CLI/core primitive gap found; scripts layer can rely on existing AgentV surfaces.` to `/tmp/agentv-optimizer-core-gap.txt`, mark this entire task N/A, and skip Steps 2-5.

N/A tracking rule:
- if no gap is found, check off Step 1, keep `/tmp/agentv-optimizer-core-gap.txt` as the execution artifact for the decision, and leave Steps 2-5 unchecked

- [ ] **Step 2: If a gap was found, run the focused test and verify it**

Run:
```bash
cd /home/christso/projects/agentv/.worktrees/optimizer-scripts-layer
bun test "$TARGET_TEST"
```

Expected: FAIL with a clearly missing stable primitive.

- [ ] **Step 3: If a gap was found, add the smallest aligned extension**

Allowed examples:
- a new machine-stable output mode
- a missing prompt subcommand
- a small artifact/path exposure improvement

Not allowed:
- moving orchestration loops into the CLI
- moving code-judge execution logic into the scripts layer
- embedding provider-specific harness behavior into core

- [ ] **Step 4: If a gap was found, re-run the focused test**

Run:
```bash
cd /home/christso/projects/agentv/.worktrees/optimizer-scripts-layer
bun test "$TARGET_TEST"
```

Expected: PASS.

- [ ] **Step 5: If a gap was found, commit the minimal extension**

```bash
git add $TARGET_FILES "$TARGET_TEST"
git commit -m $'feat: expose stable primitive for optimizer scripts\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
```

### Task 7: End-to-end validation and PR handoff

**Files:**
- Modify: `apps/web/src/content/docs/guides/skill-improvement-workflow.mdx` (if validation learnings require doc tweaks)
- Modify: `plugins/agentv-dev/skills/agentv-optimizer/SKILL.md` (if validation learnings require guidance tweaks)

- [ ] **Step 1: Run focused script tests**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun test
```

Expected: PASS for the new bundle test suite.

- [ ] **Step 2: Run repository validation**

Run:
```bash
cd /home/christso/projects/agentv/.worktrees/optimizer-scripts-layer
bun run build
bun run typecheck
bun run lint
bun run test
```

Expected: all commands PASS.

- [ ] **Step 3: Run post-implementation E2E checks**

Run:
```bash
cd plugins/agentv-dev/skills/agentv-optimizer
bun scripts/quick-validate.ts
bun scripts/run-eval.ts --eval-path ../../../../examples/features/basic/evals/dataset.eval.yaml --dry-run
bun scripts/convert-evals.ts --eval-path ../../../../examples/features/agent-skills-evals/evals.json --out /tmp/agentv-agent-skills.eval.yaml
bun scripts/run-eval.ts --eval-path /tmp/agentv-agent-skills.eval.yaml --dry-run
bun scripts/prompt-eval.ts input ../../../../examples/features/agent-skills-evals/evals.json --test-id 1
bun scripts/prompt-eval.ts judge ../../../../examples/features/agent-skills-evals/evals.json --test-id 1
```

Expected:
- `bun scripts/quick-validate.ts` exits 0 after confirming the full bundle structure is present.
- `bun scripts/run-eval.ts ...dataset.eval.yaml --dry-run` exits 0 and prints the delegated `agentv eval` command for the native YAML flow.
- `bun scripts/convert-evals.ts ...evals.json --out /tmp/agentv-agent-skills.eval.yaml` exits 0 and writes the converted YAML file.
- `bun scripts/run-eval.ts --eval-path /tmp/agentv-agent-skills.eval.yaml --dry-run` exits 0 and proves the converted file can be delegated back into `agentv eval`.
- `bun scripts/prompt-eval.ts input ... --test-id 1` exits 0 and prints the delegated `agentv prompt eval input ... --test-id 1` request for a concrete test case.
- `bun scripts/prompt-eval.ts judge ... --test-id 1` exits 0 and prints the delegated `agentv prompt eval judge ... --test-id 1` request for that same concrete test case.

- [ ] **Step 4: Push the latest commits to the existing draft PR and rely on pre-push hooks**

```bash
git push
```

Expected: the existing draft PR updates and its checks are green or running.

- [ ] **Step 5: Wait for PR checks to pass**

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)
gh pr checks "$PR_NUMBER" --watch
```

Expected: required checks finish successfully before the PR is marked ready.

- [ ] **Step 6: Mark ready and enable auto-merge**

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)
gh pr ready "$PR_NUMBER"
gh pr merge "$PR_NUMBER" --auto --squash
```

Expected: PR is ready and auto-merge is enabled only after checks pass.
