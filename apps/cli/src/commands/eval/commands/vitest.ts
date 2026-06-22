import { command, flag, number, option, optional, restPositionals, string } from 'cmd-ts';

import { runCodeGrader, runVitestWorkspaceGrader } from '@agentv/sdk';

function parseCommand(value: string | undefined): readonly string[] | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.split(/\s+/) : undefined;
}

export const evalVitestCommand = command({
  name: 'vitest',
  description: 'Run Vitest workspace verifier files as an AgentV code-grader protocol adapter',
  args: {
    testFiles: restPositionals({
      type: string,
      displayName: 'test-files',
      description: 'Vitest verifier file(s) to run',
    }),
    cwd: option({
      type: optional(string),
      long: 'cwd',
      description: 'Workspace-relative directory where Vitest should run',
    }),
    vitestCommand: option({
      type: optional(string),
      long: 'vitest-command',
      description: 'Vitest command to execute, defaults to "bunx vitest run"',
    }),
    timeoutMs: option({
      type: optional(number),
      long: 'timeout-ms',
      description: 'Timeout for the Vitest command in milliseconds',
    }),
    inWorkspace: flag({
      long: 'in-workspace',
      description:
        'Treat test files as already present in the prepared workspace instead of copying them from the current directory',
    }),
    passWithNoTests: flag({
      long: 'pass-with-no-tests',
      description: 'Return score 1 when Vitest reports zero tests',
    }),
  },
  handler: async ({ testFiles, cwd, vitestCommand, timeoutMs, inWorkspace, passWithNoTests }) => {
    await runCodeGrader((input) => {
      if (testFiles.length === 0) {
        throw new Error('Provide at least one Vitest verifier file.');
      }

      return runVitestWorkspaceGrader(
        {
          testFile: testFiles,
          cwd,
          vitestCommand: parseCommand(vitestCommand),
          timeoutMs,
          passWithNoTests,
          copyTestFilesToWorkspace: !inWorkspace,
          testFileRoot: process.cwd(),
        },
        input,
      );
    });
  },
});
