## Context
AgentV currently formats evaluator payloads in code with ad-hoc case conversion. We want a canonical wire schema that SDKs can target, while keeping developer-friendly types in TypeScript and Python.

## Goals / Non-Goals
- Goals:
  - Publish a canonical, versioned evaluator payload schema.
  - Provide optional, type-safe SDKs for TS (camelCase) and Python (snake_case).
  - Keep the runtime core lightweight and preserve backward compatibility.
- Non-Goals:
  - Rewriting all evaluator logic or introducing a required plugin runtime.
  - Breaking existing code_judge payloads without a compatibility plan.

## Decisions
- Decision: Canonical schema uses snake_case keys with a versioned envelope.
- Decision: TS SDK exposes camelCase types and handles mapping at the boundary.
- Decision: Python SDK stays snake_case and validates the wire payload directly.

## Risks / Trade-offs
- Extra mapping layer: mitigated by codegen and strict schema tests.
- Drift between core and SDKs: mitigated by schema-first generation and versioned contracts.

## Migration Plan
- Introduce schema alongside existing payloads, then migrate core to emit the canonical envelope.
- Provide a compatibility window where both formats are accepted.

## Open Questions
- Source-of-truth format: OpenAPI vs JSON Schema.
- SDK distribution: monorepo packages vs standalone repos.
