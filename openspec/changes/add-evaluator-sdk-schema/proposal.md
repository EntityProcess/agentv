# Change: Add Canonical Evaluator Schema + Optional SDKs

## Why
Evaluator plugins need a stable wire contract across TypeScript and Python while keeping TS ergonomics (camelCase) and Python idioms (snake_case). A canonical schema reduces drift, enables SDK generation, and clarifies the contract for third-party implementations.

## What Changes
- Define a canonical evaluator payload schema with snake_case wire keys and a versioned envelope.
- Add optional, idiomatic SDKs for TypeScript and Python that map to/from the canonical schema.
- Document the contract so evaluators can be re-implemented without the SDKs.

## Impact
- Affected specs: evaluation
- Affected code: evaluator payload formatting, SDK packages (new), documentation
