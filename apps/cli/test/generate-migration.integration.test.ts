import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { assertCoreBuild } from './setup-core-build.js';

assertCoreBuild();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');
const CLI_ENTRY = path.join(projectRoot, 'apps/cli/src/cli.ts');

describe('generate command migration', () => {
  it('does not list generate in top-level help', async () => {
    const result = await execa('bun', [CLI_ENTRY, '--help'], {
      cwd: projectRoot,
      reject: false,
      env: {
        ...process.env,
        CI: 'true',
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('generate');
  });

  it('prints a migration message for retired generate invocations', async () => {
    const result = await execa('bun', [CLI_ENTRY, 'generate', 'rubrics', 'evals/example.yaml'], {
      cwd: projectRoot,
      reject: false,
      env: {
        ...process.env,
        CI: 'true',
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('`agentv generate` has been retired.');
    expect(result.stderr).toContain('Use the `agentv-eval-writer` skill for eval authoring help.');
    expect(result.stderr).toContain('Choose assertions that fit the criteria');
  });
});
