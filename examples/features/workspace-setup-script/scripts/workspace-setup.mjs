// @ts-check
//
// AgentV beforeAll lifecycle extension for this example.
//
// It runs after the authored environment recipe is prepared, then refreshes
// allagents project state inside the prepared workspace.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_FILES = ['AGENTS.md', '.github/prompts/summarize-repo.prompt.md'];

/**
 * @param {{
 *   workspace_path?: string;
 *   eval_dir: string;
 * }} context
 */
export function beforeAll(context) {
  const workspacePath = context.workspace_path;
  if (!workspacePath) {
    throw new Error('workspace_path not provided to workspace setup extension');
  }

  const templatePath = resolve(context.eval_dir, '../workspace-template/.allagents/workspace.yaml');
  const marketplaceSource = resolve(context.eval_dir, '../marketplace');

  runAllagentsSetup({
    workspacePath,
    templatePath,
    marketplaceSource,
    requiredFiles: REQUIRED_FILES,
  });

  return {
    metadata: {
      workspace_setup: {
        marketplace_source: marketplaceSource,
        required_files: REQUIRED_FILES,
      },
    },
  };
}

/**
 * @param {{
 *   workspacePath: string;
 *   templatePath: string;
 *   marketplaceSource?: string;
 *   marketplaceName?: string;
 *   requiredFiles: readonly string[];
 * }} options
 */
function runAllagentsSetup(options) {
  rmSync(join(options.workspacePath, '.allagents'), { recursive: true, force: true });

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  run(npx, [
    '--yes',
    'allagents',
    'workspace',
    'init',
    options.workspacePath,
    '--from',
    options.templatePath,
  ]);

  if (options.marketplaceSource) {
    const addMarketplaceArgs = [
      '--yes',
      'allagents',
      'plugin',
      'marketplace',
      'add',
      options.marketplaceSource,
      '--scope',
      'project',
    ];
    if (options.marketplaceName) {
      addMarketplaceArgs.push('--name', options.marketplaceName);
    }
    run(npx, addMarketplaceArgs, options.workspacePath);
    run(npx, ['--yes', 'allagents', 'workspace', 'sync'], options.workspacePath);
  }

  const missing = options.requiredFiles.filter(
    (file) => !existsSync(join(options.workspacePath, file)),
  );
  if (missing.length > 0) {
    throw new Error(`Required artifacts not found in workspace: ${missing.join(', ')}`);
  }
}

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {string | undefined} cwd
 */
function run(command, args, cwd = undefined) {
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    ...(cwd ? { cwd } : {}),
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status ?? 1}`);
  }
}

function runCli() {
  const fromIndex = process.argv.indexOf('--from');
  if (fromIndex === -1 || !process.argv[fromIndex + 1]) {
    throw new Error(
      'Usage: workspace-setup.mjs --from <template-path> [--marketplace-source <dir>] [--marketplace-name <name>] [--require <file> ...]',
    );
  }

  const { workspace_path } = JSON.parse(readFileSync(0, 'utf8'));
  if (!workspace_path) {
    throw new Error('workspace_path not provided on stdin');
  }

  const requiredFiles = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--require' && process.argv[i + 1]) {
      requiredFiles.push(process.argv[i + 1]);
      i++;
    }
  }

  const marketplaceSourceIndex = process.argv.indexOf('--marketplace-source');
  const marketplaceSource =
    marketplaceSourceIndex !== -1
      ? resolve(process.cwd(), process.argv[marketplaceSourceIndex + 1])
      : undefined;
  const marketplaceNameIndex = process.argv.indexOf('--marketplace-name');
  const marketplaceName =
    marketplaceNameIndex !== -1 ? process.argv[marketplaceNameIndex + 1] : undefined;

  runAllagentsSetup({
    workspacePath: workspace_path,
    templatePath: resolve(process.cwd(), process.argv[fromIndex + 1]),
    ...(marketplaceSource ? { marketplaceSource } : {}),
    ...(marketplaceName ? { marketplaceName } : {}),
    requiredFiles,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
