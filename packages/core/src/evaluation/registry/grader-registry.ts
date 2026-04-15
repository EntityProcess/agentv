/**
 * Extensible grader registry.
 *
 * Replaces the hardcoded switch/case dispatch in the orchestrator with
 * a registry of named factory functions. Built-in evaluators are registered
 * at startup; users can add custom evaluators via `defineAssertion()` in
 * `@agentv/eval` or by dropping files in `.agentv/assertions/`.
 */

import type { EvaluationContext, EvaluationScore, Grader } from '../graders/types.js';
import type { TargetResolver } from '../graders/types.js';
import type { Provider } from '../providers/types.js';
import type { GraderConfig } from '../types.js';

/**
 * Context passed to grader factory functions during creation.
 * Contains shared resources needed by evaluator instances.
 */
export interface GraderDispatchContext {
  /** Shared LLM grader provider (resolved at suite level) */
  readonly graderProvider?: Provider;
  /** @deprecated Use `graderProvider` instead */
  readonly judgeProvider?: Provider;
  /** Function to resolve target names to providers */
  readonly targetResolver?: TargetResolver;
  /** Available target names for code graders */
  readonly availableTargets?: readonly string[];
  /** Agent timeout in ms */
  readonly agentTimeoutMs?: number;
  /** Directory containing the eval file (for composite member resolution) */
  readonly evalFileDir?: string;
  /** Shared LLM grader evaluator instance */
  readonly llmGrader: Grader;
  /** @deprecated Use `llmGrader` instead */
  readonly llmJudge?: Grader;
  /** Reference to the registry itself (for composite evaluators that need to create children) */
  readonly registry: GraderRegistry;
}

/**
 * Factory function that creates an Grader instance from a config.
 *
 * Factory functions handle all type-specific initialization logic:
 * - Reading prompt files for LLM graders
 * - Resolving script paths for code graders
 * - Creating adapter evaluators for deterministic assertions
 */
export type GraderFactoryFn = (
  config: GraderConfig,
  context: GraderDispatchContext,
) => Grader | Promise<Grader>;

/**
 * Registry of grader factory functions keyed by grader type name.
 *
 * Built-in evaluators are registered at startup. Custom evaluators can be
 * registered via the `register()` method or discovered from `.agentv/assertions/`.
 */
export class GraderRegistry {
  private readonly factories = new Map<string, GraderFactoryFn>();

  /** Register a factory function for an grader type. */
  register(type: string, factory: GraderFactoryFn): this {
    this.factories.set(type, factory);
    return this;
  }

  /** Get the factory function for an grader type. */
  get(type: string): GraderFactoryFn | undefined {
    return this.factories.get(type);
  }

  /** Check if a factory is registered for the given type. */
  has(type: string): boolean {
    return this.factories.has(type);
  }

  /** List all registered grader type names. */
  list(): string[] {
    return [...this.factories.keys()];
  }

  /**
   * Create an evaluator instance from a config, using the registered factory.
   * Throws if no factory is registered for the grader type.
   */
  async create(config: GraderConfig, context: GraderDispatchContext): Promise<Grader> {
    const factory = this.factories.get(config.type);
    if (!factory) {
      throw new Error(
        `Unknown grader type: "${config.type}". Registered types: ${this.list().join(', ')}`,
      );
    }
    return factory(config, context);
  }
}

/**
 * Adapter that wraps a synchronous assertion function as an Grader.
 * Used for deterministic assertions (contains, regex, is-json, equals).
 */
export class DeterministicAssertionGrader implements Grader {
  readonly kind: string;

  constructor(
    kind: string,
    private readonly assertFn: (context: EvaluationContext) => EvaluationScore,
  ) {
    this.kind = kind;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    return this.assertFn(context);
  }
}
