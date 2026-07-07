# File Output Transforms

Demonstrates how `default_test.options.transform` turns `ContentFile` outputs into text before grading.

## What This Shows

- a suite-level output transform shared by all tests in an eval
- an agent target returning a `ContentFile` block instead of plain text
- an `llm-rubric` receiving transformed spreadsheet text
- relative `ContentFile.path` resolution against the target workspace
- a deterministic grader target for local validation and a live LLM grader target for dogfood

## Running

```bash
# From repository root
bun apps/cli/src/cli.ts eval examples/features/file-transforms/evals/suite.yaml --provider file_output
```

Expected result: the eval passes because the grader sees the transformed spreadsheet text from `generated/report.xlsx`.

To run the same file-output path with a live OpenAI-compatible grader:

```bash
LOCAL_OPENAI_PROXY_BASE_URL=http://127.0.0.1:10531/v1 \
LOCAL_OPENAI_PROXY_API_KEY=dummy-local-key \
LOCAL_OPENAI_PROXY_MODEL=gpt-5.4-mini \
bun apps/cli/src/cli.ts eval examples/features/file-transforms/evals/suite.yaml --provider file_output_live
```

## Key Files

- `evals/suite.yaml` - eval with `default_test.options.transform`
- `.agentv/providers.yaml` - custom file-producing target and custom grader target
- `.agentv/providers/file-output.ts` - emits a relative `ContentFile` path
- `.agentv/providers/grader-check.ts` - passes only when transformed text reaches the grader prompt
- `scripts/transforms/xlsx-to-csv.ts` - example spreadsheet conversion script
