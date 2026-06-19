import { describe, expect, it } from 'bun:test';

import {
  createTargetClient,
  defineAssertion,
  defineCodeGrader,
  definePromptTemplate,
} from '../src/index.js';

describe('@agentv/eval compatibility package', () => {
  it('re-exports the public SDK helpers', () => {
    expect(typeof defineAssertion).toBe('function');
    expect(typeof defineCodeGrader).toBe('function');
    expect(typeof definePromptTemplate).toBe('function');
    expect(typeof createTargetClient).toBe('function');
  });
});
