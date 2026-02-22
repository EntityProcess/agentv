/**
 * Extensible evaluator registry.
 *
 * Replaces the hardcoded switch/case dispatch in the orchestrator with
 * a registry of named factory functions. Built-in evaluators are registered
 * at startup; users can add custom evaluators via `defineAssertion()` in
 * `@agentv/eval` or by dropping files in `.agentv/assertions/`.
 */

import type { EvaluationContext, EvaluationScore, Evaluator } from '../evaluators/types.js';
import type { TargetResolver } from '../evaluators/types.js';
import type { Provider } from '../providers/types.js';
import type { EvaluatorConfig } from '../types.js';

/**
 * Context passed to evaluator factory functions during creation.
 * Contains shared resources needed by evaluator instances.
 */
export interface EvaluatorDispatchContext {
  /** Shared LLM judge provider (resolved at suite level) */
  readonly judgeProvider?: Provider;
  /** Function to resolve target names to providers */
  readonly targetResolver?: TargetResolver;
  /** Available target names for code judges */
  readonly availableTargets?: readonly string[];
  /** Agent timeout in ms */
  readonly agentTimeoutMs?: number;
  /** Directory containing the eval file (for composite member resolution) */
  readonly evalFileDir?: string;
  /** Shared LLM judge evaluator instance */
  readonly llmJudge: Evaluator;
  /** Reference to the registry itself (for composite evaluators that need to create children) */
  readonly registry: EvaluatorRegistry;
}

/**
 * Factory function that creates an Evaluator instance from a config.
 *
 * Factory functions handle all type-specific initialization logic:
 * - Reading prompt files for LLM judges
 * - Resolving script paths for code judges
 * - Creating adapter evaluators for deterministic assertions
 */
export type EvaluatorFactoryFn = (
  config: EvaluatorConfig,
  context: EvaluatorDispatchContext,
) => Evaluator | Promise<Evaluator>;

/**
 * Registry of evaluator factory functions keyed by evaluator type name.
 *
 * Built-in evaluators are registered at startup. Custom evaluators can be
 * registered via the `register()` method or discovered from `.agentv/assertions/`.
 */
export class EvaluatorRegistry {
  private readonly factories = new Map<string, EvaluatorFactoryFn>();

  /** Register a factory function for an evaluator type. */
  register(type: string, factory: EvaluatorFactoryFn): this {
    this.factories.set(type, factory);
    return this;
  }

  /** Get the factory function for an evaluator type. */
  get(type: string): EvaluatorFactoryFn | undefined {
    return this.factories.get(type);
  }

  /** Check if a factory is registered for the given type. */
  has(type: string): boolean {
    return this.factories.has(type);
  }

  /** List all registered evaluator type names. */
  list(): string[] {
    return [...this.factories.keys()];
  }

  /**
   * Create an evaluator instance from a config, using the registered factory.
   * Throws if no factory is registered for the evaluator type.
   */
  async create(config: EvaluatorConfig, context: EvaluatorDispatchContext): Promise<Evaluator> {
    const factory = this.factories.get(config.type);
    if (!factory) {
      throw new Error(
        `Unknown evaluator type: "${config.type}". Registered types: ${this.list().join(', ')}`,
      );
    }
    return factory(config, context);
  }
}

/**
 * Adapter that wraps a synchronous assertion function as an Evaluator.
 * Used for deterministic assertions (contains, regex, is_json, equals).
 */
export class DeterministicAssertionEvaluator implements Evaluator {
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
