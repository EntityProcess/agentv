#!/usr/bin/env bun
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

interface RubricCheck {
  readonly id: string;
  readonly satisfied: boolean;
  readonly reasoning: string;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function extractRubricIds(prompt: string): string[] {
  const ids: string[] = [];
  const bracketPattern = /^- \[([^\]]+)\]/gm;
  for (const match of prompt.matchAll(bracketPattern)) {
    if (match[1]) ids.push(match[1]);
  }

  const quotedIdPattern = /"id"\s*:\s*"([^"]+)"/g;
  for (const match of prompt.matchAll(quotedIdPattern)) {
    if (match[1] && match[1] !== 'string (criterion id)') ids.push(match[1]);
  }

  return unique(ids);
}

function buildEvaluation(prompt: string): unknown {
  const ids = extractRubricIds(prompt);
  if (ids.length > 0 || prompt.includes('"checks"')) {
    const usesScoreRanges = prompt.includes('"score": integer') || prompt.includes('score ranges');
    if (usesScoreRanges) {
      return {
        checks: ids.map((id) => ({
          id,
          score: 10,
          reasoning:
            'Deterministic oracle grader marks the reference fixture as satisfying this criterion.',
        })),
        overall_reasoning: 'Deterministic oracle grader response.',
      };
    }

    return {
      checks: ids.map(
        (id): RubricCheck => ({
          id,
          satisfied: true,
          reasoning:
            'Deterministic oracle grader marks the reference fixture as satisfying this criterion.',
        }),
      ),
      overall_reasoning: 'Deterministic oracle grader response.',
    };
  }

  return {
    score: 1,
    assertions: [
      {
        text: 'Reference fixture was accepted by the deterministic oracle grader',
        passed: true,
        evidence:
          'The oracle workflow validates execution and artifact compatibility without live LLM calls.',
      },
    ],
    details: {
      oracle_grader: true,
    },
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      'prompt-file': { type: 'string' },
      output: { type: 'string' },
    },
  });

  const promptFile = values['prompt-file'];
  const outputFile = values.output;
  if (!promptFile || !outputFile) {
    throw new Error('Usage: example-oracle-grader.ts --prompt-file <path> --output <path>');
  }

  const prompt = await readFile(promptFile, 'utf8');
  const evaluation = buildEvaluation(prompt);
  const response = {
    text: JSON.stringify(evaluation),
    token_usage: { input: 0, output: 0 },
    cost_usd: 0,
    duration_ms: 1,
  };

  await writeFile(outputFile, `${JSON.stringify(response)}\n`, 'utf8');
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
