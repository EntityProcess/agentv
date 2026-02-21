import type { ResolvedTarget } from '../providers/targets.js';
import type { ChatPrompt, Message, Provider } from '../providers/types.js';
import type { TraceSummary } from '../trace.js';
import type { EvalTest, EvaluationVerdict, EvaluatorConfig, JsonObject } from '../types.js';

export type { EvaluationVerdict };

/**
 * Function to resolve a target name to a provider.
 * Used by code judges to support target override.
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
    readonly guidelines: string;
    readonly systemMessage?: string;
    readonly chatPrompt?: ChatPrompt;
  };
  readonly now: Date;
  readonly judgeProvider?: Provider;
  readonly evaluatorTemplateOverride?: string;
  readonly evaluator?: EvaluatorConfig;
  /** Output messages from agent execution (primary source for tool trajectory) */
  readonly output?: readonly Message[];
  /** Lightweight summary of trace events (if available) */
  readonly trace?: TraceSummary;
  /** Resolver for target override in code judges */
  readonly targetResolver?: TargetResolver;
  /** List of available target names for code judges */
  readonly availableTargets?: readonly string[];
  /** Unified diff of file changes from workspace (when workspace_template is configured) */
  readonly fileChanges?: string;
  /** Absolute path to the workspace directory (when workspace_template is configured) */
  readonly workspacePath?: string;
}

export interface EvaluationScore {
  readonly score: number;
  readonly verdict: EvaluationVerdict;
  readonly hits: readonly string[];
  readonly misses: readonly string[];
  readonly expectedAspectCount: number;
  readonly reasoning?: string;
  readonly evaluatorRawRequest?: JsonObject;
  readonly scores?: readonly ChildEvaluatorResult[];
  /** Optional structured details from code judges (e.g., TP/TN/FP/FN counts, alignments). */
  readonly details?: JsonObject;
}

export interface ChildEvaluatorResult {
  readonly name: string;
  readonly type: string;
  readonly score: number;
  readonly weight?: number;
  readonly verdict: EvaluationVerdict;
  readonly hits: readonly string[];
  readonly misses: readonly string[];
  readonly reasoning?: string;
  readonly evaluatorRawRequest?: JsonObject;
  readonly scores?: readonly ChildEvaluatorResult[];
  /** Optional structured details from code judges (e.g., TP/TN/FP/FN counts, alignments). */
  readonly details?: JsonObject;
}

export interface Evaluator {
  readonly kind: string;
  evaluate(context: EvaluationContext): Promise<EvaluationScore> | EvaluationScore;
}

export interface EvaluatorFactory {
  create(config: EvaluatorConfig, context: EvaluationContext): Evaluator;
}
