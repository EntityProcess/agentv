#!/usr/bin/env bun
/**
 * Fuzzy String Matching code_grader Example
 *
 * This script demonstrates how to implement fuzzy string matching as a code_grader
 * evaluator. Use this approach for comparing extracted text that may have OCR errors,
 * formatting variations, or minor typos.
 *
 * Usage in dataset.eval.yaml:
 * ```yaml
 * evaluators:
 *   - name: vendor_name_fuzzy
 *     type: code_grader
 *     script: ["bun", "run", "../graders/fuzzy_match.ts"]
 * ```
 *
 * The script reads evaluation context from stdin and outputs a JSON result.
 */

import { jaroWinklerSimilarity, levenshteinSimilarity } from '../lib/fuzzy_utils';

interface EvalInput {
  output_text: string;
  expected_output_text: string;
  criteria: string;
  input_text: string;
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

// Configuration - adjust these for your use case
const SIMILARITY_THRESHOLD = 0.85;
const ALGORITHM: 'levenshtein' | 'jaro_winkler' = 'levenshtein';

async function main(): Promise<void> {
  // Read input from stdin
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }
  const inputText = Buffer.concat(chunks).toString('utf-8');
  const input: EvalInput = JSON.parse(inputText);

  // Extract and normalize strings for comparison
  const candidate = String(input.output_text || '')
    .trim()
    .toLowerCase();
  const expected = String(input.expected_output_text || '')
    .trim()
    .toLowerCase();

  // Calculate similarity
  let similarity: number;
  if (ALGORITHM === 'jaro_winkler') {
    similarity = jaroWinklerSimilarity(candidate, expected);
  } else {
    similarity = levenshteinSimilarity(candidate, expected);
  }

  // Determine pass/fail based on threshold
  const passed = similarity >= SIMILARITY_THRESHOLD;

  const output: EvalOutput = {
    score: similarity,
    assertions: [
      {
        text: passed
          ? `Similarity: ${(similarity * 100).toFixed(1)}% (threshold: ${SIMILARITY_THRESHOLD * 100}%)`
          : `Similarity: ${(similarity * 100).toFixed(1)}% < ${SIMILARITY_THRESHOLD * 100}% threshold`,
        passed,
        evidence: `${ALGORITHM} similarity between "${input.output_text}" and "${input.expected_output_text}": ${(similarity * 100).toFixed(1)}%`,
      },
    ],
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
