/**
 * Factory functions for all built-in grader types.
 *
 * Each factory creates an Grader instance from an GraderConfig,
 * handling type-specific initialization logic. These are registered into
 * the GraderRegistry at startup.
 */

import {
  CodeGrader,
  CompositeGrader,
  CostGrader,
  ExecutionMetricsGrader,
  FieldAccuracyGrader,
  type Grader,
  LatencyGrader,
  LlmGrader,
  SkillTriggerGrader,
  TokenUsageGrader,
  ToolTrajectoryGrader,
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
} from '../graders.js';
import { InlineAssertGrader } from '../graders/inline-assert.js';
import { containsTemplateVariables, resolveCustomPrompt } from '../graders/prompt-resolution.js';
import { isAgentProvider } from '../providers/types.js';
import type { Provider } from '../providers/types.js';
import type { ToolTrajectoryGraderConfig } from '../trace.js';
import type {
  CodeGraderConfig,
  CompositeGraderConfig,
  ContainsAllGraderConfig,
  ContainsAnyGraderConfig,
  ContainsGraderConfig,
  CostGraderConfig,
  EndsWithGraderConfig,
  EqualsGraderConfig,
  ExecutionMetricsGraderConfig,
  FieldAccuracyGraderConfig,
  GraderConfig,
  IcontainsAllGraderConfig,
  IcontainsAnyGraderConfig,
  IcontainsGraderConfig,
  IsJsonGraderConfig,
  LatencyGraderConfig,
  LlmGraderConfig,
  RegexGraderConfig,
  SkillTriggerGraderConfig,
  StartsWithGraderConfig,
  TokenUsageGraderConfig,
} from '../types.js';
import {
  DeterministicAssertionGrader,
  type GraderDispatchContext,
  type GraderFactoryFn,
  GraderRegistry,
} from './grader-registry.js';

/** Symbol for attaching inline AssertFn to GraderConfig objects */
export const INLINE_ASSERT_FN = Symbol.for('agentv.inline-assert-fn');

/**
 * Factory for `llm-grader` evaluators.
 * Creates a wrapper that resolves custom prompts at evaluation time and
 * optionally overrides the grader target per evaluator.
 *
 * Auto-detects mode based on the resolved grader provider:
 * - LLM providers (azure, anthropic, gemini): structured JSON mode
 * - Agent providers (claude-cli, copilot, etc.): delegate mode
 * - agentv provider: built-in AI SDK agent mode with filesystem tools
 */
export const llmGraderFactory: GraderFactoryFn = (config, context) => {
  const c = config as LlmGraderConfig;
  const { llmGrader, graderProvider, judgeProvider, targetResolver, agentTimeoutMs } = context;

  let evaluator = llmGrader;
  if (c.target) {
    let graderTargetProvider: Provider | undefined;
    if (targetResolver) {
      graderTargetProvider = targetResolver(c.target);
    }
    if (!graderTargetProvider) {
      throw new Error(
        `llm-grader evaluator '${c.name}': target '${c.target}' not found in targets`,
      );
    }
    // Only pass graderTargetProvider for agent providers (delegate mode).
    // LLM providers use the normal resolveGraderProvider path for structured JSON mode.
    // Note: agentv uses asLanguageModel() not invoke(), so it's not in AGENT_PROVIDER_KINDS;
    // check it explicitly here for built-in agent mode.
    const isAgent = isAgentProvider(graderTargetProvider) || graderTargetProvider.kind === 'agentv';
    evaluator = new LlmGrader({
      resolveGraderProvider: async (evalContext) => {
        if (graderTargetProvider) return graderTargetProvider;
        if (evalContext.graderProvider) return evalContext.graderProvider;
        return graderProvider ?? judgeProvider;
      },
      maxSteps: c.max_steps,
      temperature: c.temperature,
      ...(isAgent ? { graderTargetProvider } : {}),
    });
  }

  return {
    kind: 'llm-grader',
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

      // Determine whether the resolved prompt should replace the entire
      // grader template or be injected as the {{criteria}} in the default
      // template.
      //
      // Script-based prompts (resolvedPromptScript) and file-based prompts
      // (resolvedPromptPath/promptPath) are always treated as full template
      // overrides — they're expected to produce the complete grader prompt.
      //
      // Inline `prompt:` strings are checked for template variables like
      // {{output}}, {{input}}, etc.  If present, the string is a full custom
      // template.  If absent, it's bare criteria text (e.g. "Check if the
      // response shows step-by-step work") and gets injected into the default
      // template's {{criteria}} slot so the grader still receives the
      // candidate output, input, and reference answer.  (#982)
      const isFromInlinePrompt =
        !c.resolvedPromptScript?.length && !c.resolvedPromptPath && !c.promptPath;

      let graderTemplateOverride: string | undefined;
      let evalCase = evalContext.evalCase;
      if (customPrompt) {
        if (!isFromInlinePrompt || containsTemplateVariables(customPrompt)) {
          graderTemplateOverride = customPrompt;
        } else {
          // Bare inline text — use as criteria in the default template
          evalCase = { ...evalCase, criteria: customPrompt };
        }
      }

      return evaluator.evaluate({
        ...evalContext,
        evalCase,
        graderTemplateOverride,
        evaluator: c,
      });
    },
  };
};

/** Factory for `code-grader` evaluators. */
export const codeFactory: GraderFactoryFn = (config, context) => {
  const c = config as CodeGraderConfig;
  return new CodeGrader({
    command: c.command ?? c.script ?? [],
    cwd: c.resolvedCwd ?? c.cwd,
    agentTimeoutMs: context.agentTimeoutMs,
    config: c.config,
    target: c.target,
  });
};

/** Factory for `composite` evaluators. */
export const compositeFactory: GraderFactoryFn = (config, context) => {
  const c = config as CompositeGraderConfig;
  const evalFileDir = context.evalFileDir ?? process.cwd();

  return new CompositeGrader({
    config: c,
    cwd: evalFileDir,
    evaluatorFactory: {
      create: (memberConfig: GraderConfig) => {
        const factory = context.registry.get(memberConfig.type);
        if (!factory) {
          throw new Error(`Unsupported grader type in composite: ${memberConfig.type}`);
        }
        // Factory functions may return a promise; for composite sync creation,
        // we handle the common synchronous cases directly.
        const result = factory(memberConfig, context);
        if (result instanceof Promise) {
          throw new Error(
            `Grader factory for type "${memberConfig.type}" is async — not supported inside composite members. Use synchronous factories for composite child evaluators.`,
          );
        }
        return result;
      },
    },
  });
};

/** Factory for `tool-trajectory` evaluators. */
export const toolTrajectoryFactory: GraderFactoryFn = (config) => {
  return new ToolTrajectoryGrader({
    config: config as ToolTrajectoryGraderConfig,
  });
};

/** Factory for `field-accuracy` evaluators. */
export const fieldAccuracyFactory: GraderFactoryFn = (config) => {
  return new FieldAccuracyGrader({
    config: config as FieldAccuracyGraderConfig,
  });
};

/** Factory for `latency` evaluators. */
export const latencyFactory: GraderFactoryFn = (config) => {
  return new LatencyGrader({ config: config as LatencyGraderConfig });
};

/** Factory for `cost` evaluators. */
export const costFactory: GraderFactoryFn = (config) => {
  return new CostGrader({ config: config as CostGraderConfig });
};

/** Factory for `token-usage` evaluators. */
export const tokenUsageFactory: GraderFactoryFn = (config) => {
  return new TokenUsageGrader({ config: config as TokenUsageGraderConfig });
};

/** Factory for `execution-metrics` evaluators. */
export const executionMetricsFactory: GraderFactoryFn = (config) => {
  return new ExecutionMetricsGrader({
    config: config as ExecutionMetricsGraderConfig,
  });
};

/** Factory for `skill-trigger` evaluator. */
export const skillTriggerFactory: GraderFactoryFn = (config) => {
  return new SkillTriggerGrader(config as SkillTriggerGraderConfig);
};

/** Factory for `contains` deterministic assertion. */
export const containsFactory: GraderFactoryFn = (config) => {
  const c = config as ContainsGraderConfig;
  return new DeterministicAssertionGrader('contains', (ctx) => {
    const result = runContainsAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      assertions: result.assertions,
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `regex` deterministic assertion. */
export const regexFactory: GraderFactoryFn = (config) => {
  const c = config as RegexGraderConfig;
  return new DeterministicAssertionGrader('regex', (ctx) => {
    const result = runRegexAssertion(ctx.candidate, c.value, c.flags);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      assertions: result.assertions,
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `is-json` deterministic assertion. */
export const isJsonFactory: GraderFactoryFn = () => {
  return new DeterministicAssertionGrader('is-json', (ctx) => {
    const result = runIsJsonAssertion(ctx.candidate);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      assertions: result.assertions,
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `equals` deterministic assertion. */
export const equalsFactory: GraderFactoryFn = (config) => {
  const c = config as EqualsGraderConfig;
  return new DeterministicAssertionGrader('equals', (ctx) => {
    const result = runEqualsAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      assertions: result.assertions,
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `contains-any` deterministic assertion. */
export const containsAnyFactory: GraderFactoryFn = (config) => {
  const c = config as ContainsAnyGraderConfig;
  return new DeterministicAssertionGrader('contains-any', (ctx) => {
    const result = runContainsAnyAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      assertions: result.assertions,
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `contains-all` deterministic assertion. */
export const containsAllFactory: GraderFactoryFn = (config) => {
  const c = config as ContainsAllGraderConfig;
  return new DeterministicAssertionGrader('contains-all', (ctx) => {
    const result = runContainsAllAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      assertions: result.assertions,
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `icontains` deterministic assertion. */
export const icontainsFactory: GraderFactoryFn = (config) => {
  const c = config as IcontainsGraderConfig;
  return new DeterministicAssertionGrader('icontains', (ctx) => {
    const result = runIcontainsAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      assertions: result.assertions,
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `icontains-any` deterministic assertion. */
export const icontainsAnyFactory: GraderFactoryFn = (config) => {
  const c = config as IcontainsAnyGraderConfig;
  return new DeterministicAssertionGrader('icontains-any', (ctx) => {
    const result = runIcontainsAnyAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      assertions: result.assertions,
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `icontains-all` deterministic assertion. */
export const icontainsAllFactory: GraderFactoryFn = (config) => {
  const c = config as IcontainsAllGraderConfig;
  return new DeterministicAssertionGrader('icontains-all', (ctx) => {
    const result = runIcontainsAllAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      assertions: result.assertions,
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `starts-with` deterministic assertion. */
export const startsWithFactory: GraderFactoryFn = (config) => {
  const c = config as StartsWithGraderConfig;
  return new DeterministicAssertionGrader('starts-with', (ctx) => {
    const result = runStartsWithAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      assertions: result.assertions,
      expectedAspectCount: 1,
    };
  });
};

/** Factory for `ends-with` deterministic assertion. */
export const endsWithFactory: GraderFactoryFn = (config) => {
  const c = config as EndsWithGraderConfig;
  return new DeterministicAssertionGrader('ends-with', (ctx) => {
    const result = runEndsWithAssertion(ctx.candidate, c.value);
    return {
      score: result.score,
      verdict: result.score === 1 ? 'pass' : 'fail',
      assertions: result.assertions,
      expectedAspectCount: 1,
    };
  });
};

/**
 * Create a new GraderRegistry with all built-in grader types registered.
 */
export function createBuiltinRegistry(): GraderRegistry {
  const registry = new GraderRegistry();

  registry
    .register('llm-grader', llmGraderFactory)
    .register('code-grader', codeFactory)
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
      return new InlineAssertGrader(fn, config.name ?? 'inline-assert');
    });

  return registry;
}
