#!/usr/bin/env bun
/**
 * Multi-Field Fuzzy Matcher
 *
 * A configurable code_grader that compares multiple fields using Levenshtein similarity.
 * Configuration is passed via YAML properties that become stdin config.
 *
 * Usage in dataset.eval.yaml:
 * ```yaml
 * evaluators:
 *   - name: party_names_fuzzy
 *     type: code_grader
 *     script: ["bun", "run", "../graders/multi_field_fuzzy.ts"]
 *     fields:
 *       - path: supplier.name
 *         threshold: 0.85
 *       - path: importer.name
 *         threshold: 0.80
 *     algorithm: levenshtein  # or jaro_winkler
 * ```
 */

import { jaroWinklerSimilarity, levenshteinSimilarity } from '../lib/fuzzy_utils';

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
  answer: string;
  reference_answer: string;
  config: EvalConfig | null;
}

interface AssertionEntry {
  text: string;
  passed: boolean;
  evidence?: string;
}

interface EvalOutput {
  score: number;
  assertions: AssertionEntry[];
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
        assertions: [{ text: 'No fields configured', passed: false }],
      }),
    );
    return;
  }

  // Parse JSON from candidate and reference
  let candidateObj: unknown;
  let referenceObj: unknown;
  try {
    candidateObj = JSON.parse(input.answer);
    referenceObj = JSON.parse(input.reference_answer);
  } catch {
    console.log(
      JSON.stringify({
        score: 0,
        assertions: [{ text: 'Failed to parse JSON', passed: false }],
      }),
    );
    return;
  }

  const assertions: AssertionEntry[] = [];
  let totalScore = 0;

  for (const field of fields) {
    const threshold = field.threshold ?? defaultThreshold;
    const candidateValue = getFieldValue(candidateObj, field.path);
    const referenceValue = getFieldValue(referenceObj, field.path);

    if (typeof candidateValue !== 'string' || typeof referenceValue !== 'string') {
      assertions.push({ text: `${field.path}: field not found or not a string`, passed: false });
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
      assertions.push({
        text: `${field.path}: ${pct}% >= ${thresholdPct}% threshold`,
        passed: true,
        evidence: `"${candidateValue}" vs "${referenceValue}" = ${pct}%`,
      });
      totalScore += 1;
    } else {
      assertions.push({
        text: `${field.path}: ${pct}% < ${thresholdPct}% threshold`,
        passed: false,
        evidence: `"${candidateValue}" vs "${referenceValue}" = ${pct}%`,
      });
    }
  }

  const score = fields.length > 0 ? totalScore / fields.length : 0;

  const output: EvalOutput = {
    score,
    assertions,
  };

  console.log(JSON.stringify(output));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      score: 0,
      assertions: [{ text: `Error: ${error.message}`, passed: false }],
    }),
  );
  process.exit(1);
});
