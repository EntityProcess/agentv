import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { PASS_THRESHOLD } from '@agentv/core';

import { loadStudioConfig } from '../../../src/commands/results/studio-config.js';

describe('loadStudioConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'studio-config-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns defaults when no config.yaml exists', () => {
    const config = loadStudioConfig(tempDir);
    expect(config.pass_threshold).toBe(PASS_THRESHOLD);
  });

  it('reads pass_threshold from config.yaml', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), 'pass_threshold: 0.6\n');
    const config = loadStudioConfig(tempDir);
    expect(config.pass_threshold).toBe(0.6);
  });

  it('clamps pass_threshold to 0 when negative', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), 'pass_threshold: -0.5\n');
    const config = loadStudioConfig(tempDir);
    expect(config.pass_threshold).toBe(0);
  });

  it('clamps pass_threshold to 1 when above 1', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), 'pass_threshold: 1.5\n');
    const config = loadStudioConfig(tempDir);
    expect(config.pass_threshold).toBe(1);
  });

  it('returns defaults for empty config.yaml', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), '');
    const config = loadStudioConfig(tempDir);
    expect(config.pass_threshold).toBe(PASS_THRESHOLD);
  });

  it('returns defaults when pass_threshold is not a number', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), 'pass_threshold: "high"\n');
    const config = loadStudioConfig(tempDir);
    expect(config.pass_threshold).toBe(PASS_THRESHOLD);
  });
});
