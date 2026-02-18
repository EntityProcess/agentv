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
const EVAL_SUBCOMMANDS = new Set(['run', 'prompt']);

/** Known prompt subcommands used for default insertion. */
const PROMPT_SUBCOMMANDS = new Set(['overview', 'input', 'judge']);

/**
 * Preprocess argv for backwards compatibility:
 * 1. `agentv eval file.yaml` → `agentv eval run file.yaml`
 * 2. `agentv eval prompt file.yaml` → `agentv eval prompt overview file.yaml`
 */
export function preprocessEvalArgv(argv: string[]): string[] {
  const evalIndex = argv.indexOf('eval');
  if (evalIndex === -1) {
    return argv;
  }

  const result = [...argv];
  const nextArg = result[evalIndex + 1];

  // If there's no arg after eval, or the arg isn't a known subcommand,
  // insert 'run' to route to the default eval run command.
  if (nextArg === undefined || !EVAL_SUBCOMMANDS.has(nextArg)) {
    result.splice(evalIndex + 1, 0, 'run');
    return result;
  }

  // If `eval prompt` is followed by something that isn't a known prompt subcommand,
  // insert 'overview' to default to the orchestration overview.
  if (nextArg === 'prompt') {
    const promptNextArg = result[evalIndex + 2];
    if (promptNextArg === undefined || !PROMPT_SUBCOMMANDS.has(promptNextArg)) {
      result.splice(evalIndex + 2, 0, 'overview');
    }
  }

  return result;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const processedArgv = preprocessEvalArgv(argv);
  await run(binary(app), processedArgv);
}
