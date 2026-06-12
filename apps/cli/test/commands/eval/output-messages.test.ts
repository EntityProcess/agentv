import { describe, expect, it } from 'bun:test';

import { trimOutputMessages } from '../../../src/commands/eval/run-eval.js';

describe('trimOutputMessages', () => {
  it('leaves final-answer output unchanged', () => {
    expect(trimOutputMessages('Done!', 1)).toBe('Done!');
    expect(trimOutputMessages('Done!', 3)).toBe('Done!');
    expect(trimOutputMessages('Done!', 'all')).toBe('Done!');
  });

  it('preserves empty final-answer output', () => {
    expect(trimOutputMessages('', 1)).toBe('');
    expect(trimOutputMessages('', 'all')).toBe('');
  });
});
