/**
 * Factory functions for all built-in evaluator types.
 *
 * Each factory creates an Evaluator instance from an EvaluatorConfig,
 * handling type-specific initialization logic. These are registered into
 * the EvaluatorRegistry at startup.
 */

import { readFileSync } from 'node:fs';
import {
  AgentJudgeEvaluator,
  CodeEvaluator,
  CompositeEvaluator,
  CostEvaluator,
  type Evaluator,
  ExecutionMetricsEvaluator,
  FieldAccuracyEvaluator,
  LatencyEvaluator,
  TokenUsageEvaluator,
  ToolTrajectoryEvaluator,
  runContainsAssertion,
  runEqualsAssertion,
  runIsJsonAssertion,
  runRegexAssertion,
} from '../evaluators.js';
import { resolveCustomPrompt } from '../evaluators/prompt-resolution.js';
import type { Provider } from '../providers/types.js';
import type { ToolTrajectoryEvaluatorConfig } from '../trace.js';
import type {
  AgentJudgeEvaluatorConfig,
  CodeEvaluatorConfig,
  CompositeEvaluatorConfig,
  ContainsEvaluatorConfig,
  CostEvaluatorConfig,
  EqualsEvaluatorConfig,
  EvaluatorConfig,
  ExecutionMetricsEvaluatorConfig,
  FieldAccuracyEvaluatorConfig,
  IsJsonEvaluatorConfig,
  LatencyEvaluatorConfig,
  LlmJudgeEvaluatorConfig,
  RegexEvaluatorConfig,
  TokenUsageEvaluatorConfig,
} from '../types.js';
import {
  DeterministicAssertionEvaluator,
  type EvaluatorDispatchContext,
  type EvaluatorFactoryFn,
  EvaluatorRegistry,
} from './evaluator-registry.js';

/**
 * Factory for `llm_judge` evaluators.
 * Creates a wrapper that resolves custom prompts at evaluation time,
 * then delegates to the shared LLM judge instance.
 */
export const llmJudgeFactory: EvaluatorFactoryFn = (config, context) => {
  const c = config as LlmJudgeEvaluatorConfig;
  const { llmJudge, agentTimeoutMs } = context;

  return {
    kind: 'llm_judge',
    async evaluate(evalContext) {
      const customPrompt = await resolveCustomPrompt(
        c,
        {
          evalCase: evalContext.evalCase,
          candidate: evalContext.candidate,
          output: evalContext.output,
          trace: evalContext.trace,
          config: c.config,
          fileChanges: evalContext.fileChanges,
          workspacePath: evalContext.workspacePath,
        },
        agentTimeoutMs,
      );
      return llmJudge.evaluate({
        ...evalContext,
        evaluatorTemplateOverride: customPrompt,
        evaluator: c,
      });
    },
  };
};

/** Factory for `code` (code_judge) evaluators. */
export const codeFactory: EvaluatorFactoryFn = (config, context) => {
  const c = config as CodeEvaluatorConfig;
  return new CodeEvaluator({
    script: c.script,
    cwd: c.resolvedCwd ?? c.cwd,
    agentTimeoutMs: context.agentTimeoutMs,
    config: c.config,
    target: c.target,
  });
};

/** Factory for `composite` evaluators. */
export const compositeFactory: EvaluatorFactoryFn = (config, context) => {
  const c = config as CompositeEvaluatorConfig;
  const evalFileDir = context.evalFileDir ?? process.cwd();

  return new CompositeEvaluator({
    config: c,
    cwd: evalFileDir,
    evaluatorFactory: {
      create: (memberConfig: EvaluatorConfig) => {
        const factory = context.registry.get(memberConfig.type);
        if (!factory) {
          throw new Error(`Unsupported evaluator type in composite: ${memberConfig.type}`);
        }
        // Factory functions may return a promise; for composite sync creation,
        // we handle the common synchronous cases directly.
        const result = factory(memberConfig, context);
        if (result instanceof Promise) {
          throw new Error(
            `Evaluator factory for type "${memberConfig.type}" is async — not supported inside composite members. Use synchronous factories for composite child evaluators.`,
          );
        }
        return result;
      },
    },
  });
};

/** Factory for `tool_trajectory` evaluators. */
export const toolTrajectoryFactory: EvaluatorFactoryFn = (config) => {
  return new ToolTrajectoryEvaluator({
    config: config as ToolTrajectoryEvaluatorConfig,
  });
};

/** Factory for `field_accuracy` evaluators. */
export const fieldAccuracyFactory: EvaluatorFactoryFn = (config) => {
  return new FieldAccuracyEvaluator({
    config: config as FieldAccuracyEvaluatorConfig,
  });
};

/** Factory for `latency` evaluators. */
export const latencyFactory: EvaluatorFactoryFn = (config) => {
  return new LatencyEvaluator({ config: config as LatencyEvaluatorConfig });
};

/** Factory for `cost` evaluators. */
export const costFactory: EvaluatorFactoryFn = (config) => {
  return new CostEvaluator({ config: config as CostEvaluatorConfig });
};

/** Factory for `token_usage` evaluators. */
export const tokenUsageFactory: EvaluatorFactoryFn = (config) => {
  return new TokenUsageEvaluator({ config: config as TokenUsageEvaluatorConfig });
};

/** Factory for `execution_metrics` evaluators. */
export const executionMetricsFactory: EvaluatorFactoryFn = (config) => {
  return new ExecutionMetricsEvaluator({
    config: config as ExecutionMetricsEvaluatorConfig,
  });
};

/** Factory for `agent_judge` evaluators. */
export const agentJudgeFactory: EvaluatorFactoryFn = (config, context) => {
  const c = config as AgentJudgeEvaluatorConfig;
  const { judgeProvider, targetResolver } = context;

  let customPrompt: string | undefined;
  if (c.resolvedPromptPath) {
    try {
      customPrompt = readFileSync(c.resolvedPromptPath, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Could not read agent_judge prompt at ${c.resolvedPromptPath}: ${message}`);
    }
  } else if (c.prompt) {
    customPrompt = c.prompt;
  }

  let judgeTargetProvider: Provider | undefined;
  if (c.target && targetResolver) {
    judgeTargetProvider = targetResolver(c.target);
    if (!judgeTargetProvider) {
      throw new Error(
        `agent_judge evaluator '${c.name}': target '${c.target}' not found in targets`,
      );
    }
  }

  return new AgentJudgeEvaluator({
    resolveJudgeProvider: async (ctx) => {
      if (ctx.judgeProvider) return ctx.judgeProvider;
      return judgeProvider;
    },
    maxSteps: c.max_steps,
    temperature: c.temperature,
    evaluatorTemplate: customPrompt,
    judgeTargetProvider,
  });
};

/** Factory for `contains` deterministic assertion. */
export const containsFactory: EvaluatorFactoryFn = (config) => {
  const c = config as ContainsEvaluatorConfig;
  return new DeterministicAssertionEvaluator('contains', (ctx) => {
    const result = runContainsAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      hits: result.hits,
      misses: result.misses,
      reasoning:
        result.score === 1
          ? `Output contains "${c.value}"`
          : `Output does not contain "${c.value}"`,
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `regex` deterministic assertion. */
export const regexFactory: EvaluatorFactoryFn = (config) => {
  const c = config as RegexEvaluatorConfig;
  return new DeterministicAssertionEvaluator('regex', (ctx) => {
    const result = runRegexAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      hits: result.hits,
      misses: result.misses,
      reasoning:
        result.score === 1
          ? `Output matches pattern /${c.value}/`
          : `Output does not match pattern /${c.value}/`,
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `is_json` deterministic assertion. */
export const isJsonFactory: EvaluatorFactoryFn = () => {
  return new DeterministicAssertionEvaluator('is_json', (ctx) => {
    const result = runIsJsonAssertion(ctx.candidate);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      hits: result.hits,
      misses: result.misses,
      reasoning: result.score === 1 ? 'Output is valid JSON' : 'Output is not valid JSON',
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `equals` deterministic assertion. */
export const equalsFactory: EvaluatorFactoryFn = (config) => {
  const c = config as EqualsEvaluatorConfig;
  return new DeterministicAssertionEvaluator('equals', (ctx) => {
    const result = runEqualsAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      hits: result.hits,
      misses: result.misses,
      reasoning:
        result.score === 1 ? `Output equals "${c.value}"` : `Output does not equal "${c.value}"`,
      expectedAspectCount: 1,
    };
  });
};

/**
 * Create a new EvaluatorRegistry with all built-in evaluator types registered.
 */
export function createBuiltinRegistry(): EvaluatorRegistry {
  const registry = new EvaluatorRegistry();

  registry
    .register('llm_judge', llmJudgeFactory)
    .register('code', codeFactory)
    .register('composite', compositeFactory)
    .register('tool_trajectory', toolTrajectoryFactory)
    .register('field_accuracy', fieldAccuracyFactory)
    .register('latency', latencyFactory)
    .register('cost', costFactory)
    .register('token_usage', tokenUsageFactory)
    .register('execution_metrics', executionMetricsFactory)
    .register('agent_judge', agentJudgeFactory)
    .register('contains', containsFactory)
    .register('regex', regexFactory)
    .register('is_json', isJsonFactory)
    .register('equals', equalsFactory);

  return registry;
}
