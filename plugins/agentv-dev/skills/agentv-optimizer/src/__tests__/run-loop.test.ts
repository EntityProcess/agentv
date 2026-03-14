import { describe, expect, it } from 'vitest';
import { planLoopCommands } from '../run-loop';

describe('run loop', () => {
  it('plans iteration commands without owning evaluator execution', () => {
    const plan = planLoopCommands({
      evalPath: 'examples/features/basic/evals/dataset.eval.yaml',
      iterations: 2,
    });
    expect(plan.commands).toHaveLength(2);
    expect(plan.commands[0]).toEqual(expect.arrayContaining(['agentv', 'eval']));
  });
});
