#!/usr/bin/env bun
/**
 * Fuzzy String Matching code_judge Example
 *
 * This script demonstrates how to implement fuzzy string matching as a code_judge
 * evaluator. Use this approach for comparing extracted text that may have OCR errors,
 * formatting variations, or minor typos.
 *
 * Usage in dataset.eval.yaml:
 * ```yaml
 * evaluators:
 *   - name: vendor_name_fuzzy
 *     type: code_judge
 *     script: ["bun", "run", "../judges/fuzzy_match.ts"]
 * ```
 *
 * The script reads evaluation context from stdin and outputs a JSON result.
 */

import { jaroWinklerSimilarity, levenshteinSimilarity } from '../lib/fuzzy_utils';

interface EvalInput {
  answer: string;
  reference_answer: string;
  criteria: string;
  question: string;
}

interface EvalOutput {
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
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
  const candidate = String(input.answer || '')
    .trim()
    .toLowerCase();
  const expected = String(input.reference_answer || '')
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
    hits: passed
      ? [
          `Similarity: ${(similarity * 100).toFixed(1)}% (threshold: ${SIMILARITY_THRESHOLD * 100}%)`,
        ]
      : [],
    misses: passed
      ? []
      : [
          `Similarity: ${(similarity * 100).toFixed(1)}% < ${SIMILARITY_THRESHOLD * 100}% threshold`,
        ],
    reasoning: `${ALGORITHM} similarity between "${input.answer}" and "${input.reference_answer}": ${(similarity * 100).toFixed(1)}%`,
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
