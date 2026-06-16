import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { assertCoreBuild } from '../../setup-core-build.js';

assertCoreBuild();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../../..');
const CLI_ENTRY = path.join(projectRoot, 'apps/cli/src/cli.ts');

describe('workspace deps', () => {
  it('exits non-zero when an eval uses removed repo schema fields', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'agentv-workspace-deps-test-'));
    try {
      const evalPath = path.join(tempDir, 'legacy-source.eval.yaml');
      await mkdir(path.dirname(evalPath), { recursive: true });
      await writeFile(
        evalPath,
        `
workspace:
  repos:
    - path: ./repo
      source:
        type: git
        url: https://github.com/org/repo.git
tests:
  - id: test-1
    input: hello
    criteria: world
`,
        'utf8',
      );

      const result = await execa(
        'bun',
        ['--no-env-file', CLI_ENTRY, 'workspace', 'deps', evalPath],
        {
          cwd: projectRoot,
          reject: false,
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('workspace.repos[].source has been removed');
      expect(result.stdout).toBe('');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
