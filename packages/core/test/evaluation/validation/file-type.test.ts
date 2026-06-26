import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectFileType } from '../../../src/evaluation/validation/file-type.js';

describe('detectFileType', () => {
  it('treats .agentv/config.local.yaml as AgentV config', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-file-type-'));
    try {
      const agentvDir = path.join(tempDir, 'project', '.agentv');
      mkdirSync(agentvDir, { recursive: true });
      const configPath = path.join(agentvDir, 'config.local.yaml');
      writeFileSync(configPath, 'execution:\n  verbose: true\n');

      await expect(detectFileType(configPath)).resolves.toBe('config');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('treats config.local.yaml outside .agentv as AgentV config', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-file-type-home-'));
    try {
      const configPath = path.join(tempDir, 'agentv-home', 'config.local.yaml');
      mkdirSync(path.dirname(configPath), { recursive: true });
      writeFileSync(configPath, 'projects: []\n');

      await expect(detectFileType(configPath)).resolves.toBe('config');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
