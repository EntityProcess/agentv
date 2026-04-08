# Content Preprocessors

Demonstrates how `llm-grader` preprocessors turn `ContentFile` outputs into text before grading.

## What This Shows

- top-level `preprocessors:` shared by all graders in an eval
- an agent target returning a `ContentFile` block instead of plain text
- an `llm-grader` receiving transformed spreadsheet text
- relative `ContentFile.path` resolution against the target workspace

## Running

```bash
# From repository root
bun apps/cli/src/cli.ts eval examples/features/preprocessors/evals/dataset.eval.yaml --target file_output
```

Expected result: the eval passes because the grader sees the transformed spreadsheet text from `generated/report.xlsx`.

## Key Files

- `evals/dataset.eval.yaml` - eval with top-level `preprocessors`
- `.agentv/targets.yaml` - custom file-producing target and custom grader target
- `.agentv/providers/file-output.ts` - emits a relative `ContentFile` path
- `.agentv/providers/grader-check.ts` - passes only when transformed text reaches the grader prompt
- `scripts/preprocessors/xlsx-to-csv.ts` - example spreadsheet preprocessor script
