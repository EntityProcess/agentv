import { evaluateDeterministicAssertion } from './deterministic.js';
import type {
  DeterministicEvaluatorType,
  EvaluationContext,
  EvaluatorAdapter,
  EvaluatorResult,
  EvaluatorType,
  NormalizedAssertionConfig,
  UnsupportedEvaluatorReport,
  UnsupportedEvaluatorType,
} from './types.js';

export const deterministicEvaluatorTypes = [
  'contains',
  'regex',
  'equals',
  'is-json',
] as const satisfies readonly DeterministicEvaluatorType[];

export const unsupportedEvaluatorTypes = [
  'llm-grader',
  'rubrics',
  'code-grader',
  'composite',
  'field-accuracy',
  'execution-metrics',
  'tool-trajectory',
  'cost',
  'latency',
  'trial-output-consistency',
] as const satisfies readonly UnsupportedEvaluatorType[];

const unsupportedReasons: Record<UnsupportedEvaluatorType, string> = {
  'llm-grader': 'Model-backed Phoenix judging is not implemented in this first-pass adapter.',
  rubrics:
    'Rubric scoring requires a model-backed or rubric-specific adapter that is not implemented yet.',
  'code-grader':
    'Code grader execution is deferred until source-relative sandboxing is implemented.',
  composite:
    'Composite evaluator aggregation is deferred until nested evaluator normalization is available.',
  'field-accuracy':
    'Field-level accuracy scoring is deferred until expected output field mapping is implemented.',
  'execution-metrics':
    'Execution metric scoring needs run or trace metric data that is not wired yet.',
  'tool-trajectory': 'Tool trajectory scoring needs trace data that is not wired yet.',
  cost: 'Cost scoring needs Phoenix or provider usage metrics that are not wired yet.',
  latency: 'Latency scoring needs Phoenix or runner timing metrics that are not wired yet.',
  'trial-output-consistency':
    'Trial consistency scoring needs multiple trial outputs that are not wired yet.',
};

export function createEvaluatorAdapter(assertion: NormalizedAssertionConfig): EvaluatorAdapter {
  const type = assertion.type;
  const name = assertion.name ?? String(type);

  if (isDeterministicEvaluatorType(type)) {
    return {
      type,
      name,
      supported: true,
      evaluate: (context) => evaluateDeterministicAssertion(assertion, context),
    };
  }

  return {
    type,
    name,
    supported: false,
    evaluate: () => unsupportedResult(assertion),
  };
}

export function createEvaluatorRegistry(
  assertions: readonly NormalizedAssertionConfig[],
): EvaluatorAdapter[] {
  return assertions.map(createEvaluatorAdapter);
}

export function evaluateAssertion(
  assertion: NormalizedAssertionConfig,
  context: EvaluationContext,
): EvaluatorResult {
  return createEvaluatorAdapter(assertion).evaluate(context);
}

export function unsupportedEvaluatorReports(
  assertions: readonly NormalizedAssertionConfig[],
): UnsupportedEvaluatorReport[] {
  return assertions.filter(isUnsupportedAssertion).map((assertion) => ({
    name: assertion.name ?? String(assertion.type),
    type: assertion.type,
    reason: unsupportedReason(assertion.type),
    metadata: assertion.metadata,
  }));
}

export function isSupportedEvaluatorType(type: EvaluatorType): boolean {
  return isDeterministicEvaluatorType(type);
}

export function isDeterministicEvaluatorType(
  type: EvaluatorType,
): type is DeterministicEvaluatorType {
  return (deterministicEvaluatorTypes as readonly string[]).includes(String(type));
}

export function isKnownUnsupportedEvaluatorType(
  type: EvaluatorType,
): type is UnsupportedEvaluatorType {
  return (unsupportedEvaluatorTypes as readonly string[]).includes(String(type));
}

function isUnsupportedAssertion(assertion: NormalizedAssertionConfig): boolean {
  return !isSupportedEvaluatorType(assertion.type);
}

function unsupportedResult(assertion: NormalizedAssertionConfig): EvaluatorResult {
  return {
    name: assertion.name ?? String(assertion.type),
    type: assertion.type,
    score: 0,
    passed: false,
    label: 'unsupported',
    explanation: unsupportedReason(assertion.type),
    unsupported: true,
    metadata: assertion.metadata,
  };
}

function unsupportedReason(type: EvaluatorType): string {
  if (isKnownUnsupportedEvaluatorType(type)) return unsupportedReasons[type];

  return `Unknown evaluator family: ${String(type)}`;
}
