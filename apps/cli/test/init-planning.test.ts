import { describe, expect, test } from 'bun:test';

import { computeInitActions, resolveInitMode } from '../src/commands/init/index.js';

describe('resolveInitMode', () => {
  test('defaults to prompt mode', () => {
    expect(resolveInitMode({ skipExisting: false, replaceExisting: false })).toBe('prompt');
  });

  test('uses skip-existing mode', () => {
    expect(resolveInitMode({ skipExisting: true, replaceExisting: false })).toBe('skip-existing');
  });

  test('uses replace-existing mode', () => {
    expect(resolveInitMode({ skipExisting: false, replaceExisting: true })).toBe(
      'replace-existing',
    );
  });

  test('throws when both flags are enabled', () => {
    expect(() => resolveInitMode({ skipExisting: true, replaceExisting: true })).toThrow(
      'Cannot specify both --skip-existing and --replace-existing',
    );
  });
});

describe('computeInitActions', () => {
  const templates = [
    '.env.example',
    '.agentv/targets.yaml',
    '.agents/skills/agentv-eval-builder/SKILL.md',
  ];

  test('writes all templates when nothing exists', () => {
    const actions = computeInitActions({
      templatePaths: templates,
      existingPaths: new Set<string>(),
      mode: 'prompt',
    });

    expect(actions.needsPrompt).toBe(false);
    expect(actions.toWrite).toEqual(templates);
    expect(actions.toSkip).toEqual([]);
  });

  test('prompts in prompt mode when existing files are detected', () => {
    const actions = computeInitActions({
      templatePaths: templates,
      existingPaths: new Set<string>(['.env.example']),
      mode: 'prompt',
    });

    expect(actions.needsPrompt).toBe(true);
    expect(actions.toWrite).toEqual([]);
    expect(actions.toSkip).toEqual([]);
  });

  test('skip-existing mode writes only missing files', () => {
    const actions = computeInitActions({
      templatePaths: templates,
      existingPaths: new Set<string>(['.env.example', '.agentv/targets.yaml']),
      mode: 'skip-existing',
    });

    expect(actions.needsPrompt).toBe(false);
    expect(actions.toWrite).toEqual(['.agents/skills/agentv-eval-builder/SKILL.md']);
    expect(actions.toSkip).toEqual(['.env.example', '.agentv/targets.yaml']);
  });

  test('replace-existing mode writes all files', () => {
    const actions = computeInitActions({
      templatePaths: templates,
      existingPaths: new Set<string>(['.env.example']),
      mode: 'replace-existing',
    });

    expect(actions.needsPrompt).toBe(false);
    expect(actions.toWrite).toEqual(templates);
    expect(actions.toSkip).toEqual([]);
  });
});
