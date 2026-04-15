---
name: agentv-html-report
description: >-
  Generate a static HTML report from existing AgentV `*.results.jsonl` files.
  Use when asked to export a shareable results page, turn eval results into an
  offline HTML report, or publish existing AgentV run output without re-running
  the eval. Do NOT use for running evals, editing eval YAML, or analyzing traces
  when no HTML export is needed.
---

# AgentV HTML Report

Generate a self-contained Studio-themed HTML report from existing AgentV results.
Do not generate HTML with the model. Use the shipped template asset and
deterministic file I/O only.

## Inputs

- A single `*.results.jsonl` file, or
- A directory containing one or more `*.results.jsonl` files
- Optional output path

Default output path:

- single JSONL file -> sibling `<basename>.report.html`
- directory input -> `<directory>/eval-report.html`

## Workflow

### 1. Resolve the template path

Find the directory that contains this `SKILL.md`, then use:

- `assets/report-template.html`

Do all path resolution relative to the skill directory so the skill still works
when installed from a plugin manager.

### 2. Discover result files

- If the input path is a file, use that file only
- If the input path is a file and does not end with `.results.jsonl`, stop with
  a clear error instead of guessing
- If the input path is a directory, read every `*.results.jsonl` file in that
  directory
- Sort files by filename for deterministic output
- If no matching files exist, stop and report the error clearly

### 3. Read and serialize results

For each JSONL file:

1. Read UTF-8 text
2. Split on newlines
3. Ignore empty lines
4. `JSON.parse()` each line
5. Add an `eval_file` field derived from the JSONL filename with the
   `.results.jsonl` suffix removed
6. Preserve the original result payload otherwise - do not invent a new schema

Combine all parsed rows into one array, preserving filename order and the line
order inside each file.

The template groups results by `eval_file`, so every serialized entry must carry
that field even though the original JSONL does not.

### 4. Substitute into the template

Read `assets/report-template.html`, then replace the literal
`__DATA_PLACEHOLDER__` token with the JSON array string.

Before substitution, escape `</script>` inside the JSON string as `<\\/script>`
so result text cannot break out of the inline script block.

Write the completed HTML file as UTF-8.

### 5. Validate before reporting success

Confirm:

- the output file exists
- `__DATA_PLACEHOLDER__` no longer appears in the written HTML
- the HTML is self-contained (no external CSS, JS, or font URLs)

If any step fails, report the exact error and stop.

## Reference implementation

Use a small inline Node script when you need the deterministic transformation:

```bash
node --input-type=module - "$INPUT_PATH" "$OUTPUT_PATH" "$TEMPLATE_PATH" <<'EOF'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , inputPath, outputPathArg, templatePath] = process.argv;

if (!inputPath || !templatePath) {
  throw new Error('Usage: node report-export.mjs <input-path> <output-path> <template-path>');
}

const inputStat = await stat(inputPath);
if (!inputStat.isDirectory() && !/\\.results\\.jsonl$/i.test(inputPath)) {
  throw new Error(`Input file must end with .results.jsonl: ${inputPath}`);
}
const resultFiles = inputStat.isDirectory()
  ? (await readdir(inputPath))
      .filter((name) => name.endsWith('.results.jsonl'))
      .sort()
      .map((name) => path.join(inputPath, name))
  : [inputPath];

if (resultFiles.length === 0) {
  throw new Error(`No *.results.jsonl files found under ${inputPath}`);
}

const defaultOutputPath = inputStat.isDirectory()
  ? path.join(inputPath, 'eval-report.html')
  : inputPath.replace(/\.results\.jsonl$/i, '.report.html');
const outputPath = outputPathArg || defaultOutputPath;

const rows = [];
for (const filePath of resultFiles) {
  const evalFile = path.basename(filePath).replace(/\.results\.jsonl$/i, '');
  const content = await readFile(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed);
    rows.push({ ...parsed, eval_file: evalFile });
  }
}

const template = await readFile(templatePath, 'utf8');
if (!template.includes('__DATA_PLACEHOLDER__')) {
  throw new Error('Template placeholder __DATA_PLACEHOLDER__ was not found');
}
if (/https?:\\/\\//i.test(template)) {
  throw new Error('Template must remain self-contained with no external URLs');
}
const dataJson = JSON.stringify(rows).replace(/<\//g, '<\\/');
const html = template.replace('__DATA_PLACEHOLDER__', dataJson);
await writeFile(outputPath, html, 'utf8');
const written = await readFile(outputPath, 'utf8');
if (written.includes('__DATA_PLACEHOLDER__')) {
  throw new Error('Placeholder substitution failed');
}
console.log(outputPath);
EOF
```

## Notes

- This skill exports from existing results only. It does not run `agentv eval`.
- Keep the output deterministic: file read, JSON parse, one substitution, file
  write.
- Do not rewrite or regenerate the HTML structure. The shipped template is the
  source of truth.
