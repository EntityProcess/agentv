import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

import type { ValidationError, ValidationResult } from './types.js';

/**
 * Validate a config.yaml file for schema compliance and structural correctness.
 */
export async function validateConfigFile(filePath: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = parse(content) as unknown;

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
        const exportConfig = (results as Record<string, unknown>).export;
        if (exportConfig !== undefined) {
          if (
            typeof exportConfig !== 'object' ||
            exportConfig === null ||
            Array.isArray(exportConfig)
          ) {
            errors.push({
              severity: 'error',
              filePath,
              location: 'results.export',
              message: "Field 'results.export' must be an object",
            });
          } else {
            const exportRecord = exportConfig as Record<string, unknown>;
            if (typeof exportRecord.repo !== 'string' || exportRecord.repo.trim().length === 0) {
              errors.push({
                severity: 'error',
                filePath,
                location: 'results.export.repo',
                message: "Field 'results.export.repo' must be a non-empty string",
              });
            }
            if (typeof exportRecord.path !== 'string' || exportRecord.path.trim().length === 0) {
              errors.push({
                severity: 'error',
                filePath,
                location: 'results.export.path',
                message: "Field 'results.export.path' must be a non-empty string",
              });
            }
            if (
              exportRecord.auto_push !== undefined &&
              typeof exportRecord.auto_push !== 'boolean'
            ) {
              errors.push({
                severity: 'error',
                filePath,
                location: 'results.export.auto_push',
                message: "Field 'results.export.auto_push' must be a boolean",
              });
            }
            if (
              exportRecord.branch_prefix !== undefined &&
              (typeof exportRecord.branch_prefix !== 'string' ||
                exportRecord.branch_prefix.trim().length === 0)
            ) {
              errors.push({
                severity: 'error',
                filePath,
                location: 'results.export.branch_prefix',
                message: "Field 'results.export.branch_prefix' must be a non-empty string",
              });
            }
          }
        }
      }
    }

    const allowedFields = new Set([
      '$schema',
      'eval_patterns',
      'required_version',
      'execution',
      'results',
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
