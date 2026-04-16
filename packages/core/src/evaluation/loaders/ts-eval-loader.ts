/**
 * Loads an eval suite from a TypeScript *.eval.ts file.
 *
 * Each TS eval file must export an EvalConfig as its default export or
 * as a named export called `config` or `evalConfig`.
 *
 * The file is loaded via dynamic import() which works natively in Bun
 * and requires tsx/jiti for Node.js.
 *
 * To add a new export convention: add the name to EXPORT_NAMES below.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { type EvalConfig, materializeEvalConfig } from '../evaluate.js';
import { createFunctionProvider } from '../providers/function-provider.js';
import type { ProviderFactoryFn } from '../providers/provider-registry.js';
import type { TargetDefinition } from '../providers/types.js';
import type { EvalSuiteResult } from '../yaml-parser.js';

const EXPORT_NAMES = ['default', 'config', 'evalConfig'] as const;

export interface TsEvalResult {
  readonly config: EvalConfig;
  readonly filePath: string;
}

export interface TsEvalSuiteResult extends EvalSuiteResult {
  readonly inlineTarget?: TargetDefinition;
  readonly providerFactory?: ProviderFactoryFn;
}

/**
 * Import a *.eval.ts file and extract the EvalConfig export.
 * Tries default, `config`, and `evalConfig` named exports in priority order.
 */
export async function loadTsEvalFile(filePath: string): Promise<TsEvalResult> {
  const absolutePath = path.resolve(filePath);
  const moduleUrl = pathToFileURL(absolutePath).href;
  const module = await import(moduleUrl);

  let config: EvalConfig | undefined;
  for (const name of EXPORT_NAMES) {
    const candidate = module[name];
    if (isEvalConfigLike(candidate)) {
      config = candidate;
      break;
    }
  }

  if (!config) {
    throw new Error(
      `${filePath}: no EvalConfig export found. Export an EvalConfig as default, 'config', or 'evalConfig'.`,
    );
  }

  return { config, filePath: absolutePath };
}

export async function loadTsEvalSuite(
  filePath: string,
  repoRoot: string,
  options?: {
    readonly verbose?: boolean;
    readonly filter?: string | readonly string[];
    readonly category?: string;
  },
): Promise<TsEvalSuiteResult> {
  const { config, filePath: absolutePath } = await loadTsEvalFile(filePath);
  const materialized = await materializeEvalConfig(config, {
    repoRoot,
    baseDir: path.dirname(absolutePath),
    filter: options?.filter,
    category: options?.category,
  });

  return {
    tests: materialized.tests,
    ...(materialized.workers !== undefined && { workers: materialized.workers }),
    ...(materialized.cache !== undefined && { cacheConfig: { enabled: materialized.cache } }),
    ...(materialized.budgetUsd !== undefined && { budgetUsd: materialized.budgetUsd }),
    ...(materialized.threshold !== undefined && { threshold: materialized.threshold }),
    ...(materialized.metadata !== undefined && { metadata: materialized.metadata }),
    ...(materialized.target !== undefined && { inlineTarget: materialized.target }),
    ...(materialized.task !== undefined && {
      providerFactory: (() => {
        const task = materialized.task;
        if (!task) {
          throw new Error(`${filePath}: missing task function for providerFactory`);
        }
        return createFunctionProvider(task);
      }) as ProviderFactoryFn,
    }),
  };
}

/**
 * Duck-type check for EvalConfig-like objects.
 * An EvalConfig must have at least one of: tests, specFile, or target.
 */
function isEvalConfigLike(value: unknown): value is EvalConfig {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return 'tests' in obj || 'specFile' in obj || 'target' in obj || 'task' in obj;
}
