import { describe, expect, it } from 'bun:test';

import { buildEvalRunRawOptions } from '../../../src/commands/eval/commands/run.js';

describe('eval run provider CLI options', () => {
  it('lowers public provider flags into existing internal run options', () => {
    const rawOptions = buildEvalRunRawOptions({
      provider: ['codex-host', 'claude-docker'],
      providers: '.agentv/providers.yaml',
      graderProvider: 'grader-gpt5-mini',
      testId: ['case-*'],
    });

    expect(rawOptions.target).toEqual(['codex-host', 'claude-docker']);
    expect(rawOptions.targets).toBe('.agentv/providers.yaml');
    expect(rawOptions.graderTarget).toBe('grader-gpt5-mini');
    expect(rawOptions.filter).toEqual(['case-*']);
  });

  it('hard-errors removed target-named flags with migration guidance', () => {
    expect(() => buildEvalRunRawOptions({ target: ['codex-host'] })).toThrow(
      /--target was removed.*--provider codex-host/,
    );
    expect(() => buildEvalRunRawOptions({ targets: '.agentv/targets.yaml' })).toThrow(
      /--targets was removed.*--providers \.agentv\/targets\.yaml/,
    );
    expect(() => buildEvalRunRawOptions({ graderTarget: 'judge' })).toThrow(
      /--grader-target was removed.*--grader-provider judge/,
    );
  });
});
