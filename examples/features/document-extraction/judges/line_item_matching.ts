#!/usr/bin/env bun
/**
 * Line Item Matching Judge
 *
 * A code_judge that matches expected line items to parsed line items using
 * greedy matching before scoring. This handles reordered and duplicate items.
 *
 * Matching strategy (greedy):
 * 1. Compute pairwise similarity scores based on configured match fields
 * 2. Repeatedly take the best remaining match above threshold
 * 3. Unmatched expected items count toward FN
 * 4. Unmatched parsed items count toward FP
 *
 * Usage in dataset.yaml:
 * ```yaml
 * evaluators:
 *   - name: line_items_matched
 *     type: code_judge
 *     script: ["bun", "run", "../judges/line_item_matching.ts"]
 *     match_fields: ["description"]  # Fields used for matching
 *     score_fields: ["description", "quantity", "line_total"]  # Fields to score
 *     threshold: 0.8  # Similarity threshold for matching
 *     line_items_path: line_items  # Path to line items array
 * ```
 */

import { levenshteinSimilarity } from '../lib/fuzzy_utils';

interface EvalConfig {
  match_fields?: string[];
  score_fields?: string[];
  threshold?: number;
  line_items_path?: string;
}

interface EvalInput {
  candidate_answer: string;
  expected_messages: Array<{ role: string; content: unknown }>;
  config: EvalConfig | null;
}

interface FieldMetrics {
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  precision?: number;
  recall?: number;
  f1?: number;
}

interface AlignmentEntry {
  expectedIdx: number;
  parsedIdx: number;
  similarity: number;
}

interface EvalOutput {
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
  details: {
    alignment: AlignmentEntry[];
    metrics: Record<string, FieldMetrics>;
    unmatched_expected: number[];
    unmatched_parsed: number[];
    summary: {
      matched_count: number;
      expected_count: number;
      parsed_count: number;
      macro_f1?: number;
    };
  };
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

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.hasOwn(bObj, key) && deepEqual(aObj[key], bObj[key]));
}

/**
 * Compute similarity between two items based on match fields.
 * Uses Levenshtein for strings, exact match for numbers/dates.
 */
function computeItemSimilarity(
  expected: Record<string, unknown>,
  parsed: Record<string, unknown>,
  matchFields: string[],
): number {
  if (matchFields.length === 0) return 0;

  let totalSimilarity = 0;
  let validFields = 0;

  for (const field of matchFields) {
    const expectedVal = getFieldValue(expected, field);
    const parsedVal = getFieldValue(parsed, field);

    if (expectedVal === undefined || parsedVal === undefined) {
      continue;
    }

    validFields++;

    if (typeof expectedVal === 'string' && typeof parsedVal === 'string') {
      // Normalized Levenshtein for strings
      const similarity = levenshteinSimilarity(
        expectedVal.trim().toLowerCase(),
        parsedVal.trim().toLowerCase(),
      );
      totalSimilarity += similarity;
    } else if (typeof expectedVal === 'number' && typeof parsedVal === 'number') {
      // Exact match for numbers
      totalSimilarity += expectedVal === parsedVal ? 1 : 0;
    } else {
      // Deep equality for other types
      totalSimilarity += deepEqual(expectedVal, parsedVal) ? 1 : 0;
    }
  }

  return validFields > 0 ? totalSimilarity / validFields : 0;
}

/**
 * Greedy matching: repeatedly take best match above threshold.
 */
function greedyMatch(
  expectedItems: Record<string, unknown>[],
  parsedItems: Record<string, unknown>[],
  matchFields: string[],
  threshold: number,
): AlignmentEntry[] {
  const alignment: AlignmentEntry[] = [];
  const usedExpected = new Set<number>();
  const usedParsed = new Set<number>();

  // Compute all pairwise similarities
  const pairs: Array<{ expectedIdx: number; parsedIdx: number; similarity: number }> = [];
  for (let i = 0; i < expectedItems.length; i++) {
    for (let j = 0; j < parsedItems.length; j++) {
      const similarity = computeItemSimilarity(expectedItems[i], parsedItems[j], matchFields);
      if (similarity >= threshold) {
        pairs.push({ expectedIdx: i, parsedIdx: j, similarity });
      }
    }
  }

  // Sort by similarity descending
  pairs.sort((a, b) => b.similarity - a.similarity);

  // Greedily assign matches
  for (const pair of pairs) {
    if (usedExpected.has(pair.expectedIdx) || usedParsed.has(pair.parsedIdx)) {
      continue;
    }
    alignment.push(pair);
    usedExpected.add(pair.expectedIdx);
    usedParsed.add(pair.parsedIdx);
  }

  return alignment;
}

function computeDerivedMetrics(metrics: FieldMetrics): FieldMetrics {
  const { tp, fp, fn } = metrics;
  const precision = tp + fp > 0 ? tp / (tp + fp) : undefined;
  const recall = tp + fn > 0 ? tp / (tp + fn) : undefined;
  const f1 =
    precision !== undefined && recall !== undefined && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : undefined;
  return { ...metrics, precision, recall, f1 };
}

async function main(): Promise<void> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }
  const input: EvalInput = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

  const config = input.config ?? {};
  const matchFields = config.match_fields ?? ['description'];
  const scoreFields = config.score_fields ?? ['description', 'quantity', 'line_total'];
  const threshold = config.threshold ?? 0.8;
  const lineItemsPath = config.line_items_path ?? 'line_items';

  // Parse candidate answer
  let candidateObj: unknown;
  try {
    candidateObj = JSON.parse(input.candidate_answer);
  } catch {
    console.log(
      JSON.stringify({
        score: 0,
        hits: [],
        misses: ['Failed to parse candidate_answer as JSON'],
        reasoning: 'Could not parse candidate_answer',
        details: {
          alignment: [],
          metrics: {},
          unmatched_expected: [],
          unmatched_parsed: [],
          summary: { matched_count: 0, expected_count: 0, parsed_count: 0 },
        },
      }),
    );
    return;
  }

  // Extract expected data from expected_messages
  let expectedObj: unknown;
  for (let i = input.expected_messages.length - 1; i >= 0; i--) {
    const msg = input.expected_messages[i];
    if (msg.role === 'assistant' && msg.content) {
      expectedObj = msg.content;
      break;
    }
  }

  if (!expectedObj) {
    console.log(
      JSON.stringify({
        score: 0,
        hits: [],
        misses: ['No expected data found in expected_messages'],
        reasoning: 'Could not find assistant message with expected content',
        details: {
          alignment: [],
          metrics: {},
          unmatched_expected: [],
          unmatched_parsed: [],
          summary: { matched_count: 0, expected_count: 0, parsed_count: 0 },
        },
      }),
    );
    return;
  }

  // Get line items arrays
  const expectedItems = getFieldValue(expectedObj, lineItemsPath) as
    | Record<string, unknown>[]
    | undefined;
  const parsedItems = getFieldValue(candidateObj, lineItemsPath) as
    | Record<string, unknown>[]
    | undefined;

  if (!Array.isArray(expectedItems)) {
    console.log(
      JSON.stringify({
        score: 0,
        hits: [],
        misses: [`Expected line items not found at path: ${lineItemsPath}`],
        reasoning: 'No expected line items array',
        details: {
          alignment: [],
          metrics: {},
          unmatched_expected: [],
          unmatched_parsed: [],
          summary: { matched_count: 0, expected_count: 0, parsed_count: 0 },
        },
      }),
    );
    return;
  }

  if (!Array.isArray(parsedItems)) {
    // All expected items are FN
    const unmatchedExpected = expectedItems.map((_, i) => i);
    const fieldMetrics: Record<string, FieldMetrics> = {};

    for (const field of scoreFields) {
      let fn = 0;
      for (const item of expectedItems) {
        const val = getFieldValue(item, field);
        if (!isEmpty(val)) fn++;
      }
      fieldMetrics[field] = computeDerivedMetrics({ tp: 0, tn: 0, fp: 0, fn });
    }

    console.log(
      JSON.stringify({
        score: 0,
        hits: [],
        misses: [`Parsed line items not found at path: ${lineItemsPath}`],
        reasoning: 'No parsed line items array',
        details: {
          alignment: [],
          metrics: fieldMetrics,
          unmatched_expected: unmatchedExpected,
          unmatched_parsed: [],
          summary: {
            matched_count: 0,
            expected_count: expectedItems.length,
            parsed_count: 0,
            macro_f1: 0,
          },
        },
      }),
    );
    return;
  }

  // Perform greedy matching
  const alignment = greedyMatch(expectedItems, parsedItems, matchFields, threshold);
  const matchedExpected = new Set(alignment.map((a) => a.expectedIdx));
  const matchedParsed = new Set(alignment.map((a) => a.parsedIdx));

  const unmatchedExpected = expectedItems
    .map((_, i) => i)
    .filter((i) => !matchedExpected.has(i));
  const unmatchedParsed = parsedItems
    .map((_, i) => i)
    .filter((i) => !matchedParsed.has(i));

  const hits: string[] = [];
  const misses: string[] = [];
  const fieldMetrics: Record<string, FieldMetrics> = {};

  // Initialize field metrics
  for (const field of scoreFields) {
    fieldMetrics[field] = { tp: 0, tn: 0, fp: 0, fn: 0 };
  }

  // Score matched pairs
  for (const match of alignment) {
    const expected = expectedItems[match.expectedIdx];
    const parsed = parsedItems[match.parsedIdx];

    for (const field of scoreFields) {
      const expectedVal = getFieldValue(expected, field);
      const parsedVal = getFieldValue(parsed, field);
      const expectedEmpty = isEmpty(expectedVal);
      const parsedEmpty = isEmpty(parsedVal);
      const valuesEqual = deepEqual(expectedVal, parsedVal);

      if (valuesEqual && !expectedEmpty) {
        fieldMetrics[field].tp++;
      } else if (valuesEqual && expectedEmpty) {
        fieldMetrics[field].tn++;
      } else if (!valuesEqual && !expectedEmpty && !parsedEmpty) {
        fieldMetrics[field].fp++;
        fieldMetrics[field].fn++;
      } else if (expectedEmpty && !parsedEmpty) {
        fieldMetrics[field].fp++;
      } else if (!expectedEmpty && parsedEmpty) {
        fieldMetrics[field].fn++;
      }
    }

    hits.push(`Matched expected[${match.expectedIdx}] -> parsed[${match.parsedIdx}] (${(match.similarity * 100).toFixed(0)}%)`);
  }

  // Unmatched expected items contribute to FN
  for (const idx of unmatchedExpected) {
    const item = expectedItems[idx];
    for (const field of scoreFields) {
      const val = getFieldValue(item, field);
      if (!isEmpty(val)) {
        fieldMetrics[field].fn++;
      }
    }
    misses.push(`Unmatched expected[${idx}] (FN)`);
  }

  // Unmatched parsed items contribute to FP
  for (const idx of unmatchedParsed) {
    const item = parsedItems[idx];
    for (const field of scoreFields) {
      const val = getFieldValue(item, field);
      if (!isEmpty(val)) {
        fieldMetrics[field].fp++;
      }
    }
    misses.push(`Unmatched parsed[${idx}] (FP)`);
  }

  // Compute derived metrics for each field
  const f1Scores: number[] = [];
  for (const field of scoreFields) {
    const m = fieldMetrics[field];
    fieldMetrics[field] = computeDerivedMetrics(m);
    // Include in macro-F1 calculation:
    // - Use actual F1 if defined (TP > 0)
    // - Use 0 if errors occurred (FP > 0 or FN > 0) but F1 undefined
    // - Exclude TN-only fields (TP=0, FP=0, FN=0) from average
    const hasErrors = m.fp > 0 || m.fn > 0;
    if (fieldMetrics[field].f1 !== undefined) {
      f1Scores.push(fieldMetrics[field].f1!);
    } else if (hasErrors) {
      f1Scores.push(0);
    }
  }

  // Compute macro-F1 (treating undefined as 0 when errors occurred)
  const macroF1 = f1Scores.length > 0 ? f1Scores.reduce((a, b) => a + b, 0) / f1Scores.length : 0;

  const output: EvalOutput = {
    score: macroF1,
    hits: hits.slice(0, 10),
    misses: misses.slice(0, 10),
    reasoning: `Matched ${alignment.length}/${expectedItems.length} expected items, macro-F1=${macroF1.toFixed(3)}`,
    details: {
      alignment,
      metrics: fieldMetrics,
      unmatched_expected: unmatchedExpected,
      unmatched_parsed: unmatchedParsed,
      summary: {
        matched_count: alignment.length,
        expected_count: expectedItems.length,
        parsed_count: parsedItems.length,
        macro_f1: macroF1,
      },
    },
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
      details: {
        alignment: [],
        metrics: {},
        unmatched_expected: [],
        unmatched_parsed: [],
        summary: { matched_count: 0, expected_count: 0, parsed_count: 0 },
      },
    }),
  );
  process.exit(1);
});
