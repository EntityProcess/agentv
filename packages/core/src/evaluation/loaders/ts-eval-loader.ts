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
import type { EvalConfig } from '../evaluate.js';

const EXPORT_NAMES = ['default', 'config', 'evalConfig'] as const;

export interface TsEvalResult {
  readonly config: EvalConfig;
  readonly filePath: string;
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

/**
 * Duck-type check for EvalConfig-like objects.
 * An EvalConfig must have at least one of: tests, specFile, or target.
 */
function isEvalConfigLike(value: unknown): value is EvalConfig {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return 'tests' in obj || 'specFile' in obj || 'target' in obj || 'task' in obj;
}
