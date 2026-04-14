import type { ResolvedTarget } from '../providers/targets.js';
import type { ChatPrompt, Message, Provider } from '../providers/types.js';
import type { TokenUsage, TraceSummary } from '../trace.js';
import type {
  DependencyResult,
  DockerWorkspaceConfig,
  EvalTest,
  EvaluationVerdict,
  EvaluatorConfig,
  JsonObject,
} from '../types.js';

export type { EvaluationVerdict };

/**
 * Function to resolve a target name to a provider.
 * Used by code graders to support target override.
 */
export type TargetResolver = (targetName: string) => Provider | undefined;

export interface EvaluationContext {
  readonly evalCase: EvalTest;
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly attempt: number;
  readonly promptInputs: {
    readonly question: string;
    readonly systemMessage?: string;
    readonly chatPrompt?: ChatPrompt;
  };
  readonly now: Date;
  readonly graderProvider?: Provider;
  /** @deprecated Use `graderProvider` instead */
  readonly judgeProvider?: Provider;
  readonly evaluatorTemplateOverride?: string;
  readonly evaluator?: EvaluatorConfig;
  /** Output messages from agent execution (primary source for tool trajectory) */
  readonly output?: readonly Message[];
  /** Lightweight summary of trace events (if available) */
  readonly trace?: TraceSummary;
  /** Token usage from provider execution (promoted from TraceSummary) */
  readonly tokenUsage?: TokenUsage;
  /** Total cost in USD (from provider) */
  readonly costUsd?: number;
  /** Execution duration in milliseconds */
  readonly durationMs?: number;
  /** ISO 8601 timestamp when execution started */
  readonly startTime?: string;
  /** ISO 8601 timestamp when execution ended */
  readonly endTime?: string;
  /** Resolver for target override in code graders */
  readonly targetResolver?: TargetResolver;
  /** List of available target names for code graders */
  readonly availableTargets?: readonly string[];
  /** Unified diff of file changes from workspace */
  readonly fileChanges?: string;
  /** Absolute path to the workspace directory */
  readonly workspacePath?: string;
  /** Docker workspace config: when present, code-grader commands run inside a container */
  readonly dockerConfig?: DockerWorkspaceConfig;
  /** Results from dependency tests (only present when the test has depends_on) */
  readonly dependencyResults?: Readonly<Record<string, DependencyResult>>;
}

export interface EvaluationScore {
  readonly score: number;
  readonly verdict: EvaluationVerdict;
  readonly assertions: readonly import('../types.js').AssertionEntry[];
  readonly expectedAspectCount: number;
  readonly evaluatorRawRequest?: JsonObject;
  readonly scores?: readonly ChildEvaluatorResult[];
  /** Optional structured details from evaluators (e.g., TP/TN/FP/FN counts, alignments, per-turn scores). */
  readonly details?: JsonObject;
  /** Token usage from LLM calls made by this evaluator (optional). */
  readonly tokenUsage?: TokenUsage;
  /** Target name used for grading (e.g., the LLM provider). */
  readonly graderTarget?: string;
}

export interface ChildEvaluatorResult {
  readonly name: string;
  readonly type: string;
  readonly score: number;
  readonly weight?: number;
  readonly verdict: EvaluationVerdict;
  readonly assertions: readonly import('../types.js').AssertionEntry[];
  readonly evaluatorRawRequest?: JsonObject;
  readonly scores?: readonly ChildEvaluatorResult[];
  /** Optional structured details from evaluators (e.g., TP/TN/FP/FN counts, alignments, per-turn scores). */
  readonly details?: JsonObject;
  /** Token usage from LLM calls made by this evaluator (optional). */
  readonly tokenUsage?: TokenUsage;
}

export interface Evaluator {
  readonly kind: string;
  evaluate(context: EvaluationContext): Promise<EvaluationScore> | EvaluationScore;
}

export interface EvaluatorFactory {
  create(config: EvaluatorConfig, context: EvaluationContext): Evaluator;
}
