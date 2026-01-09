// Back-compat entrypoint.
// Prefer running `bun run export --in ... [--backend confident|langfuse]` which executes `export-jsonl-to-otel.ts`.
import './export-jsonl-to-otel';
