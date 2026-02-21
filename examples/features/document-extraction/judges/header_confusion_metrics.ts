#!/usr/bin/env bun
/**
 * Header Field Confusion Metrics Judge
 *
 * A code_judge that compares header fields and classifies them as TP/TN/FP/FN
 * based on empty vs non-empty expected/parsed values.
 *
 * Classification rules (per attribute):
 * - TP: expected == parsed AND expected is non-empty
 * - TN: expected == parsed AND expected is empty
 * - FP+FN: expected != parsed AND both are non-empty (increment both FP and FN)
 * - FP: expected is empty AND parsed is non-empty
 * - FN: expected is non-empty AND parsed is empty
 *
 * Usage in dataset.eval.yaml:
 * ```yaml
 * evaluators:
 *   - name: header_confusion
 *     type: code_judge
 *     script: ["bun", "run", "../judges/header_confusion_metrics.ts"]
 *     fields:
 *       - path: invoice_number
 *       - path: supplier.name
 *       - path: importer.name
 * ```
 */

interface FieldConfig {
  path: string;
}

interface EvalConfig {
  fields?: FieldConfig[];
}

interface EvalInput {
  answer: string;
  expected_output: Array<{ role: string; content: unknown }>;
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

interface EvalOutput {
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
  details: {
    metrics: Record<string, FieldMetrics>;
    summary: {
      total_tp: number;
      total_tn: number;
      total_fp: number;
      total_fn: number;
      macro_precision?: number;
      macro_recall?: number;
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
  const fields = config.fields ?? [];

  if (fields.length === 0) {
    console.log(
      JSON.stringify({
        score: 0,
        hits: [],
        misses: ['No fields configured'],
        reasoning: 'config.fields is empty or not provided',
        details: {
          metrics: {},
          summary: { total_tp: 0, total_tn: 0, total_fp: 0, total_fn: 0 },
        },
      }),
    );
    return;
  }

  // Parse candidate answer
  let candidateObj: unknown;
  try {
    candidateObj = JSON.parse(input.answer);
  } catch {
    console.log(
      JSON.stringify({
        score: 0,
        hits: [],
        misses: ['Failed to parse answer as JSON'],
        reasoning: 'Could not parse answer',
        details: {
          metrics: {},
          summary: { total_tp: 0, total_tn: 0, total_fp: 0, total_fn: 0 },
        },
      }),
    );
    return;
  }

  // Extract expected data from expected_output (last assistant message)
  let expectedObj: unknown;
  for (let i = input.expected_output.length - 1; i >= 0; i--) {
    const msg = input.expected_output[i];
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
        misses: ['No expected data found in expected_output'],
        reasoning: 'Could not find assistant message with expected content',
        details: {
          metrics: {},
          summary: { total_tp: 0, total_tn: 0, total_fp: 0, total_fn: 0 },
        },
      }),
    );
    return;
  }

  const hits: string[] = [];
  const misses: string[] = [];
  const fieldMetrics: Record<string, FieldMetrics> = {};
  let totalTp = 0;
  let totalTn = 0;
  let totalFp = 0;
  let totalFn = 0;
  const f1Scores: number[] = [];

  for (const field of fields) {
    const expectedValue = getFieldValue(expectedObj, field.path);
    const parsedValue = getFieldValue(candidateObj, field.path);

    const expectedEmpty = isEmpty(expectedValue);
    const parsedEmpty = isEmpty(parsedValue);
    const valuesEqual = deepEqual(expectedValue, parsedValue);

    let tp = 0;
    let tn = 0;
    let fp = 0;
    let fn = 0;

    if (valuesEqual && !expectedEmpty) {
      // TP: expected == parsed AND expected is non-empty
      tp = 1;
      hits.push(`${field.path}: TP (correct non-empty)`);
    } else if (valuesEqual && expectedEmpty) {
      // TN: expected == parsed AND expected is empty
      tn = 1;
      hits.push(`${field.path}: TN (correct empty)`);
    } else if (!valuesEqual && !expectedEmpty && !parsedEmpty) {
      // FP+FN: expected != parsed AND both are non-empty
      fp = 1;
      fn = 1;
      misses.push(`${field.path}: FP+FN (wrong value)`);
    } else if (expectedEmpty && !parsedEmpty) {
      // FP: expected is empty AND parsed is non-empty
      fp = 1;
      misses.push(`${field.path}: FP (hallucinated)`);
    } else if (!expectedEmpty && parsedEmpty) {
      // FN: expected is non-empty AND parsed is empty
      fn = 1;
      misses.push(`${field.path}: FN (missing)`);
    }

    totalTp += tp;
    totalTn += tn;
    totalFp += fp;
    totalFn += fn;

    const metrics = computeDerivedMetrics({ tp, tn, fp, fn });
    fieldMetrics[field.path] = metrics;

    // Include in macro-F1 calculation:
    // - Use actual F1 if defined (TP > 0)
    // - Use 0 if errors occurred (FP > 0 or FN > 0) but F1 undefined
    // - Exclude TN-only fields (TP=0, FP=0, FN=0) from average
    const hasErrors = fp > 0 || fn > 0;
    if (metrics.f1 !== undefined) {
      f1Scores.push(metrics.f1);
    } else if (hasErrors) {
      f1Scores.push(0);
    }
  }

  // Compute macro-F1 (unweighted average of per-attribute F1 scores, treating undefined as 0 when errors occurred)
  const macroF1 = f1Scores.length > 0 ? f1Scores.reduce((a, b) => a + b, 0) / f1Scores.length : 0;

  const summaryMetrics = computeDerivedMetrics({
    tp: totalTp,
    tn: totalTn,
    fp: totalFp,
    fn: totalFn,
  });

  const output: EvalOutput = {
    score: macroF1,
    hits: hits.slice(0, 10),
    misses: misses.slice(0, 10),
    reasoning: `TP=${totalTp} TN=${totalTn} FP=${totalFp} FN=${totalFn}, macro-F1=${macroF1.toFixed(3)}`,
    details: {
      metrics: fieldMetrics,
      summary: {
        total_tp: totalTp,
        total_tn: totalTn,
        total_fp: totalFp,
        total_fn: totalFn,
        macro_precision: summaryMetrics.precision,
        macro_recall: summaryMetrics.recall,
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
        metrics: {},
        summary: { total_tp: 0, total_tn: 0, total_fp: 0, total_fn: 0 },
      },
    }),
  );
  process.exit(1);
});
