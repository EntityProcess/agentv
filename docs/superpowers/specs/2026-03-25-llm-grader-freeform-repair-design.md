# LLM Grader Freeform Repair Design

**Problem:** `llm-grader` freeform evaluation currently fails after three retries when the grader returns JSON-like output that is close to the schema but not valid JSON, such as `assertions[].passed: mixed`.

**Goal:** Recover from narrow, common malformed outputs without expanding the public schema or introducing tri-state assertion semantics.

## Design

The fix will stay at the parsing boundary. We will add a narrow repair pass before `JSON.parse` that only targets recoverable assertion boolean values in freeform grader-style payloads. The repaired payload will still flow through the existing Zod schema, so `assertions[].passed` remains strictly boolean in the validated result.

The repair logic will coerce schema-near partial assertion markers such as unquoted `mixed` to `false`. This matches the product constraint that partial satisfaction should not introduce a new assertion state and should be treated as not fully passed unless a separate assertion-level numeric score exists.

We will not broaden parsing into a general malformed JSON fixer. Rubric and score-range modes should keep their current strict behavior unless they benefit incidentally from the same bounded parsing helper without changing accepted schema values.

## Testing

Add regression tests for:
- freeform `llm-grader` output with `assertions[].passed: mixed` recovering to a valid evaluation result
- existing valid JSON and fenced JSON behavior remaining intact
- clearly malformed JSON continuing to fail and return a skipped grader result

## Documentation

Update `CLAUDE.md` so this repository documents `devbox2-codex` as the default `AGENT_ID` for this working environment unless the user specifies a different identifier.
