import { readFileSync, writeFileSync } from 'node:fs';
import { toCamelCaseDeep, toSnakeCaseDeep, trimBaselineResult } from '@agentv/core';
import type { EvaluationResult } from '@agentv/core';
import { command, option, optional, positional, string } from 'cmd-ts';

/**
 * Trims a JSONL file of EvaluationResults, stripping debug/audit fields
 * that are unnecessary for baseline comparisons.
 */
export const trimCommand = command({
  name: 'trim',
  description: 'Trim evaluation results for baseline storage (strips debug/audit fields)',
  args: {
    input: positional({
      type: string,
      displayName: 'input',
      description: 'Path to input JSONL result file',
    }),
    out: option({
      type: optional(string),
      long: 'out',
      short: 'o',
      description: 'Path to output JSONL file (defaults to stdout)',
    }),
  },
  handler: async ({ input, out }) => {
    try {
      const content = readFileSync(input, 'utf8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.trim());

      const trimmedLines = lines.map((line) => {
        const record = JSON.parse(line);
        // Records on disk are snake_case; convert to camelCase for trimming, then back
        const camel = toCamelCaseDeep(record) as EvaluationResult;
        const trimmed = trimBaselineResult(camel);
        const snake = toSnakeCaseDeep(trimmed);
        return JSON.stringify(snake);
      });

      const output = `${trimmedLines.join('\n')}\n`;

      if (out) {
        writeFileSync(out, output, 'utf8');
        console.error(`Trimmed ${lines.length} record(s) → ${out}`);
      } else {
        process.stdout.write(output);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
