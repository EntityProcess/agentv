import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { getLocalConfigPath } from '../../config-overlays.js';
import { getAgentvConfigDir } from '../../paths.js';
import { interpolateEnv } from '../interpolation.js';
import {
  normalizeComposableConfigGraph,
  resolveConfigFieldReferences,
} from '../loaders/config-graph.js';
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

    let config: Record<string, unknown>;
    try {
      config = await resolveConfigFieldReferences(parsed as Record<string, unknown>, filePath);
    } catch (error) {
      errors.push({
        severity: 'error',
        filePath,
        message: (error as Error).message,
      });
      return { valid: false, filePath, fileType: 'config', errors };
    }

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
    validateRefsConfig(errors, filePath, config.refs);
    validateComposableGraph(errors, filePath, config);
    validateDashboardConfig(errors, filePath, config.dashboard);
    validateHooksConfig(errors, filePath, config.hooks);
    validateEnvPathConfig(errors, filePath, config.env_path);
    validateEnvFromConfig(errors, filePath, config.env_from);

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

    const allowedFields = new Set([
      '$schema',
      'eval_patterns',
      'required_version',
      'execution',
      'results',
      'repo_resolvers',
      'refs',
      'targets',
      'graders',
      'tests',
      'defaults',
      'projects',
      'dashboard',
      'studio',
      'hooks',
      'env_path',
      'env_from',
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

function validateComposableGraph(
  errors: ValidationError[],
  filePath: string,
  config: Record<string, unknown>,
): void {
  try {
    normalizeComposableConfigGraph(config, filePath);
  } catch (error) {
    addError(errors, filePath, undefined, (error as Error).message);
  }
}

function validateDashboardConfig(
  errors: ValidationError[],
  filePath: string,
  rawDashboard: unknown,
): void {
  if (rawDashboard === undefined) {
    return;
  }
  if (!isPlainObject(rawDashboard)) {
    addError(errors, filePath, 'dashboard', "Field 'dashboard' must be an object");
    return;
  }
  if (Object.prototype.hasOwnProperty.call(rawDashboard, 'app_name')) {
    addError(
      errors,
      filePath,
      'dashboard.app_name',
      "Field 'dashboard.app_name' has been removed; the Dashboard app name is not user-configurable.",
    );
  }
}

const ENV_FROM_FORMATS = new Set(['shell_exports', 'json']);

function validateHooksConfig(errors: ValidationError[], filePath: string, rawHooks: unknown): void {
  if (rawHooks === undefined || rawHooks === null) {
    return;
  }
  if (!isPlainObject(rawHooks)) {
    addError(errors, filePath, 'hooks', "Field 'hooks' must be an object");
    return;
  }

  if (rawHooks.before_session !== undefined) {
    validateOptionalString(errors, filePath, rawHooks.before_session, 'hooks.before_session');
    errors.push({
      severity: 'warning',
      filePath,
      location: 'hooks.before_session',
      message:
        "'hooks.before_session' is deprecated; use 'env_path' and/or 'env_from' to load environment variables before validation and eval.",
    });
  }
}

function validateEnvPathConfig(
  errors: ValidationError[],
  filePath: string,
  rawEnvPath: unknown,
): void {
  if (rawEnvPath === undefined || rawEnvPath === null) {
    return;
  }

  const isList = Array.isArray(rawEnvPath);
  const entries = isList ? rawEnvPath : [rawEnvPath];
  entries.forEach((entry, index) => {
    const location = isList ? `env_path[${index}]` : 'env_path';
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      addError(errors, filePath, location, `Field '${location}' must be a non-empty string`);
    }
  });
}

function validateEnvFromConfig(
  errors: ValidationError[],
  filePath: string,
  rawEnvFrom: unknown,
): void {
  if (rawEnvFrom === undefined || rawEnvFrom === null) {
    return;
  }

  const isList = Array.isArray(rawEnvFrom);
  const entries = isList ? rawEnvFrom : [rawEnvFrom];
  entries.forEach((entry, index) => {
    const location = isList ? `env_from[${index}]` : 'env_from';
    if (!isPlainObject(entry)) {
      addError(errors, filePath, location, `Field '${location}' must be an object`);
      return;
    }

    const command = entry.command;
    if (typeof command === 'string') {
      addError(
        errors,
        filePath,
        `${location}.command`,
        `Field '${location}.command' must be an argv array of strings, not a shell command string. Use e.g. ["bun", "scripts/load-secrets.ts"].`,
      );
    } else if (
      !Array.isArray(command) ||
      command.length === 0 ||
      !command.every((part) => typeof part === 'string' && part.length > 0)
    ) {
      addError(
        errors,
        filePath,
        `${location}.command`,
        `Field '${location}.command' must be a non-empty array of strings`,
      );
    }

    if (entry.format !== undefined && !ENV_FROM_FORMATS.has(entry.format as string)) {
      addError(
        errors,
        filePath,
        `${location}.format`,
        `Field '${location}.format' must be "shell_exports" or "json"`,
      );
    }
  });
}

function validateRefsConfig(errors: ValidationError[], filePath: string, rawRefs: unknown): void {
  if (rawRefs === undefined) {
    return;
  }
  if (!isPlainObject(rawRefs)) {
    addError(errors, filePath, 'refs', "Field 'refs' must be an object");
    return;
  }

  for (const [name, value] of Object.entries(rawRefs)) {
    if (name.trim().length === 0) {
      addError(errors, filePath, 'refs', "Field 'refs' has an empty ref name");
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      addError(errors, filePath, `refs.${name}`, `Field 'refs.${name}' must be a non-empty string`);
    }
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
  location: string | undefined,
  message: string,
): void {
  errors.push({ severity: 'error', filePath, ...(location ? { location } : {}), message });
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
    addError(
      errors,
      filePath,
      `${location}.mode`,
      `Remove '${location}.mode'; results use '${location}.repo' and '${location}.path'.`,
    );
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
  validateResultsConfigBody(errors, filePath, rawResults, location);
}

function validateResultsConfig(
  errors: ValidationError[],
  filePath: string,
  rawResults: unknown,
  location: string,
): void {
  validateResultsConfigBody(errors, filePath, rawResults, location);
}
