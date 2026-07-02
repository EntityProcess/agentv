import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { command, option, optional, positional, string } from 'cmd-ts';
import { stringify as stringifyYaml } from 'yaml';

import { HtmlWriter } from '../eval/html-writer.js';
import { readAgentSkillsEvalsFile } from '../read-adapters/agent-skills-evals.js';

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

async function convertJsonlToHtml(inputPath: string, outputPath: string): Promise<number> {
  const content = readFileSync(inputPath, 'utf8');
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line.trim());

  const writer = await HtmlWriter.open(outputPath);
  for (const line of lines) {
    await writer.append(JSON.parse(line));
  }
  await writer.close();
  return lines.length;
}

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

/**
 * Convert an Agent Skills evals.json file into an AgentV EVAL.yaml.
 * Returns the YAML string.
 */
export function convertEvalsJsonToYaml(inputPath: string): string {
  const suite = readAgentSkillsEvalsFile(inputPath);
  const lines: string[] = [];

  lines.push('# Converted from Agent Skills evals.json');
  lines.push('# See: https://agentskills.io/skill-creation/evaluating-skills');
  lines.push('# Agent Skills expected_output is treated as expected outcome/rubric context,');
  lines.push('# not as AgentV expected_output reference data.');
  lines.push('#');
  lines.push('# AgentV features you can add:');
  lines.push('#   - type: is-json, contains, regex for deterministic graders');
  lines.push('#   - type: script for custom scoring scripts');
  lines.push('#   - type: g-eval criteria with weights and score ranges for rubrics');
  lines.push('#   - Multi-turn conversations via input message arrays');
  lines.push('#   - Multiple assertions with weighted scoring');
  lines.push('#   - Workspace isolation with repos and hooks');
  lines.push('');

  lines.push(`description: ${quoteYamlString(`Evals for ${suite.skillName} skill`)}`);
  lines.push('tags:');
  lines.push(`  skill: ${quoteYamlString(suite.skillName)}`);
  lines.push('metadata:');
  lines.push('  source_adapter: "agent-skills-evals-json"');
  lines.push('');

  lines.push('tests:');

  for (const test of suite.tests) {
    lines.push(`  - id: "${test.id}"`);
    lines.push('');

    // Emit criteria from Agent Skills expected_output.
    if (test.expectedOutcome) {
      lines.push('    criteria: |-');
      for (const line of test.expectedOutcome.split('\n')) {
        lines.push(`      ${line}`);
      }
      lines.push('');
    }

    // Emit input as shorthand so input_files can attach to the same user prompt.
    if (test.prompt.includes('\n')) {
      lines.push('    input: |-');
      for (const line of test.prompt.split('\n')) {
        lines.push(`      ${line}`);
      }
    } else {
      lines.push(`    input: ${quoteYamlString(test.prompt)}`);
    }
    lines.push('');

    if (test.files.length > 0) {
      lines.push('    input_files:');
      for (const file of test.files) {
        lines.push(`      - ${quoteYamlString(file)}`);
      }
      lines.push('');
    }

    // Emit expected_output / assertions / expectations as rubric criteria.
    if (test.criteria.length > 0) {
      lines.push('    # Promoted from evals.json expected_output, assertions[], and expectations[]');
      lines.push('    # Replace with type: is-json, contains, or regex for deterministic checks');
      lines.push('    assertions:');
      lines.push('      - name: agent-skills-criteria');
      lines.push('        type: g-eval');
      lines.push('        criteria:');
      for (const criterion of test.criteria) {
        lines.push(`          - id: ${quoteYamlString(criterion.id)}`);
        lines.push(`            outcome: ${quoteYamlString(criterion.outcome)}`);
        lines.push('            required: true');
      }
      lines.push('');
    }
  }

  return `${lines.join('\n')}\n`;
}

export const convertCommand = command({
  name: 'convert',
  description: 'Convert between evaluation formats (JSONL→YAML, JSONL→HTML, evals.json→EVAL.yaml)',
  args: {
    input: positional({
      type: string,
      displayName: 'input',
      description: 'Path to input file (.jsonl or .json)',
    }),
    out: option({
      type: optional(string),
      long: 'out',
      short: 'o',
      description: 'Output file path (defaults to stdout for evals.json, .yaml or .html for JSONL)',
    }),
  },
  handler: async ({ input, out }) => {
    const ext = path.extname(input).toLowerCase();

    if (ext === '.json') {
      try {
        const yaml = convertEvalsJsonToYaml(input);
        if (out) {
          writeFileSync(out, yaml);
          console.log(`Converted to ${path.resolve(out)}`);
        } else {
          process.stdout.write(yaml);
        }
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
      return;
    }

    if (ext === '.jsonl') {
      const outExt = out ? path.extname(out).toLowerCase() : '.yaml';
      if (outExt === '.html' || outExt === '.htm') {
        const outputPath = out ?? input.replace(/\.jsonl$/, '.html');
        try {
          const count = await convertJsonlToHtml(input, outputPath);
          console.log(`Converted ${count} records to ${path.resolve(outputPath)}`);
        } catch (error) {
          console.error(`Error: ${(error as Error).message}`);
          process.exit(1);
        }
        return;
      }
      const outputPath = out ?? input.replace(/\.jsonl$/, '.yaml');
      try {
        const count = convertJsonlToYaml(input, outputPath);
        console.log(`Converted ${count} records to ${path.resolve(outputPath)}`);
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
      return;
    }

    console.error(`Error: Unsupported input format '${ext}'. Supported: .json, .jsonl`);
    process.exit(1);
  },
});
