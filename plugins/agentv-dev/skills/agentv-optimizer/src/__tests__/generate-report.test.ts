import { describe, expect, it } from 'vitest';
import { buildReviewModel } from '../generate-report';

describe('generate report', () => {
  it('builds a review model from existing AgentV artifacts', () => {
    const review = buildReviewModel({
      gradingPath: 'src/__fixtures__/grading.json',
      benchmarkPath: 'src/__fixtures__/benchmark.json',
      timingPath: 'src/__fixtures__/timing.json',
      resultsPath: 'src/__fixtures__/results.jsonl',
    });
    expect(review.sections.length).toBeGreaterThan(0);
    expect(review.testCases.length).toBeGreaterThan(0);
  });
});
