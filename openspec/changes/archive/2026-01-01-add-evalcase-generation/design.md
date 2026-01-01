# Design: generate evals (Evalcase Generation)

## Goals
- Generate AgentV YAML eval suites from raw datasets with minimal/no custom code.
- Make generation deterministic-ish via strict JSON output.
- Keep the first version simple: JSON/JSONL inputs, one LLM call per row, concurrency control.

## Non-goals (initial scope)
- Tool-augmented generation (search/tools) as a built-in agent runner.
- CSV ingestion (can be added later).
- Complex dataset sampling/stratification.

## Command Shape

### `agentv generate evals`
Required:
- `--in <path>`: dataset file (`.json` or `.jsonl`)
- `--out <path>`: output YAML file

Optional:
- `--target <name>`: generation target (default follows existing target resolution patterns)
- `--limit <n>`: maximum rows to process
- `--concurrency <n>`: parallel generation workers
- `--id-prefix <prefix>`: prefix for generated evalcase IDs
- `--prompt <text>` or `--prompt-path <file>`: override generation prompt

## Input Formats

### JSON
- Must be an array of objects.

### JSONL
- Each line is a JSON object.

## Output Contract (LLM JSON)
Generation uses a strict JSON schema; per row the model returns:
- `id: string`
- `input_messages: [{ role: string, content: string }]`
- `expected_outcome?: string`
- `expected_messages?: [{ role: string, content: string }]`
- `note?: string`

The CLI validates the object before adding it to the output suite.

## Output YAML
The emitted YAML suite uses:
- `description`
- `target`
- `evalcases: [...]`

## Failure Handling
- If a row fails generation or schema validation:
  - default behavior: skip and record an error list
  - optional strict mode (future): fail the command

## Relationship to Trace Proposal
This command is valuable even without trace support.
If trace support exists, the generation prompt can instruct the model to include process constraints in `expected_outcome` or in evaluator configs, but this is out of scope for the first version.
