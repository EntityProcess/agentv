# Change: Add Claude Code CLI provider

## Why
AgentV supports evaluating AI coding agents via Codex CLI and Pi Coding Agent providers. Users should also be able to evaluate Claude Code (Anthropic's official CLI) using the same framework, enabling unified benchmarking across all major coding agents.

## What Changes
- Add a new `claude-code` provider type that invokes the `claude` CLI with proper arguments
- Parse JSONL streaming output (`--output-format stream-json`) to extract messages, tool calls, and usage metrics
- Support model selection, system prompts, custom arguments, and timeout configuration
- Include stream logging similar to Codex and Pi providers for debugging

## Impact
- Affected specs: `evaluation` (new provider kind)
- Affected code:
  - `packages/core/src/evaluation/providers/claude-code.ts` (new)
  - `packages/core/src/evaluation/providers/claude-code-log-tracker.ts` (new)
  - `packages/core/src/evaluation/providers/targets.ts` (add config)
  - `packages/core/src/evaluation/providers/index.ts` (export)
  - `packages/core/src/evaluation/providers/types.ts` (add kind)
