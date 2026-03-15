# Eval Schema Generation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-generate `eval-schema.json` from a Zod schema and add a diff test to catch drift.

**Architecture:** Create a comprehensive Zod schema (`eval-file.schema.ts`) that mirrors the eval YAML file structure. A generator script converts it to JSON Schema via `zod-to-json-schema`. A test regenerates and diffs against the committed file — if they diverge, it fails.

**Tech Stack:** Zod, zod-to-json-schema, Vitest

---

### Task 1: Add `zod-to-json-schema` dependency

**Files:**
- Modify: `packages/core/package.json`

**Step 1: Install the dependency**

Run: `cd /home/christso/projects/agentv && bun add -d zod-to-json-schema --cwd packages/core`

**Step 2: Verify installation**

Run: `grep zod-to-json-schema packages/core/package.json`
Expected: `"zod-to-json-schema": "^3.x.x"` in devDependencies

**Step 3: Commit**

```bash
git add packages/core/package.json bun.lock
git commit -m "chore: add zod-to-json-schema dev dependency"
```

---

### Task 2: Create the eval file Zod schema

**Files:**
- Create: `packages/core/src/evaluation/validation/eval-file.schema.ts`

**Context:** This schema represents the **YAML input format** (what users write), not the parsed runtime types. Key differences from runtime types:
- Uses snake_case field names (YAML convention)
- Includes shorthands (string input → message array)
- Includes deprecated aliases (eval_cases, script, expected_outcome)
- Uses `additionalProperties` / `.passthrough()` where custom config is allowed
- Does NOT include resolved/computed fields (resolvedCwd, resolvedPromptPath, etc.)

The schema should import `EVALUATOR_KIND_VALUES` from `types.ts` to stay in sync with the evaluator kind enum.

**Step 1: Write the schema file**

Create `packages/core/src/evaluation/validation/eval-file.schema.ts` with:

```typescript
/**
 * Zod schema for eval YAML file format.
 * Used to generate eval-schema.json for AI agent reference.
 *
 * IMPORTANT: This schema describes the YAML input format, not the parsed runtime types.
 * When adding new eval features, update this schema AND run `bun run generate:schema`
 * to regenerate eval-schema.json. The sync test will fail if they diverge.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Message content: string or structured array */
const ContentItemSchema = z.object({
  type: z.enum(['text', 'file']),
  value: z.string(),
});

const MessageContentSchema = z.union([
  z.string(),
  z.array(ContentItemSchema),
]);

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: MessageContentSchema,
});

/** Input: string shorthand or message array */
const InputSchema = z.union([z.string(), z.array(MessageSchema)]);

/** Expected output: string, object, or message array */
const ExpectedOutputSchema = z.union([
  z.string(),
  z.record(z.unknown()),
  z.array(MessageSchema),
]);

// ---------------------------------------------------------------------------
// Evaluator schemas (YAML input format)
// ---------------------------------------------------------------------------

/** Common fields shared by all evaluators */
const EvaluatorCommonSchema = z.object({
  name: z.string().optional(),
  weight: z.number().min(0).optional(),
  required: z.union([z.boolean(), z.number().gt(0).lte(1)]).optional(),
  negate: z.boolean().optional(),
});

/** Prompt: string (inline/file path) or executable script config */
const PromptSchema = z.union([
  z.string(),
  z.object({
    command: z.union([z.string(), z.array(z.string())]).optional(),
    script: z.union([z.string(), z.array(z.string())]).optional(),
    config: z.record(z.unknown()).optional(),
  }),
]);

/** Score range for analytic rubrics */
const ScoreRangeSchema = z.object({
  score_range: z.tuple([z.number().int().min(0).max(10), z.number().int().min(0).max(10)]),
  outcome: z.string().min(1),
});

/** Rubric item (checklist or score-range mode) */
const RubricItemSchema = z.object({
  id: z.string().optional(),
  outcome: z.string().optional(),
  weight: z.number().optional(),
  required: z.boolean().optional(),
  required_min_score: z.number().int().min(0).max(10).optional(),
  score_ranges: z.array(ScoreRangeSchema).optional(),
});

// --- Type-specific evaluator schemas ---

const CodeJudgeSchema = EvaluatorCommonSchema.extend({
  type: z.literal('code_judge'),
  command: z.union([z.string(), z.array(z.string())]),
  script: z.union([z.string(), z.array(z.string())]).optional(),
  cwd: z.string().optional(),
  target: z.union([z.boolean(), z.object({ max_calls: z.number().optional() })]).optional(),
  config: z.record(z.unknown()).optional(),
});

const LlmJudgeSchema = EvaluatorCommonSchema.extend({
  type: z.literal('llm_judge'),
  prompt: PromptSchema.optional(),
  rubrics: z.array(RubricItemSchema).optional(),
  model: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

/** Aggregator configs for composite evaluator */
const AggregatorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('weighted_average'),
    weights: z.record(z.number()).optional(),
  }),
  z.object({
    type: z.literal('threshold'),
    threshold: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal('code_judge'),
    path: z.string(),
    cwd: z.string().optional(),
  }),
  z.object({
    type: z.literal('llm_judge'),
    prompt: z.string().optional(),
    model: z.string().optional(),
  }),
]);

// Use z.lazy for recursive composite evaluator
const CompositeSchema: z.ZodType = z.lazy(() =>
  EvaluatorCommonSchema.extend({
    type: z.literal('composite'),
    assertions: z.array(EvaluatorSchema).optional(),
    evaluators: z.array(EvaluatorSchema).optional(),
    aggregator: AggregatorSchema,
  }),
);

const ArgsMatchSchema = z.union([
  z.enum(['exact', 'ignore', 'subset', 'superset']),
  z.array(z.string()),
]);

const ToolTrajectoryExpectedItemSchema = z.object({
  tool: z.string(),
  args: z.union([z.literal('any'), z.record(z.unknown())]).optional(),
  max_duration_ms: z.number().min(0).optional(),
  maxDurationMs: z.number().min(0).optional(),
  args_match: ArgsMatchSchema.optional(),
  argsMatch: ArgsMatchSchema.optional(),
});

const ToolTrajectorySchema = EvaluatorCommonSchema.extend({
  type: z.literal('tool_trajectory'),
  mode: z.enum(['any_order', 'in_order', 'exact', 'subset', 'superset']),
  minimums: z.record(z.number().int().min(0)).optional(),
  expected: z.array(ToolTrajectoryExpectedItemSchema).optional(),
  args_match: ArgsMatchSchema.optional(),
  argsMatch: ArgsMatchSchema.optional(),
});

const FieldConfigSchema = z.object({
  path: z.string(),
  match: z.enum(['exact', 'numeric_tolerance', 'date']),
  required: z.boolean().optional(),
  weight: z.number().optional(),
  tolerance: z.number().min(0).optional(),
  relative: z.boolean().optional(),
  formats: z.array(z.string()).optional(),
});

const FieldAccuracySchema = EvaluatorCommonSchema.extend({
  type: z.literal('field_accuracy'),
  fields: z.array(FieldConfigSchema).min(1),
  aggregation: z.enum(['weighted_average', 'all_or_nothing']).optional(),
});

const LatencySchema = EvaluatorCommonSchema.extend({
  type: z.literal('latency'),
  threshold: z.number().min(0),
});

const CostSchema = EvaluatorCommonSchema.extend({
  type: z.literal('cost'),
  budget: z.number().min(0),
});

const TokenUsageSchema = EvaluatorCommonSchema.extend({
  type: z.literal('token_usage'),
  max_total: z.number().min(0).optional(),
  max_input: z.number().min(0).optional(),
  max_output: z.number().min(0).optional(),
});

const ExecutionMetricsSchema = EvaluatorCommonSchema.extend({
  type: z.literal('execution_metrics'),
  max_tool_calls: z.number().min(0).optional(),
  max_llm_calls: z.number().min(0).optional(),
  max_tokens: z.number().min(0).optional(),
  max_cost_usd: z.number().min(0).optional(),
  max_duration_ms: z.number().min(0).optional(),
  target_exploration_ratio: z.number().min(0).max(1).optional(),
  exploration_tolerance: z.number().min(0).optional(),
});

// Note: agent_judge was removed — llm-judge now covers all judge use cases
// including agentic behavior (auto-detected based on judge provider kind).
// See LlmJudgeSchema above for the unified schema.

const ContainsSchema = EvaluatorCommonSchema.extend({
  type: z.literal('contains'),
  value: z.string(),
});

const RegexSchema = EvaluatorCommonSchema.extend({
  type: z.literal('regex'),
  value: z.string(),
});

const IsJsonSchema = EvaluatorCommonSchema.extend({
  type: z.literal('is_json'),
});

const EqualsSchema = EvaluatorCommonSchema.extend({
  type: z.literal('equals'),
  value: z.string(),
});

const RubricsSchema = EvaluatorCommonSchema.extend({
  type: z.literal('rubrics'),
  criteria: z.array(RubricItemSchema).min(1),
});

/** Union of all evaluator types */
const EvaluatorSchema = z.union([
  CodeJudgeSchema,
  LlmJudgeSchema,
  CompositeSchema,
  ToolTrajectorySchema,
  FieldAccuracySchema,
  LatencySchema,
  CostSchema,
  TokenUsageSchema,
  ExecutionMetricsSchema,
  ContainsSchema,
  RegexSchema,
  IsJsonSchema,
  EqualsSchema,
  RubricsSchema,
]);

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

const WorkspaceScriptSchema = z.object({
  command: z.union([z.string(), z.array(z.string())]).optional(),
  script: z.union([z.string(), z.array(z.string())]).optional(),
  timeout_ms: z.number().min(0).optional(),
  cwd: z.string().optional(),
});

const WorkspaceSchema = z.object({
  template: z.string().optional(),
  before_all: WorkspaceScriptSchema.optional(),
  after_all: WorkspaceScriptSchema.optional(),
  before_each: WorkspaceScriptSchema.optional(),
  after_each: WorkspaceScriptSchema.optional(),
});

// ---------------------------------------------------------------------------
// Execution block
// ---------------------------------------------------------------------------

const TrialsSchema = z.object({
  count: z.number().int().min(1),
  strategy: z.enum(['pass_at_k', 'mean', 'confidence_interval']).optional(),
  cost_limit_usd: z.number().min(0).optional(),
  costLimitUsd: z.number().min(0).optional(),
});

const ExecutionSchema = z.object({
  target: z.string().optional(),
  targets: z.array(z.string()).optional(),
  assertions: z.array(EvaluatorSchema).optional(),
  evaluators: z.array(EvaluatorSchema).optional(),
  skip_defaults: z.boolean().optional(),
  cache: z.boolean().optional(),
  trials: TrialsSchema.optional(),
  total_budget_usd: z.number().min(0).optional(),
  totalBudgetUsd: z.number().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Test case
// ---------------------------------------------------------------------------

const EvalTestSchema = z.object({
  id: z.string().min(1),
  criteria: z.string().optional(),
  expected_outcome: z.string().optional(),
  input: InputSchema.optional(),
  expected_output: ExpectedOutputSchema.optional(),
  assertions: z.array(EvaluatorSchema).optional(),
  evaluators: z.array(EvaluatorSchema).optional(),
  execution: ExecutionSchema.optional(),
  workspace: WorkspaceSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  conversation_id: z.string().optional(),
  dataset: z.string().optional(),
  note: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Top-level eval file
// ---------------------------------------------------------------------------

export const EvalFileSchema = z.object({
  $schema: z.string().optional(),
  // Metadata
  name: z.string().regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  license: z.string().optional(),
  requires: z.object({ agentv: z.string().optional() }).optional(),
  // Suite-level input
  input: InputSchema.optional(),
  // Tests (array or external file path)
  tests: z.union([z.array(EvalTestSchema), z.string()]),
  // Deprecated aliases
  eval_cases: z.union([z.array(EvalTestSchema), z.string()]).optional(),
  // Target
  target: z.string().optional(),
  // Execution
  execution: ExecutionSchema.optional(),
  // Suite-level assertions
  assertions: z.array(EvaluatorSchema).optional(),
  // Workspace
  workspace: WorkspaceSchema.optional(),
});
```

**Step 2: Verify the file compiles**

Run: `cd /home/christso/projects/agentv && bunx tsc --noEmit packages/core/src/evaluation/validation/eval-file.schema.ts --esModuleInterop --moduleResolution bundler --module esnext --target es2022 --strict`

If tsc is fussy with standalone file checking, just run the full typecheck:
Run: `bun run typecheck --filter @agentv/core`

**Step 3: Commit**

```bash
git add packages/core/src/evaluation/validation/eval-file.schema.ts
git commit -m "feat: add Zod schema for eval YAML file format"
```

---

### Task 3: Create the generator script

**Files:**
- Create: `packages/core/scripts/generate-eval-schema.ts`
- Modify: `packages/core/package.json` (add script)

**Step 1: Write the generator script**

Create `packages/core/scripts/generate-eval-schema.ts`:

```typescript
#!/usr/bin/env bun
/**
 * Generates eval-schema.json from the Zod schema.
 * Run: bun run generate:schema (from packages/core)
 * Or:  bun packages/core/scripts/generate-eval-schema.ts (from repo root)
 */
import { zodToJsonSchema } from 'zod-to-json-schema';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EvalFileSchema } from '../src/evaluation/validation/eval-file.schema.js';

const jsonSchema = zodToJsonSchema(EvalFileSchema, {
  name: 'EvalFile',
  $refStrategy: 'none',
});

// Add JSON Schema metadata
const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'AgentV Eval File',
  description: 'Schema for AgentV evaluation YAML files (.eval.yaml)',
  ...jsonSchema,
};

const outputPath = path.resolve(
  import.meta.dirname,
  '../../../plugins/agentv-dev/skills/agentv-eval-builder/references/eval-schema.json',
);

await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`Generated: ${outputPath}`);
```

**Step 2: Add the script to package.json**

Add to `packages/core/package.json` scripts:
```json
"generate:schema": "bun scripts/generate-eval-schema.ts"
```

**Step 3: Run the generator and verify output**

Run: `cd /home/christso/projects/agentv/packages/core && bun run generate:schema`
Expected: `Generated: .../plugins/agentv-dev/skills/agentv-eval-builder/references/eval-schema.json`

Inspect the output:
Run: `head -30 /home/christso/projects/agentv/plugins/agentv-dev/skills/agentv-eval-builder/references/eval-schema.json`
Expected: Valid JSON with `$schema`, `title`, `properties` including `tests`, `execution`, `assert`, etc.

**Step 4: Run biome format on the generated file**

Run: `cd /home/christso/projects/agentv && bunx biome format --write plugins/agentv-dev/skills/agentv-eval-builder/references/eval-schema.json`

**Step 5: Commit**

```bash
git add packages/core/scripts/generate-eval-schema.ts packages/core/package.json
git add plugins/agentv-dev/skills/agentv-eval-builder/references/eval-schema.json
git commit -m "feat: add eval-schema.json generator from Zod schema"
```

---

### Task 4: Add the sync diff test

**Files:**
- Create: `packages/core/test/evaluation/validation/eval-schema-sync.test.ts`

**Step 1: Write the failing test (schema should already be in sync from Task 3)**

Create `packages/core/test/evaluation/validation/eval-schema-sync.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { EvalFileSchema } from '../../../src/evaluation/validation/eval-file.schema.js';

describe('eval-schema.json sync', () => {
  it('matches the generated schema from Zod', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../..');
    const schemaPath = path.join(
      repoRoot,
      'plugins/agentv-dev/skills/agentv-eval-builder/references/eval-schema.json',
    );

    // Read committed schema
    const committed = JSON.parse(await readFile(schemaPath, 'utf8'));

    // Generate fresh schema from Zod
    const generated = zodToJsonSchema(EvalFileSchema, {
      name: 'EvalFile',
      $refStrategy: 'none',
    });

    const expected = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'AgentV Eval File',
      description: 'Schema for AgentV evaluation YAML files (.eval.yaml)',
      ...generated,
    };

    // Compare (ignoring formatting differences)
    expect(JSON.parse(JSON.stringify(committed))).toEqual(
      JSON.parse(JSON.stringify(expected)),
    );
  });
});
```

**Step 2: Run the test to verify it passes**

Run: `cd /home/christso/projects/agentv && bun test packages/core/test/evaluation/validation/eval-schema-sync.test.ts`
Expected: PASS (since we just generated the schema in Task 3)

**Step 3: Commit**

```bash
git add packages/core/test/evaluation/validation/eval-schema-sync.test.ts
git commit -m "test: add eval-schema.json sync test"
```

---

### Task 5: Also copy generated schema to CLI dist templates

**Context:** The schema is also bundled in `apps/cli/dist/templates/`. Check if this is done by the build or needs manual sync.

**Step 1: Check how CLI templates reference the schema**

Run: `diff plugins/agentv-dev/skills/agentv-eval-builder/references/eval-schema.json apps/cli/dist/templates/.claude/skills/agentv-eval-builder/references/eval-schema.json`

If they differ, the CLI build should copy from the source. Check the CLI build process:
Run: `grep -r "eval-schema" apps/cli/tsup.config.ts apps/cli/package.json 2>/dev/null`

If no copy step exists, the template copies are stale artifacts. Either:
- Add a copy step to the CLI build, or
- Note this as out of scope (the CLI templates are created by `agentv create` and may have their own update cycle)

**Step 2: Determine action and commit if needed**

This step is investigative — commit only if a change is needed.

---

### Task 6: Run full test suite and push

**Step 1: Run all tests**

Run: `cd /home/christso/projects/agentv && bun run test`
Expected: All tests pass

**Step 2: Run typecheck**

Run: `cd /home/christso/projects/agentv && bun run typecheck`
Expected: No errors

**Step 3: Run lint**

Run: `cd /home/christso/projects/agentv && bun run lint`
Expected: No errors (fix any formatting issues from generated file)

**Step 4: Push the branch**

Run: `git push -u origin chore/update-eval-schema`

---

### Task 7: Create PR and file follow-up issue

**Step 1: Create PR**

```bash
gh pr create --title "chore: auto-generate eval-schema.json from Zod" --body "$(cat <<'EOF'
## Summary
- Adds a comprehensive Zod schema (`eval-file.schema.ts`) that describes the eval YAML file format
- Generates `eval-schema.json` from this Zod schema via `zod-to-json-schema`
- Adds a sync test that regenerates and diffs — fails if schema drifts from Zod

## Motivation
The JSON schema was manually maintained and had drifted significantly from the actual validation logic. This ensures the schema stays current as the codebase evolves.

## How to update the schema
When adding new eval features, update `eval-file.schema.ts` and run:
```bash
cd packages/core && bun run generate:schema
```

## Test plan
- [ ] `bun test packages/core/test/evaluation/validation/eval-schema-sync.test.ts` passes
- [ ] Full test suite passes
- [ ] Schema validates against existing example eval files

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 2: File follow-up issue for Approach B**

```bash
gh issue create --title "refactor: migrate eval-validator.ts from procedural to Zod-based validation" --body "$(cat <<'EOF'
## Context
The eval file validation in `eval-validator.ts` uses procedural if/else logic (~500+ lines). A parallel Zod schema (`eval-file.schema.ts`) was added in #<PR_NUMBER> for JSON Schema generation, creating two sources of truth.

## Proposal
Refactor `eval-validator.ts` to use the Zod schema as the single source of truth for both:
1. Runtime validation (Zod `.safeParse()`)
2. JSON Schema generation (`zod-to-json-schema`)

## Benefits
- Single source of truth for eval file structure
- Better error messages from Zod
- Removes ~500 lines of manual validation code
- Type-safe parsing (no type casts)

## Considerations
- The current procedural validator supports warnings (not just errors) — Zod only does pass/fail
- Custom evaluator types use `.passthrough()` which needs careful handling
- Backward-compatible aliases (eval_cases, script, expected_outcome) need Zod transforms
- Extensive test coverage exists in `eval-validator.test.ts` — migration should preserve all test cases

## Scope
- `packages/core/src/evaluation/validation/eval-validator.ts` → refactor to use Zod
- `packages/core/test/evaluation/validation/eval-validator.test.ts` → update test setup
- Remove the separate `eval-file.schema.ts` once validator uses Zod natively
EOF
)"
```
