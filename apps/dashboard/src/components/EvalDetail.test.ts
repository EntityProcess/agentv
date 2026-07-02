import { describe, expect, it } from 'bun:test';

import { parseGradingArtifact } from './EvalDetail';

describe('parseGradingArtifact', () => {
  it('reads assertion_results with legacy assertions fallback', () => {
    const current = parseGradingArtifact(
      JSON.stringify({
        assertion_results: [
          { text: 'Current evidence row', passed: true, evidence: 'from assertion_results' },
        ],
        assertions: [{ text: 'Legacy row ignored when current shape exists', passed: false }],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      }),
    );

    expect(current?.assertions).toEqual([
      { text: 'Current evidence row', passed: true, evidence: 'from assertion_results' },
    ]);

    const legacy = parseGradingArtifact(
      JSON.stringify({
        assertions: [{ text: 'Legacy evidence row', passed: false, evidence: 'from assertions' }],
      }),
    );

    expect(legacy?.assertions).toEqual([
      { text: 'Legacy evidence row', passed: false, evidence: 'from assertions' },
    ]);
  });
});
