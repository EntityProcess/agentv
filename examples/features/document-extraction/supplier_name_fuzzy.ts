#!/usr/bin/env bun
/**
 * Supplier Name Fuzzy Matcher
 *
 * Example code_judge that extracts supplier.name from structured JSON
 * and compares using Levenshtein similarity. Demonstrates how to combine
 * field_accuracy (for exact/numeric/date fields) with fuzzy matching
 * for specific text fields.
 *
 * Customize this template for your own field paths and thresholds.
 */

// Configuration
const FIELD_PATH = 'supplier.name';
const SIMILARITY_THRESHOLD = 0.85;

interface EvalInput {
  candidate_answer: string;
  reference_answer: string;
}

interface EvalOutput {
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  return 1.0 - levenshteinDistance(a, b) / maxLen;
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
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }
  const input: EvalInput = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

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

  // Extract field values
  const candidateValue = getFieldValue(candidateObj, FIELD_PATH);
  const referenceValue = getFieldValue(referenceObj, FIELD_PATH);

  if (typeof candidateValue !== 'string' || typeof referenceValue !== 'string') {
    console.log(
      JSON.stringify({
        score: 0,
        hits: [],
        misses: [`${FIELD_PATH}: field not found or not a string`],
        reasoning: `Could not extract ${FIELD_PATH} from both candidate and reference`,
      }),
    );
    return;
  }

  // Compare with fuzzy matching
  const candidate = candidateValue.trim().toLowerCase();
  const expected = referenceValue.trim().toLowerCase();
  const similarity = levenshteinSimilarity(candidate, expected);
  const passed = similarity >= SIMILARITY_THRESHOLD;

  const output: EvalOutput = {
    score: passed ? 1.0 : similarity,
    hits: passed ? [`${FIELD_PATH}: ${(similarity * 100).toFixed(1)}% similar`] : [],
    misses: passed
      ? []
      : [`${FIELD_PATH}: ${(similarity * 100).toFixed(1)}% < ${SIMILARITY_THRESHOLD * 100}%`],
    reasoning: `"${candidateValue}" vs "${referenceValue}": ${(similarity * 100).toFixed(1)}% similarity`,
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
