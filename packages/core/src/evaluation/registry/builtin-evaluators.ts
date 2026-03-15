/**
 * Factory functions for all built-in evaluator types.
 *
 * Each factory creates an Evaluator instance from an EvaluatorConfig,
 * handling type-specific initialization logic. These are registered into
 * the EvaluatorRegistry at startup.
 */

import {
  CodeEvaluator,
  CompositeEvaluator,
  CostEvaluator,
  type Evaluator,
  ExecutionMetricsEvaluator,
  FieldAccuracyEvaluator,
  LatencyEvaluator,
  LlmJudgeEvaluator,
  SkillTriggerEvaluator,
  TokenUsageEvaluator,
  ToolTrajectoryEvaluator,
  runContainsAllAssertion,
  runContainsAnyAssertion,
  runContainsAssertion,
  runEndsWithAssertion,
  runEqualsAssertion,
  runIcontainsAllAssertion,
  runIcontainsAnyAssertion,
  runIcontainsAssertion,
  runIsJsonAssertion,
  runRegexAssertion,
  runStartsWithAssertion,
} from '../evaluators.js';
import { InlineAssertEvaluator } from '../evaluators/inline-assert.js';
import { resolveCustomPrompt } from '../evaluators/prompt-resolution.js';
import { isAgentProvider } from '../providers/types.js';
import type { Provider } from '../providers/types.js';
import type { ToolTrajectoryEvaluatorConfig } from '../trace.js';
import type {
  CodeEvaluatorConfig,
  CompositeEvaluatorConfig,
  ContainsAllEvaluatorConfig,
  ContainsAnyEvaluatorConfig,
  ContainsEvaluatorConfig,
  CostEvaluatorConfig,
  EndsWithEvaluatorConfig,
  EqualsEvaluatorConfig,
  EvaluatorConfig,
  ExecutionMetricsEvaluatorConfig,
  FieldAccuracyEvaluatorConfig,
  IcontainsAllEvaluatorConfig,
  IcontainsAnyEvaluatorConfig,
  IcontainsEvaluatorConfig,
  IsJsonEvaluatorConfig,
  LatencyEvaluatorConfig,
  LlmJudgeEvaluatorConfig,
  RegexEvaluatorConfig,
  SkillTriggerEvaluatorConfig,
  StartsWithEvaluatorConfig,
  TokenUsageEvaluatorConfig,
} from '../types.js';
import {
  DeterministicAssertionEvaluator,
  type EvaluatorDispatchContext,
  type EvaluatorFactoryFn,
  EvaluatorRegistry,
} from './evaluator-registry.js';

/** Symbol for attaching inline AssertFn to EvaluatorConfig objects */
export const INLINE_ASSERT_FN = Symbol.for('agentv.inline-assert-fn');

/**
 * Factory for `llm-judge` evaluators.
 * Creates a wrapper that resolves custom prompts at evaluation time and
 * optionally overrides the judge target per evaluator.
 *
 * Auto-detects mode based on the resolved judge provider:
 * - LLM providers (azure, anthropic, gemini): structured JSON mode
 * - Agent providers (claude-cli, copilot, etc.): delegate mode
 * - agentv provider: built-in AI SDK agent mode with filesystem tools
 */
export const llmJudgeFactory: EvaluatorFactoryFn = (config, context) => {
  const c = config as LlmJudgeEvaluatorConfig;
  const { llmJudge, judgeProvider, targetResolver, agentTimeoutMs } = context;

  let evaluator = llmJudge;
  if (c.target) {
    let judgeTargetProvider: Provider | undefined;
    if (targetResolver) {
      judgeTargetProvider = targetResolver(c.target);
    }
    if (!judgeTargetProvider) {
      throw new Error(`llm-judge evaluator '${c.name}': target '${c.target}' not found in targets`);
    }
    // Only pass judgeTargetProvider for agent providers (delegate mode).
    // LLM providers use the normal resolveJudgeProvider path for structured JSON mode.
    const isAgent = isAgentProvider(judgeTargetProvider) || judgeTargetProvider.kind === 'agentv';
    evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async (evalContext) => {
        if (judgeTargetProvider) return judgeTargetProvider;
        if (evalContext.judgeProvider) return evalContext.judgeProvider;
        return judgeProvider;
      },
      maxSteps: c.max_steps,
      temperature: c.temperature,
      ...(isAgent ? { judgeTargetProvider } : {}),
    });
  }

  return {
    kind: 'llm-judge',
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
      return evaluator.evaluate({
        ...evalContext,
        evaluatorTemplateOverride: customPrompt,
        evaluator: c,
      });
    },
  };
};

/** Factory for `code-judge` evaluators. */
export const codeFactory: EvaluatorFactoryFn = (config, context) => {
  const c = config as CodeEvaluatorConfig;
  return new CodeEvaluator({
    command: c.command ?? c.script ?? [],
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

/** Factory for `tool-trajectory` evaluators. */
export const toolTrajectoryFactory: EvaluatorFactoryFn = (config) => {
  return new ToolTrajectoryEvaluator({
    config: config as ToolTrajectoryEvaluatorConfig,
  });
};

/** Factory for `field-accuracy` evaluators. */
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

/** Factory for `token-usage` evaluators. */
export const tokenUsageFactory: EvaluatorFactoryFn = (config) => {
  return new TokenUsageEvaluator({ config: config as TokenUsageEvaluatorConfig });
};

/** Factory for `execution-metrics` evaluators. */
export const executionMetricsFactory: EvaluatorFactoryFn = (config) => {
  return new ExecutionMetricsEvaluator({
    config: config as ExecutionMetricsEvaluatorConfig,
  });
};

/** Factory for `skill-trigger` evaluator. */
export const skillTriggerFactory: EvaluatorFactoryFn = (config) => {
  return new SkillTriggerEvaluator(config as SkillTriggerEvaluatorConfig);
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
    const result = runRegexAssertion(ctx.candidate, c.value, c.flags);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      hits: result.hits,
      misses: result.misses,
      reasoning:
        result.score === 1
          ? `Output matches pattern /${c.value}/${c.flags ?? ''}`
          : `Output does not match pattern /${c.value}/${c.flags ?? ''}`,
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `is-json` deterministic assertion. */
export const isJsonFactory: EvaluatorFactoryFn = () => {
  return new DeterministicAssertionEvaluator('is-json', (ctx) => {
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

/** Factory for `contains-any` deterministic assertion. */
export const containsAnyFactory: EvaluatorFactoryFn = (config) => {
  const c = config as ContainsAnyEvaluatorConfig;
  return new DeterministicAssertionEvaluator('contains-any', (ctx) => {
    const result = runContainsAnyAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      hits: result.hits,
      misses: result.misses,
      reasoning: result.score === 1 ? result.hits[0] : result.misses[0],
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `contains-all` deterministic assertion. */
export const containsAllFactory: EvaluatorFactoryFn = (config) => {
  const c = config as ContainsAllEvaluatorConfig;
  return new DeterministicAssertionEvaluator('contains-all', (ctx) => {
    const result = runContainsAllAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      hits: result.hits,
      misses: result.misses,
      reasoning: result.score === 1 ? result.hits[0] : result.misses[0],
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `icontains` deterministic assertion. */
export const icontainsFactory: EvaluatorFactoryFn = (config) => {
  const c = config as IcontainsEvaluatorConfig;
  return new DeterministicAssertionEvaluator('icontains', (ctx) => {
    const result = runIcontainsAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      hits: result.hits,
      misses: result.misses,
      reasoning: result.score === 1 ? result.hits[0] : result.misses[0],
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `icontains-any` deterministic assertion. */
export const icontainsAnyFactory: EvaluatorFactoryFn = (config) => {
  const c = config as IcontainsAnyEvaluatorConfig;
  return new DeterministicAssertionEvaluator('icontains-any', (ctx) => {
    const result = runIcontainsAnyAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      hits: result.hits,
      misses: result.misses,
      reasoning: result.score === 1 ? result.hits[0] : result.misses[0],
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `icontains-all` deterministic assertion. */
export const icontainsAllFactory: EvaluatorFactoryFn = (config) => {
  const c = config as IcontainsAllEvaluatorConfig;
  return new DeterministicAssertionEvaluator('icontains-all', (ctx) => {
    const result = runIcontainsAllAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      hits: result.hits,
      misses: result.misses,
      reasoning: result.score === 1 ? result.hits[0] : result.misses[0],
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `starts-with` deterministic assertion. */
export const startsWithFactory: EvaluatorFactoryFn = (config) => {
  const c = config as StartsWithEvaluatorConfig;
  return new DeterministicAssertionEvaluator('starts-with', (ctx) => {
    const result = runStartsWithAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      hits: result.hits,
      misses: result.misses,
      reasoning: result.score === 1 ? result.hits[0] : result.misses[0],
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `ends-with` deterministic assertion. */
export const endsWithFactory: EvaluatorFactoryFn = (config) => {
  const c = config as EndsWithEvaluatorConfig;
  return new DeterministicAssertionEvaluator('ends-with', (ctx) => {
    const result = runEndsWithAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      hits: result.hits,
      misses: result.misses,
      reasoning: result.score === 1 ? result.hits[0] : result.misses[0],
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
    .register('llm-judge', llmJudgeFactory)
    .register('code-judge', codeFactory)
    .register('composite', compositeFactory)
    .register('tool-trajectory', toolTrajectoryFactory)
    .register('field-accuracy', fieldAccuracyFactory)
    .register('latency', latencyFactory)
    .register('cost', costFactory)
    .register('token-usage', tokenUsageFactory)
    .register('execution-metrics', executionMetricsFactory)
    .register('skill-trigger', skillTriggerFactory)
    .register('contains', containsFactory)
    .register('contains-any', containsAnyFactory)
    .register('contains-all', containsAllFactory)
    .register('icontains', icontainsFactory)
    .register('icontains-any', icontainsAnyFactory)
    .register('icontains-all', icontainsAllFactory)
    .register('starts-with', startsWithFactory)
    .register('ends-with', endsWithFactory)
    .register('regex', regexFactory)
    .register('is-json', isJsonFactory)
    .register('equals', equalsFactory)
    .register('inline-assert', (config) => {
      // biome-ignore lint/suspicious/noExplicitAny: symbol key access requires any
      const fn = (config as any)[INLINE_ASSERT_FN] as
        | import('../assertions.js').AssertFn
        | undefined;
      if (!fn) {
        throw new Error(
          `No inline assert function found on config for "${config.name}". Inline assert functions must be attached via INLINE_ASSERT_FN symbol.`,
        );
      }
      return new InlineAssertEvaluator(fn, config.name ?? 'inline-assert');
    });

  return registry;
}
