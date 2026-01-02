---
"@agentv/core": patch
---

refactor: use Zod schemas for CLI provider JSON parsing

Replace manual type assertions and field validation with Zod schema definitions
in the CLI provider's `parseOutputContent()` and `parseJsonlBatchOutput()` methods.
This provides a single source of truth for data validation, clearer error messages,
and aligns with the project's established Zod validation patterns.
