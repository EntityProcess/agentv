import { binary, run, subcommands } from 'cmd-ts';

import packageJson from '../package.json' with { type: 'json' };
import { compareCommand } from './commands/compare/index.js';
import { convertCommand } from './commands/convert/index.js';
import { evalCommand } from './commands/eval/index.js';
import { generateCommand } from './commands/generate/index.js';
import { initCmdTsCommand } from './commands/init/index.js';
import { selfCommand } from './commands/self/index.js';
import { validateCommand } from './commands/validate/index.js';

export const app = subcommands({
  name: 'agentv',
  description: 'AgentV CLI',
  version: packageJson.version,
  cmds: {
    compare: compareCommand,
    convert: convertCommand,
    eval: evalCommand,
    generate: generateCommand,
    init: initCmdTsCommand,
    self: selfCommand,
    validate: validateCommand,
  },
});

/** Known eval subcommands used for backwards-compat detection. */
const EVAL_SUBCOMMANDS = new Set(['run', 'prompt', 'input', 'judge']);

/**
 * Insert 'run' after 'eval' when the next arg isn't a known subcommand.
 * This preserves backwards compatibility: `agentv eval file.yaml` → `agentv eval run file.yaml`.
 */
export function preprocessEvalArgv(argv: string[]): string[] {
  const evalIndex = argv.indexOf('eval');
  if (evalIndex === -1) {
    return argv;
  }

  const nextArg = argv[evalIndex + 1];
  // If there's no arg after eval, or the arg isn't a known subcommand,
  // insert 'run' to route to the default eval run command.
  if (nextArg === undefined || !EVAL_SUBCOMMANDS.has(nextArg)) {
    const result = [...argv];
    result.splice(evalIndex + 1, 0, 'run');
    return result;
  }

  return argv;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const processedArgv = preprocessEvalArgv(argv);
  await run(binary(app), processedArgv);
}
