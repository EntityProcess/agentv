import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DEFAULT_THRESHOLD } from '@agentv/core';
import { parse as parseYaml } from 'yaml';

import { loadStudioConfig, saveStudioConfig } from '../../../src/commands/results/studio-config.js';

describe('loadStudioConfig', () => {
  let tempDir: string;
  let previousAgentvHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'studio-config-'));
    previousAgentvHome = process.env.AGENTV_HOME;
    process.env.AGENTV_HOME = path.join(tempDir, 'home');
  });

  afterEach(() => {
    if (previousAgentvHome === undefined) {
      process.env.AGENTV_HOME = undefined;
    } else {
      process.env.AGENTV_HOME = previousAgentvHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns defaults when no config.yaml exists', () => {
    const config = loadStudioConfig(tempDir);
    expect(config.threshold).toBe(DEFAULT_THRESHOLD);
    expect(config.appName).toBe('agentv');
  });

  it.each([
    ['dashboard.threshold', 'dashboard:\n  threshold: 0.6\n'],
    ['dashboard.pass_threshold fallback', 'dashboard:\n  pass_threshold: 0.6\n'],
    ['legacy studio.threshold fallback', 'studio:\n  threshold: 0.6\n'],
    ['legacy studio.pass_threshold fallback', 'studio:\n  pass_threshold: 0.6\n'],
    ['legacy root pass_threshold fallback', 'pass_threshold: 0.6\n'],
  ])('reads %s', (_name, yaml) => {
    writeFileSync(path.join(tempDir, 'config.yaml'), yaml);
    expect(loadStudioConfig(tempDir).threshold).toBe(0.6);
  });

  it('prefers dashboard.threshold over dashboard.pass_threshold', () => {
    writeFileSync(
      path.join(tempDir, 'config.yaml'),
      'dashboard:\n  threshold: 0.9\n  pass_threshold: 0.5\n',
    );
    const config = loadStudioConfig(tempDir);
    expect(config.threshold).toBe(0.9);
  });

  it('prefers dashboard section over legacy studio section', () => {
    writeFileSync(
      path.join(tempDir, 'config.yaml'),
      'dashboard:\n  threshold: 0.9\nstudio:\n  threshold: 0.5\n',
    );
    const config = loadStudioConfig(tempDir);
    expect(config.threshold).toBe(0.9);
  });

  it('reads dashboard.app_name for white labelling', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), 'dashboard:\n  app_name: ai evals\n');
    expect(loadStudioConfig(tempDir).appName).toBe('ai evals');
  });

  it('ignores blank dashboard.app_name', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), 'dashboard:\n  app_name: "  "\n');
    expect(loadStudioConfig(tempDir).appName).toBe('agentv');
  });

  it('falls back to global config.yaml for dashboard settings', () => {
    const homeDir = process.env.AGENTV_HOME;
    if (!homeDir) throw new Error('AGENTV_HOME test setup failed');
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(
      path.join(homeDir, 'config.yaml'),
      'dashboard:\n  app_name: ai evals\n  threshold: 0.6\n',
    );

    const config = loadStudioConfig(tempDir);
    expect(config.appName).toBe('ai evals');
    expect(config.threshold).toBe(0.6);
  });

  it('prefers local config.yaml over global config.yaml', () => {
    const homeDir = process.env.AGENTV_HOME;
    if (!homeDir) throw new Error('AGENTV_HOME test setup failed');
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(
      path.join(homeDir, 'config.yaml'),
      'dashboard:\n  app_name: ai evals\n  threshold: 0.6\n',
    );
    writeFileSync(
      path.join(tempDir, 'config.yaml'),
      'dashboard:\n  app_name: local evals\n  threshold: 0.9\n',
    );

    const config = loadStudioConfig(tempDir);
    expect(config.appName).toBe('local evals');
    expect(config.threshold).toBe(0.9);
  });

  it('overlays config.local.yaml on config.yaml for dashboard settings', () => {
    writeFileSync(
      path.join(tempDir, 'config.yaml'),
      'dashboard:\n  app_name: base evals\n  threshold: 0.6\n',
    );
    writeFileSync(path.join(tempDir, 'config.local.yaml'), 'dashboard:\n  threshold: 0.9\n');

    const config = loadStudioConfig(tempDir);

    expect(config.appName).toBe('base evals');
    expect(config.threshold).toBe(0.9);
  });

  it('falls back to legacy studio section when dashboard has no threshold', () => {
    writeFileSync(
      path.join(tempDir, 'config.yaml'),
      'dashboard:\n  theme: dark\nstudio:\n  threshold: 0.5\n',
    );
    const config = loadStudioConfig(tempDir);
    expect(config.threshold).toBe(0.5);
  });

  it('prefers dashboard section over root-level pass_threshold', () => {
    writeFileSync(
      path.join(tempDir, 'config.yaml'),
      'pass_threshold: 0.5\ndashboard:\n  threshold: 0.9\n',
    );
    const config = loadStudioConfig(tempDir);
    expect(config.threshold).toBe(0.9);
  });

  it.each([
    ['negative', -0.5, 0],
    ['above 1', 1.5, 1],
  ])('clamps %s threshold', (_name, value, expected) => {
    writeFileSync(path.join(tempDir, 'config.yaml'), `dashboard:\n  threshold: ${value}\n`);
    expect(loadStudioConfig(tempDir).threshold).toBe(expected);
  });

  it('returns defaults for empty config.yaml', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), '');
    const config = loadStudioConfig(tempDir);
    expect(config.threshold).toBe(DEFAULT_THRESHOLD);
  });

  it('returns defaults when threshold is not a number', () => {
    writeFileSync(path.join(tempDir, 'config.yaml'), 'dashboard:\n  threshold: "high"\n');
    const config = loadStudioConfig(tempDir);
    expect(config.threshold).toBe(DEFAULT_THRESHOLD);
  });
});

describe('saveStudioConfig', () => {
  let tempDir: string;
  let previousAgentvHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'studio-config-'));
    previousAgentvHome = process.env.AGENTV_HOME;
    process.env.AGENTV_HOME = path.join(tempDir, 'home');
  });

  afterEach(() => {
    if (previousAgentvHome === undefined) {
      process.env.AGENTV_HOME = undefined;
    } else {
      process.env.AGENTV_HOME = previousAgentvHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('preserves existing fields when saving', () => {
    writeFileSync(
      path.join(tempDir, 'config.yaml'),
      'required_version: ">=4.2.0"\neval_patterns:\n  - "**/*.eval.yaml"\n',
    );
    saveStudioConfig(tempDir, { threshold: 0.9, appName: 'ai evals' });

    const raw = readFileSync(path.join(tempDir, 'config.yaml'), 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect(parsed.required_version).toBe('>=4.2.0');
    expect(parsed.eval_patterns).toEqual(['**/*.eval.yaml']);
    expect((parsed.dashboard as Record<string, unknown>).threshold).toBe(0.9);
    expect((parsed.dashboard as Record<string, unknown>).app_name).toBe('ai evals');
    expect((parsed.dashboard as Record<string, unknown>).appName).toBeUndefined();
  });

  it('writes canonical dashboard.threshold and removes legacy threshold fields on save', () => {
    writeFileSync(
      path.join(tempDir, 'config.yaml'),
      'required_version: ">=4.2.0"\npass_threshold: 0.8\ndashboard:\n  pass_threshold: 0.6\nstudio:\n  theme: dark\n  pass_threshold: 0.5\n',
    );
    saveStudioConfig(tempDir, { threshold: 0.7, appName: 'agentv' });

    const raw = readFileSync(path.join(tempDir, 'config.yaml'), 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect(parsed.required_version).toBe('>=4.2.0');
    expect(parsed.pass_threshold).toBeUndefined();
    expect(parsed.studio).toBeUndefined();
    const dashboard = parsed.dashboard as Record<string, unknown>;
    expect(dashboard.theme).toBe('dark');
    expect(dashboard.pass_threshold).toBeUndefined();
    expect(dashboard.threshold).toBe(0.7);
    expect(dashboard.app_name).toBe('agentv');
    expect(dashboard.appName).toBeUndefined();
  });

  it('creates config.yaml when it does not exist', () => {
    saveStudioConfig(tempDir, { threshold: 0.6, appName: 'agentv' });

    const raw = readFileSync(path.join(tempDir, 'config.yaml'), 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect((parsed.dashboard as Record<string, unknown>).threshold).toBe(0.6);
  });

  it('creates directory if it does not exist', () => {
    const nestedDir = path.join(tempDir, 'nested', '.agentv');
    saveStudioConfig(nestedDir, { threshold: 0.5, appName: 'agentv' });

    const raw = readFileSync(path.join(nestedDir, 'config.yaml'), 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect((parsed.dashboard as Record<string, unknown>).threshold).toBe(0.5);
  });
});
