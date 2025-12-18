# Add Evalcase Generation (generate evals)

## Summary
Add a first-class `agentv generate evals` command to create YAML eval suites from raw datasets (JSON/JSONL initially), so users can build eval datasets without writing bespoke scripts.

## Motivation
Users often start with:
- an existing dataset (JSON/JSONL/CSV) containing real questions, incidents, tickets, or archived Q&A
- a domain-specific “curation” rubric (rewrite the question, extract expected requirements, optionally cite sources)

Today, AgentV assumes evalcases already exist in YAML. Teams that want to generate eval suites from archived Q&A, tickets, or knowledge-base exports must write custom code to:
- load datasets
- parallelize LLM curation across rows
- emit AgentV YAML in the right shape

AgentV should make this easy and standardized so users don’t invent one-off harnesses.

## Proposed Changes

### 1. New CLI command: `agentv generate evals`
- Input: dataset file (`.json` or `.jsonl` initially)
- Output: AgentV YAML suite containing `evalcases`
- Concurrency: controlled via CLI option with safe defaults

### 2. Structured generation contract (JSON)
- Each dataset row is transformed into a generated evalcase via an LLM.
- The LLM MUST return a single JSON object per row describing the evalcase fields (`id`, `input_messages`, `expected_outcome` and/or `expected_messages`, optional `note`).

### 3. Minimal templating
- Provide a default generation prompt template.
- Allow override via `--prompt` / `--prompt-path`.

## Impact
- **Affected specs**: `rubric-generation` (CLI generation surface)
- **Affected code (expected)**: CLI command plumbing, dataset readers, YAML writer, provider selection.

## Compatibility
- Additive change.
- Does not affect `agentv eval`.
- Does not change YAML parsing rules; it produces standard YAML suites.
