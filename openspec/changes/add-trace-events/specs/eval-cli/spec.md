# Spec Delta: Eval CLI (Trace Output)

## ADDED Requirements

### Requirement: Trace Artifacts MUST be optionally persisted

The CLI SHALL allow users to persist trace artifacts for debugging and auditing.

#### Scenario: Dump traces enabled
- **WHEN** the user runs `agentv eval` with `--dump-traces`
- **THEN** the CLI writes one trace JSON file per eval case attempt under `.agentv/traces/`
- **AND** the trace file includes `eval_id`, `attempt`, `target`, and the normalized trace payload when available
- **AND** when a provider does not supply a trace, the file contains an empty trace with a summary indicating zero events

#### Scenario: Dump traces disabled
- **WHEN** `--dump-traces` is not provided
- **THEN** the CLI does not write separate trace artifact files

### Requirement: Result output SHALL include trace summary

The CLI output formats SHALL include a compact `trace_summary` field when available.

#### Scenario: JSONL includes trace_summary
- **WHEN** an eval result is written to JSONL
- **THEN** the JSON object includes `trace_summary` when the provider produced a trace
- **AND** omits `trace` by default to avoid bloating the results

#### Scenario: Trace summary includes tool identity
- **WHEN** `trace_summary` is present
- **THEN** it includes the distinct tool names invoked and per-tool call counts (e.g., `toolCallsByName`)
- **AND** downstream evaluators can use these fields without needing provider-specific parsing

#### Scenario: Include full trace in results
- **WHEN** the user runs `agentv eval` with `--include-trace`
- **THEN** the CLI includes the full normalized `trace` payload in the result output
- **AND** still includes `trace_summary` for quick scanning
