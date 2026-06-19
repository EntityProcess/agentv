import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../../..');
const CLI_ENTRY = path.join(projectRoot, 'apps/cli/src/cli.ts');

describe('agentv create assertion', () => {
  it('scaffolds canonical assertion output without deprecated reasoning examples', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'agentv-create-assertion-'));

    try {
      await symlink(
        path.join(projectRoot, 'node_modules'),
        path.join(cwd, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const result = await execa(
        'bun',
        ['--no-env-file', CLI_ENTRY, 'create', 'assertion', 'word-count'],
        { cwd, reject: false },
      );

      expect(result.exitCode).toBe(0);

      const content = await readFile(
        path.join(cwd, '.agentv', 'assertions', 'word-count.ts'),
        'utf8',
      );
      expect(content).toContain("import { defineAssertion } from '@agentv/sdk';");
      expect(content).toContain("const text = output ?? '';");
      expect(content).toContain(
        "assertions: [{ text: pass ? 'Output has content' : 'Output is empty', passed: pass }]",
      );
      expect(content).not.toContain('reasoning:');
      expect(content).not.toContain('getMessageText');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});
