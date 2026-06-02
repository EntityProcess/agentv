export type DeterministicEvaluatorType = 'contains' | 'regex' | 'equals' | 'is-json';

export type UnsupportedEvaluatorType =
  | 'llm-grader'
  | 'rubrics'
  | 'code-grader'
  | 'composite'
  | 'field-accuracy'
  | 'execution-metrics'
  | 'tool-trajectory'
  | 'cost'
  | 'latency'
  | 'trial-output-consistency';

export type EvaluatorType = DeterministicEvaluatorType | UnsupportedEvaluatorType | string;

export interface NormalizedAssertionConfig {
  type: EvaluatorType;
  name?: string;
  value?: unknown;
  expected?: unknown;
  pattern?: string;
  flags?: string;
  caseSensitive?: boolean;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EvaluationContext {
  output: unknown;
  expectedOutput?: unknown;
  input?: unknown;
  metadata?: Record<string, unknown>;
}

export interface EvaluatorResult {
  name: string;
  type: EvaluatorType;
  score: number;
  passed: boolean;
  label: 'pass' | 'fail' | 'unsupported';
  explanation: string;
  unsupported?: boolean;
  metadata?: Record<string, unknown>;
}

export interface EvaluatorAdapter {
  type: EvaluatorType;
  name: string;
  supported: boolean;
  evaluate(context: EvaluationContext): EvaluatorResult;
}

export interface UnsupportedEvaluatorReport {
  name: string;
  type: EvaluatorType;
  reason: string;
  metadata?: Record<string, unknown>;
}
