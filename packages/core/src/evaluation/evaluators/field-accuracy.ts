import type { FieldAccuracyEvaluatorConfig, FieldConfig, JsonObject } from '../types.js';
import { clampScore, deepEqual, parseJsonFromText, scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

/** Result from evaluating a single field */
interface FieldResult {
  readonly path: string;
  readonly score: number;
  readonly weight: number;
  readonly hit: boolean;
  readonly message: string;
}

/**
 * Default date formats to try when parsing dates.
 * Ordered from most specific to least specific.
 */
const DEFAULT_DATE_FORMATS = [
  'YYYY-MM-DDTHH:mm:ssZ', // ISO with timezone
  'YYYY-MM-DDTHH:mm:ss', // ISO with time
  'YYYY-MM-DD', // ISO date
  'DD-MMM-YYYY', // Localized (e.g., "15-JAN-2025")
  'MM/DD/YYYY', // US format
  'DD/MM/YYYY', // EU format
  'MM-DD-YYYY', // US with dashes
  'DD-MM-YYYY', // EU with dashes
];

/**
 * Month name mappings for parsing localized dates.
 */
const MONTH_NAMES: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

export interface FieldAccuracyEvaluatorOptions {
  readonly config: FieldAccuracyEvaluatorConfig;
}

/**
 * FieldAccuracyEvaluator compares extracted structured data against expected values
 * with configurable matching strategies (exact, fuzzy, numeric_tolerance, date).
 */
export class FieldAccuracyEvaluator implements Evaluator {
  readonly kind = 'field_accuracy';

  private readonly config: FieldAccuracyEvaluatorConfig;

  constructor(options: FieldAccuracyEvaluatorOptions) {
    this.config = options.config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const { evalCase, candidate } = context;

    // Parse candidate answer as JSON
    let candidateData: Record<string, unknown>;
    try {
      candidateData = parseJsonFromTextSafe(candidate);
    } catch {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['Failed to parse candidate answer as JSON'],
        expectedAspectCount: this.config.fields.length,
        reasoning: 'Candidate answer is not valid JSON',
      };
    }

    // Extract expected data from expected_output
    const expectedData = this.extractExpectedData(evalCase.expected_output);
    if (!expectedData) {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['No expected data found in expected_output'],
        expectedAspectCount: this.config.fields.length,
        reasoning: 'Could not extract expected data from expected_output',
      };
    }

    // Evaluate each field
    const fieldResults: FieldResult[] = [];
    for (const fieldConfig of this.config.fields) {
      const result = this.evaluateField(fieldConfig, candidateData, expectedData);
      fieldResults.push(result);
    }

    // Aggregate results
    return this.aggregateResults(fieldResults);
  }

  /**
   * Extract expected data from expected_output array.
   * Looks for the last assistant message with content.
   */
  private extractExpectedData(
    expectedMessages: readonly JsonObject[],
  ): Record<string, unknown> | undefined {
    // Find the last assistant message with content
    for (let i = expectedMessages.length - 1; i >= 0; i--) {
      const message = expectedMessages[i];
      if (message.role === 'assistant' && message.content) {
        if (typeof message.content === 'object' && message.content !== null) {
          return message.content as Record<string, unknown>;
        }
        // If content is a string, try to parse it as JSON
        if (typeof message.content === 'string') {
          try {
            return parseJsonFromTextSafe(message.content);
          } catch {
            // Parsing failed, continue to next message
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Evaluate a single field against the expected value.
   */
  private evaluateField(
    fieldConfig: FieldConfig,
    candidateData: Record<string, unknown>,
    expectedData: Record<string, unknown>,
  ): FieldResult {
    const { path, match, required = true, weight = 1.0 } = fieldConfig;

    const candidateValue = resolvePath(candidateData, path);
    const expectedValue = resolvePath(expectedData, path);

    // Handle missing expected value
    if (expectedValue === undefined) {
      // If the expected value is missing, we can't compare
      return {
        path,
        score: 1.0, // No expected value means no comparison needed
        weight,
        hit: true,
        message: `${path}: no expected value`,
      };
    }

    // Handle missing candidate value
    if (candidateValue === undefined) {
      if (required) {
        return {
          path,
          score: 0,
          weight,
          hit: false,
          message: `${path} (required, missing)`,
        };
      }
      // Optional field missing - don't count in aggregation
      return {
        path,
        score: 1.0, // Don't penalize missing optional fields
        weight: 0, // Zero weight means it won't affect the score
        hit: true,
        message: `${path}: optional field missing`,
      };
    }

    // Compare based on match type
    switch (match) {
      case 'exact':
        return this.compareExact(path, candidateValue, expectedValue, weight);
      case 'numeric_tolerance':
        return this.compareNumericTolerance(
          path,
          candidateValue,
          expectedValue,
          fieldConfig,
          weight,
        );
      case 'date':
        return this.compareDate(path, candidateValue, expectedValue, fieldConfig, weight);
      default:
        return {
          path,
          score: 0,
          weight,
          hit: false,
          message: `${path}: unknown match type "${match}"`,
        };
    }
  }

  /**
   * Exact equality comparison.
   */
  private compareExact(
    path: string,
    candidateValue: unknown,
    expectedValue: unknown,
    weight: number,
  ): FieldResult {
    // Deep equality for objects and arrays
    if (deepEqual(candidateValue, expectedValue)) {
      return {
        path,
        score: 1.0,
        weight,
        hit: true,
        message: path,
      };
    }

    // Type mismatch
    if (typeof candidateValue !== typeof expectedValue) {
      return {
        path,
        score: 0,
        weight,
        hit: false,
        message: `${path} (type mismatch: got ${typeof candidateValue}, expected ${typeof expectedValue})`,
      };
    }

    return {
      path,
      score: 0,
      weight,
      hit: false,
      message: `${path} (value mismatch)`,
    };
  }

  /**
   * Numeric comparison with absolute or relative tolerance.
   */
  private compareNumericTolerance(
    path: string,
    candidateValue: unknown,
    expectedValue: unknown,
    fieldConfig: FieldConfig,
    weight: number,
  ): FieldResult {
    const { tolerance = 0, relative = false } = fieldConfig;

    const candidateNum = toNumber(candidateValue);
    const expectedNum = toNumber(expectedValue);

    if (candidateNum === null || expectedNum === null) {
      return {
        path,
        score: 0,
        weight,
        hit: false,
        message: `${path} (non-numeric value)`,
      };
    }

    if (!Number.isFinite(candidateNum) || !Number.isFinite(expectedNum)) {
      return {
        path,
        score: 0,
        weight,
        hit: false,
        message: `${path} (invalid numeric value)`,
      };
    }

    const diff = Math.abs(candidateNum - expectedNum);
    let withinTolerance: boolean;

    if (relative) {
      // Relative tolerance: |actual - expected| / |expected| <= tolerance
      // Handle division by zero for expected === 0
      const relativeDiff = expectedNum === 0 ? diff : diff / Math.abs(expectedNum);
      withinTolerance = relativeDiff <= tolerance;
    } else {
      // Absolute tolerance: |actual - expected| <= tolerance
      withinTolerance = diff <= tolerance;
    }

    if (withinTolerance) {
      return {
        path,
        score: 1.0,
        weight,
        hit: true,
        message: `${path} (within tolerance: diff=${diff.toFixed(2)})`,
      };
    }

    return {
      path,
      score: 0,
      weight,
      hit: false,
      message: `${path} (outside tolerance: diff=${diff.toFixed(2)}, tolerance=${tolerance})`,
    };
  }

  /**
   * Date comparison with format normalization.
   */
  private compareDate(
    path: string,
    candidateValue: unknown,
    expectedValue: unknown,
    fieldConfig: FieldConfig,
    weight: number,
  ): FieldResult {
    const formats = fieldConfig.formats ?? DEFAULT_DATE_FORMATS;

    const candidateDate = parseDate(String(candidateValue), formats);
    const expectedDate = parseDate(String(expectedValue), formats);

    if (candidateDate === null) {
      return {
        path,
        score: 0,
        weight,
        hit: false,
        message: `${path} (unparseable candidate date)`,
      };
    }

    if (expectedDate === null) {
      return {
        path,
        score: 0,
        weight,
        hit: false,
        message: `${path} (unparseable expected date)`,
      };
    }

    // Compare dates by year, month, and day (ignore time component)
    if (
      candidateDate.getFullYear() === expectedDate.getFullYear() &&
      candidateDate.getMonth() === expectedDate.getMonth() &&
      candidateDate.getDate() === expectedDate.getDate()
    ) {
      return {
        path,
        score: 1.0,
        weight,
        hit: true,
        message: path,
      };
    }

    return {
      path,
      score: 0,
      weight,
      hit: false,
      message: `${path} (date mismatch: got ${formatDateISO(candidateDate)}, expected ${formatDateISO(expectedDate)})`,
    };
  }

  /**
   * Aggregate field results using configured strategy.
   */
  private aggregateResults(results: readonly FieldResult[]): EvaluationScore {
    const aggregation = this.config.aggregation ?? 'weighted_average';
    const hits: string[] = [];
    const misses: string[] = [];

    for (const result of results) {
      if (result.hit) {
        hits.push(result.message);
      } else {
        misses.push(result.message);
      }
    }

    let score: number;
    if (aggregation === 'all_or_nothing') {
      // All fields must pass for score 1.0
      score = misses.length === 0 ? 1.0 : 0.0;
    } else {
      // weighted_average (default)
      const totalWeight = results.reduce((sum, r) => sum + r.weight, 0);
      if (totalWeight === 0) {
        score = results.length === 0 ? 1.0 : 0.0;
      } else {
        const weightedSum = results.reduce((sum, r) => sum + r.score * r.weight, 0);
        score = weightedSum / totalWeight;
      }
    }

    const reasoning = `${hits.length}/${results.length} fields matched`;

    return {
      score: clampScore(score),
      verdict: scoreToVerdict(score),
      hits: hits.slice(0, 4), // Cap at 4 to keep output concise
      misses: misses.slice(0, 4),
      expectedAspectCount: results.length,
      reasoning,
    };
  }
}

/**
 * Resolve a dot-notation path (with array indexing) to a value.
 * Example: "invoice.line_items[0].amount"
 */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  if (!path || !obj) {
    return undefined;
  }

  // Split on dots and array brackets
  const parts = path.split(/\.|\[|\]/).filter((p) => p.length > 0);
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current !== 'object') {
      return undefined;
    }

    const isIndex = /^\d+$/.test(part);
    if (isIndex && Array.isArray(current)) {
      current = current[Number.parseInt(part, 10)];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}

/**
 * Convert a value to a number, returning null if not possible.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const num = Number.parseFloat(value);
    return Number.isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Parse a date string using the specified formats.
 * Returns null if parsing fails.
 *
 * Date format disambiguation:
 * - If only US formats (MM/DD/YYYY) are specified, parses as US
 * - If only EU formats (DD/MM/YYYY) are specified, parses as EU
 * - If both or neither are specified, attempts to infer from values:
 *   - If first number > 12, assumes EU format (day first)
 *   - If second number > 12, assumes US format (month first)
 *   - If ambiguous (both <= 12), defaults to US format (MM/DD/YYYY)
 */
function parseDate(dateStr: string, formats: readonly string[]): Date | null {
  if (!dateStr) return null;

  const trimmed = dateStr.trim();

  // Try ISO format first (JavaScript native)
  const isoDate = new Date(trimmed);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Try localized format (DD-MMM-YYYY)
  const localizedMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/);
  if (localizedMatch) {
    const day = Number.parseInt(localizedMatch[1], 10);
    const monthName = localizedMatch[2].toLowerCase();
    const year = Number.parseInt(localizedMatch[3], 10);
    const month = MONTH_NAMES[monthName];
    if (month !== undefined) {
      return new Date(year, month, day);
    }
  }

  // Try US format (MM/DD/YYYY or MM-DD-YYYY)
  const usMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (usMatch) {
    // Check if first or second number is likely the month
    // Assume MM/DD/YYYY for formats array containing "MM/DD/YYYY" or "MM-DD-YYYY"
    const hasUSFormat = formats.some((f) => f.includes('MM/DD') || f.includes('MM-DD'));
    const hasEUFormat = formats.some((f) => f.includes('DD/MM') || f.includes('DD-MM'));

    if (hasUSFormat && !hasEUFormat) {
      const month = Number.parseInt(usMatch[1], 10) - 1;
      const day = Number.parseInt(usMatch[2], 10);
      const year = Number.parseInt(usMatch[3], 10);
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        return new Date(year, month, day);
      }
    } else if (hasEUFormat && !hasUSFormat) {
      const day = Number.parseInt(usMatch[1], 10);
      const month = Number.parseInt(usMatch[2], 10) - 1;
      const year = Number.parseInt(usMatch[3], 10);
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        return new Date(year, month, day);
      }
    } else {
      // Ambiguous - try to infer from values
      const num1 = Number.parseInt(usMatch[1], 10);
      const num2 = Number.parseInt(usMatch[2], 10);
      const year = Number.parseInt(usMatch[3], 10);

      // If first number > 12, it must be day (EU format)
      if (num1 > 12 && num2 <= 12) {
        return new Date(year, num2 - 1, num1);
      }
      // If second number > 12, it must be day (US format)
      if (num2 > 12 && num1 <= 12) {
        return new Date(year, num1 - 1, num2);
      }
      // Default to US format
      if (num1 <= 12 && num2 <= 31) {
        return new Date(year, num1 - 1, num2);
      }
    }
  }

  return null;
}

/**
 * Format a date as ISO date string (YYYY-MM-DD).
 */
function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Parse JSON from text with type narrowing to Record<string, unknown>.
 * Delegates to parseJsonFromText from scoring.ts.
 */
function parseJsonFromTextSafe(text: string): Record<string, unknown> {
  return parseJsonFromText(text) as Record<string, unknown>;
}
