import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { discoverEvalFiles } from '../../../src/commands/eval/discover.js';

describe('discoverEvalFiles', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-discover-eval-files-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('discovers explicit TypeScript eval config files without arbitrary TypeScript configs', async () => {
    const evalDir = path.join(tempDir, 'evals');
    mkdirSync(evalDir, { recursive: true });

    const tsFile = path.join(evalDir, 'greeting.eval.ts');
    const mtsFile = path.join(evalDir, 'module.eval.mts');
    writeFileSync(tsFile, 'export default { prompts: ["{{ input }}"], tests: [] };\n');
    writeFileSync(mtsFile, 'export default { prompts: ["{{ input }}"], tests: [] };\n');
    writeFileSync(path.join(evalDir, 'helper.ts'), 'export const helper = true;\n');
    writeFileSync(path.join(evalDir, 'agentvconfig.ts'), 'export default { tests: [] };\n');
    writeFileSync(path.join(evalDir, 'promptfooconfig.ts'), 'export default { tests: [] };\n');

    const discovered = await discoverEvalFiles(tempDir);
    const relativePaths = discovered.map((file) => file.relativePath);

    expect(relativePaths).toEqual(['evals/greeting.eval.ts', 'evals/module.eval.mts']);
  });
});
