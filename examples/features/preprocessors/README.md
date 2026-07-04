# File Output Transforms

Demonstrates how `default_test.options.transform` turns `ContentFile` outputs into text before grading.

## What This Shows

- a suite-level output transform shared by all tests in an eval
- an agent target returning a `ContentFile` block instead of plain text
- an `llm-rubric` receiving transformed spreadsheet text
- relative `ContentFile.path` resolution against the target workspace

## Running

```bash
# From repository root
bun apps/cli/src/cli.ts eval examples/features/preprocessors/evals/suite.yaml --target file_output
```

Expected result: the eval passes because the grader sees the transformed spreadsheet text from `generated/report.xlsx`.

## Key Files

- `evals/suite.yaml` - eval with `default_test.options.transform`
- `.agentv/targets.yaml` - custom file-producing target and custom grader target
- `.agentv/providers/file-output.ts` - emits a relative `ContentFile` path
- `.agentv/providers/grader-check.ts` - passes only when transformed text reaches the grader prompt
- `scripts/preprocessors/xlsx-to-csv.ts` - example spreadsheet conversion script
