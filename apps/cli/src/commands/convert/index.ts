import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeLineEndings } from '@agentv/core';
import { command, option, optional, positional, string } from 'cmd-ts';
import { stringify as stringifyYaml } from 'yaml';

function convertJsonlToYaml(inputPath: string, outputPath: string): number {
  const content = readFileSync(inputPath, 'utf8');
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line.trim());

  let yamlOutput = '';
  let isFirst = true;

  for (const line of lines) {
    const record = JSON.parse(line);
    const yamlDoc = stringifyYaml(record, {
      indent: 2,
      lineWidth: 0,
    });

    const normalizedYaml = normalizeLineEndings(yamlDoc);
    const separator = isFirst ? '---\n' : '\n---\n';
    isFirst = false;
    yamlOutput += separator + normalizedYaml;
  }

  writeFileSync(outputPath, yamlOutput);
  return lines.length;
}

export const convertCommand = command({
  name: 'convert',
  description: 'Convert evaluation results from JSONL to YAML format',
  args: {
    input: positional({
      type: string,
      displayName: 'input',
      description: 'Path to input JSONL file',
    }),
    out: option({
      type: optional(string),
      long: 'out',
      short: 'o',
      description: 'Output file path (defaults to input path with .yaml extension)',
    }),
  },
  handler: async ({ input, out }) => {
    if (!input.endsWith('.jsonl')) {
      console.error('Error: Input file must be a .jsonl file');
      process.exit(1);
    }

    const outputPath = out ?? input.replace(/\.jsonl$/, '.yaml');

    try {
      const count = convertJsonlToYaml(input, outputPath);
      console.log(`Converted ${count} records to ${path.resolve(outputPath)}`);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
