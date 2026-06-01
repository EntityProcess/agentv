import { readFile } from 'node:fs/promises';

import { interpolateEnv } from '../interpolation.js';
import { parseYamlValue } from '../yaml-loader.js';
import type { ValidationError, ValidationResult } from './types.js';

/**
 * Validate a config.yaml file for schema compliance and structural correctness.
 */
export async function validateConfigFile(filePath: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = interpolateEnv(parseYamlValue(content), process.env);

    // Check if parsed content is an object
    if (typeof parsed !== 'object' || parsed === null) {
      errors.push({
        severity: 'error',
        filePath,
        message: 'Config file must contain a valid YAML object',
      });
      return { valid: false, filePath, fileType: 'config', errors };
    }

    const config = parsed as Record<string, unknown>;

    // Validate eval_patterns if present
    const evalPatterns = config.eval_patterns;
    if (evalPatterns !== undefined) {
      if (!Array.isArray(evalPatterns)) {
        errors.push({
          severity: 'error',
          filePath,
          location: 'eval_patterns',
          message: "Field 'eval_patterns' must be an array",
        });
      } else if (!evalPatterns.every((p) => typeof p === 'string')) {
        errors.push({
          severity: 'error',
          filePath,
          location: 'eval_patterns',
          message: "All entries in 'eval_patterns' must be strings",
        });
      } else if (evalPatterns.length === 0) {
        errors.push({
          severity: 'warning',
          filePath,
          location: 'eval_patterns',
          message: "Field 'eval_patterns' is empty. Consider removing it or adding patterns.",
        });
      }
    }

    // Check for unexpected fields
    // Validate required_version if present
    const requiredVersion = config.required_version;
    if (requiredVersion !== undefined) {
      if (typeof requiredVersion !== 'string' || requiredVersion.trim().length === 0) {
        errors.push({
          severity: 'error',
          filePath,
          location: 'required_version',
          message: 'Field \'required_version\' must be a non-empty string (e.g. ">=3.1.0")',
        });
      }
    }

    const results = config.results;
    if (results !== undefined) {
      if (typeof results !== 'object' || results === null || Array.isArray(results)) {
        errors.push({
          severity: 'error',
          filePath,
          location: 'results',
          message: "Field 'results' must be an object",
        });
      } else {
        const resultsRecord = results as Record<string, unknown>;
        if (resultsRecord.mode !== 'github') {
          errors.push({
            severity: 'error',
            filePath,
            location: 'results.mode',
            message: "Field 'results.mode' must be 'github'",
          });
        }
        if (typeof resultsRecord.repo !== 'string' || resultsRecord.repo.trim().length === 0) {
          errors.push({
            severity: 'error',
            filePath,
            location: 'results.repo',
            message: "Field 'results.repo' must be a non-empty string",
          });
        }
        if (resultsRecord.path !== undefined) {
          if (typeof resultsRecord.path !== 'string' || resultsRecord.path.trim().length === 0) {
            errors.push({
              severity: 'error',
              filePath,
              location: 'results.path',
              message: "Field 'results.path' must be a non-empty string",
            });
          } else {
            const p = resultsRecord.path.trim();
            const isFilesystemPath =
              p.startsWith('/') ||
              p.startsWith('~/') ||
              p.startsWith('~\\') ||
              p === '~' ||
              /^[A-Za-z]:[/\\]/.test(p);
            if (!isFilesystemPath) {
              errors.push({
                severity: 'error',
                filePath,
                location: 'results.path',
                message: `'results.path' must be an absolute or home-relative filesystem path (e.g., ~/data/agentv-results). Found: '${p}'. Remove 'path' to use the default.`,
              });
            }
          }
        }
        if (resultsRecord.auto_push !== undefined && typeof resultsRecord.auto_push !== 'boolean') {
          errors.push({
            severity: 'error',
            filePath,
            location: 'results.auto_push',
            message: "Field 'results.auto_push' must be a boolean",
          });
        }
        if (
          resultsRecord.branch_prefix !== undefined &&
          (typeof resultsRecord.branch_prefix !== 'string' ||
            resultsRecord.branch_prefix.trim().length === 0)
        ) {
          errors.push({
            severity: 'error',
            filePath,
            location: 'results.branch_prefix',
            message: "Field 'results.branch_prefix' must be a non-empty string",
          });
        }
      }
    }

    const allowedFields = new Set([
      '$schema',
      'eval_patterns',
      'required_version',
      'execution',
      'results',
      'dashboard',
      'studio',
    ]);
    const unexpectedFields = Object.keys(config).filter((key) => !allowedFields.has(key));

    if (unexpectedFields.length > 0) {
      errors.push({
        severity: 'warning',
        filePath,
        message: `Unexpected fields: ${unexpectedFields.join(', ')}`,
      });
    }

    return {
      valid: errors.filter((e) => e.severity === 'error').length === 0,
      filePath,
      fileType: 'config',
      errors,
    };
  } catch (error) {
    errors.push({
      severity: 'error',
      filePath,
      message: `Failed to parse config file: ${(error as Error).message}`,
    });
    return { valid: false, filePath, fileType: 'config', errors };
  }
}
