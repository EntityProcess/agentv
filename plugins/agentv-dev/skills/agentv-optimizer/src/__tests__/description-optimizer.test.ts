import { describe, expect, it } from 'vitest';
import { buildDescriptionImprovementPlan } from '../description-optimizer';

describe('description optimizer', () => {
  it('turns trigger observations into provider-agnostic follow-up prompts and diffs', () => {
    const plan = buildDescriptionImprovementPlan({
      triggerMisses: ['review this diff'],
      falseTriggers: ['write a test'],
    });
    expect(plan.nextExperiments.length).toBeGreaterThan(0);
    expect(plan.nextExperiments[0].prompt).toContain('review this diff');
    expect(plan.diffPreview).not.toContain('claude');
    expect(plan.diffPreview).not.toContain('copilot');
  });

  it('uses a readable empty summary when no observations are available', () => {
    const plan = buildDescriptionImprovementPlan({});

    expect(plan.summary).toContain('No observations found');
    expect(plan.nextExperiments).toHaveLength(0);
  });
});
