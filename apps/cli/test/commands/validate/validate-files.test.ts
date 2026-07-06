import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { validateFiles } from '../../../src/commands/validate/validate-files.js';

describe('validateFiles TypeScript eval configs', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-validate-ts-config-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('validates *.eval.ts through the core loader', async () => {
    const configFile = path.join(tempDir, 'suite.eval.ts');
    writeFileSync(
      configFile,
      `export default {
  prompts: ['{{ input }}'],
  tests: [
    {
      id: 'hello',
      vars: { input: 'Say hello' },
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
};
`,
    );

    const summary = await validateFiles([configFile]);

    expect(summary.totalFiles).toBe(1);
    expect(summary.validFiles).toBe(1);
    expect(summary.results[0].filePath).toBe(path.normalize(configFile));
  });

  it('reports missing default export errors for TypeScript configs', async () => {
    const configFile = path.join(tempDir, 'suite.eval.ts');
    writeFileSync(configFile, 'export const config = { tests: [] };\n');

    const summary = await validateFiles([configFile]);

    expect(summary.invalidFiles).toBe(1);
    expect(summary.results[0].errors[0].message).toContain('default export');
  });

  it('reports invalid TypeScript eval contract errors', async () => {
    const configFile = path.join(tempDir, 'suite.eval.mts');
    writeFileSync(
      configFile,
      `export default {
  prompts: ['{{ input }}'],
  providers: ['openai:gpt-5'],
  tests: [{ id: 'hello', vars: { input: 'Say hello' } }],
};
`,
    );

    const summary = await validateFiles([configFile]);

    expect(summary.invalidFiles).toBe(1);
    expect(summary.results[0].errors[0].message).toContain("top-level 'providers'");
  });

  it('expands directories without treating custom assertion files as eval configs', async () => {
    const assertionsDir = path.join(tempDir, '.agentv', 'assertions');
    mkdirSync(assertionsDir, { recursive: true });
    writeFileSync(path.join(assertionsDir, 'custom-check.ts'), 'export default () => true;\n');
    const configFile = path.join(tempDir, 'suite.eval.ts');
    writeFileSync(
      configFile,
      `export default {
  prompts: ['{{ input }}'],
  tests: [
    {
      id: 'hello',
      vars: { input: 'Say hello' },
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
};
`,
    );

    const summary = await validateFiles([tempDir]);

    expect(summary.totalFiles).toBe(1);
    expect(summary.results[0].filePath).toBe(path.normalize(configFile));
  });

  it('does not validate promptfooconfig.ts as an eval config', async () => {
    const configFile = path.join(tempDir, 'promptfooconfig.ts');
    writeFileSync(configFile, 'export default { prompts: ["{{ input }}"], tests: [] };\n');

    const summary = await validateFiles([tempDir]);

    expect(summary.totalFiles).toBe(0);
  });

  it('does not validate agentvconfig.ts as an eval config', async () => {
    const configFile = path.join(tempDir, 'agentvconfig.ts');
    writeFileSync(configFile, 'export default { prompts: ["{{ input }}"], tests: [] };\n');

    const summary = await validateFiles([tempDir]);

    expect(summary.totalFiles).toBe(0);
  });
});
