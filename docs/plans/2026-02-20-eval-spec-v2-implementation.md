# Eval Spec v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the eval spec v2 design — metadata block, unified `assert` field, deterministic assertion types, required gates, and `tests` as string path.

**Architecture:** Additive changes to the YAML parser, evaluator parser, type definitions, validator, and scoring orchestrator. All existing fields remain supported as backward-compatible aliases. New `assert` field at test level is parsed alongside `execution.evaluators` and `rubrics`, all converging to the same internal `EvaluatorConfig[]` pipeline.

**Tech Stack:** TypeScript, Zod (for metadata validation), Vitest (testing), Bun (runtime)

---

### Task 1: Add Metadata Types and Zod Schema

**Files:**
- Create: `packages/core/src/evaluation/metadata.ts`
- Test: `packages/core/test/evaluation/metadata.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/test/evaluation/metadata.test.ts
import { describe, expect, it } from 'vitest';
import { parseMetadata } from '../src/evaluation/metadata.js';

describe('parseMetadata', () => {
  it('parses valid metadata with all fields', () => {
    const result = parseMetadata({
      name: 'export-screening',
      description: 'Evaluates export screening accuracy',
      version: '1.0',
      author: 'acme-compliance',
      tags: ['compliance', 'agents'],
      license: 'Apache-2.0',
      requires: { agentv: '>=0.6.0' },
    });
    expect(result).toEqual({
      name: 'export-screening',
      description: 'Evaluates export screening accuracy',
      version: '1.0',
      author: 'acme-compliance',
      tags: ['compliance', 'agents'],
      license: 'Apache-2.0',
      requires: { agentv: '>=0.6.0' },
    });
  });

  it('returns undefined when no metadata fields present', () => {
    const result = parseMetadata({ tests: [] });
    expect(result).toBeUndefined();
  });

  it('requires description when name is present', () => {
    expect(() => parseMetadata({ name: 'test-eval' })).toThrow();
  });

  it('requires name when description is present', () => {
    expect(() => parseMetadata({ description: 'A test eval' })).toThrow();
  });

  it('validates name format (lowercase + hyphens only)', () => {
    expect(() =>
      parseMetadata({ name: 'Invalid Name!', description: 'test' }),
    ).toThrow();
  });

  it('parses minimal metadata (name + description only)', () => {
    const result = parseMetadata({
      name: 'my-eval',
      description: 'A simple eval',
    });
    expect(result).toEqual({
      name: 'my-eval',
      description: 'A simple eval',
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/evaluation/metadata.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/evaluation/metadata.ts
import { z } from 'zod';
import type { JsonObject } from './types.js';

const MetadataSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  description: z.string().min(1).max(1024),
  version: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  license: z.string().optional(),
  requires: z
    .object({
      agentv: z.string().optional(),
    })
    .optional(),
});

export type EvalMetadata = z.infer<typeof MetadataSchema>;

export function parseMetadata(suite: JsonObject): EvalMetadata | undefined {
  const hasName = typeof suite.name === 'string';
  const hasDescription = typeof suite.description === 'string';

  if (!hasName && !hasDescription) {
    return undefined;
  }

  return MetadataSchema.parse({
    name: suite.name,
    description: suite.description,
    version: suite.version,
    author: suite.author,
    tags: suite.tags,
    license: suite.license,
    requires: suite.requires,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/test/evaluation/metadata.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/metadata.ts packages/core/test/evaluation/metadata.test.ts
git commit -m "feat(core): add eval metadata schema and parser"
```

---

### Task 2: Wire Metadata Into YAML Parser

**Files:**
- Modify: `packages/core/src/evaluation/yaml-parser.ts:60-70` (RawTestSuite type)
- Modify: `packages/core/src/evaluation/yaml-parser.ts:181-406` (loadTestsFromYaml)
- Modify: `packages/core/src/evaluation/types.ts:464-485` (EvalTest — add metadata to suite return)
- Test: `packages/core/test/evaluation/loaders/evaluator-parser.test.ts` (add metadata tests)

**Step 1: Write the failing test**

Add a test that loads a YAML file with metadata fields and verifies they're parsed. Use the existing test patterns in `evaluator-parser.test.ts` or create a new test for the yaml-parser directly.

```typescript
it('parses suite-level metadata from YAML', async () => {
  // Write a temp YAML file with metadata fields
  // Load via loadTestsFromYaml
  // Verify parsed.name, parsed.description, etc. are present
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/evaluation/...`
Expected: FAIL — metadata fields not extracted

**Step 3: Add metadata fields to RawTestSuite type**

In `packages/core/src/evaluation/yaml-parser.ts:60-70`, add metadata fields:

```typescript
type RawTestSuite = JsonObject & {
  readonly tests?: JsonValue;
  readonly eval_cases?: JsonValue;
  readonly evalcases?: JsonValue;
  readonly target?: JsonValue;
  readonly execution?: JsonValue;
  readonly dataset?: JsonValue;
  readonly workspace?: JsonValue;
  // New metadata fields
  readonly name?: JsonValue;
  readonly description?: JsonValue;
  readonly version?: JsonValue;
  readonly author?: JsonValue;
  readonly tags?: JsonValue;
  readonly license?: JsonValue;
  readonly requires?: JsonValue;
  readonly assert?: JsonValue;
};
```

**Step 4: Parse metadata in loadTestsFromYaml**

After line 204 (`const suite = parsed as RawTestSuite;`), add:

```typescript
import { parseMetadata } from './metadata.js';
// ...
const metadata = parseMetadata(suite);
```

Return metadata in the result object (extend the return type to include it).

**Step 5: Run test to verify it passes**

Run: `bun test packages/core/test/evaluation/...`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/core/src/evaluation/yaml-parser.ts packages/core/src/evaluation/types.ts
git commit -m "feat(core): wire metadata parsing into YAML loader"
```

---

### Task 3: Add Deterministic Assertion Evaluators

**Files:**
- Create: `packages/core/src/evaluation/evaluators/assertions.ts`
- Test: `packages/core/test/evaluation/evaluators/assertions.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/core/test/evaluation/evaluators/assertions.test.ts
import { describe, expect, it } from 'vitest';
import {
  runContainsAssertion,
  runRegexAssertion,
  runIsJsonAssertion,
  runEqualsAssertion,
} from '../../src/evaluation/evaluators/assertions.js';

describe('deterministic assertions', () => {
  describe('contains', () => {
    it('scores 1 when output contains value', () => {
      const result = runContainsAssertion('Hello world', 'world');
      expect(result.score).toBe(1);
      expect(result.hits).toEqual(['Output contains "world"']);
    });

    it('scores 0 when output does not contain value', () => {
      const result = runContainsAssertion('Hello world', 'foo');
      expect(result.score).toBe(0);
      expect(result.misses).toEqual(['Output does not contain "foo"']);
    });
  });

  describe('regex', () => {
    it('scores 1 when output matches pattern', () => {
      const result = runRegexAssertion('risk: High', 'risk: (High|Critical)');
      expect(result.score).toBe(1);
    });

    it('scores 0 when output does not match pattern', () => {
      const result = runRegexAssertion('risk: Low', 'risk: (High|Critical)');
      expect(result.score).toBe(0);
    });
  });

  describe('is_json', () => {
    it('scores 1 for valid JSON', () => {
      const result = runIsJsonAssertion('{"key": "value"}');
      expect(result.score).toBe(1);
    });

    it('scores 0 for invalid JSON', () => {
      const result = runIsJsonAssertion('not json');
      expect(result.score).toBe(0);
    });
  });

  describe('equals', () => {
    it('scores 1 for exact match', () => {
      const result = runEqualsAssertion('DENIED', 'DENIED');
      expect(result.score).toBe(1);
    });

    it('scores 0 for non-match', () => {
      const result = runEqualsAssertion('DENIED', 'APPROVED');
      expect(result.score).toBe(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/evaluation/evaluators/assertions.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/evaluation/evaluators/assertions.ts
type AssertionResult = {
  score: number;
  hits: string[];
  misses: string[];
};

export function runContainsAssertion(
  output: string,
  value: string,
): AssertionResult {
  const found = output.includes(value);
  return {
    score: found ? 1 : 0,
    hits: found ? [`Output contains "${value}"`] : [],
    misses: found ? [] : [`Output does not contain "${value}"`],
  };
}

export function runRegexAssertion(
  output: string,
  pattern: string,
): AssertionResult {
  const regex = new RegExp(pattern);
  const found = regex.test(output);
  return {
    score: found ? 1 : 0,
    hits: found ? [`Output matches pattern /${pattern}/`] : [],
    misses: found ? [] : [`Output does not match pattern /${pattern}/`],
  };
}

export function runIsJsonAssertion(output: string): AssertionResult {
  try {
    JSON.parse(output);
    return { score: 1, hits: ['Output is valid JSON'], misses: [] };
  } catch {
    return { score: 0, hits: [], misses: ['Output is not valid JSON'] };
  }
}

export function runEqualsAssertion(
  output: string,
  value: string,
): AssertionResult {
  const match = output.trim() === value.trim();
  return {
    score: match ? 1 : 0,
    hits: match ? ['Output exactly matches expected value'] : [],
    misses: match ? [] : [`Output does not equal "${value}"`],
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/test/evaluation/evaluators/assertions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/evaluators/assertions.ts packages/core/test/evaluation/evaluators/assertions.test.ts
git commit -m "feat(core): add deterministic assertion evaluators (contains, regex, is_json, equals)"
```

---

### Task 4: Register Assertion Types in Evaluator Parser

**Files:**
- Modify: `packages/core/src/evaluation/types.ts:150-162` (add assertion types to EVALUATOR_KIND_VALUES)
- Modify: `packages/core/src/evaluation/loaders/evaluator-parser.ts:75-831` (add parsing branches)
- Test: `packages/core/test/evaluation/loaders/evaluator-parser.test.ts`

**Step 1: Write the failing tests**

```typescript
// Add to evaluator-parser.test.ts
describe('deterministic assertion types', () => {
  it('parses type: contains', async () => {
    const evaluators = await parseEvaluatorList(
      [{ type: 'contains', value: 'DENIED' }],
      ['/tmp'],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators![0].type).toBe('contains');
  });

  it('parses type: regex', async () => {
    const evaluators = await parseEvaluatorList(
      [{ type: 'regex', value: 'risk: \\w+' }],
      ['/tmp'],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators![0].type).toBe('regex');
  });

  it('parses type: is_json', async () => {
    const evaluators = await parseEvaluatorList(
      [{ type: 'is_json' }],
      ['/tmp'],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators![0].type).toBe('is_json');
  });

  it('parses type: equals', async () => {
    const evaluators = await parseEvaluatorList(
      [{ type: 'equals', value: 'DENIED' }],
      ['/tmp'],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators![0].type).toBe('equals');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/evaluation/loaders/evaluator-parser.test.ts`
Expected: FAIL — unknown evaluator type

**Step 3: Add types and parsing branches**

In `types.ts:150-162`, add new types:

```typescript
const EVALUATOR_KIND_VALUES = [
  'code_judge',
  'llm_judge',
  'rubric',
  'composite',
  'tool_trajectory',
  'field_accuracy',
  'latency',
  'cost',
  'token_usage',
  'execution_metrics',
  'agent_judge',
  'contains',
  'regex',
  'is_json',
  'equals',
  'rubrics',
] as const;
```

Add config interfaces for each assertion type and add them to the `EvaluatorConfig` union.

In `evaluator-parser.ts`, add parsing branches in `parseEvaluatorList()` for each new type. Follow the pattern of existing simple evaluators like `latency` (lines 476-494).

**Step 4: Run tests to verify they pass**

Run: `bun test packages/core/test/evaluation/loaders/evaluator-parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/types.ts packages/core/src/evaluation/loaders/evaluator-parser.ts
git commit -m "feat(core): register deterministic assertion types in evaluator parser"
```

---

### Task 5: Wire Assertions Into Orchestrator

**Files:**
- Modify: `packages/core/src/evaluation/orchestrator.ts:1207-1763` (add assertion execution in runEvaluatorList)
- Test: `packages/core/test/evaluation/orchestrator.test.ts`

**Step 1: Write the failing test**

Test that a `contains` evaluator config is executed during evaluation and produces the correct score.

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/evaluation/orchestrator.test.ts`
Expected: FAIL — unknown evaluator type in switch

**Step 3: Add execution branches in runEvaluatorList**

In the evaluator type switch/if-chain in `runEvaluatorList()`, add branches for `contains`, `regex`, `is_json`, `equals` that call the assertion functions from `evaluators/assertions.ts`.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/test/evaluation/orchestrator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/orchestrator.ts
git commit -m "feat(core): execute deterministic assertions in orchestrator"
```

---

### Task 6: Add `assert` Field Support (Test-Level and Suite-Level)

**Files:**
- Modify: `packages/core/src/evaluation/yaml-parser.ts:72-85` (RawEvalCase — add `assert` field)
- Modify: `packages/core/src/evaluation/yaml-parser.ts:323-342` (parse assert alongside evaluators/rubrics)
- Modify: `packages/core/src/evaluation/loaders/evaluator-parser.ts:15-48` (parseEvaluators — handle assert field)
- Test: `packages/core/test/evaluation/loaders/evaluator-parser.test.ts`

**Step 1: Write the failing test**

```typescript
describe('assert field', () => {
  it('parses assert field as evaluators', async () => {
    const evaluators = await parseEvaluators(
      {
        assert: [
          { type: 'contains', value: 'DENIED' },
          { type: 'llm_judge', prompt: './judge.md' },
        ],
      },
      undefined,
      ['/tmp'],
      'test-1',
    );
    expect(evaluators).toHaveLength(2);
    expect(evaluators![0].type).toBe('contains');
    expect(evaluators![1].type).toBe('llm_judge');
  });

  it('merges suite-level assert with test-level assert', async () => {
    const evaluators = await parseEvaluators(
      {
        assert: [{ type: 'contains', value: 'DENIED' }],
      },
      { assert: [{ type: 'latency', max_ms: 5000 }] },
      ['/tmp'],
      'test-1',
    );
    expect(evaluators).toHaveLength(2);
  });

  it('prefers assert over execution.evaluators when both present', async () => {
    const evaluators = await parseEvaluators(
      {
        assert: [{ type: 'contains', value: 'DENIED' }],
        execution: {
          evaluators: [{ type: 'latency', max_ms: 5000 }],
        },
      },
      undefined,
      ['/tmp'],
      'test-1',
    );
    // assert takes precedence
    expect(evaluators).toHaveLength(1);
    expect(evaluators![0].type).toBe('contains');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/evaluation/loaders/evaluator-parser.test.ts`
Expected: FAIL — assert field not recognized

**Step 3: Implement assert field parsing**

In `parseEvaluators()` (evaluator-parser.ts:15-48):
- Check for `rawEvalCase.assert` as a source of evaluators
- If `assert` is present, use it. If `execution.evaluators` is also present, log a deprecation warning.
- For suite-level: check `globalExecution.assert` in addition to `globalExecution.evaluators`
- Handle `skip_defaults` for both `assert` and `evaluators`

In `yaml-parser.ts`, add `assert` to `RawEvalCase` type (line 72-85) and `RawTestSuite` type (line 60-70).

In `loadTestsFromYaml()`, extract suite-level `assert` and pass it to `parseEvaluators()`.

**Step 4: Run tests to verify they pass**

Run: `bun test packages/core/test/evaluation/loaders/evaluator-parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/yaml-parser.ts packages/core/src/evaluation/loaders/evaluator-parser.ts
git commit -m "feat(core): support assert field at test and suite level"
```

---

### Task 7: Add `type: rubrics` With `criteria` Field

**Files:**
- Modify: `packages/core/src/evaluation/loaders/evaluator-parser.ts:772-797` (add rubrics type with criteria)
- Test: `packages/core/test/evaluation/loaders/evaluator-parser.test.ts`

**Step 1: Write the failing test**

```typescript
describe('type: rubrics with criteria field', () => {
  it('parses rubrics type with criteria array', async () => {
    const evaluators = await parseEvaluatorList(
      [
        {
          type: 'rubrics',
          criteria: [
            { id: 'accuracy', outcome: 'Correct answer', weight: 5.0 },
            { id: 'reasoning', outcome: 'Clear reasoning', weight: 3.0 },
          ],
          weight: 4.0,
        },
      ],
      ['/tmp'],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    // Internally maps to llm_judge with rubrics
    expect(evaluators![0].type).toBe('llm_judge');
    expect((evaluators![0] as any).rubrics).toHaveLength(2);
    expect((evaluators![0] as any).weight).toBe(4.0);
  });

  it('supports required on individual criteria', async () => {
    const evaluators = await parseEvaluatorList(
      [
        {
          type: 'rubrics',
          criteria: [
            {
              id: 'gate',
              outcome: 'Must pass',
              weight: 5.0,
              required: true,
            },
            { id: 'bonus', outcome: 'Nice to have', weight: 1.0 },
          ],
        },
      ],
      ['/tmp'],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/evaluation/loaders/evaluator-parser.test.ts`
Expected: FAIL

**Step 3: Add `rubrics` type parsing**

In `evaluator-parser.ts`, add a new branch for `typeValue === 'rubrics'`:
- Read `criteria` field (array of rubric items)
- Parse each item using existing `parseRubricItems()` function
- Create an `LlmJudgeEvaluatorConfig` with the parsed rubrics
- Carry over `weight` and `required` from the outer level

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/test/evaluation/loaders/evaluator-parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/loaders/evaluator-parser.ts
git commit -m "feat(core): add type: rubrics with criteria field"
```

---

### Task 8: Add Required Gates to Scoring

**Files:**
- Modify: `packages/core/src/evaluation/types.ts` (add `required` to EvaluatorConfig types)
- Modify: `packages/core/src/evaluation/loaders/evaluator-parser.ts` (parse `required` field)
- Modify: `packages/core/src/evaluation/orchestrator.ts:1736-1762` (gate-first scoring)
- Test: `packages/core/test/evaluation/evaluators.test.ts`

**Step 1: Write the failing test**

```typescript
describe('required gates', () => {
  it('scores 0 when a required evaluator fails', () => {
    // Create scored results where one has required: true and score < threshold
    // Verify aggregateScore = 0
  });

  it('scores normally when all required evaluators pass', () => {
    // Create scored results where all required items pass
    // Verify normal weighted average
  });

  it('supports numeric required threshold', () => {
    // required: 0.6 means score must be >= 0.6
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/evaluation/evaluators.test.ts`
Expected: FAIL

**Step 3: Implement required gates**

Add `required` field to all evaluator config interfaces in `types.ts`.

Parse `required` in `evaluator-parser.ts` — accept `true` (maps to 0.8 threshold) or a number.

In `orchestrator.ts:1736-1762`, before computing the weighted average:

```typescript
const PASS_THRESHOLD = 0.8;
const hasRequiredFailure = scored.some((entry) => {
  if (!entry.required) return false;
  const minScore =
    typeof entry.required === 'number' ? entry.required : PASS_THRESHOLD;
  return entry.score.score < minScore;
});

const aggregateScore = hasRequiredFailure
  ? 0
  : scored.length > 0
    ? computeWeightedMean(
        scored.map((e) => ({ score: e.score.score, weight: e.weight })),
      )
    : 0;
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/test/evaluation/evaluators.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/types.ts packages/core/src/evaluation/loaders/evaluator-parser.ts packages/core/src/evaluation/orchestrator.ts
git commit -m "feat(core): add required gates to scoring pipeline"
```

---

### Task 9: Support `tests` as String Path

**Files:**
- Modify: `packages/core/src/evaluation/yaml-parser.ts:212-215` (handle string tests field)
- Modify: `packages/core/src/evaluation/loaders/case-file-loader.ts` (load from direct path)
- Test: `packages/core/test/evaluation/loaders/case-file-loader.test.ts`

**Step 1: Write the failing test**

```typescript
it('resolves tests field as string path to external file', async () => {
  // Create temp YAML with tests: ./cases.yaml
  // Create temp cases.yaml with test array
  // Load via loadTestsFromYaml
  // Verify tests are loaded from external file
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/evaluation/loaders/case-file-loader.test.ts`
Expected: FAIL

**Step 3: Implement string path handling**

In `yaml-parser.ts`, after `resolveTests(suite)` (line 212), check if the result is a string:

```typescript
const rawTestcases = resolveTests(suite);

let expandedTestcases: JsonValue[];

if (typeof rawTestcases === 'string') {
  const externalPath = path.resolve(evalFileDir, rawTestcases);
  expandedTestcases = await loadTestsFromExternalFile(externalPath);
} else if (Array.isArray(rawTestcases)) {
  expandedTestcases = await expandFileReferences(rawTestcases, evalFileDir);
} else {
  throw new Error(
    `Invalid test file format: ${evalFilePath} - 'tests' must be an array or file path`,
  );
}
```

Add `loadTestsFromExternalFile()` that handles `.yaml`, `.jsonl`, and `.csv` based on extension.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/test/evaluation/loaders/case-file-loader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/yaml-parser.ts packages/core/src/evaluation/loaders/case-file-loader.ts
git commit -m "feat(core): support tests field as string path to external file"
```

---

### Task 10: Add Validation for New Fields

**Files:**
- Modify: `packages/core/src/evaluation/validation/eval-validator.ts:18-198`
- Test: `packages/core/test/evaluation/validation/eval-validator.test.ts`

**Step 1: Write the failing tests**

```typescript
describe('assert field validation', () => {
  it('validates assert array items have type field', () => {});
  it('validates contains assertion has value field', () => {});
  it('validates required field accepts boolean or number', () => {});
});

describe('metadata validation', () => {
  it('warns when name is present without description', () => {});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/evaluation/validation/eval-validator.test.ts`
Expected: FAIL

**Step 3: Add validation logic**

Add validation for `assert` field, metadata co-presence, `required` field types, and assertion-specific field checks.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/test/evaluation/validation/eval-validator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/validation/eval-validator.ts
git commit -m "feat(core): add validation for assert and metadata fields"
```

---

### Task 11: Update Composite Evaluator to Use `assert` Inner Field

**Files:**
- Modify: `packages/core/src/evaluation/loaders/evaluator-parser.ts:175-315` (composite parsing)
- Test: `packages/core/test/evaluation/loaders/evaluator-parser.test.ts`

**Step 1: Write the failing test**

```typescript
it('parses composite with assert field (new syntax)', async () => {
  const evaluators = await parseEvaluatorList(
    [
      {
        type: 'composite',
        assert: [
          { name: 'safety', type: 'llm_judge', prompt: './safety.md' },
          { name: 'quality', type: 'llm_judge', prompt: './quality.md' },
        ],
        aggregator: { type: 'weighted_average' },
      },
    ],
    ['/tmp'],
    'test-1',
  );
  expect(evaluators).toHaveLength(1);
  expect(evaluators![0].type).toBe('composite');
});

it('supports both evaluators and assert in composite (backward compat)', async () => {
  // evaluators field still works, assert is preferred
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/evaluation/loaders/evaluator-parser.test.ts`
Expected: FAIL

**Step 3: Update composite parsing**

In composite parsing block, accept `assert` as alias for `evaluators`:

```typescript
const innerEvaluators = entry.assert ?? entry.evaluators;
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/test/evaluation/loaders/evaluator-parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/loaders/evaluator-parser.ts
git commit -m "feat(core): support assert field in composite evaluator"
```

---

### Task 12: Update Documentation and Skill

**Files:**
- Modify: `apps/web/src/content/docs/evaluation/eval-files.mdx`
- Modify: `apps/web/src/content/docs/evaluation/eval-cases.mdx`
- Modify: `skills/agentv-eval-builder/SKILL.md`

**Step 1: Update eval-files.mdx** — metadata fields, suite-level assert, tests as string path

**Step 2: Update eval-cases.mdx** — per-test assert, required gates, skip_defaults, migration guide

**Step 3: Update SKILL.md** — AI-focused eval builder reference with new spec format

**Step 4: Commit**

```bash
git add apps/web/src/content/docs/evaluation/ skills/agentv-eval-builder/
git commit -m "docs: update eval spec documentation for v2 assert and metadata"
```

---

### Task 13: Run Full Test Suite and Fix Issues

**Step 1:** Run: `bun run test` — all tests pass

**Step 2:** Run: `bun run typecheck` — no type errors

**Step 3:** Run: `bun run lint` — no lint errors

**Step 4:** Run: `bun run build` — clean build

**Step 5: Fix any issues and commit**

```bash
git commit -m "fix: resolve test/lint/type issues from eval spec v2"
```

---

### Task 14: End-to-End Verification

**Step 1:** Create `examples/features/assert/evals/dataset.yaml` with the new syntax

**Step 2:** Run: `bun agentv eval examples/features/assert/evals/dataset.yaml --test-id <test-id>`

**Step 3:** Inspect results JSONL — verify metadata, assertions, rubrics, required gates, backward compat

**Step 4: Commit**

```bash
git add examples/features/assert/
git commit -m "feat(examples): add assert field eval example"
```
