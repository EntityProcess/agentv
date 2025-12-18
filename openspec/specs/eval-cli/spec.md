# Spec: Eval CLI

## Purpose
Defines the `agentv eval` command behavior: target discovery and validation, environment loading, output handling, prompt dumping, concurrency scheduling, and summary reporting.
## Requirements
### Requirement: Target and Environment Resolution

The CLI SHALL resolve targets and environment variables before running evaluations.

#### Scenario: Targets file discovery and selection

- **WHEN** the CLI needs a targets file
- **THEN** it uses an explicit `--targets` path when provided (including nested `targets.yaml` within that path), otherwise searches the eval file directory upward to the repo root and finally the current working directory for the first `targets.yaml`/`.yml` (including `.agentv` variants)
- **AND** selects the target name using CLI override when not `"default"`, else the eval file target if present, else `"default"`

#### Scenario: Targets validation with warnings

- **WHEN** a targets file is found
- **THEN** the CLI validates it, printing warnings but aborting on validation errors before execution

#### Scenario: Lazy .env loading

- **WHEN** CLI argument parsing completes
- **THEN** the CLI loads the first `.env` file found from the eval directory upward to the repo root, then the repo root, then the current working directory
- **AND** continues without failing when no `.env` file is found

### Requirement: Eval Input Resolution

The CLI SHALL resolve eval paths and execution options from user input.

#### Scenario: Path expansion and validation

- **WHEN** the user supplies eval paths or globs
- **THEN** the CLI resolves them to YAML files (deduplicated, sorted) and fails with an error when no files match any provided pattern

#### Scenario: Dry-run mode

- **WHEN** the user passes `--dry-run` (with optional delay flags)
- **THEN** the CLI swaps the resolved target for a mock provider using the configured fixed or ranged delays and executes without external API calls

### Requirement: Concurrency and Worker Scheduling

The CLI SHALL schedule work across eval files and cases within configured worker limits.

#### Scenario: Worker limits and validation

- **WHEN** the user provides `--workers <count>`
- **THEN** the CLI enforces a minimum of 1 and maximum of 50 workers (erroring when out of range)
- **AND** defaults to 1 worker when the flag is omitted or non-numeric

#### Scenario: File-level worker balancing

- **WHEN** multiple eval files are provided with `--workers N`
- **THEN** the CLI assigns at least one worker per file up to `N`, dividing remaining workers evenly per file to cap in-flight evals

#### Scenario: VS Code worker cap

- **WHEN** the selected target is `vscode`/`vscode-insiders`
- **THEN** the CLI limits workers to 1 (with a warning when a higher value was requested) to avoid window-focus contention

### Requirement: Output Persistence and Formats

The CLI SHALL persist results in the selected format with thread-safe writes.

#### Scenario: Default output location and format

- **WHEN** no `--out` path is provided
- **THEN** the CLI writes results to `.agentv/results/eval_<timestamp>.jsonl` (or `.yaml` when `--output-format yaml`), creating parent directories as needed
- **AND** unsupported format values fall back to `jsonl` without failing

#### Scenario: JSONL output

- **WHEN** writing JSONL results
- **THEN** writes are mutex-protected, each result is serialized as a single JSON line with a trailing newline, and results may appear in completion order

#### Scenario: YAML output

- **WHEN** writing YAML results
- **THEN** each result is emitted as its own YAML document separated by `---`, preserving multiline strings, rather than a single YAML sequence

### Requirement: Prompt Dumping

The CLI SHALL optionally persist prompt payloads for debugging.

#### Scenario: Dump prompts enabled

- **WHEN** the user passes `--dump-prompts` (with optional directory)
- **THEN** the CLI ensures the directory exists (defaulting to `.agentv/prompts`), then writes one JSON file per eval case containing `eval_id`, formatted `question`, `guidelines`, and `guideline_paths`
- **AND** the dump omits provider settings and matches the exact question string sent to the provider

#### Scenario: Dump prompts disabled

- **WHEN** `--dump-prompts` is not provided
- **THEN** no prompt payload files are written

### Requirement: Summary Reporting

The CLI SHALL present a summary after all eval cases complete.

#### Scenario: Statistics and distribution

- **WHEN** all eval cases finish
- **THEN** the CLI computes mean, median, min, max, and (when applicable) standard deviation, builds a histogram with bins `[0,0.2)`, `[0.2,0.4)`, `[0.4,0.6)`, `[0.6,0.8)`, `[0.8,1.0]`, and prints top/bottom three results

#### Scenario: Error surfacing

- **WHEN** any eval results include an `error`
- **THEN** the CLI lists those errors in an `ERRORS` section before the summary while still including them in the written output

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

