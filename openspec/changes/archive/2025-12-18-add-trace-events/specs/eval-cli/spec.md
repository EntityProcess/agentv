# Spec Delta: Eval CLI (Trace Output)

## ADDED Requirements

### Requirement: Result output SHALL include trace summary by default

The CLI output formats SHALL include a compact `trace_summary` field when available.

#### Scenario: JSONL includes trace_summary by default
- **WHEN** an eval result is written to JSONL
- **AND** the provider produced a trace
- **THEN** the JSON object includes `trace_summary`
- **AND** omits full `trace` array by default to avoid bloating the results

#### Scenario: Trace summary includes tool identity
- **WHEN** `trace_summary` is present
- **THEN** it includes the distinct tool names invoked and per-tool call counts (e.g., `toolCallsByName`)
- **AND** downstream evaluators can use these fields without needing provider-specific parsing

#### Scenario: No trace available
- **WHEN** an eval result is written to JSONL
- **AND** the provider did not produce a trace
- **THEN** the JSON object omits `trace_summary` (or sets it to `null`)

### Requirement: Trace artifacts MAY be dumped to files

The CLI SHALL allow users to dump trace artifacts to separate files for debugging.

#### Scenario: Dump traces enabled
- **WHEN** the user runs `agentv eval` with `--dump-traces`
- **THEN** the CLI writes one trace JSON file per eval case attempt under `.agentv/traces/`
- **AND** the filename includes eval case id and attempt number (e.g., `branch-deactivation-001_attempt-1.json`)
- **AND** the trace file includes `eval_id`, `attempt`, `target`, and the normalized trace payload
- **AND** when a provider does not supply a trace, the file contains `trace: null` with `trace_summary: null`

#### Scenario: Dump traces disabled by default
- **WHEN** the user runs `agentv eval` without `--dump-traces`
- **THEN** the CLI does not write separate trace artifact files

### Requirement: Full trace MAY be included inline via CLI flag

The CLI SHALL allow users to include full trace data inline in result output.

#### Scenario: Include full trace in results
- **WHEN** the user runs `agentv eval` with `--include-trace`
- **THEN** the CLI includes the full normalized `trace` array in the result output
- **AND** still includes `trace_summary` for quick scanning

#### Scenario: Default excludes full trace
- **WHEN** the user runs `agentv eval` without `--include-trace`
- **THEN** the CLI omits the full `trace` array from result output
- **AND** only includes `trace_summary`
