import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  getBuiltinOtelBackendResolverNames,
  resolveOtelBackend,
} from '../../../src/commands/eval/otel-backends.js';

describe('OTel backend resolvers', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'agentv-otel-backends-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('keeps the existing CLI backend names available outside core', () => {
    expect(getBuiltinOtelBackendResolverNames()).toEqual(['langfuse', 'braintrust', 'confident']);
  });

  it('resolves Langfuse endpoint and Basic auth headers', async () => {
    const resolved = await resolveOtelBackend('langfuse', {
      cwd: tempDir,
      env: {
        LANGFUSE_HOST: 'https://langfuse.example.com/',
        LANGFUSE_PUBLIC_KEY: 'pk-test',
        LANGFUSE_SECRET_KEY: 'sk-test',
      },
    });

    expect(resolved).toEqual({
      endpoint: 'https://langfuse.example.com/api/public/otel/v1/traces',
      headers: {
        Authorization: `Basic ${Buffer.from('pk-test:sk-test').toString('base64')}`,
      },
    });
  });

  it('resolves Braintrust auth and project routing headers', async () => {
    const resolved = await resolveOtelBackend('braintrust', {
      cwd: tempDir,
      env: {
        BRAINTRUST_API_KEY: 'bt-key',
        BRAINTRUST_PROJECT: 'agentv-evals',
      },
    });

    expect(resolved).toEqual({
      endpoint: 'https://api.braintrust.dev/otel/v1/traces',
      headers: {
        Authorization: 'Bearer bt-key',
        'x-bt-parent': 'project_name:agentv-evals',
      },
    });
  });

  it('resolves Confident auth headers', async () => {
    const resolved = await resolveOtelBackend('confident', {
      cwd: tempDir,
      env: { CONFIDENT_API_KEY: 'conf-key' },
    });

    expect(resolved).toEqual({
      endpoint: 'https://otel.confident-ai.com/v1/traces',
      headers: {
        'x-confident-api-key': 'conf-key',
      },
    });
  });

  it('discovers a project-local resolver by backend name', async () => {
    const nestedDir = path.join(tempDir, 'evals', 'suite');
    const resolverDir = path.join(tempDir, '.agentv', 'otel-backends');
    await mkdir(nestedDir, { recursive: true });
    await mkdir(resolverDir, { recursive: true });
    await writeFile(
      path.join(resolverDir, 'local.mjs'),
      `
        export default {
          resolve: ({ env, cwd }) => ({
            endpoint: env.LOCAL_OTEL_ENDPOINT ?? cwd,
            headers: { "x-local": "true" },
            resourceAttributes: { "agentv.test": "local" },
          }),
        };
      `,
      'utf8',
    );

    const resolved = await resolveOtelBackend('local', {
      cwd: nestedDir,
      env: { LOCAL_OTEL_ENDPOINT: 'https://otel.example.com/v1/traces' },
    });

    expect(resolved).toEqual({
      endpoint: 'https://otel.example.com/v1/traces',
      headers: { 'x-local': 'true' },
      resourceAttributes: { 'agentv.test': 'local' },
    });
  });

  it('uses a local ESM resolver before a built-in resolver with the same name', async () => {
    const resolverDir = path.join(tempDir, '.agentv', 'otel-backends');
    await mkdir(resolverDir, { recursive: true });
    await writeFile(
      path.join(resolverDir, 'langfuse.mjs'),
      `
        export const resolver = {
          name: "langfuse",
          resolve: () => ({ endpoint: "https://local.example.com/v1/traces" }),
        };
      `,
      'utf8',
    );

    const resolved = await resolveOtelBackend('langfuse', {
      cwd: tempDir,
      env: {},
    });

    expect(resolved).toEqual({ endpoint: 'https://local.example.com/v1/traces' });
  });

  it('loads CommonJS .js resolver files', async () => {
    const resolverDir = path.join(tempDir, '.agentv', 'otel-backends');
    await mkdir(resolverDir, { recursive: true });
    await writeFile(
      path.join(resolverDir, 'commonjs.js'),
      `
        module.exports = {
          name: "commonjs",
          resolve: () => ({ endpoint: "https://commonjs.example.com/v1/traces" }),
        };
      `,
      'utf8',
    );

    const resolved = await resolveOtelBackend('commonjs', {
      cwd: tempDir,
      env: {},
    });

    expect(resolved).toEqual({ endpoint: 'https://commonjs.example.com/v1/traces' });
  });

  it('returns undefined for unknown backend names', async () => {
    const resolved = await resolveOtelBackend('unknown', { cwd: tempDir, env: {} });

    expect(resolved).toBeUndefined();
  });

  it('ignores TypeScript resolver files because packaged Node cannot import them', async () => {
    const resolverDir = path.join(tempDir, '.agentv', 'otel-backends');
    await mkdir(resolverDir, { recursive: true });
    await writeFile(
      path.join(resolverDir, 'typescript-only.ts'),
      `
        export default {
          resolve: () => ({ endpoint: "https://typescript.example.com/v1/traces" }),
        };
      `,
      'utf8',
    );

    const resolved = await resolveOtelBackend('typescript-only', {
      cwd: tempDir,
      env: {},
    });

    expect(resolved).toBeUndefined();
  });
});
