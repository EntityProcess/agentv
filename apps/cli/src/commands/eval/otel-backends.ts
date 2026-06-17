/**
 * OTel backend resolver loading for the eval CLI.
 *
 * Core owns generic OTLP export only. This module keeps CLI ergonomics for
 * `--otel-backend <name>` by checking project-local resolver files first, then
 * falling back to the small set of resolver names already exposed by the CLI.
 *
 * To add a local resolver, create `.agentv/otel-backends/<name>.mjs`
 * (or a Node-loadable `.js`) and export a resolver object as `default`,
 * `otelBackend`, or `resolver`.
 */

import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  OtelBackendResolution,
  OtelBackendResolver,
  OtelBackendResolverContext,
} from '@agentv/core';

const RESOLVER_EXTENSIONS = ['.mjs', '.js'] as const;

const builtinOtelBackendResolvers: readonly OtelBackendResolver[] = [
  {
    name: 'langfuse',
    resolve: ({ env }) => {
      const baseUrl = trimTrailingSlash(env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com');
      const publicKey = env.LANGFUSE_PUBLIC_KEY ?? '';
      const secretKey = env.LANGFUSE_SECRET_KEY ?? '';

      return {
        endpoint: `${baseUrl}/api/public/otel/v1/traces`,
        headers: {
          Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`,
        },
      };
    },
  },
  {
    name: 'braintrust',
    resolve: ({ env }) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${env.BRAINTRUST_API_KEY ?? ''}`,
      };
      const parent =
        env.BRAINTRUST_PARENT ??
        (env.BRAINTRUST_PROJECT_ID ? `project_id:${env.BRAINTRUST_PROJECT_ID}` : undefined) ??
        (env.BRAINTRUST_PROJECT ? `project_name:${env.BRAINTRUST_PROJECT}` : undefined);

      if (parent) {
        headers['x-bt-parent'] = parent;
      }

      return {
        endpoint: 'https://api.braintrust.dev/otel/v1/traces',
        headers,
      };
    },
  },
  {
    name: 'confident',
    resolve: ({ env }) => ({
      endpoint: 'https://otel.confident-ai.com/v1/traces',
      headers: {
        'x-confident-api-key': env.CONFIDENT_API_KEY ?? '',
      },
    }),
  },
];

const builtinOtelBackendResolversByName = new Map(
  builtinOtelBackendResolvers.map((resolver) => [resolver.name, resolver]),
);

export async function resolveOtelBackend(
  name: string,
  context: OtelBackendResolverContext,
): Promise<OtelBackendResolution | undefined> {
  const resolver = await loadOtelBackendResolver(name, context.cwd);
  return resolver?.resolve(context);
}

export async function loadOtelBackendResolver(
  name: string,
  cwd: string,
): Promise<OtelBackendResolver | undefined> {
  const localResolverPath = await findLocalOtelBackendResolver(name, cwd);
  if (localResolverPath) {
    return importOtelBackendResolver(localResolverPath, name);
  }

  return builtinOtelBackendResolversByName.get(name);
}

export function getBuiltinOtelBackendResolverNames(): readonly string[] {
  return builtinOtelBackendResolvers.map((resolver) => resolver.name);
}

async function findLocalOtelBackendResolver(
  name: string,
  cwd: string,
): Promise<string | undefined> {
  if (!isSafeResolverName(name)) {
    return undefined;
  }

  for (const dir of getResolverSearchDirs(cwd)) {
    for (const ext of RESOLVER_EXTENSIONS) {
      const candidate = path.join(dir, `${name}${ext}`);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Candidate does not exist in this directory.
      }
    }
  }

  return undefined;
}

function getResolverSearchDirs(cwd: string): readonly string[] {
  const dirs: string[] = [];
  let current = path.resolve(cwd);
  const root = path.parse(current).root;

  while (current !== root) {
    dirs.push(path.join(current, '.agentv', 'otel-backends'));
    current = path.dirname(current);
  }

  return dirs;
}

function isSafeResolverName(name: string): boolean {
  return name.length > 0 && !name.includes('/') && !name.includes('\\') && !name.startsWith('.');
}

async function importOtelBackendResolver(
  filePath: string,
  fallbackName: string,
): Promise<OtelBackendResolver> {
  const mod = await import(pathToFileURL(filePath).href);
  const candidate = [mod.default, mod.otelBackend, mod.resolver].find(
    (value) => value && typeof value.resolve === 'function',
  );

  if (!candidate) {
    throw new Error(
      `OTel backend resolver '${fallbackName}' from ${filePath} must export a resolver object`,
    );
  }

  return {
    ...candidate,
    name:
      typeof candidate.name === 'string' && candidate.name.length > 0
        ? candidate.name
        : fallbackName,
  } as OtelBackendResolver;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
