/**
 * Typed configuration file support for AgentV.
 *
 * Provides `defineConfig()` for use in `agentv.config.ts` files. Supports
 * auto-discovery, Zod validation, and IDE autocomplete.
 *
 * @example
 * ```typescript
 * // agentv.config.ts
 * import { defineConfig } from '@agentv/core';
 *
 * export default defineConfig({
 *   execution: {
 *     maxConcurrency: 5,
 *     maxRetries: 2,
 *     agentTimeoutMs: 120_000,
 *   },
 *   output: {
 *     dir: './results',
 *   },
 * });
 * ```
 *
 * @module
 */

import { z } from 'zod';

const ExecutionConfigSchema = z
  .object({
    /** General eval parallelism (default: 3) */
    maxConcurrency: z.number().int().min(1).max(50).optional(),
    /** Maximum retries on failure (default: 2) */
    maxRetries: z.number().int().min(0).optional(),
    /** Agent timeout in milliseconds. No timeout if not set. */
    agentTimeoutMs: z.number().int().min(0).optional(),
    /** Enable verbose logging */
    verbose: z.boolean().optional(),
    /** Always keep temp workspaces after eval */
    keepWorkspaces: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const supportedFields = new Set([
      'maxConcurrency',
      'maxRetries',
      'agentTimeoutMs',
      'verbose',
      'keepWorkspaces',
    ]);

    if ('otelFile' in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['otelFile'],
        message:
          'execution.otelFile has been removed. Emit OpenTelemetry/OpenInference traces from the system under test or provider and correlate AgentV run artifacts with external_trace metadata.',
      });
    }

    for (const key of Object.keys(value)) {
      if (!supportedFields.has(key) && key !== 'otelFile') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Unsupported execution field '${key}'`,
        });
      }
    }
  })
  .transform(({ maxConcurrency, maxRetries, agentTimeoutMs, verbose, keepWorkspaces }) => ({
    ...(maxConcurrency !== undefined && { maxConcurrency }),
    ...(maxRetries !== undefined && { maxRetries }),
    ...(agentTimeoutMs !== undefined && { agentTimeoutMs }),
    ...(verbose !== undefined && { verbose }),
    ...(keepWorkspaces !== undefined && { keepWorkspaces }),
  }));

/**
 * Schema for AgentV project-level configuration.
 */
const AgentVConfigSchema = z.object({
  /** Default execution settings */
  execution: ExecutionConfigSchema.optional(),

  /** Output settings */
  output: z
    .object({
      /** Default eval run artifact directory */
      dir: z.string().optional(),
    })
    .strict()
    .optional(),

  /** Response caching */
  cache: z
    .object({
      /** Enable response caching */
      enabled: z.boolean().optional(),
      /** Response cache directory */
      path: z.string().optional(),
    })
    .optional(),

  /** Cost and duration limits */
  limits: z
    .object({
      /** Maximum cost per run in USD */
      maxCostUsd: z.number().min(0).optional(),
      /** Maximum duration per run in milliseconds */
      maxDurationMs: z.number().int().min(0).optional(),
    })
    .optional(),

  /** Lifecycle hooks */
  hooks: z
    .object({
      /**
       * Shell command to run once at agentv startup, before any command executes.
       * stdout is parsed for env var exports (`KEY=value` or `export KEY="value"`)
       * and injected into process.env. Keys already set in the environment are
       * not overwritten — existing env always takes priority.
       * stderr is forwarded to the user. Non-zero exit aborts with an error.
       */
      beforeSession: z.string().optional(),
    })
    .optional(),

  /** Project-local reusable references for fields that support ref://name */
  refs: z.record(z.string().min(1)).optional(),
});

/**
 * AgentV project-level configuration type.
 * Inferred from the Zod schema for full type safety.
 */
export type AgentVConfig = z.infer<typeof AgentVConfigSchema>;

/**
 * Define a typed AgentV configuration.
 *
 * Use this in `agentv.config.ts` at your project root. The configuration
 * is validated at load time and provides full IDE autocomplete.
 *
 * @param config - Configuration object
 * @returns Validated configuration
 *
 * @example
 * ```typescript
 * import { defineConfig } from '@agentv/core';
 *
 * export default defineConfig({
 *   execution: { maxConcurrency: 5 },
 *   output: { dir: './results' },
 *   limits: { maxCostUsd: 10.0 },
 * });
 * ```
 */
export function defineConfig(config: AgentVConfig): AgentVConfig {
  return AgentVConfigSchema.parse(config);
}

/**
 * Config file discovery order.
 * The first file found wins.
 */
const CONFIG_FILE_NAMES = [
  'agentv.config.ts',
  'agentv.config.js',
  'agentv.config.mts',
  'agentv.config.mjs',
  '.agentv/config.ts',
  '.agentv/config.js',
] as const;

/**
 * Discover and load an AgentV config file from the project root.
 *
 * Searches for config files in discovery order. Returns null if
 * no config file is found.
 *
 * @param projectRoot - Project root directory to search from
 * @returns Loaded and validated config, or null if not found
 */
export async function loadTsConfig(projectRoot: string): Promise<AgentVConfig | null> {
  const { existsSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  const { join } = await import('node:path');

  for (const fileName of CONFIG_FILE_NAMES) {
    const filePath = join(projectRoot, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const fileUrl = pathToFileURL(filePath).href;
      const mod = await import(fileUrl);
      const config = mod.default ?? mod;

      return AgentVConfigSchema.parse(config);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load config from ${filePath}: ${msg}`);
    }
  }

  return null;
}
