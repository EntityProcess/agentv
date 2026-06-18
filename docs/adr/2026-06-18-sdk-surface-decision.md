# ADR: Align existing eval authoring surfaces before adding a separate SDK package

Date: 2026-06-18

Status: Proposed

## Context

AgentV currently exposes eval authoring through three overlapping TypeScript
surfaces:

- YAML eval files use `assertions` at suite, test, and turn level in the schema
  and docs (`packages/core/src/evaluation/validation/eval-file.schema.ts` and
  `apps/web/src/content/docs/docs/evaluation/*.mdx`).
- The programmatic `evaluate()` API uses `assert` in `EvalConfig`,
  `EvalTestInput`, and `ConversationTurnInput`, then lowers those entries into
  runtime `assertions` during materialization
  (`packages/core/src/evaluation/evaluate.ts`).
- `@agentv/eval` is already a small SDK package, but it is for custom
  assertion/code-grader runtimes rather than eval authoring.

The result is vocabulary drift:

- the runtime model is already `assertions`;
- YAML authoring is already `assertions`;
- programmatic examples in `examples/features/sdk-programmatic-api/*.ts` still
  teach `assert`;
- one docs page already drifted the other way and shows `assertions` inside
  `evaluate()` even though the current `EvalConfig` type does not accept it
  (`apps/web/src/content/docs/docs/evaluation/sdk.mdx`).

The question is whether that drift justifies a separate `@agentv/sdk` facade,
or whether the current surfaces can be aligned with less code.

## Current evidence

1. YAML is already the clearest canonical authoring contract.
   - The schema accepts `assertions` on suites, tests, turns, and execution
     blocks.
   - The YAML parser still carries deprecated `assert` aliases, which means the
     canonical name has already effectively been chosen.

2. Programmatic `evaluate()` already converts authoring input into the YAML
   runtime shape.
   - `materializeEvalConfig()` maps programmatic `assert` fields into runtime
     `assertions` arrays.
   - This means a large part of the needed convergence is naming cleanup, not a
     missing execution primitive.

3. A separate `@agentv/sdk` package would add a third authoring vocabulary
   unless it simply re-exported existing shapes.
   - If it invents Braintrust-style `data/task/scores`, it diverges from AgentV
     YAML and from Promptfoo-like `assert`/`assertions` concepts.
   - If it mirrors existing YAML concepts, it can live in `@agentv/core`
     without a new package.

4. `@agentv/eval` already occupies the obvious "SDK" name in user mental
   models.
   - Adding `@agentv/sdk` now creates package-boundary confusion:
     `@agentv/core` runs evals, `@agentv/eval` writes graders, and
     `@agentv/sdk` would author eval definitions.
   - That is more terminology, not less.

## Decision

Do not add a separate `@agentv/sdk` package now.

Converge the existing YAML, programmatic, docs, and Python-facing authoring
surfaces first, using YAML-shaped definitions and small helpers in existing
packages.

The canonical authoring vocabulary should be:

- `tests`
- `input`
- `expected_output` on wire/YAML boundaries
- `expectedOutput` in TypeScript authoring helpers
- `assertions` for YAML and for stable programmatic authoring objects

For programmatic TypeScript, keep camelCase where it is an ordinary TypeScript
boundary, but mirror the YAML structure rather than inventing a second model.

## Package boundary recommendation

Use the current package split:

- `@agentv/core`: eval authoring and execution APIs
- `@agentv/eval`: custom assertion/code-grader runtime SDK

If ergonomic authoring helpers are needed, add them to `@agentv/core` as a
small surface such as:

- YAML-shaped TypeScript types for eval definitions
- a typed `defineEval()` or equivalent identity helper
- narrow assertion-builder helpers if repeated object literals prove noisy

Do not create a new package boundary unless one of these becomes true after the
cleanup ships:

- authoring helpers pull in dependencies that materially bloat `@agentv/core`;
- non-execution consumers need eval-definition types without the rest of core;
- a real external audience asks for a standalone authoring package often enough
  that the boundary removes confusion instead of adding it.

No current evidence in the repo proves any of those conditions.

## Naming decision: `assertions` vs `assert`

Choose `assertions` as the stable public authoring name across YAML and future
programmatic eval-definition APIs.

Rationale:

- YAML already uses `assertions`.
- the runtime model already uses `assertions`.
- Promptfoo similarity is good enough here: plural assertion entries under a
  test are legible, conventional, and do not require Braintrust-style
  vocabulary replacement.
- keeping programmatic `assert` while YAML uses `assertions` preserves a split
  that already caused doc drift.

Migration guidance:

- YAML keeps `assertions` as canonical and may continue to read `assert` only as
  a compatibility alias if needed.
- TypeScript `evaluate()` should converge toward accepting `assertions` on
  authoring objects that mirror YAML.
- Existing programmatic `assert` can remain temporarily as a deprecated alias
  during the convergence window, but it should not be the documented primary
  name.

## Options considered

### 1. Current surfaces plus docs cleanup only

Pros:

- smallest immediate code change
- no new package

Cons:

- preserves the actual `assert` vs `assertions` type split
- leaves TypeScript authoring less YAML-shaped than claimed
- keeps docs/examples fighting the types

Decision: insufficient.

### 2. YAML-shaped TypeScript definitions in existing packages

Pros:

- aligns YAML, loader, runtime, and docs around one model
- smallest change that actually fixes the vocabulary split
- works for TypeScript and Python-facing generated shapes
- avoids adding a third package and a third naming layer

Cons:

- requires a small migration/deprecation pass in `evaluate()` types and docs

Decision: recommended.

### 3. Small helpers in existing packages

Pros:

- can reduce literal noise without adding new product vocabulary
- composes naturally with option 2

Cons:

- helpers alone do not solve the naming split
- risks premature API flourish if added before the base model is aligned

Decision: acceptable only after or alongside option 2, and only if the helpers
stay narrow.

### 4. Separate `@agentv/sdk` package

Pros:

- could provide a clean slate for authoring ergonomics

Cons:

- adds package-boundary and vocabulary confusion next to `@agentv/core` and
  `@agentv/eval`
- risks drifting into Braintrust-shaped `data/task/scores` APIs that the current
  user decision explicitly does not want to assume are better
- duplicates types/helpers that can live in current packages with less code
- is not justified by a demonstrated dependency or publishing boundary yet

Decision: rejected for now as overengineering.

## Smallest path forward

1. Treat YAML shape as canonical for authoring concepts.
2. Update programmatic eval-definition types in `@agentv/core` to center
   `assertions`, not `assert`.
3. Keep temporary alias support only where needed for compatibility, and mark it
   deprecated.
4. Fix docs and examples so every public eval-authoring example uses the same
   terminology.
5. Leave `@agentv/eval` focused on custom grader runtime contracts.
6. Revisit a separate package only after real usage shows a boundary that cannot
   be met by `@agentv/core` types/helpers.

## Consequences

Positive:

- one authoring vocabulary across YAML, TS, and future Python-facing shapes
- less code than introducing and maintaining `@agentv/sdk`
- better fit with the repo principle of lightweight core plus extension points

Negative:

- requires a short deprecation/migration pass for current programmatic `assert`
- `@agentv/core` remains the home for both execution and authoring helpers for
  now

## Tracker impact

- `av-bv4.2`: resolved in favor of no separate `@agentv/sdk` package at this
  stage.
- `av-bv4.9`: package boundary remains `@agentv/core` for eval authoring and
  `@agentv/eval` for custom grader runtime code.
- `av-bv4.10`: converge on `assertions` as the stable public authoring term;
  keep `assert` only as a temporary deprecated compatibility alias where needed.
