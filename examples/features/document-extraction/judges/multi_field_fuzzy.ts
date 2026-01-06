#!/usr/bin/env bun
/**
 * Multi-Field Fuzzy Matcher
 *
 * A configurable code_judge that compares multiple fields using Levenshtein similarity.
 * Configuration is passed via YAML properties that become stdin config.
 *
 * Usage in dataset.yaml:
 * ```yaml
 * evaluators:
 *   - name: party_names_fuzzy
 *     type: code_judge
 *     script: ["bun", "run", "../judges/multi_field_fuzzy.ts"]
 *     fields:
 *       - path: supplier.name
 *         threshold: 0.85
 *       - path: importer.name
 *         threshold: 0.80
 *     algorithm: levenshtein  # or jaro_winkler
 * ```
 */

import { levenshteinSimilarity, jaroWinklerSimilarity } from '../lib/fuzzy_utils';

interface FieldConfig {
  path: string;
  threshold?: number;
}

interface EvalConfig {
  fields?: FieldConfig[];
  threshold?: number; // Default threshold if not specified per-field
  algorithm?: 'levenshtein' | 'jaro_winkler';
}

interface EvalInput {
  candidate_answer: string;
  reference_answer: string;
  config: EvalConfig | null;
}

interface EvalOutput {
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
}

function getFieldValue(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function main(): Promise<void> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }
  const input: EvalInput = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

  const config = input.config ?? {};
  const fields = config.fields ?? [];
  const defaultThreshold = config.threshold ?? 0.85;
  const algorithm = config.algorithm ?? 'levenshtein';

  if (fields.length === 0) {
    console.log(
      JSON.stringify({
        score: 0,
        hits: [],
        misses: ['No fields configured'],
        reasoning: 'config.fields is empty or not provided',
      }),
    );
    return;
  }

  // Parse JSON from candidate and reference
  let candidateObj: unknown;
  let referenceObj: unknown;
  try {
    candidateObj = JSON.parse(input.candidate_answer);
    referenceObj = JSON.parse(input.reference_answer);
  } catch {
    console.log(
      JSON.stringify({
        score: 0,
        hits: [],
        misses: ['Failed to parse JSON'],
        reasoning: 'Could not parse candidate or reference as JSON',
      }),
    );
    return;
  }

  const hits: string[] = [];
  const misses: string[] = [];
  const details: string[] = [];
  let totalScore = 0;

  for (const field of fields) {
    const threshold = field.threshold ?? defaultThreshold;
    const candidateValue = getFieldValue(candidateObj, field.path);
    const referenceValue = getFieldValue(referenceObj, field.path);

    if (typeof candidateValue !== 'string' || typeof referenceValue !== 'string') {
      misses.push(`${field.path}: field not found or not a string`);
      details.push(`${field.path}: missing or non-string`);
      continue;
    }

    const candidate = candidateValue.trim().toLowerCase();
    const expected = referenceValue.trim().toLowerCase();

    const similarity =
      algorithm === 'jaro_winkler'
        ? jaroWinklerSimilarity(candidate, expected)
        : levenshteinSimilarity(candidate, expected);

    const passed = similarity >= threshold;
    const pct = (similarity * 100).toFixed(1);

    const thresholdPct = (threshold * 100).toFixed(0);
    if (passed) {
      hits.push(`${field.path}: ${pct}% >= ${thresholdPct}% threshold`);
      totalScore += 1;
    } else {
      misses.push(`${field.path}: ${pct}% < ${thresholdPct}% threshold`);
    }
    details.push(`${field.path}: "${candidateValue}" vs "${referenceValue}" = ${pct}%`);
  }

  const score = fields.length > 0 ? totalScore / fields.length : 0;

  const output: EvalOutput = {
    score,
    hits,
    misses,
    reasoning: details.join('; '),
  };

  console.log(JSON.stringify(output));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      score: 0,
      hits: [],
      misses: [`Error: ${error.message}`],
      reasoning: `Evaluation failed: ${error.message}`,
    }),
  );
  process.exit(1);
});
