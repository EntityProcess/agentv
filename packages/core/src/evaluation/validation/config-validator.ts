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
    validateRequiredString(errors, filePath, projectRecord.name, `${location}.name`);
    validateProjectRepoConfig(errors, filePath, projectRecord, location);
    validateProjectResultsConfig(errors, filePath, projectRecord.results, `${location}.results`);
  });
}

function addWarning(
  errors: ValidationError[],
  filePath: string,
  location: string,
  message: string,
): void {
  errors.push({ severity: 'warning', filePath, location, message });
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

function isGitRemoteUrlValue(value: string): boolean {
  return /^(https?:\/\/|ssh:\/\/|git@|file:\/\/).+/.test(value.trim());
}

function validateProjectRepoConfig(
  errors: ValidationError[],
  filePath: string,
  projectRecord: Record<string, unknown>,
  location: string,
): void {
  if (projectRecord.source !== undefined) {
    addError(
      errors,
      filePath,
      `${location}.source`,
      `Field '${location}.source' was removed. Move 'source.url' to '${location}.repo.url', move 'source.ref' to '${location}.repo.branch', and set '${location}.repo.path' to the local checkout path.`,
    );
  }

  if (projectRecord.repository !== undefined) {
    addError(
      errors,
      filePath,
      `${location}.repository`,
      `Field '${location}.repository' was removed. Use '${location}.repo.url' with a Git remote URL instead.`,
    );
  }

  if (projectRecord.repo !== undefined) {
    if (!isPlainObject(projectRecord.repo)) {
      addError(
        errors,
        filePath,
        `${location}.repo`,
        `Field '${location}.repo' must be an object with path, optional url, and optional branch.`,
      );
      return;
    }

    for (const flatField of ['path', 'repo_url', 'ref']) {
      if (projectRecord[flatField] !== undefined) {
        addError(
          errors,
          filePath,
          `${location}.${flatField}`,
          `Do not mix '${location}.${flatField}' with '${location}.repo'. Move source repo fields under '${location}.repo'.`,
        );
      }
    }

    validateRequiredString(errors, filePath, projectRecord.repo.path, `${location}.repo.path`);
    if (projectRecord.repo.url !== undefined) {
      validateGitRemoteUrl(errors, filePath, projectRecord.repo.url, `${location}.repo.url`);
    }
    if (projectRecord.repo.branch !== undefined) {
      validateRequiredString(
        errors,
        filePath,
        projectRecord.repo.branch,
        `${location}.repo.branch`,
      );
    }
    if (projectRecord.repo.ref !== undefined) {
      addError(
        errors,
        filePath,
        `${location}.repo.ref`,
        `Field '${location}.repo.ref' is not supported. Use '${location}.repo.branch'.`,
      );
    }
    if (projectRecord.repo.remote !== undefined) {
      addError(
        errors,
        filePath,
        `${location}.repo.remote`,
        `Use '${location}.repo.url' for the source Git URL. '${location}.repo.remote' is only valid inside results repo config.`,
      );
    }
    return;
  }

  validateRequiredString(errors, filePath, projectRecord.path, `${location}.path`);
  addWarning(
    errors,
    filePath,
    `${location}.path`,
    `Field '${location}.path' is deprecated. Use '${location}.repo.path'. Existing flat project entries still load and are written back in nested form.`,
  );

  if (projectRecord.repo_url !== undefined) {
    validateGitRemoteUrl(errors, filePath, projectRecord.repo_url, `${location}.repo_url`);
    addWarning(
      errors,
      filePath,
      `${location}.repo_url`,
      `Field '${location}.repo_url' is deprecated. Use '${location}.repo.url'.`,
    );
  }

  if (projectRecord.ref !== undefined) {
    validateRequiredString(errors, filePath, projectRecord.ref, `${location}.ref`);
    addWarning(
      errors,
      filePath,
      `${location}.ref`,
      `Field '${location}.ref' is deprecated. Use '${location}.repo.branch'.`,
    );
  }
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
  if (!isGitRemoteUrlValue(repoUrl)) {
    errors.push({
      severity: 'error',
      filePath,
      location,
      message: `Field '${location}' must be a Git remote URL, not an owner/name shorthand. Use https://github.com/owner/repo.git or git@github.com:owner/repo.git.`,
    });
  }
}

function validateResultsRepoBlock(
  errors: ValidationError[],
  filePath: string,
  rawRepo: unknown,
  location: string,
): void {
  if (!isPlainObject(rawRepo)) {
    addError(errors, filePath, location, `Field '${location}' must be an object`);
    return;
  }

  const repoRecord = rawRepo;
  const hasUrl = repoRecord.url !== undefined;
  const hasRemote = repoRecord.remote !== undefined;
  const hasPath = repoRecord.path !== undefined;

  if (!hasRemote && !hasUrl && !hasPath) {
    addError(errors, filePath, location, `Field '${location}' must set remote or path`);
  }

  if (hasRemote && hasUrl) {
    addError(
      errors,
      filePath,
      location,
      `Field '${location}' must set only one remote endpoint. Use '${location}.remote'.`,
    );
  }

  if (hasRemote) {
    validateGitRemoteUrl(errors, filePath, repoRecord.remote, `${location}.remote`);
  }

  if (hasUrl) {
    validateGitRemoteUrl(errors, filePath, repoRecord.url, `${location}.url`);
    addWarning(
      errors,
      filePath,
      `${location}.url`,
      `Field '${location}.url' is accepted for compatibility. Use '${location}.remote' for the Git remote URL.`,
    );
  }

  if (hasPath) {
    validateRequiredString(errors, filePath, repoRecord.path, `${location}.path`);
  }

  if (
    repoRecord.branch !== undefined &&
    (typeof repoRecord.branch !== 'string' || repoRecord.branch.trim().length === 0)
  ) {
    addError(
      errors,
      filePath,
      `${location}.branch`,
      `Field '${location}.branch' must be a non-empty string`,
    );
  }
}

function validateResultsSyncAndBranchPrefix(
  errors: ValidationError[],
  filePath: string,
  resultsRecord: Record<string, unknown>,
  location: string,
): void {
  if (resultsRecord.auto_push !== undefined && typeof resultsRecord.auto_push !== 'boolean') {
    addError(
      errors,
      filePath,
      `${location}.auto_push`,
      `Field '${location}.auto_push' must be a boolean`,
    );
  }

  if (resultsRecord.sync !== undefined) {
    if (
      typeof resultsRecord.sync !== 'object' ||
      resultsRecord.sync === null ||
      Array.isArray(resultsRecord.sync)
    ) {
      addError(errors, filePath, `${location}.sync`, `Field '${location}.sync' must be an object`);
    } else {
      const syncRecord = resultsRecord.sync as Record<string, unknown>;
      if (syncRecord.auto_push !== undefined && typeof syncRecord.auto_push !== 'boolean') {
        addError(
          errors,
          filePath,
          `${location}.sync.auto_push`,
          `Field '${location}.sync.auto_push' must be a boolean`,
        );
      }
      if (syncRecord.require_push !== undefined) {
        addError(
          errors,
          filePath,
          `${location}.sync.require_push`,
          `Field '${location}.sync.require_push' was removed from persistent config. Use the per-run --results-require-push CLI flag instead.`,
        );
      }
      if (syncRecord.push_conflict_policy === 'backup_and_force_push') {
        addError(
          errors,
          filePath,
          `${location}.sync.push_conflict_policy`,
          `Field '${location}.sync.push_conflict_policy' uses removed value 'backup_and_force_push'; remove it or set it to 'block'. AgentV never force-pushes result branches.`,
        );
      } else if (
        syncRecord.push_conflict_policy !== undefined &&
        syncRecord.push_conflict_policy !== 'block'
      ) {
        addError(
          errors,
          filePath,
          `${location}.sync.push_conflict_policy`,
          `Field '${location}.sync.push_conflict_policy' must be 'block'`,
        );
      }
    }
  }

  if (
    resultsRecord.branch_prefix !== undefined &&
    (typeof resultsRecord.branch_prefix !== 'string' ||
      resultsRecord.branch_prefix.trim().length === 0)
  ) {
    addError(
      errors,
      filePath,
      `${location}.branch_prefix`,
      `Field '${location}.branch_prefix' must be a non-empty string`,
    );
  }
}

function validateFlatResultsRepoConfig(
  errors: ValidationError[],
  filePath: string,
  resultsRecord: Record<string, unknown>,
  location: string,
  options: { allowLegacyRepoString: boolean },
): void {
  const hasLegacyRepo = typeof resultsRecord.repo === 'string';
  const hasRepoUrl = resultsRecord.repo_url !== undefined;
  const hasRepoPath = resultsRecord.repo_path !== undefined;
  const sourceCount = [
    options.allowLegacyRepoString && hasLegacyRepo,
    hasRepoUrl,
    hasRepoPath,
  ].filter(Boolean).length;
  if (sourceCount === 0) {
    addError(errors, filePath, location, `Field '${location}' must set repo.remote or repo.path`);
  } else if (sourceCount > 1) {
    addError(
      errors,
      filePath,
      location,
      `Field '${location}' must set only one results repo source. Use '${location}.repo.remote' for a managed clone or '${location}.repo.path' for an existing local checkout.`,
    );
  } else if (hasLegacyRepo) {
    validateRequiredString(errors, filePath, resultsRecord.repo, `${location}.repo`);
  } else if (hasRepoUrl) {
    validateGitRemoteUrl(errors, filePath, resultsRecord.repo_url, `${location}.repo_url`);
  } else {
    validateRequiredString(errors, filePath, resultsRecord.repo_path, `${location}.repo_path`);
  }

  if (
    resultsRecord.branch !== undefined &&
    (typeof resultsRecord.branch !== 'string' || resultsRecord.branch.trim().length === 0)
  ) {
    addError(
      errors,
      filePath,
      `${location}.branch`,
      `Field '${location}.branch' must be a non-empty string`,
    );
  }

  if (
    resultsRecord.remote !== undefined &&
    (typeof resultsRecord.remote !== 'string' || resultsRecord.remote.trim().length === 0)
  ) {
    addError(
      errors,
      filePath,
      `${location}.remote`,
      `Field '${location}.remote' must be a non-empty string`,
    );
  }

  if (resultsRecord.path !== undefined) {
    if (typeof resultsRecord.path !== 'string' || resultsRecord.path.trim().length === 0) {
      addError(
        errors,
        filePath,
        `${location}.path`,
        `Field '${location}.path' must be a non-empty string`,
      );
    } else {
      const p = resultsRecord.path.trim();
      if (!isFilesystemPath(p)) {
        addError(
          errors,
          filePath,
          `${location}.path`,
          `'${location}.path' must be an absolute or home-relative filesystem path (e.g., ~/data/agentv-results). Found: '${p}'. Remove 'path' to use the default.`,
        );
      }
    }
  }
}

function warnFlatResultsMigration(
  errors: ValidationError[],
  filePath: string,
  resultsRecord: Record<string, unknown>,
  location: string,
): void {
  const migrations: Record<string, string> = {
    repo: `${location}.repo.remote`,
    repo_url: `${location}.repo.remote`,
    repo_path: `${location}.repo.path`,
    branch: `${location}.repo.branch`,
    path: `${location}.repo.path`,
    auto_push: `${location}.sync.auto_push`,
    mode: '(remove this field)',
  };

  for (const [field, replacement] of Object.entries(migrations)) {
    if (resultsRecord[field] !== undefined) {
      addWarning(
        errors,
        filePath,
        `${location}.${field}`,
        `Field '${location}.${field}' is deprecated. Use '${replacement}' in the nested results repo schema.`,
      );
    }
  }

  if (resultsRecord.remote !== undefined) {
    addWarning(
      errors,
      filePath,
      `${location}.remote`,
      `Field '${location}.remote' is a legacy local Git remote-name override. Prefer omitting it; nested '${location}.repo.remote' is the portable Git remote URL and AgentV manages local aliases automatically.`,
    );
  }
}

function validateResultsConfigBody(
  errors: ValidationError[],
  filePath: string,
  rawResults: unknown,
  location: string,
  options: { allowLegacyRepoString: boolean; projectScoped: boolean },
): void {
  if (rawResults === undefined) {
    return;
  }

  if (!isPlainObject(rawResults)) {
    addError(errors, filePath, location, `Field '${location}' must be an object`);
    return;
  }

  const resultsRecord = rawResults;
  if (resultsRecord.mode !== undefined) {
    if (options.projectScoped) {
      addError(
        errors,
        filePath,
        `${location}.mode`,
        `Remove '${location}.mode'; project results use '${location}.repo.remote' or '${location}.repo.path'.`,
      );
    } else if (resultsRecord.mode !== 'github') {
      addError(errors, filePath, `${location}.mode`, `Field '${location}.mode' must be 'github'`);
    }
  }

  for (const [field, message] of Object.entries({
    repository: `Field '${location}.repository' was removed. Use '${location}.repo.remote' with a Git remote URL instead.`,
    local_path: `Field '${location}.local_path' was removed. Use '${location}.repo.path' for the local clone path instead.`,
  })) {
    if (resultsRecord[field] !== undefined) {
      addError(errors, filePath, `${location}.${field}`, message);
    }
  }

  if (options.projectScoped && resultsRecord.auto_push !== undefined) {
    addError(
      errors,
      filePath,
      `${location}.auto_push`,
      `Field '${location}.auto_push' was removed. Use '${location}.sync.auto_push' instead.`,
    );
  }

  const hasNestedRepo = isPlainObject(resultsRecord.repo);
  if (resultsRecord.repo !== undefined && !hasNestedRepo) {
    if (typeof resultsRecord.repo === 'string' && options.allowLegacyRepoString) {
      // Handled by the flat compatibility branch below.
    } else {
      addError(
        errors,
        filePath,
        `${location}.repo`,
        `Field '${location}.repo' must be an object. Use '${location}.repo.remote' for a Git remote URL or '${location}.repo.path' for an existing local checkout.`,
      );
    }
  }

  if (hasNestedRepo) {
    for (const flatField of ['repo_url', 'repo_path', 'branch', 'remote', 'path']) {
      if (resultsRecord[flatField] !== undefined) {
        addError(
          errors,
          filePath,
          `${location}.${flatField}`,
          `Do not mix '${location}.${flatField}' with '${location}.repo'. Move results repo fields under '${location}.repo'.`,
        );
      }
    }
    validateResultsRepoBlock(errors, filePath, resultsRecord.repo, `${location}.repo`);
  } else {
    validateFlatResultsRepoConfig(errors, filePath, resultsRecord, location, {
      allowLegacyRepoString: options.allowLegacyRepoString,
    });
    warnFlatResultsMigration(errors, filePath, resultsRecord, location);
  }

  validateResultsSyncAndBranchPrefix(errors, filePath, resultsRecord, location);
}

function validateProjectResultsConfig(
  errors: ValidationError[],
  filePath: string,
  rawResults: unknown,
  location: string,
): void {
  validateResultsConfigBody(errors, filePath, rawResults, location, {
    allowLegacyRepoString: false,
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
    allowLegacyRepoString: true,
    projectScoped: false,
  });
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
