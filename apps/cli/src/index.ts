import { binary, run, subcommands } from 'cmd-ts';

import packageJson from '../package.json' with { type: 'json' };
import { compareCommand } from './commands/compare/index.js';
import { convertCommand } from './commands/convert/index.js';
import { createCommand } from './commands/create/index.js';
import { evalPromptCommand } from './commands/eval/commands/prompt/index.js';
import { evalCommand } from './commands/eval/index.js';
import { generateCommand } from './commands/generate/index.js';
import { initCmdTsCommand } from './commands/init/index.js';
import { resultsCommand } from './commands/results/index.js';
import { resultsServeCommand } from './commands/results/serve.js';
import { selfCommand } from './commands/self/index.js';
import { traceCommand } from './commands/trace/index.js';
import { transpileCommand } from './commands/transpile/index.js';
import { trimCommand } from './commands/trim/index.js';
import { validateCommand } from './commands/validate/index.js';
import { workspaceCommand } from './commands/workspace/index.js';
import { getUpdateNotice } from './update-check.js';

export const app = subcommands({
  name: 'agentv',
  description: 'AgentV CLI',
  version: packageJson.version,
  cmds: {
    eval: evalCommand,
    prompt: evalPromptCommand,
    compare: compareCommand,
    convert: convertCommand,
    create: createCommand,
    generate: generateCommand,
    init: initCmdTsCommand,
    results: resultsCommand,
    self: selfCommand,
    serve: resultsServeCommand,
    trace: traceCommand,
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
const EVAL_SUBCOMMANDS = new Set(['run', 'prompt', 'assert']);

/**
 * Top-level CLI command names (excluding `eval` itself).
 * Used to distinguish `agentv eval …` from `agentv prompt eval …`.
 */
const TOP_LEVEL_COMMANDS = new Set([
  'prompt',
  'compare',
  'convert',
  'create',
  'generate',
  'init',
  'results',
  'self',
  'serve',
  'trace',
  'transpile',
  'trim',
  'validate',
  'workspace',
]);

/**
 * Preprocess argv for convenience aliases:
 * - `--eval-id` → `--test-id`
 * - `agentv eval <non-subcommand>` → `agentv eval run <non-subcommand>`
 *   (backward compat: `eval` used to be a direct command, now it's a group)
 */
export function preprocessArgv(argv: string[]): string[] {
  const result = [...argv];

  // Rewrite --eval-id → --test-id (convenience alias)
  for (let i = 0; i < result.length; i++) {
    if (result[i] === '--eval-id') {
      result[i] = '--test-id';
    } else if (result[i].startsWith('--eval-id=')) {
      result[i] = `--test-id=${result[i].slice('--eval-id='.length)}`;
    }
  }

  // Implicit `run` subcommand: `agentv eval <arg>` → `agentv eval run <arg>`
  // when the first arg after `eval` is not a known eval subcommand.
  // This preserves backward compatibility now that `eval` is a subcommands group.
  // Only applies when `eval` is the top-level subcommand, NOT when it appears
  // inside another command (e.g. `agentv prompt eval …`).
  // Exception: `--help` / `-h` should show the eval group help, not run's help.
  const evalIdx = result.indexOf('eval');
  if (evalIdx !== -1) {
    // Ensure no top-level command appears before `eval` in the argv —
    // if one does, `eval` is a nested subcommand (e.g. `prompt eval`).
    const isTopLevel = !result.slice(0, evalIdx).some((arg) => TOP_LEVEL_COMMANDS.has(arg));
    if (isTopLevel) {
      const nextArg = result[evalIdx + 1];
      if (
        nextArg !== undefined &&
        !EVAL_SUBCOMMANDS.has(nextArg) &&
        nextArg !== '--help' &&
        nextArg !== '-h'
      ) {
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
  await run(binary(app), processedArgv);
}
