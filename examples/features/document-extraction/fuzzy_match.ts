#!/usr/bin/env bun
/**
 * Fuzzy String Matching code_judge Example
 *
 * This script demonstrates how to implement fuzzy string matching as a code_judge
 * evaluator. Use this approach for comparing extracted text that may have OCR errors,
 * formatting variations, or minor typos.
 *
 * Usage in dataset.yaml:
 * ```yaml
 * evaluators:
 *   - name: vendor_name_fuzzy
 *     type: code_judge
 *     script: ["bun", "run", "./fuzzy_match.ts"]
 * ```
 *
 * The script reads evaluation context from stdin and outputs a JSON result.
 */

interface EvalInput {
  candidate_answer: string;
  reference_answer: string;
  expected_outcome: string;
  question: string;
}

interface EvalOutput {
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
}

/**
 * Calculate Levenshtein distance between two strings.
 * This is the number of single-character edits (insertions, deletions, substitutions)
 * required to change one string into the other.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate Levenshtein similarity (0.0 to 1.0).
 * Returns 1.0 for identical strings, 0.0 for completely different strings.
 */
function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const distance = levenshteinDistance(a, b);
  return 1.0 - distance / maxLen;
}

/**
 * Calculate Jaro similarity between two strings.
 */
function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
}

/**
 * Calculate Jaro-Winkler similarity (0.0 to 1.0).
 * Gives bonus weight to common prefixes, useful for names and addresses.
 */
function jaroWinklerSimilarity(s1: string, s2: string): number {
  const jaro = jaroSimilarity(s1, s2);

  // Find common prefix (up to 4 characters)
  let prefixLength = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefixLength++;
    } else {
      break;
    }
  }

  // Jaro-Winkler with scaling factor 0.1
  return jaro + prefixLength * 0.1 * (1 - jaro);
}

// Configuration - adjust these for your use case
const SIMILARITY_THRESHOLD = 0.85;
const ALGORITHM: 'levenshtein' | 'jaro_winkler' = 'levenshtein';

async function main(): Promise<void> {
  // Read input from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }
  const inputText = Buffer.concat(chunks).toString('utf-8');
  const input: EvalInput = JSON.parse(inputText);

  // Extract and normalize strings for comparison
  const candidate = String(input.candidate_answer || '')
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
    reasoning: `${ALGORITHM} similarity between "${input.candidate_answer}" and "${input.reference_answer}": ${(similarity * 100).toFixed(1)}%`,
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
