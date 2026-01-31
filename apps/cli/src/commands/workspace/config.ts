import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

export type WorkspaceMode = 'copy' | 'symlink';

export type WorkspaceSource =
  | {
      readonly id: string;
      readonly type: 'local';
      /** Absolute or workspace-relative path to the source repo/folder */
      readonly root: string;
      /** Relative folder paths (from root) to sync */
      readonly include: readonly string[];
      /** Relative path (from workspace root) to place the synced content */
      readonly dest?: string;
    }
  | {
      readonly id: string;
      readonly type: 'git';
      /** Git repo URL (https://, ssh, file path) */
      readonly repo: string;
      /** Branch/tag/commit; defaults to repo default */
      readonly ref?: string;
      /** Relative folder paths (from repo root) to sync */
      readonly include: readonly string[];
      /** Relative path (from workspace root) to place the synced content */
      readonly dest?: string;
    };

export interface WorkspaceConfig {
  readonly version: 1;
  /** Workspace root directory containing this config, unless explicitly set */
  readonly workspace_root?: string;
  readonly mode?: WorkspaceMode;
  readonly sources: readonly WorkspaceSource[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeRelPath(value: string): string {
  const trimmed = value.trim().replace(/\\/g, '/');
  return trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
}

function assertValidSourceId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
    throw new Error(
      `Invalid source id '${id}'. Use letters, numbers, dot, underscore, hyphen (must start with alphanumeric).`,
    );
  }
}

export async function readWorkspaceConfig(configPath: string): Promise<{
  readonly config: WorkspaceConfig;
  readonly configDir: string;
  readonly workspaceRoot: string;
}> {
  const resolvedConfigPath = path.resolve(configPath);
  const configDir = path.dirname(resolvedConfigPath);

  const rawText = await fs.readFile(resolvedConfigPath, 'utf8');
  const parsed = YAML.parse(rawText) as unknown;

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Invalid workspace config: expected YAML object at ${resolvedConfigPath}`);
  }

  const obj = parsed as Record<string, unknown>;
  const version = obj.version;
  if (version !== 1) {
    throw new Error(
      `Unsupported workspace config version: ${String(version)}. Expected version: 1`,
    );
  }

  const modeRaw = obj.mode;
  const mode: WorkspaceMode | undefined =
    modeRaw === undefined
      ? undefined
      : modeRaw === 'copy' || modeRaw === 'symlink'
        ? (modeRaw as WorkspaceMode)
        : undefined;
  if (modeRaw !== undefined && mode === undefined) {
    throw new Error(`Invalid workspace mode '${String(modeRaw)}' (expected 'copy' or 'symlink')`);
  }

  const workspaceRootRaw = obj.workspace_root;
  const workspaceRoot = isNonEmptyString(workspaceRootRaw)
    ? path.resolve(configDir, workspaceRootRaw)
    : configDir;

  const sourcesRaw = obj.sources;
  if (!Array.isArray(sourcesRaw)) {
    throw new Error('Workspace config must include sources: [...]');
  }

  const seenIds = new Set<string>();
  const sources: WorkspaceSource[] = sourcesRaw.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`sources[${index}] must be an object`);
    }

    const rec = item as Record<string, unknown>;
    const id = rec.id;
    if (!isNonEmptyString(id)) {
      throw new Error(`sources[${index}].id is required`);
    }
    assertValidSourceId(id);
    if (seenIds.has(id)) {
      throw new Error(`Duplicate source id '${id}'`);
    }
    seenIds.add(id);

    const type = rec.type;
    if (type !== 'local' && type !== 'git') {
      throw new Error(`sources[${index}].type must be 'local' or 'git'`);
    }

    const include = rec.include;
    if (!Array.isArray(include) || include.length === 0 || !include.every(isNonEmptyString)) {
      throw new Error(`sources[${index}].include must be a non-empty string array`);
    }
    const normalizedInclude = include.map((p) => normalizeRelPath(p));

    const destRaw = rec.dest;
    const dest = isNonEmptyString(destRaw) ? normalizeRelPath(destRaw) : undefined;

    if (type === 'local') {
      const root = rec.root;
      if (!isNonEmptyString(root)) {
        throw new Error(`sources[${index}].root is required for local sources`);
      }
      return {
        id,
        type: 'local',
        root,
        include: normalizedInclude,
        dest,
      };
    }

    const repo = rec.repo;
    if (!isNonEmptyString(repo)) {
      throw new Error(`sources[${index}].repo is required for git sources`);
    }

    const refRaw = rec.ref;
    const ref = isNonEmptyString(refRaw) ? refRaw.trim() : undefined;

    return {
      id,
      type: 'git',
      repo,
      ref,
      include: normalizedInclude,
      dest,
    };
  });

  const config: WorkspaceConfig = {
    version: 1,
    workspace_root: isNonEmptyString(workspaceRootRaw) ? workspaceRootRaw.trim() : undefined,
    mode,
    sources,
  };

  return { config, configDir, workspaceRoot };
}

export async function writeDefaultWorkspaceConfig(configPath: string, workspaceRoot: string) {
  const resolvedConfigPath = path.resolve(configPath);
  const configDir = path.dirname(resolvedConfigPath);

  await fs.mkdir(path.join(workspaceRoot, '.agentv'), { recursive: true });
  await fs.mkdir(configDir, { recursive: true });

  const doc: WorkspaceConfig = {
    version: 1,
    workspace_root: path.relative(configDir, workspaceRoot).split(path.sep).join('/'),
    mode: 'copy',
    sources: [],
  };

  const yamlText = YAML.stringify(doc);
  await fs.writeFile(resolvedConfigPath, yamlText, 'utf8');

  return resolvedConfigPath;
}
