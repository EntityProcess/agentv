import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isAgentSkillsFormat, normalizeLineEndings, parseAgentSkillsEvals } from '@agentv/core';
import { command, option, optional, positional, string } from 'cmd-ts';
import { stringify as stringifyYaml } from 'yaml';

import { HtmlWriter } from '../eval/html-writer.js';

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
  const content = readFileSync(inputPath, 'utf8');
  const parsed = JSON.parse(content);

  if (!isAgentSkillsFormat(parsed)) {
    throw new Error(`Not a valid Agent Skills evals.json: missing 'evals' array`);
  }

  const tests = parseAgentSkillsEvals(parsed, inputPath, path.dirname(path.resolve(inputPath)));
  const lines: string[] = [];

  lines.push('# Converted from Agent Skills evals.json');
  lines.push('# See: https://agentskills.io/skill-creation/evaluating-skills');
  lines.push('#');
  lines.push('# AgentV features you can add:');
  lines.push('#   - type: is_json, contains, regex for deterministic evaluators');
  lines.push('#   - type: code-grader for custom scoring scripts');
  lines.push('#   - Multi-turn conversations via input message arrays');
  lines.push('#   - Composite evaluators with weighted scoring');
  lines.push('#   - Workspace isolation with repos and hooks');
  lines.push('');

  if (parsed.skill_name) {
    lines.push(`description: "Evals for ${parsed.skill_name} skill"`);
    lines.push('');
  }

  lines.push('tests:');

  for (const test of tests) {
    lines.push(`  - id: "${test.id}"`);
    lines.push('');

    // Emit criteria
    if (test.criteria) {
      lines.push('    criteria: |-');
      for (const line of test.criteria.split('\n')) {
        lines.push(`      ${line}`);
      }
      lines.push('');
    }

    // Emit input as simple user message
    lines.push('    input:');
    for (const msg of test.input) {
      lines.push(`      - role: ${msg.role}`);
      if (typeof msg.content === 'string' && msg.content.includes('\n')) {
        lines.push('        content: |-');
        for (const line of msg.content.split('\n')) {
          lines.push(`          ${line}`);
        }
      } else {
        lines.push(
          `        content: "${typeof msg.content === 'string' ? msg.content.replace(/"/g, '\\"') : msg.content}"`,
        );
      }
    }
    lines.push('');

    // Emit expected_output
    if (test.expected_output && test.expected_output.length > 0) {
      lines.push('    expected_output:');
      for (const msg of test.expected_output) {
        lines.push(`      - role: ${msg.role}`);
        if (typeof msg.content === 'string' && msg.content.includes('\n')) {
          lines.push('        content: |-');
          for (const line of msg.content.split('\n')) {
            lines.push(`          ${line}`);
          }
        } else {
          lines.push(
            `        content: "${typeof msg.content === 'string' ? msg.content.replace(/"/g, '\\"') : msg.content}"`,
          );
        }
      }
      lines.push('');
    }

    // Emit assertions as llm-grader evaluators
    if (test.assertions && test.assertions.length > 0) {
      lines.push('    # Promoted from evals.json assertions[]');
      lines.push('    # Replace with type: is_json, contains, or regex for deterministic checks');
      lines.push('    assertions:');
      for (const assertion of test.assertions) {
        lines.push(`      - name: ${assertion.name}`);
        lines.push(`        type: ${assertion.type}`);
        if ((assertion.type === 'llm-grader' || assertion.type === 'llm-judge') && 'prompt' in assertion) {
          const prompt = (assertion as { prompt: string }).prompt;
          lines.push(`        prompt: "${prompt.replace(/"/g, '\\"')}"`);
        }
      }
      lines.push('');
    }

    // Note about files
    if (test.file_paths && test.file_paths.length > 0) {
      lines.push('    # TODO: Configure workspace.repos or file references for these files:');
      const agentSkillsFiles = test.metadata?.agent_skills_files as readonly string[] | undefined;
      if (agentSkillsFiles) {
        for (const file of agentSkillsFiles) {
          lines.push(`    #   - ${file}`);
        }
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
