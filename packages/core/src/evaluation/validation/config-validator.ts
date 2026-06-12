import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { getAgentvConfigDir } from '../../paths.js';
import { interpolateEnv } from '../interpolation.js';
import { parseYamlValue } from '../yaml-loader.js';
import type { ValidationError, ValidationResult } from './types.js';

/**
 * Validate a config.yaml file for schema compliance and structural correctness.
 */
export async function validateConfigFile(
  filePath: string,
  options: { scope?: 'project' | 'global' } = {},
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const scope = options.scope ?? inferConfigScope(filePath);

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

    validateResultsConfig(errors, filePath, config.results, 'results');

    const projects = config.projects;
    if (projects !== undefined) {
      if (scope === 'project') {
        errors.push({
          severity: 'warning',
          filePath,
          location: 'projects',
          message:
            "Field 'projects' is only valid in $AGENTV_HOME/config.yaml. Ignoring project registry entries in project-local .agentv/config.yaml.",
        });
      } else if (!Array.isArray(projects)) {
        errors.push({
          severity: 'error',
          filePath,
          location: 'projects',
          message: "Field 'projects' must be an array",
        });
      } else {
        validateProjects(errors, filePath, projects);
      }
    }

    if (config.results_by_project !== undefined) {
      errors.push({
        severity: 'warning',
        filePath,
        location: 'results_by_project',
        message:
          "Field 'results_by_project' is deprecated. Put per-project result repo settings under projects[].results in $AGENTV_HOME/config.yaml.",
      });
    }

    const allowedFields = new Set([
      '$schema',
      'eval_patterns',
      'required_version',
      'execution',
      'results',
      'projects',
      'results_by_project',
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

function inferConfigScope(filePath: string): 'project' | 'global' {
  const globalConfigPath = path.resolve(getAgentvConfigDir(), 'config.yaml');
  if (path.resolve(filePath) === globalConfigPath) {
    return 'global';
  }
  return filePath.split(/[\\/]/).includes('.agentv') ? 'project' : 'global';
}

function validateProjects(errors: ValidationError[], filePath: string, projects: unknown[]): void {
  projects.forEach((project, index) => {
    const location = `projects[${index}]`;
    if (typeof project !== 'object' || project === null || Array.isArray(project)) {
      errors.push({
        severity: 'error',
        filePath,
        location,
        message: `Field '${location}' must be an object`,
      });
      return;
    }

    const projectRecord = project as Record<string, unknown>;
    validateRequiredString(errors, filePath, projectRecord.id, `${location}.id`);
    validateRequiredString(errors, filePath, projectRecord.name, `${location}.name`);
    validateRequiredString(errors, filePath, projectRecord.path, `${location}.path`);

    if (projectRecord.source !== undefined) {
      errors.push({
        severity: 'error',
        filePath,
        location: `${location}.source`,
        message: `Field '${location}.source' was removed. Move 'source.url' to '${location}.repo_url' and move 'source.ref' to '${location}.ref'. Use a Git remote URL such as https://github.com/example/repo.git or git@github.com:example/repo.git.`,
      });
    }

    if (projectRecord.repository !== undefined) {
      errors.push({
        severity: 'error',
        filePath,
        location: `${location}.repository`,
        message: `Field '${location}.repository' was removed. Use '${location}.repo_url' with a Git remote URL instead.`,
      });
    }

    if (projectRecord.repo_url !== undefined) {
      validateGitRemoteUrl(errors, filePath, projectRecord.repo_url, `${location}.repo_url`);
    }

    if (projectRecord.ref !== undefined) {
      validateRequiredString(errors, filePath, projectRecord.ref, `${location}.ref`);
    }

    validateProjectResultsConfig(errors, filePath, projectRecord.results, `${location}.results`);
  });
}

function validateRequiredString(
  errors: ValidationError[],
  filePath: string,
  value: unknown,
  location: string,
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push({
      severity: 'error',
      filePath,
      location,
      message: `Field '${location}' must be a non-empty string`,
    });
  }
}

function validateGitRemoteUrl(
  errors: ValidationError[],
  filePath: string,
  value: unknown,
  location: string,
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push({
      severity: 'error',
      filePath,
      location,
      message: `Field '${location}' must be a non-empty Git remote URL (e.g., https://github.com/EntityProcess/agentv.git or git@github.com:EntityProcess/agentv.git)`,
    });
    return;
  }

  const repoUrl = value.trim();
  if (!/^(https?:\/\/|ssh:\/\/|git@|file:\/\/).+/.test(repoUrl)) {
    errors.push({
      severity: 'error',
      filePath,
      location,
      message: `Field '${location}' must be a Git remote URL, not an owner/name shorthand. Use https://github.com/owner/repo.git or git@github.com:owner/repo.git.`,
    });
  }
}

function validateProjectResultsConfig(
  errors: ValidationError[],
  filePath: string,
  rawResults: unknown,
  location: string,
): void {
  if (rawResults === undefined) {
    return;
  }

  if (typeof rawResults !== 'object' || rawResults === null || Array.isArray(rawResults)) {
    errors.push({
      severity: 'error',
      filePath,
      location,
      message: `Field '${location}' must be an object`,
    });
    return;
  }

  const resultsRecord = rawResults as Record<string, unknown>;

  const removedFields: Record<string, string> = {
    mode: `Remove '${location}.mode'; project results use '${location}.repo_url' as the Git remote URL.`,
    repo: `Field '${location}.repo' was removed. Use '${location}.repo_url' with a Git remote URL instead.`,
    repository: `Field '${location}.repository' was removed. Use '${location}.repo_url' with a Git remote URL instead.`,
    local_path: `Field '${location}.local_path' was removed. Use '${location}.path' for the local clone path instead.`,
    auto_push: `Field '${location}.auto_push' was removed. Use '${location}.sync.auto_push' instead.`,
  };

  for (const [field, message] of Object.entries(removedFields)) {
    if (resultsRecord[field] !== undefined) {
      errors.push({
        severity: 'error',
        filePath,
        location: `${location}.${field}`,
        message,
      });
    }
  }

  validateGitRemoteUrl(errors, filePath, resultsRecord.repo_url, `${location}.repo_url`);

  if (
    resultsRecord.branch !== undefined &&
    (typeof resultsRecord.branch !== 'string' || resultsRecord.branch.trim().length === 0)
  ) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.branch`,
      message: `Field '${location}.branch' must be a non-empty string`,
    });
  }

  if (resultsRecord.path !== undefined) {
    if (typeof resultsRecord.path !== 'string' || resultsRecord.path.trim().length === 0) {
      errors.push({
        severity: 'error',
        filePath,
        location: `${location}.path`,
        message: `Field '${location}.path' must be a non-empty string`,
      });
    } else if (!isFilesystemPath(resultsRecord.path.trim())) {
      errors.push({
        severity: 'error',
        filePath,
        location: `${location}.path`,
        message: `'${location}.path' must be an absolute or home-relative filesystem path (e.g., ~/data/agentv-results).`,
      });
    }
  }

  if (resultsRecord.sync !== undefined) {
    if (
      typeof resultsRecord.sync !== 'object' ||
      resultsRecord.sync === null ||
      Array.isArray(resultsRecord.sync)
    ) {
      errors.push({
        severity: 'error',
        filePath,
        location: `${location}.sync`,
        message: `Field '${location}.sync' must be an object`,
      });
    } else {
      const syncRecord = resultsRecord.sync as Record<string, unknown>;
      if (syncRecord.auto_push !== undefined && typeof syncRecord.auto_push !== 'boolean') {
        errors.push({
          severity: 'error',
          filePath,
          location: `${location}.sync.auto_push`,
          message: `Field '${location}.sync.auto_push' must be a boolean`,
        });
      }
    }
  }

  if (
    resultsRecord.branch_prefix !== undefined &&
    (typeof resultsRecord.branch_prefix !== 'string' ||
      resultsRecord.branch_prefix.trim().length === 0)
  ) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.branch_prefix`,
      message: `Field '${location}.branch_prefix' must be a non-empty string`,
    });
  }
}

function validateResultsConfig(
  errors: ValidationError[],
  filePath: string,
  rawResults: unknown,
  location: string,
): void {
  if (rawResults === undefined) {
    return;
  }

  if (typeof rawResults !== 'object' || rawResults === null || Array.isArray(rawResults)) {
    errors.push({
      severity: 'error',
      filePath,
      location,
      message: `Field '${location}' must be an object`,
    });
    return;
  }

  const resultsRecord = rawResults as Record<string, unknown>;
  if (resultsRecord.mode !== 'github') {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.mode`,
      message: `Field '${location}.mode' must be 'github'`,
    });
  }
  validateRequiredString(errors, filePath, resultsRecord.repo, `${location}.repo`);

  if (
    resultsRecord.branch !== undefined &&
    (typeof resultsRecord.branch !== 'string' || resultsRecord.branch.trim().length === 0)
  ) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.branch`,
      message: `Field '${location}.branch' must be a non-empty string`,
    });
  }

  if (resultsRecord.path !== undefined) {
    if (typeof resultsRecord.path !== 'string' || resultsRecord.path.trim().length === 0) {
      errors.push({
        severity: 'error',
        filePath,
        location: `${location}.path`,
        message: `Field '${location}.path' must be a non-empty string`,
      });
    } else {
      const p = resultsRecord.path.trim();
      if (!isFilesystemPath(p)) {
        errors.push({
          severity: 'error',
          filePath,
          location: `${location}.path`,
          message: `'${location}.path' must be an absolute or home-relative filesystem path (e.g., ~/data/agentv-results). Found: '${p}'. Remove 'path' to use the default.`,
        });
      }
    }
  }

  if (resultsRecord.auto_push !== undefined && typeof resultsRecord.auto_push !== 'boolean') {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.auto_push`,
      message: `Field '${location}.auto_push' must be a boolean`,
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
      location: `${location}.branch_prefix`,
      message: `Field '${location}.branch_prefix' must be a non-empty string`,
    });
  }
}

function isFilesystemPath(p: string): boolean {
  return (
    p.startsWith('/') ||
    p.startsWith('~/') ||
    p.startsWith('~\\') ||
    p === '~' ||
    /^[A-Za-z]:[/\\]/.test(p)
  );
}
