import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { getLocalConfigPath } from '../../config-overlays.js';
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
    validateRepoResolversConfig(errors, filePath, config.repo_resolvers);

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
      'repo_resolvers',
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

function validateRepoResolversConfig(
  errors: ValidationError[],
  filePath: string,
  rawResolvers: unknown,
): void {
  if (rawResolvers === undefined) {
    return;
  }

  if (!Array.isArray(rawResolvers)) {
    addError(errors, filePath, 'repo_resolvers', "Field 'repo_resolvers' must be an array");
    return;
  }

  const seenNames = new Set<string>();
  let defaultCount = 0;

  rawResolvers.forEach((resolver, index) => {
    const location = `repo_resolvers[${index}]`;
    if (!isPlainObject(resolver)) {
      addError(errors, filePath, location, `Field '${location}' must be an object`);
      return;
    }

    const name = resolver.name;
    if (typeof name !== 'string' || name.trim().length === 0) {
      addError(
        errors,
        filePath,
        `${location}.name`,
        `Field '${location}.name' must be a non-empty string`,
      );
    } else {
      const trimmedName = name.trim();
      if (seenNames.has(trimmedName)) {
        addError(
          errors,
          filePath,
          `${location}.name`,
          `Duplicate repo resolver name '${trimmedName}'`,
        );
      }
      seenNames.add(trimmedName);

      if (trimmedName === 'default') {
        defaultCount += 1;
        if (resolver.repos !== undefined) {
          addError(
            errors,
            filePath,
            `${location}.repos`,
            "Repo resolver named 'default' must not declare repos",
          );
        }
      }
    }

    const command = resolver.command;
    if (
      !Array.isArray(command) ||
      !command.every((entry) => typeof entry === 'string') ||
      command.length === 0
    ) {
      addError(
        errors,
        filePath,
        `${location}.command`,
        `Field '${location}.command' must be a non-empty string array`,
      );
    }

    const repos = resolver.repos;
    if (
      repos !== undefined &&
      (!Array.isArray(repos) ||
        repos.length === 0 ||
        !repos.every((entry) => typeof entry === 'string' && entry.trim().length > 0))
    ) {
      addError(
        errors,
        filePath,
        `${location}.repos`,
        `Field '${location}.repos' must be a non-empty string array when set`,
      );
    }

    if (resolver.config !== undefined && !isPlainObject(resolver.config)) {
      addError(
        errors,
        filePath,
        `${location}.config`,
        `Field '${location}.config' must be an object when set`,
      );
    }
  });

  if (defaultCount > 1) {
    addError(errors, filePath, 'repo_resolvers', "Duplicate repo resolver named 'default'");
  }
}

function inferConfigScope(filePath: string): 'project' | 'global' {
  const globalConfigPath = path.resolve(getAgentvConfigDir(), 'config.yaml');
  const globalLocalConfigPath = path.resolve(getLocalConfigPath(globalConfigPath));
  const resolvedPath = path.resolve(filePath);
  if (resolvedPath === globalConfigPath || resolvedPath === globalLocalConfigPath) {
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
    validateProjectRepoConfig(errors, filePath, projectRecord, location);
    validateProjectResultsConfig(errors, filePath, projectRecord.results, `${location}.results`);
  });
}

function addError(
  errors: ValidationError[],
  filePath: string,
  location: string,
  message: string,
): void {
  errors.push({ severity: 'error', filePath, location, message });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function validateOptionalString(
  errors: ValidationError[],
  filePath: string,
  value: unknown,
  location: string,
): void {
  if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0)) {
    addError(errors, filePath, location, `Field '${location}' must be a non-empty string`);
  }
}

function validateProjectRepoConfig(
  errors: ValidationError[],
  filePath: string,
  projectRecord: Record<string, unknown>,
  location: string,
): void {
  // Source repo is flat: required local checkout `path`, optional `repo`
  // (slug or Git URL), and optional `branch`.
  validateRequiredString(errors, filePath, projectRecord.path, `${location}.path`);
  validateOptionalString(errors, filePath, projectRecord.repo, `${location}.repo`);
  validateOptionalString(errors, filePath, projectRecord.branch, `${location}.branch`);
}

function validateResultsConfigBody(
  errors: ValidationError[],
  filePath: string,
  rawResults: unknown,
  location: string,
  options: { projectScoped: boolean },
): void {
  if (rawResults === undefined) {
    return;
  }

  if (!isPlainObject(rawResults)) {
    addError(errors, filePath, location, `Field '${location}' must be an object`);
    return;
  }

  const r = rawResults;

  if (r.mode !== undefined) {
    if (options.projectScoped) {
      addError(
        errors,
        filePath,
        `${location}.mode`,
        `Remove '${location}.mode'; project results use '${location}.repo' and '${location}.path'.`,
      );
    } else if (r.mode !== 'github') {
      addError(errors, filePath, `${location}.mode`, `Field '${location}.mode' must be 'github'`);
    }
  }

  validateOptionalString(errors, filePath, r.repo, `${location}.repo`);
  validateOptionalString(errors, filePath, r.path, `${location}.path`);
  validateOptionalString(errors, filePath, r.branch, `${location}.branch`);

  if (r.repo === undefined && r.path === undefined) {
    addError(errors, filePath, location, `Field '${location}' must set repo or path`);
  }

  if (r.auto_push !== undefined && typeof r.auto_push !== 'boolean') {
    addError(
      errors,
      filePath,
      `${location}.auto_push`,
      `Field '${location}.auto_push' must be a boolean`,
    );
  }
}

function validateProjectResultsConfig(
  errors: ValidationError[],
  filePath: string,
  rawResults: unknown,
  location: string,
): void {
  validateResultsConfigBody(errors, filePath, rawResults, location, {
    projectScoped: true,
  });
}

function validateResultsConfig(
  errors: ValidationError[],
  filePath: string,
  rawResults: unknown,
  location: string,
): void {
  validateResultsConfigBody(errors, filePath, rawResults, location, {
    projectScoped: false,
  });
}
