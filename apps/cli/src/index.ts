import { binary, run, subcommands } from 'cmd-ts';

import packageJson from '../package.json' with { type: 'json' };
import { compareCommand } from './commands/compare/index.js';
import { convertCommand } from './commands/convert/index.js';
import { evalPromptCommand } from './commands/eval/commands/prompt/index.js';
import { evalRunCommand } from './commands/eval/commands/run.js';
import { generateCommand } from './commands/generate/index.js';
import { initCmdTsCommand } from './commands/init/index.js';
import { selfCommand } from './commands/self/index.js';
import { trimCommand } from './commands/trim/index.js';
import { validateCommand } from './commands/validate/index.js';

export const app = subcommands({
  name: 'agentv',
  description: 'AgentV CLI',
  version: packageJson.version,
  cmds: {
    run: evalRunCommand,
    prompt: evalPromptCommand,
    compare: compareCommand,
    convert: convertCommand,
    generate: generateCommand,
    init: initCmdTsCommand,
    self: selfCommand,
    trim: trimCommand,
    validate: validateCommand,
  },
});

/** Known prompt subcommands used for default insertion. */
const PROMPT_SUBCOMMANDS = new Set(['overview', 'input', 'judge']);

/**
 * Preprocess argv for backwards compatibility and default subcommand insertion:
 * 1. `agentv eval ...` → `agentv run ...` (deprecated alias)
 * 2. `agentv eval prompt ...` → `agentv prompt ...` (deprecated alias)
 * 3. `agentv file.yaml` → `agentv run file.yaml` (bare file shorthand)
 * 4. `agentv prompt file.yaml` → `agentv prompt overview file.yaml` (default subcommand)
 */
export function preprocessArgv(argv: string[]): string[] {
  const result = [...argv];

  const evalIndex = result.indexOf('eval');
  if (evalIndex !== -1) {
    const nextArg = result[evalIndex + 1];

    if (nextArg === 'prompt') {
      // `agentv eval prompt ...` → `agentv prompt ...`
      result.splice(evalIndex, 2, 'prompt');
      printEvalDeprecation('prompt');
    } else if (nextArg === 'run') {
      // `agentv eval run ...` → `agentv run ...`
      result.splice(evalIndex, 2, 'run');
      printEvalDeprecation('run');
    } else {
      // `agentv eval file.yaml ...` → `agentv run file.yaml ...`
      result.splice(evalIndex, 1, 'run');
      printEvalDeprecation('run');
    }
  }

  // Insert default prompt subcommand: `agentv prompt file.yaml` → `agentv prompt overview file.yaml`
  const promptIndex = result.indexOf('prompt');
  if (promptIndex !== -1) {
    const promptNextArg = result[promptIndex + 1];
    if (promptNextArg === undefined || !PROMPT_SUBCOMMANDS.has(promptNextArg)) {
      result.splice(promptIndex + 1, 0, 'overview');
    }
  }

  return result;
}

/** @deprecated Use {@link preprocessArgv} instead. */
export const preprocessEvalArgv = preprocessArgv;

function printEvalDeprecation(replacement: string): void {
  console.error(
    `⚠  \`agentv eval\` is deprecated. Use \`agentv ${replacement}\` instead.\n   This alias will be removed in v4.0.\n`,
  );
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const processedArgv = preprocessArgv(argv);
  await run(binary(app), processedArgv);
}
