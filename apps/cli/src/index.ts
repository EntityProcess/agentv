import path from 'node:path';
import { loadConfig, runBeforeSessionHook } from '@agentv/core';
import { binary, run, subcommands } from 'cmd-ts';
import { findRepoRoot } from './commands/eval/shared.js';

import packageJson from '../package.json' with { type: 'json' };
import { compareCommand } from './commands/compare/index.js';
import { convertCommand } from './commands/convert/index.js';
import { createCommand } from './commands/create/index.js';
import { doctorCommand } from './commands/doctor/index.js';
import { evalCommand } from './commands/eval/index.js';
import { gradeCommand } from './commands/grade/index.js';
import { importCommand } from './commands/import/index.js';
import { initCmdTsCommand } from './commands/init/index.js';
import { inspectCommand } from './commands/inspect/index.js';
import { pipelineCommand } from './commands/pipeline/index.js';
import { prepareCommand } from './commands/prepare/index.js';
import { resultsCommand } from './commands/results/index.js';
import { resultsServeCommand } from './commands/results/serve.js';
import { runsCommand } from './commands/runs/index.js';
import { selfCommand } from './commands/self/index.js';
import { skillsCommand } from './commands/skills/index.js';
import { transpileCommand } from './commands/transpile/index.js';
import { trendCommand } from './commands/trend/index.js';
import { trimCommand } from './commands/trim/index.js';
import { validateCommand } from './commands/validate/index.js';
import { workspaceCommand } from './commands/workspace/index.js';
import { getUpdateNotice } from './update-check.js';

export const app = subcommands({
  name: 'agentv',
  description: 'AgentV CLI',
  version: packageJson.version,
  cmds: {
    dashboard: resultsServeCommand,
    eval: evalCommand,
    grade: gradeCommand,
    import: importCommand,
    compare: compareCommand,
    convert: convertCommand,
    create: createCommand,
    doctor: doctorCommand,
    init: initCmdTsCommand,
    pipeline: pipelineCommand,
    prepare: prepareCommand,
    results: resultsCommand,
    runs: runsCommand,
    self: selfCommand,
    skills: skillsCommand,
    serve: resultsServeCommand,
    inspect: inspectCommand,
    trend: trendCommand,
    transpile: transpileCommand,
    trim: trimCommand,
    validate: validateCommand,
    workspace: workspaceCommand,
  },
});

/**
 * Known eval subcommand names — used to decide whether to inject the
 * implicit `run` subcommand for backward-compatible `agentv eval <paths>`.
 */
const EVAL_SUBCOMMANDS = new Set(['run', 'assert', 'aggregate', 'bundle', 'vitest']);

/**
 * Top-level CLI command names (excluding `eval` itself).
 * Used to ensure `eval` is the top-level subcommand, not nested.
 */
const TOP_LEVEL_COMMANDS = new Set([
  'import',
  'inspect',
  'compare',
  'convert',
  'create',
  'dashboard',
  'doctor',
  'grade',
  'init',
  'pipeline',
  'prepare',
  'results',
  'runs',
  'self',
  'skills',
  'serve',
  'studio',
  'trend',
  'transpile',
  'trim',
  'validate',
  'workspace',
]);

export function usesDeprecatedStudioAlias(argv: string[]): boolean {
  return argv[2] === 'studio';
}

export function shouldRunBeforeSessionHook(argv: string[]): boolean {
  return !(argv[2] === 'eval' && argv[3] === 'vitest');
}

/**
 * Preprocess argv for convenience aliases:
 * - `--eval-id` → `--test-id`
 * - `agentv eval <non-subcommand>` → `agentv eval run <non-subcommand>`
 *   (backward compat: `eval` used to be a direct command, now it's a group)
 */
export function preprocessArgv(argv: string[]): string[] {
  const result = [...argv];

  if (result[2] === 'studio') {
    result[2] = 'dashboard';
  }

  // Rewrite --eval-id → --test-id (convenience alias)
  for (let i = 0; i < result.length; i++) {
    if (result[i] === '--eval-id') {
      result[i] = '--test-id';
    } else if (result[i].startsWith('--eval-id=')) {
      result[i] = `--test-id=${result[i].slice('--eval-id='.length)}`;
    }
  }

  // Implicit `run` subcommand: `agentv eval [<arg>]` → `agentv eval run [<arg>]`
  // when the first arg after `eval` is absent or is not a known eval subcommand.
  // Backward-compat: `eval` used to be a direct command; now it is a subcommands group.
  // Bare `agentv eval` falls through to the run handler so its TTY check can launch
  // the interactive wizard.
  // Only applies when `eval` is the top-level subcommand.
  // Exception: `--help` / `-h` should show the eval group help, not run's help.
  const evalIdx = result.indexOf('eval');
  if (evalIdx !== -1) {
    // Ensure no top-level command appears before `eval` in the argv —
    // if one does, `eval` is a nested subcommand.
    const isTopLevel = !result.slice(0, evalIdx).some((arg) => TOP_LEVEL_COMMANDS.has(arg));
    if (isTopLevel) {
      const nextArg = result[evalIdx + 1];
      const isHelp = nextArg === '--help' || nextArg === '-h';
      const isKnownSubcommand = nextArg !== undefined && EVAL_SUBCOMMANDS.has(nextArg);
      if (!isHelp && !isKnownSubcommand) {
        result.splice(evalIdx + 1, 0, 'run');
      }
    }
  }

  return result;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  // Kick off update check: reads from local cache (fast), spawns a detached
  // child to refresh if stale. The notice is printed on process exit so it
  // appears after command output, even if the command calls process.exit().
  let updateNotice: string | null = null;
  process.on('exit', () => {
    if (updateNotice) process.stderr.write(`\n${updateNotice}\n`);
  });
  getUpdateNotice(packageJson.version).then((n) => {
    updateNotice = n;
  });

  const processedArgv = preprocessArgv(argv);
  if (usesDeprecatedStudioAlias(argv)) {
    process.stderr.write(
      'Warning: `agentv studio` is deprecated and will be removed in a future release. Use `agentv dashboard` instead.\n',
    );
  }

  if (shouldRunBeforeSessionHook(processedArgv)) {
    // Run before_session hook once at startup, before any command executes.
    // Uses cwd as the search root for .agentv/config.yaml.
    const cwd = process.cwd();
    const repoRoot = await findRepoRoot(cwd);
    const sessionConfig = await loadConfig(path.join(cwd, '_'), repoRoot);
    const beforeSessionCommand = sessionConfig?.hooks?.before_session;
    if (beforeSessionCommand) {
      runBeforeSessionHook(beforeSessionCommand);
    }
  }

  await run(binary(app), processedArgv);
}
