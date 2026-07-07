import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  loadEnvPathFiles,
  parseJsonEnv,
  parseShellExportsEnv,
  runEnvFromEntries,
} from '../../src/evaluation/env-injection.js';
import { resolveProviderDefinition } from '../../src/evaluation/providers/targets.js';

describe('parseShellExportsEnv', () => {
  it('parses export and bare KEY=value lines, stripping quotes', () => {
    const input = ['export FOO="bar"', "BAZ='qux'", 'QUUX=plain'].join('\n');
    expect(parseShellExportsEnv(input)).toEqual({ FOO: 'bar', BAZ: 'qux', QUUX: 'plain' });
  });

  it('ignores blank lines and comments', () => {
    expect(parseShellExportsEnv('\n# comment\nFOO=bar\n\n')).toEqual({ FOO: 'bar' });
  });

  it('ignores lines with invalid env var names', () => {
    expect(parseShellExportsEnv('123FOO=bar\nVALID=ok')).toEqual({ VALID: 'ok' });
  });
});

describe('parseJsonEnv', () => {
  it('parses a flat JSON object of string values', () => {
    expect(parseJsonEnv('{"FOO":"bar","BAZ":"qux"}')).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('rejects invalid JSON', () => {
    expect(() => parseJsonEnv('not json')).toThrow(/invalid JSON/);
  });

  it('rejects non-object JSON shapes', () => {
    expect(() => parseJsonEnv('["FOO"]')).toThrow(/flat JSON object/);
  });

  it('rejects non-string values', () => {
    expect(() => parseJsonEnv('{"FOO":1}')).toThrow(/must be a string/);
  });

  it('rejects invalid environment variable names', () => {
    expect(() => parseJsonEnv('{"123FOO":"bar"}')).toThrow(/invalid environment variable name/);
  });

  it('never leaks a fragment of malformed content in the JSON parse error', () => {
    try {
      parseJsonEnv('{"API_KEY": sk_live_SUPER_SECRET_TOKEN_123}');
      throw new Error('expected parseJsonEnv to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('SUPER_SECRET_TOKEN');
      expect((error as Error).message).toBe('invalid JSON');
    }
  });
});

describe('loadEnvPathFiles', () => {
  let tempDir: string;
  const testKeys = ['AGENTV_TEST_ENV_PATH_NEW', 'AGENTV_TEST_ENV_PATH_EXISTING'];

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentv-env-path-'));
    for (const key of testKeys) delete process.env[key];
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    for (const key of testKeys) delete process.env[key];
  });

  it('injects missing env vars from a dotenv file relative to baseDir', async () => {
    await writeFile(path.join(tempDir, '.env'), 'AGENTV_TEST_ENV_PATH_NEW=from-file\n');

    const result = await loadEnvPathFiles(['.env'], tempDir);

    expect(process.env.AGENTV_TEST_ENV_PATH_NEW).toBe('from-file');
    expect(result.injectedCount).toBe(1);
    expect(result.missing).toEqual([]);
  });

  it('does not override an existing process.env value', async () => {
    process.env.AGENTV_TEST_ENV_PATH_EXISTING = 'from-process';
    await writeFile(path.join(tempDir, '.env'), 'AGENTV_TEST_ENV_PATH_EXISTING=from-file\n');

    const result = await loadEnvPathFiles(['.env'], tempDir);

    expect(process.env.AGENTV_TEST_ENV_PATH_EXISTING).toBe('from-process');
    expect(result.injectedCount).toBe(0);
  });

  it('warns and continues when a file is missing instead of failing', async () => {
    const result = await loadEnvPathFiles(['.env.missing'], tempDir);

    expect(result.missing).toHaveLength(1);
    expect(result.loaded).toEqual([]);
  });
});

describe('runEnvFromEntries', () => {
  const testKeys = [
    'AGENTV_TEST_ENV_FROM_SHELL',
    'AGENTV_TEST_ENV_FROM_JSON',
    'AGENTV_TEST_ENV_FROM_EXISTING',
  ];

  beforeEach(() => {
    for (const key of testKeys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of testKeys) delete process.env[key];
  });

  it('injects env vars parsed from shell_exports command output', async () => {
    const result = await runEnvFromEntries(
      [
        {
          command: ['bun', '-e', "process.stdout.write('export AGENTV_TEST_ENV_FROM_SHELL=hi\\n')"],
          format: 'shell_exports',
        },
      ],
      { cwd: process.cwd() },
    );

    expect(process.env.AGENTV_TEST_ENV_FROM_SHELL).toBe('hi');
    expect(result.injectedCount).toBe(1);
  });

  it('injects env vars parsed from json command output', async () => {
    await runEnvFromEntries(
      [
        {
          command: [
            'bun',
            '-e',
            "process.stdout.write(JSON.stringify({AGENTV_TEST_ENV_FROM_JSON: 'value'}))",
          ],
          format: 'json',
        },
      ],
      { cwd: process.cwd() },
    );

    expect(process.env.AGENTV_TEST_ENV_FROM_JSON).toBe('value');
  });

  it('does not override an existing process.env value', async () => {
    process.env.AGENTV_TEST_ENV_FROM_EXISTING = 'from-process';

    const result = await runEnvFromEntries(
      [
        {
          command: [
            'bun',
            '-e',
            "process.stdout.write('AGENTV_TEST_ENV_FROM_EXISTING=from-command\\n')",
          ],
        },
      ],
      { cwd: process.cwd() },
    );

    expect(process.env.AGENTV_TEST_ENV_FROM_EXISTING).toBe('from-process');
    expect(result.injectedCount).toBe(0);
  });

  it('throws a useful error when the command exits non-zero', async () => {
    await expect(
      runEnvFromEntries([{ command: ['bun', '-e', 'process.exit(1)'] }], { cwd: process.cwd() }),
    ).rejects.toThrow(/exited with code 1/);
  });

  it('throws when json output is invalid', async () => {
    await expect(
      runEnvFromEntries(
        [{ command: ['bun', '-e', "process.stdout.write('not json')"], format: 'json' }],
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(/invalid json output/);
  });

  it('never leaks malformed JSON command output in the thrown error', async () => {
    // The secret must live only in the script's runtime stdout, not in the
    // command's own argv, so this isolates the "stdout leaking into an error
    // message" vector from the (expected, non-secret) command-argv logging.
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentv-env-from-leak-'));
    try {
      const scriptPath = path.join(tempDir, 'print-bad-json.ts');
      await writeFile(
        scriptPath,
        'process.stdout.write(String.raw`{"API_KEY": sk_live_SUPER_SECRET_TOKEN_123}`)',
      );

      try {
        await runEnvFromEntries([{ command: ['bun', scriptPath], format: 'json' }], {
          cwd: process.cwd(),
        });
        throw new Error('expected runEnvFromEntries to throw');
      } catch (error) {
        expect((error as Error).message).not.toContain('SUPER_SECRET_TOKEN');
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('env injection feeds {{ env.* }} target interpolation', () => {
  beforeEach(() => {
    process.env.AGENTV_TEST_MODEL = 'gpt-5-mini';
  });

  afterEach(() => {
    process.env.AGENTV_TEST_SECRET_FROM_ENV_PATH = undefined;
    process.env.AGENTV_TEST_SECRET_FROM_ENV_FROM = undefined;
    process.env.AGENTV_TEST_MODEL = undefined;
  });

  it('resolves a target field from a value injected via env_path', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentv-env-path-target-'));
    try {
      await writeFile(
        path.join(tempDir, '.env'),
        'AGENTV_TEST_SECRET_FROM_ENV_PATH=from-env-path\n',
      );

      await loadEnvPathFiles(['.env'], tempDir);

      const target = resolveProviderDefinition(
        {
          id: 'oracle',
          provider: 'openai',
          config: {
            api_key: '{{ env.AGENTV_TEST_SECRET_FROM_ENV_PATH }}',
            model: '{{ env.AGENTV_TEST_MODEL }}',
          },
        } as never,
        process.env,
      );

      if (target.kind !== 'openai') {
        throw new Error('expected openai target');
      }
      expect(target.config.apiKey).toBe('from-env-path');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves a target field from a value injected via env_from', async () => {
    await runEnvFromEntries(
      [
        {
          command: [
            'bun',
            '-e',
            "process.stdout.write('export AGENTV_TEST_SECRET_FROM_ENV_FROM=from-env-from\\n')",
          ],
        },
      ],
      { cwd: process.cwd() },
    );

    const target = resolveProviderDefinition(
      {
        id: 'oracle',
        provider: 'openai',
        config: {
          api_key: '{{ env.AGENTV_TEST_SECRET_FROM_ENV_FROM }}',
          model: '{{ env.AGENTV_TEST_MODEL }}',
        },
      } as never,
      process.env,
    );

    if (target.kind !== 'openai') {
      throw new Error('expected openai target');
    }
    expect(target.config.apiKey).toBe('from-env-from');
  });
});
