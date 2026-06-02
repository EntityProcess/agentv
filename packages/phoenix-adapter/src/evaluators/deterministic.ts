import type {
  DeterministicEvaluatorType,
  EvaluationContext,
  EvaluatorResult,
  NormalizedAssertionConfig,
} from './types.js';

export function evaluateDeterministicAssertion(
  assertion: NormalizedAssertionConfig,
  context: EvaluationContext,
): EvaluatorResult {
  const type = assertion.type as DeterministicEvaluatorType;

  switch (type) {
    case 'contains':
      return evaluateContains(assertion, context);
    case 'regex':
      return evaluateRegex(assertion, context);
    case 'equals':
      return evaluateEquals(assertion, context);
    case 'is-json':
      return evaluateIsJson(assertion, context);
    default:
      return result(
        assertion,
        false,
        `Unsupported deterministic evaluator: ${String(assertion.type)}`,
      );
  }
}

function evaluateContains(
  assertion: NormalizedAssertionConfig,
  context: EvaluationContext,
): EvaluatorResult {
  const needle = assertionValue(assertion);

  if (needle === undefined || needle === null) {
    return result(assertion, false, 'contains assertion is missing a value');
  }

  const haystack = stringifyOutput(context.output);
  const expected = String(needle);
  const caseSensitive = assertion.caseSensitive !== false;
  const passed = caseSensitive
    ? haystack.includes(expected)
    : haystack.toLocaleLowerCase().includes(expected.toLocaleLowerCase());

  return result(
    assertion,
    passed,
    passed ? `Output contains ${expected}` : `Output does not contain ${expected}`,
  );
}

function evaluateRegex(
  assertion: NormalizedAssertionConfig,
  context: EvaluationContext,
): EvaluatorResult {
  const pattern = assertion.pattern ?? stringAssertionValue(assertion);

  if (!pattern) {
    return result(assertion, false, 'regex assertion is missing a pattern');
  }

  try {
    const regex = new RegExp(pattern, assertion.flags);
    const passed = regex.test(stringifyOutput(context.output));

    return result(
      assertion,
      passed,
      passed ? `Output matches /${pattern}/` : `Output does not match /${pattern}/`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return result(assertion, false, `Invalid regex pattern: ${message}`);
  }
}

function evaluateEquals(
  assertion: NormalizedAssertionConfig,
  context: EvaluationContext,
): EvaluatorResult {
  const expected = assertionValue(assertion) ?? context.expectedOutput;
  const passed = stableValue(context.output) === stableValue(expected);

  return result(
    assertion,
    passed,
    passed ? 'Output equals expected value' : 'Output does not equal expected value',
  );
}

function evaluateIsJson(
  assertion: NormalizedAssertionConfig,
  context: EvaluationContext,
): EvaluatorResult {
  const parsed = parseJsonLike(context.output);
  const passed = parsed.ok;

  return result(assertion, passed, passed ? 'Output is valid JSON' : parsed.reason);
}

function assertionValue(assertion: NormalizedAssertionConfig): unknown {
  if ('value' in assertion) return assertion.value;
  if ('expected' in assertion) return assertion.expected;
  if ('text' in assertion) return assertion.text;
  if ('substring' in assertion) return assertion.substring;

  return undefined;
}

function stringAssertionValue(assertion: NormalizedAssertionConfig): string | undefined {
  const value = assertionValue(assertion);

  return typeof value === 'string' ? value : undefined;
}

function stringifyOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === undefined || output === null) return '';

  return JSON.stringify(output);
}

function stableValue(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]),
    );
  }

  return value;
}

function parseJsonLike(value: unknown): { ok: true } | { ok: false; reason: string } {
  if (value && typeof value === 'object') return { ok: true };

  if (typeof value !== 'string') {
    return { ok: false, reason: 'Output is not a JSON string or object' };
  }

  try {
    JSON.parse(value);

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return { ok: false, reason: `Output is not valid JSON: ${message}` };
  }
}

function result(
  assertion: NormalizedAssertionConfig,
  passed: boolean,
  explanation: string,
): EvaluatorResult {
  return {
    name: assertion.name ?? String(assertion.type),
    type: assertion.type,
    score: passed ? 1 : 0,
    passed,
    label: passed ? 'pass' : 'fail',
    explanation,
    metadata: assertion.metadata,
  };
}
