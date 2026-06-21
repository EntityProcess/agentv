import { describe, expect, it } from 'bun:test';

import { EvalFileSchema } from '../../../src/evaluation/validation/eval-file.schema.js';

describe('EvalFileSchema input shorthand', () => {
  const baseTest = {
    id: 'test-1',
    criteria: 'Goal',
    input: 'Classify this request.',
  };

  it('accepts structured object input shorthand without a top-level role key', () => {
    const result = EvalFileSchema.safeParse({
      input: { task: 'classify', labels: ['bug', 'feature'] },
      tests: [baseTest],
    });

    expect(result.success).toBe(true);
  });

  it('accepts a single message-shaped input object with a top-level role key', () => {
    const result = EvalFileSchema.safeParse({
      input: { role: 'user', content: { task: 'classify' } },
      tests: [baseTest],
    });

    expect(result.success).toBe(true);
  });

  it('rejects object input with a reserved top-level role key unless it is a valid message', () => {
    const result = EvalFileSchema.safeParse({
      input: { role: 'admin', task: 'classify' },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });
});
