/**
 * Extensible provider registry.
 *
 * Replaces the hardcoded switch/case dispatch in createProvider() with
 * a registry of named factory functions. Built-in providers are registered
 * at startup; users can add custom providers via the registry API or by
 * dropping files in `.agentv/providers/`.
 */

import type { ResolvedTarget } from './targets.js';
import type { Provider } from './types.js';

/**
 * Factory function that creates a Provider instance from a resolved target.
 */
export type ProviderFactoryFn = (target: ResolvedTarget) => Provider;

/**
 * Registry of provider factory functions keyed by provider kind.
 *
 * Built-in providers are registered at startup. Custom providers can be
 * registered via the `register()` method.
 */
export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactoryFn>();

  /** Register a factory function for a provider kind. */
  register(kind: string, factory: ProviderFactoryFn): this {
    this.factories.set(kind, factory);
    return this;
  }

  /** Get the factory function for a provider kind. */
  get(kind: string): ProviderFactoryFn | undefined {
    return this.factories.get(kind);
  }

  /** Check if a factory is registered for the given kind. */
  has(kind: string): boolean {
    return this.factories.has(kind);
  }

  /** List all registered provider kind names. */
  list(): string[] {
    return [...this.factories.keys()];
  }

  /**
   * Create a provider instance from a resolved target.
   * Falls back to CLI provider for unknown kinds (custom provider escape hatch).
   */
  create(target: ResolvedTarget): Provider {
    const factory = this.factories.get(target.kind);
    if (!factory) {
      throw new Error(
        `Unknown provider kind: "${target.kind}". Registered kinds: ${this.list().join(', ')}`,
      );
    }
    return factory(target);
  }
}
