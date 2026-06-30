# 11. Consolidate case conversion at the artifact boundary

Date: 2026-06-30

## Status

Accepted

## Context

AgentV normalizes many provider and harness shapes into one internal evaluation
model. The internal TypeScript contract is camelCase, while persisted
YAML/JSONL artifacts use snake_case for Python, shell, jq, and JSONL
portability. This split is already documented on the trace model and matches
AgentV's role as a multi-provider abstraction layer.

The alternative of making TypeScript types snake_case-native fits
single-provider SDKs whose public types mirror one HTTP API. It does not fit
AgentV because AgentV's core model must normalize Claude, Codex, Copilot, Pi,
VS Code, CLI, function, replay, mock, and future providers into a single
provider-neutral shape.

Before this decision, conversion logic was duplicated in four places:

- `packages/core/src/evaluation/case-conversion.ts`
- `packages/sdk/src/case-conversion.ts`
- `apps/cli/src/utils/case-conversion.ts`
- an inline `toCamelCaseDeep()` copy in
  `packages/core/src/evaluation/run-artifacts.ts`

Those implementations had already drifted. The inline result-artifact parser
converted only `/_([a-z])/g`, while the canonical core converter handles digits
and guards proper-noun keys that start with uppercase letters.

Current conversion call sites include:

- core result parsing and artifact writing in
  `packages/core/src/evaluation/run-artifacts.ts`
- core grader and prompt-template stdin payloads in
  `packages/core/src/evaluation/graders/code-grader.ts` and
  `packages/core/src/evaluation/graders/prompt-resolution.ts`
- SDK stdin boundaries in `packages/sdk/src/runtime.ts`,
  `packages/sdk/src/assertion.ts`, and `packages/sdk/src/prompt-template.ts`
- CLI JSON/YAML output and manifest reading in `apps/cli/src/commands/eval`,
  `apps/cli/src/commands/inspect`, `apps/cli/src/commands/compare`,
  `apps/cli/src/commands/trend`, `apps/cli/src/commands/trim`, and
  `apps/cli/src/commands/results`

## Decision

Keep camelCase TypeScript internals and snake_case persisted wire artifacts.
Consolidate deep case conversion into
`packages/core/src/evaluation/case-conversion.ts` and export it from
`@agentv/core` for SDK and CLI reuse. Delete local SDK, CLI, and inline
duplicates.

Use a Zod-backed boundary serializer for AgentV-owned result wire shapes. The
serializer validates canonical camelCase objects, converts to or from snake_case
at the boundary, and uses `.passthrough()` so unknown additive keys are
preserved instead of silently dropped.

The canonical edge-case semantics are:

- keys that start with uppercase letters are preserved unchanged, which keeps
  proper-noun tool names such as `Read` and `Edit` stable;
- camelCase to snake_case lowers uppercase letters after the first character,
  so `topP` becomes `top_p`;
- snake_case to camelCase converts underscore-plus-lowercase or digit, so
  `top_p` becomes `topP` and `top_2` becomes `top2`;
- acronym keys that start with uppercase letters, such as `HTTPStatus`, are
  treated as proper nouns and preserved.

Where existing converters disagree, treat the divergence as a latent defect and
converge on the canonical core behavior. Baseline diffs caused by digit
handling or uppercase proper-noun guarding are accepted bug fixes, not
bug-for-bug compatibility requirements. Any baseline diff not explained by this
known drift is a regression and must be fixed before release.

If artifact or JSONL baselines change because of the accepted convergence, add a
CHANGELOG or migration note describing the casing fix.

## Consequences

Positive:

- SDK, CLI, and core behavior use one tested conversion implementation.
- AgentV keeps the documented multi-provider architecture: provider-neutral
  camelCase internals with snake_case wire boundaries.
- Zod validation protects the artifact boundary without dropping unknown
  additive keys.
- Future conversion edge cases are covered in one shared test suite.

Negative:

- Rows or artifacts that previously passed through the drifted inline converter
  can change for keys such as `top_2` and `Foo_bar`.
- SDK and CLI packages now depend on the exported core converter instead of
  carrying local copies.

## Alternatives Considered

- **Make TypeScript types snake_case-native.** Rejected. That pattern is useful
  for single-provider SDKs with generated API types, but AgentV is a
  provider-neutral normalization layer.
- **Keep duplicate converters and add tests to each.** Rejected. That preserves
  the drift risk and makes future boundary fixes harder to reason about.
- **Preserve the inline converter's bug-for-bug behavior.** Rejected. The drift
  is a latent artifact bug, and the canonical behavior already exists in core.
- **Use strict Zod schemas at the wire boundary.** Rejected. Strict parsing
  would drop or reject unknown additive keys and create an unintended breaking
  change for portable artifacts.
- **Adopt a third-party case library (`camelcase-keys` / `snakecase-keys`).**
  Rejected. (1) `camelcase-keys` is one-directional, so the snake_case wire
  direction would require a second library (`snakecase-keys`, built on
  `change-case`) with a different edge-case engine. (2) Those libraries have
  different acronym/number semantics (e.g. `preserveConsecutiveUppercase`,
  `top2` vs `top_2`), which would maximize baseline diffs rather than minimize
  them — the opposite of the byte-compatibility goal. (3) They lack AgentV's
  proper-noun guard, so tool names such as `Read`/`Edit` would be transformed;
  reconstructing the guard via `exclude: [/^[A-Z]/]` on both libraries is
  fragile. (4) `snakecase-keys ∘ camelcase-keys` is not provably identity for
  AgentV keys, while the in-house pair is. (5) AgentV keys are its own finite
  schema, not arbitrary user input, so the library's main value (robust handling
  of arbitrary keys) does not apply. Revisit only if AgentV must ingest
  arbitrary external/user kebab+snake keys or drops byte-compatibility. An
  optional test may cross-check the in-house converter against `camelcase-keys`
  on the known key set to document divergences, without a runtime dependency.

## Future Work

The strictly-better long-term boundary is an explicit per-field casing mapping
encoded in the Zod schemas (no deep stringly-typed key walk), which also mirrors
how the Vercel AI SDK does explicit per-provider mapping. That is a larger,
separate effort and is intentionally out of scope for this consolidation. Note
that kebab-case is the same conversion problem as snake_case (only the separator
differs: `[-_]`), but the camelCase-to-kebab reverse is lossy/ambiguous and
would need an explicit per-field rule rather than a blanket reverse — another
reason to prefer explicit schema-level mapping if a kebab dialect is ever
required.

## Non-Goals

- Changing grader-author-facing SDK input casing.
- Changing YAML authoring conventions.
- Rewriting provider-specific opaque payloads that intentionally preserve their
  native key casing.
