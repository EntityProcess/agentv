# `--threshold` Flag Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `--threshold` CLI flag and `execution.threshold` YAML field to `agentv eval` that exits 1 when mean quality score falls below the threshold.

**Architecture:** The threshold value flows from CLI flag or YAML config through the existing options pipeline. After all tests complete, the summary is checked against the threshold. JUnit writer also uses the threshold for per-test pass/fail.

**Tech Stack:** TypeScript, cmd-ts (CLI parsing), Zod (schema validation), Vitest (testing)

---

### Task 1: Add `extractThreshold` to core config-loader

**Files:**
- Modify: `packages/core/src/evaluation/loaders/config-loader.ts:287` (after `extractTotalBudgetUsd`)
- Test: `packages/core/test/evaluation/loaders/config-loader.test.ts`

**Step 1: Write the failing tests**

Add to `packages/core/test/evaluation/loaders/config-loader.test.ts` after the `extractFailOnError` describe block:

```typescript
describe('extractThreshold', () => {
  it('returns undefined when no execution block', () => {
    const suite: JsonObject = { tests: [] };
    expect(extractThreshold(suite)).toBeUndefined();
  });

  it('returns undefined when threshold not set', () => {
    const suite: JsonObject = { execution: { target: 'default' } };
    expect(extractThreshold(suite)).toBeUndefined();
  });

  it('parses valid threshold', () => {
    const suite: JsonObject = { execution: { threshold: 0.8 } };
    expect(extractThreshold(suite)).toBe(0.8);
  });

  it('accepts 0 as threshold', () => {
    const suite: JsonObject = { execution: { threshold: 0 } };
    expect(extractThreshold(suite)).toBe(0);
  });

  it('accepts 1 as threshold', () => {
    const suite: JsonObject = { execution: { threshold: 1 } };
    expect(extractThreshold(suite)).toBe(1);
  });

  it('returns undefined for negative threshold', () => {
    const suite: JsonObject = { execution: { threshold: -0.1 } };
    expect(extractThreshold(suite)).toBeUndefined();
  });

  it('returns undefined for threshold > 1', () => {
    const suite: JsonObject = { execution: { threshold: 1.5 } };
    expect(extractThreshold(suite)).toBeUndefined();
  });

  it('returns undefined for non-number threshold', () => {
    const suite: JsonObject = { execution: { threshold: 'high' } };
    expect(extractThreshold(suite)).toBeUndefined();
  });
});
```

Also add `extractThreshold` to the import at the top of the test file.

**Step 2: Run tests to verify they fail**

Run: `bun test packages/core/test/evaluation/loaders/config-loader.test.ts`
Expected: FAIL — `extractThreshold` not found

**Step 3: Implement `extractThreshold`**

Add to `packages/core/src/evaluation/loaders/config-loader.ts` after `extractTotalBudgetUsd` (after line ~308):

```typescript
/**
 * Extract `execution.threshold` from parsed eval suite.
 * Accepts a number in [0, 1] range.
 * Returns undefined when not specified.
 */
export function extractThreshold(suite: JsonObject): number | undefined {
  const execution = suite.execution;
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
    return undefined;
  }

  const executionObj = execution as Record<string, unknown>;
  const raw = executionObj.threshold;

  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw === 'number' && raw >= 0 && raw <= 1) {
    return raw;
  }

  logWarning(
    `Invalid execution.threshold: ${raw}. Must be a number between 0 and 1. Ignoring.`,
  );
  return undefined;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test packages/core/test/evaluation/loaders/config-loader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/loaders/config-loader.ts packages/core/test/evaluation/loaders/config-loader.test.ts
git commit -m "feat(core): add extractThreshold for execution.threshold YAML field (#698)"
```

---

### Task 2: Wire `extractThreshold` through YAML parser and schema

**Files:**
- Modify: `packages/core/src/evaluation/yaml-parser.ts:12` (imports), `:58` (re-exports), `:204` (loadTestSuite)
- Modify: `packages/core/src/evaluation/yaml-parser.ts:168` (EvalSuiteResult type)
- Modify: `packages/core/src/evaluation/validation/eval-file.schema.ts:317` (ExecutionSchema)

**Step 1: Add `threshold` to ExecutionSchema in eval-file.schema.ts**

In `packages/core/src/evaluation/validation/eval-file.schema.ts`, add to the `ExecutionSchema` object (after `failOnError` at line 330):

```typescript
  threshold: z.number().min(0).max(1).optional(),
```

**Step 2: Add to EvalSuiteResult type in yaml-parser.ts**

In `packages/core/src/evaluation/yaml-parser.ts`, add to the `EvalSuiteResult` type (after `failOnError` at line 182):

```typescript
  /** Suite-level quality threshold (0-1) — suite fails if mean score is below */
  readonly threshold?: number;
```

**Step 3: Import and re-export `extractThreshold` in yaml-parser.ts**

Add `extractThreshold` to the import from `./loaders/config-loader.js` (line 12 area) and the re-export block (line 58 area).

**Step 4: Use in `loadTestSuite`**

In the `loadTestSuite` function (around line 203), extract and return threshold:

```typescript
  const threshold = extractThreshold(parsed);
  return {
    tests,
    trials: extractTrialsConfig(parsed),
    targets: extractTargetsFromSuite(parsed),
    workers: extractWorkersFromSuite(parsed),
    cacheConfig: extractCacheConfig(parsed),
    totalBudgetUsd: extractTotalBudgetUsd(parsed),
    ...(metadata !== undefined && { metadata }),
    ...(failOnError !== undefined && { failOnError }),
    ...(threshold !== undefined && { threshold }),
  };
```

**Step 5: Regenerate the JSON schema**

Run: `bun run generate:schema`

**Step 6: Run core tests**

Run: `bun test packages/core/test/evaluation/loaders/config-loader.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/core/src/evaluation/validation/eval-file.schema.ts packages/core/src/evaluation/yaml-parser.ts
git commit -m "feat(core): wire extractThreshold through YAML parser and schema (#698)"
```

---

### Task 3: Add `--threshold` CLI flag and pass through to run-eval

**Files:**
- Modify: `apps/cli/src/commands/eval/commands/run.ts` (add CLI flag)
- Modify: `apps/cli/src/commands/eval/run-eval.ts` (NormalizedOptions, normalizeOptions, handler return)

**Step 1: Add CLI flag to run.ts**

In `apps/cli/src/commands/eval/commands/run.ts`, add after the `model` option (around line 171):

```typescript
    threshold: option({
      type: optional(number),
      long: 'threshold',
      description: 'Suite-level quality gate: exit 1 if mean score falls below this value (0-1)',
    }),
```

And add `threshold: args.threshold` to the `rawOptions` object in the handler (around line 219).

**Step 2: Add to NormalizedOptions in run-eval.ts**

In `apps/cli/src/commands/eval/run-eval.ts`, add to the `NormalizedOptions` interface:

```typescript
  readonly threshold?: number;
```

**Step 3: Add to normalizeOptions**

In the `normalizeOptions` function, add threshold resolution (CLI > YAML):

```typescript
  // Resolve threshold: CLI --threshold > YAML execution.threshold
  const cliThreshold = normalizeOptionalNumber(rawOptions.threshold);
```

And in the return statement:

```typescript
    threshold: cliThreshold,
```

**Step 4: Wire YAML threshold into normalized options**

In `runEvalCommand`, after `prepareEvalFile` returns, merge the YAML threshold if CLI didn't set one. In the loop over eval files (around the `prepareEvalFile` call), capture `suite.threshold` and pass it through.

The cleanest approach: read the YAML threshold in `prepareEvalFile` and return it alongside the other fields. Then in the main `runEvalCommand`, resolve CLI vs YAML threshold.

Add `threshold` to the `prepareEvalFile` return type (alongside `failOnError`):

```typescript
  readonly threshold?: number;
```

And in `prepareEvalFile`, add after `failOnError: suite.failOnError`:

```typescript
    threshold: suite.threshold,
```

**Step 5: Commit**

```bash
git add apps/cli/src/commands/eval/commands/run.ts apps/cli/src/commands/eval/run-eval.ts
git commit -m "feat(cli): add --threshold flag and wire through options pipeline (#698)"
```

---

### Task 4: Add threshold check and summary output after eval completes

**Files:**
- Modify: `apps/cli/src/commands/eval/run-eval.ts` (after summary calculation ~line 1152)
- Modify: `apps/cli/src/commands/eval/statistics.ts` (add `formatThresholdSummary`)
- Test: `apps/cli/test/commands/eval/threshold.test.ts` (new)

**Step 1: Write failing tests**

Create `apps/cli/test/commands/eval/threshold.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';

import type { EvaluationResult } from '@agentv/core';

import { formatThresholdSummary } from '../../../src/commands/eval/statistics.js';

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    timestamp: '2024-01-01T00:00:00Z',
    testId: 'test-1',
    score: 1.0,
    assertions: [{ text: 'criterion-1', passed: true }],
    output: [{ role: 'assistant' as const, content: 'answer' }],
    target: 'default',
    ...overrides,
  };
}

describe('formatThresholdSummary', () => {
  it('returns PASS when mean score meets threshold', () => {
    const result = formatThresholdSummary(0.85, 0.6);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('0.85');
    expect(result.message).toContain('0.60');
    expect(result.message).toContain('PASS');
  });

  it('returns FAIL when mean score is below threshold', () => {
    const result = formatThresholdSummary(0.53, 0.6);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('0.53');
    expect(result.message).toContain('0.60');
    expect(result.message).toContain('FAIL');
  });

  it('returns PASS when mean score exactly equals threshold', () => {
    const result = formatThresholdSummary(0.6, 0.6);
    expect(result.passed).toBe(true);
  });

  it('returns PASS for threshold 0 with any score', () => {
    const result = formatThresholdSummary(0, 0);
    expect(result.passed).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test apps/cli/test/commands/eval/threshold.test.ts`
Expected: FAIL — `formatThresholdSummary` not found

**Step 3: Implement `formatThresholdSummary` in statistics.ts**

Add to `apps/cli/src/commands/eval/statistics.ts`:

```typescript
/**
 * Format a threshold check summary line.
 * Returns whether the threshold was met and the formatted message.
 */
export function formatThresholdSummary(
  meanScore: number,
  threshold: number,
): { passed: boolean; message: string } {
  const passed = meanScore >= threshold;
  const verdict = passed ? 'PASS' : 'FAIL';
  const message = `Suite score: ${meanScore.toFixed(2)} (threshold: ${threshold.toFixed(2)}) — ${verdict}`;
  return { passed, message };
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test apps/cli/test/commands/eval/threshold.test.ts`
Expected: PASS

**Step 5: Wire the threshold check into run-eval.ts**

In `apps/cli/src/commands/eval/run-eval.ts`, after the summary is printed (around line 1153), add:

```typescript
    // Threshold quality gate check
    const resolvedThreshold = options.threshold ?? yamlThreshold;
    if (resolvedThreshold !== undefined) {
      const { formatThresholdSummary } = await import('./statistics.js');
      const thresholdResult = formatThresholdSummary(summary.mean, resolvedThreshold);
      console.log(`\n${thresholdResult.message}`);
      if (!thresholdResult.passed) {
        process.exitCode = 1;
      }
    }
```

Note: `yamlThreshold` needs to be captured from the `prepareEvalFile` results. If multiple eval files are run, use the first non-undefined threshold (or the CLI value).

Import `formatThresholdSummary` statically at the top (preferred over dynamic import since it's in the same package):

```typescript
import {
  calculateEvaluationSummary,
  formatEvaluationSummary,
  formatMatrixSummary,
  formatThresholdSummary,
} from './statistics.js';
```

**Step 6: Commit**

```bash
git add apps/cli/src/commands/eval/statistics.ts apps/cli/src/commands/eval/run-eval.ts apps/cli/test/commands/eval/threshold.test.ts
git commit -m "feat(cli): add threshold check with summary output after eval (#698)"
```

---

### Task 5: JUnit writer uses threshold for per-test pass/fail

**Files:**
- Modify: `apps/cli/src/commands/eval/junit-writer.ts`
- Modify: `apps/cli/test/commands/eval/output-writers.test.ts` (add tests)

**Step 1: Write failing tests**

Add to `apps/cli/test/commands/eval/output-writers.test.ts` in the JUnit describe block:

```typescript
  it('uses custom threshold for pass/fail when provided', async () => {
    const filePath = path.join(testDir, `junit-threshold-${Date.now()}.xml`);
    const writer = await JunitWriter.open(filePath, { threshold: 0.8 });

    await writer.append(makeResult({ testId: 'high', score: 0.9 }));
    await writer.append(makeResult({ testId: 'mid', score: 0.6 }));
    await writer.close();

    const xml = await readFile(filePath, 'utf8');
    expect(xml).not.toContain('<failure message="score=0.900"');
    expect(xml).toContain('<failure message="score=0.600"');
  });

  it('defaults to 0.5 threshold when none provided', async () => {
    const filePath = path.join(testDir, `junit-default-${Date.now()}.xml`);
    const writer = await JunitWriter.open(filePath);

    await writer.append(makeResult({ testId: 'pass', score: 0.6 }));
    await writer.append(makeResult({ testId: 'fail', score: 0.3 }));
    await writer.close();

    const xml = await readFile(filePath, 'utf8');
    expect(xml).not.toContain('<failure message="score=0.600"');
    expect(xml).toContain('<failure message="score=0.300"');
  });
```

**Step 2: Run tests to verify they fail**

Run: `bun test apps/cli/test/commands/eval/output-writers.test.ts`
Expected: FAIL — `JunitWriter.open` doesn't accept options

**Step 3: Implement threshold support in JunitWriter**

Modify `apps/cli/src/commands/eval/junit-writer.ts`:

```typescript
export interface JunitWriterOptions {
  readonly threshold?: number;
}

export class JunitWriter {
  private readonly filePath: string;
  private readonly results: EvaluationResult[] = [];
  private readonly threshold: number;
  private closed = false;

  private constructor(filePath: string, options?: JunitWriterOptions) {
    this.filePath = filePath;
    this.threshold = options?.threshold ?? 0.5;
  }

  static async open(filePath: string, options?: JunitWriterOptions): Promise<JunitWriter> {
    await mkdir(path.dirname(filePath), { recursive: true });
    return new JunitWriter(filePath, options);
  }
```

Then replace all `r.score < 0.5` with `r.score < this.threshold` in the `close()` method.

**Step 4: Pass threshold to JunitWriter in output-writer.ts**

In `apps/cli/src/commands/eval/output-writer.ts`, where JunitWriter is created, pass the threshold. Check how output writers are created and thread the threshold through.

**Step 5: Run tests to verify they pass**

Run: `bun test apps/cli/test/commands/eval/output-writers.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/cli/src/commands/eval/junit-writer.ts apps/cli/src/commands/eval/output-writer.ts apps/cli/test/commands/eval/output-writers.test.ts
git commit -m "feat(cli): JUnit writer uses --threshold for per-test pass/fail (#698)"
```

---

### Task 6: Add `threshold` to Zod schema and regenerate JSON schema

**Files:**
- Modify: `packages/core/src/evaluation/validation/eval-file.schema.ts` (already done in Task 2)
- Run: `bun run generate:schema`

**Step 1: Verify threshold is in ExecutionSchema**

Read `packages/core/src/evaluation/validation/eval-file.schema.ts` and confirm `threshold` was added in Task 2.

**Step 2: Regenerate JSON schema**

Run: `bun run generate:schema`

**Step 3: Run validate:examples to check existing YAML files still pass**

Run: `bun run validate:examples`
Expected: PASS (threshold is optional, so existing files are unaffected)

**Step 4: Commit if schema file changed**

```bash
git add packages/core/
git commit -m "chore: regenerate eval-schema.json with threshold field (#698)"
```

---

### Task 7: Run full test suite and verify

**Step 1: Run all tests**

Run: `bun run test`
Expected: PASS (except any pre-existing known failures)

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Run lint**

Run: `bun run lint`
Expected: PASS

**Step 4: Run build**

Run: `bun run build`
Expected: PASS

---

### Task 8: Manual red/green UAT

**Step 1: Red — verify no threshold behavior on main**

Run an eval without --threshold:

```bash
bun apps/cli/src/cli.ts eval examples/features/rubric/evals/dataset.eval.yaml --test-id summary-1
```

Confirm: no "Suite score" line in output, exit code is 0.

**Step 2: Green — verify --threshold works**

Run with a threshold that should PASS:

```bash
bun apps/cli/src/cli.ts eval examples/features/rubric/evals/dataset.eval.yaml --test-id summary-1 --threshold 0.3
```

Confirm: "Suite score: X.XX (threshold: 0.30) — PASS" printed, exit code 0.

Run with a threshold that should FAIL:

```bash
bun apps/cli/src/cli.ts eval examples/features/rubric/evals/dataset.eval.yaml --test-id summary-1 --threshold 0.99
```

Confirm: "Suite score: X.XX (threshold: 0.99) — FAIL" printed, exit code 1.

**Step 3: Verify JUnit output uses threshold**

```bash
bun apps/cli/src/cli.ts eval examples/features/rubric/evals/dataset.eval.yaml --test-id summary-1 --threshold 0.9 -o /tmp/test-threshold.xml
```

Inspect the XML: tests with score < 0.9 should have `<failure>` elements.
