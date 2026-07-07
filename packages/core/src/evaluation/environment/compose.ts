import { createHash } from 'node:crypto';

import type { EnvironmentRecipe } from '../loaders/environment-recipe.js';

export interface EnvironmentCompositionLayer {
  readonly scope: 'base' | 'provider';
  readonly providerName?: string;
  readonly environment: EnvironmentRecipe;
}

export type ComposedEnvironmentRecipe = EnvironmentRecipe & {
  readonly composition?: {
    readonly layers: readonly EnvironmentCompositionLayer[];
  };
};

export function composeProviderEnvironment(params: {
  readonly base: EnvironmentRecipe | undefined;
  readonly provider: EnvironmentRecipe | undefined;
  readonly providerName: string;
  readonly role: 'candidate' | 'grader';
}): ComposedEnvironmentRecipe | undefined {
  const { base, provider, providerName, role } = params;
  if (!provider) {
    return base;
  }
  if (!base) {
    return withComposition(provider, [{ scope: 'provider', providerName, environment: provider }]);
  }

  assertComposable(base, provider, providerName, role);
  const merged = {
    ...base,
    ...(base.env || provider.env
      ? {
          env: {
            ...(base.env ?? {}),
            ...(provider.env ?? {}),
          },
        }
      : {}),
    ...(provider.setup ? { setup: provider.setup } : {}),
    recipeSha256: compositionSha256(base, provider, providerName, role),
  } as ComposedEnvironmentRecipe;
  return withComposition(merged, [
    { scope: 'base', environment: base },
    { scope: 'provider', providerName, environment: provider },
  ]);
}

function withComposition(
  environment: EnvironmentRecipe,
  layers: readonly EnvironmentCompositionLayer[],
): ComposedEnvironmentRecipe {
  return {
    ...environment,
    composition: { layers },
  };
}

function assertComposable(
  base: EnvironmentRecipe,
  provider: EnvironmentRecipe,
  providerName: string,
  role: 'candidate' | 'grader',
): void {
  const prefix = `Provider-local environment for ${role} provider "${providerName}" cannot compose`;
  if (base.type !== provider.type) {
    throw new Error(
      `${prefix}: base environment type is "${base.type}" but provider type is "${provider.type}".`,
    );
  }
  if (base.workdir !== provider.workdir) {
    throw new Error(
      `${prefix}: base environment workdir "${base.workdir}" overlaps provider workdir "${provider.workdir}". Use the same workdir or move the provider-specific setup to a separate run.`,
    );
  }
  if (base.setup && provider.setup) {
    throw new Error(
      `${prefix}: both base and provider environments define setup commands, and AgentV will not guess setup ordering. Put shared setup in the base environment and provider-only setup in one layer.`,
    );
  }
  if (base.type === 'docker' && provider.type === 'docker') {
    for (const field of ['context', 'dockerfile', 'image'] as const) {
      if (
        base[field] !== undefined &&
        provider[field] !== undefined &&
        base[field] !== provider[field]
      ) {
        throw new Error(
          `${prefix}: docker ${field} differs between base and provider environments.`,
        );
      }
    }
  }
}

function compositionSha256(
  base: EnvironmentRecipe,
  provider: EnvironmentRecipe,
  providerName: string,
  role: 'candidate' | 'grader',
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        role,
        providerName,
        base: base.recipeSha256,
        provider: provider.recipeSha256,
        env: { ...(base.env ?? {}), ...(provider.env ?? {}) },
        setup: provider.setup ?? base.setup,
      }),
    )
    .digest('hex');
}
