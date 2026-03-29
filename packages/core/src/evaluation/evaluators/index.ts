// Types
export type {
  ChildEvaluatorResult,
  EvaluationContext,
  EvaluationScore,
  EvaluationVerdict,
  Evaluator,
  EvaluatorFactory,
} from './types.js';

// Scoring utilities
export {
  PASS_THRESHOLD,
  clampScore,
  deepEqual,
  extractJsonBlob,
  isNonEmptyString,
  negateScore,
  parseJsonFromText,
  parseJsonSafe,
  scoreToVerdict,
} from './scoring.js';

// Evaluators
export { CodeEvaluator, executeScript } from './code-evaluator.js';
export type { CodeEvaluatorOptions } from './code-evaluator.js';

export { CompositeEvaluator } from './composite.js';
export type { CompositeEvaluatorOptions } from './composite.js';

export { CostEvaluator } from './cost.js';
export type { CostEvaluatorOptions } from './cost.js';

export { ExecutionMetricsEvaluator } from './execution-metrics.js';
export type { ExecutionMetricsEvaluatorOptions } from './execution-metrics.js';

export { FieldAccuracyEvaluator } from './field-accuracy.js';
export type { FieldAccuracyEvaluatorOptions } from './field-accuracy.js';

export { LatencyEvaluator } from './latency.js';
export type { LatencyEvaluatorOptions } from './latency.js';

export {
  LlmGraderEvaluator,
  LlmGraderEvaluator as LlmJudgeEvaluator,
  buildOutputSchema,
  buildRubricOutputSchema,
  buildScoreRangeOutputSchema,
  calculateRubricScore,
  DEFAULT_EVALUATOR_TEMPLATE,
  extractImageBlocks,
  substituteVariables,
  freeformEvaluationSchema,
  rubricEvaluationSchema,
} from './llm-grader.js';
export type {
  LlmGraderEvaluatorOptions,
  LlmGraderEvaluatorOptions as LlmJudgeEvaluatorOptions,
} from './llm-grader.js';

export { SkillTriggerEvaluator } from './skill-trigger.js';

export {
  assembleLlmGraderPrompt,
  assembleLlmGraderPrompt as assembleLlmJudgePrompt,
} from './llm-grader-prompt.js';
export type {
  LlmGraderPromptAssembly,
  LlmGraderPromptAssembly as LlmJudgePromptAssembly,
} from './llm-grader-prompt.js';

export { TokenUsageEvaluator } from './token-usage.js';
export type { TokenUsageEvaluatorOptions } from './token-usage.js';

export { ToolTrajectoryEvaluator } from './tool-trajectory.js';
export type { ToolTrajectoryEvaluatorOptions } from './tool-trajectory.js';

// Deterministic assertions
export {
  runContainsAssertion,
  runContainsAnyAssertion,
  runContainsAllAssertion,
  runIcontainsAssertion,
  runIcontainsAnyAssertion,
  runIcontainsAllAssertion,
  runStartsWithAssertion,
  runEndsWithAssertion,
  runEqualsAssertion,
  runIsJsonAssertion,
  runRegexAssertion,
} from './assertions.js';
export type { AssertionResult } from './assertions.js';
