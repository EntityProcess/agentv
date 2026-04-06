import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DEFAULT_THRESHOLD } from '@agentv/core';
import { parse as parseYaml } from 'yaml';

import { loadStudioConfig, saveStudioConfig } from '../../../src/commands/results/studio-config.js';

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
    expect(config.pass_threshold).toBe(DEFAULT_THRESHOLD);
  });

  it('reads pass_threshold from studio section', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), 'studio:\n  pass_threshold: 0.6\n');
    const config = loadStudioConfig(tempDir);
    expect(config.pass_threshold).toBe(0.6);
  });

  it('falls back to root-level pass_threshold (legacy)', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), 'pass_threshold: 0.7\n');
    const config = loadStudioConfig(tempDir);
    expect(config.pass_threshold).toBe(0.7);
  });

  it('prefers studio section over root-level pass_threshold', () => {
    writeFileSync(
      path.join(tempDir, 'config.yaml'),
      'pass_threshold: 0.5\nstudio:\n  pass_threshold: 0.9\n',
    );
    const config = loadStudioConfig(tempDir);
    expect(config.pass_threshold).toBe(0.9);
  });

  it('clamps pass_threshold to 0 when negative', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), 'studio:\n  pass_threshold: -0.5\n');
    const config = loadStudioConfig(tempDir);
    expect(config.pass_threshold).toBe(0);
  });

  it('clamps pass_threshold to 1 when above 1', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), 'studio:\n  pass_threshold: 1.5\n');
    const config = loadStudioConfig(tempDir);
    expect(config.pass_threshold).toBe(1);
  });

  it('returns defaults for empty config.yaml', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), '');
    const config = loadStudioConfig(tempDir);
    expect(config.pass_threshold).toBe(DEFAULT_THRESHOLD);
  });

  it('returns defaults when pass_threshold is not a number', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), 'studio:\n  pass_threshold: "high"\n');
    const config = loadStudioConfig(tempDir);
    expect(config.pass_threshold).toBe(DEFAULT_THRESHOLD);
  });
});

describe('saveStudioConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'studio-config-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('preserves existing fields when saving', () => {
    writeFileSync(
      path.join(tempDir, 'config.yaml'),
      'required_version: ">=4.2.0"\neval_patterns:\n  - "**/*.eval.yaml"\n',
    );
    saveStudioConfig(tempDir, { pass_threshold: 0.9 });

    const raw = readFileSync(path.join(tempDir, 'config.yaml'), 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect(parsed.required_version).toBe('>=4.2.0');
    expect(parsed.eval_patterns).toEqual(['**/*.eval.yaml']);
    expect((parsed.studio as Record<string, unknown>).pass_threshold).toBe(0.9);
  });

  it('removes legacy root-level pass_threshold on save', () => {
    writeFileSync(
      path.join(tempDir, 'config.yaml'),
      'required_version: ">=4.2.0"\npass_threshold: 0.8\n',
    );
    saveStudioConfig(tempDir, { pass_threshold: 0.7 });

    const raw = readFileSync(path.join(tempDir, 'config.yaml'), 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect(parsed.required_version).toBe('>=4.2.0');
    expect(parsed.pass_threshold).toBeUndefined();
    expect((parsed.studio as Record<string, unknown>).pass_threshold).toBe(0.7);
  });

  it('creates config.yaml when it does not exist', () => {
    saveStudioConfig(tempDir, { pass_threshold: 0.6 });

    const raw = readFileSync(path.join(tempDir, 'config.yaml'), 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect((parsed.studio as Record<string, unknown>).pass_threshold).toBe(0.6);
  });

  it('creates directory if it does not exist', () => {
    const nestedDir = path.join(tempDir, 'nested', '.agentv');
    saveStudioConfig(nestedDir, { pass_threshold: 0.5 });

    const raw = readFileSync(path.join(nestedDir, 'config.yaml'), 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect((parsed.studio as Record<string, unknown>).pass_threshold).toBe(0.5);
  });
});
