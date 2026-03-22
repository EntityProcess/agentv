/**
 * Validate all eval YAML files under examples/features.
 *
 * Finds files matching examples/features/** /*.eval.yaml (and .EVAL.yaml)
 * and runs AgentV schema validation on each one.
 *
 * Used by the prek pre-push hook to catch invalid eval files before pushing.
 *
 * Exit codes:
 *   0 — all files valid
 *   1 — one or more files invalid
 */
import { globSync } from 'node:fs';
import path from 'node:path';

import {
  type ValidationResult,
  validateEvalFile,
  validateFileReferences,
} from '../packages/core/src/evaluation/validation/index.js';

const ROOT = path.resolve(import.meta.dir, '..');

function findEvalFiles(): string[] {
  const patterns = [
    'examples/features/**/evals/*.eval.yaml',
    'examples/features/**/evals/*.EVAL.yaml',
    'examples/features/**/*.EVAL.yaml',
  ];

  const files = new Set<string>();
  for (const pattern of patterns) {
    for (const match of globSync(pattern, { cwd: ROOT })) {
      files.add(path.resolve(ROOT, match));
    }
  }
  return [...files].sort();
}

async function validateSingleFile(filePath: string): Promise<ValidationResult> {
  let result = await validateEvalFile(filePath);

  if (result.valid || result.errors.filter((e) => e.severity === 'error').length === 0) {
    const fileRefErrors = await validateFileReferences(filePath);
    if (fileRefErrors.length > 0) {
      result = {
        ...result,
        errors: [...result.errors, ...fileRefErrors],
        valid: result.valid && fileRefErrors.filter((e) => e.severity === 'error').length === 0,
      };
    }
  }

  return result;
}

async function main() {
  const files = findEvalFiles();

  if (files.length === 0) {
    console.log('No eval YAML files found.');
    process.exit(0);
  }

  console.log(`Validating ${files.length} eval YAML files...\n`);

  let invalidCount = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const result = await validateSingleFile(file);

    const errors = result.errors.filter((e) => e.severity === 'error');
    const warnings = result.errors.filter((e) => e.severity === 'warning');

    if (errors.length > 0) {
      invalidCount++;
      console.log(`\u2717 ${rel}`);
      for (const err of errors) {
        console.log(`  \u2717 ${err.path ? `[${err.path}] ` : ''}${err.message}`);
      }
    } else if (warnings.length > 0) {
      console.log(`\u2713 ${rel}`);
      for (const w of warnings) {
        console.log(`  \u26a0 ${w.path ? `[${w.path}] ` : ''}${w.message}`);
      }
    } else {
      console.log(`\u2713 ${rel}`);
    }
  }

  console.log(
    `\nTotal: ${files.length} | Valid: ${files.length - invalidCount} | Invalid: ${invalidCount}`,
  );

  if (invalidCount > 0) {
    process.exit(1);
  }
}

main();
