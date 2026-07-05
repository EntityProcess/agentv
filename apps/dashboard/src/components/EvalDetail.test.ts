import { describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { GradingArtifactView, parseGradingArtifact } from './EvalDetail';

describe('parseGradingArtifact', () => {
  it('reads aggregate pass, score, reason, named_scores, and metadata', () => {
    const parsed = parseGradingArtifact(
      JSON.stringify({
        pass: false,
        score: 0.42,
        reason: 'One authored assertion failed.',
        named_scores: { correctness: 0.5, style: 0.34, ignored: 'not a number' },
        metadata: { grader_target: 'azure-llm', run_kind: 'sample' },
      }),
    );

    expect(parsed?.result).toMatchObject({
      pass: false,
      score: 0.42,
      reason: 'One authored assertion failed.',
      namedScores: { correctness: 0.5, style: 0.34 },
      metadata: { grader_target: 'azure-llm', run_kind: 'sample' },
      componentResults: [],
    });
  });

  it('reads single, multiple, and nested component_results with assertion metadata', () => {
    const parsed = parseGradingArtifact(
      JSON.stringify({
        pass: false,
        score: 0.66,
        reason: 'Nested rubric failed.',
        component_results: [
          {
            pass: true,
            score: 1,
            reason: 'Valid JSON.',
            assertion: { type: 'is-json', metric: 'validity' },
          },
          {
            pass: false,
            score: 0.32,
            reason: 'Rubric partially matched.',
            assertion: { type: 'llm-rubric', metric: 'correctness', value: 'must cite policy' },
            component_results: [
              {
                pass: false,
                score: 0,
                reason: 'Missing citation.',
                assertion: { type: 'contains', value: 'POL-123' },
              },
            ],
          },
        ],
      }),
    );

    expect(parsed?.result?.componentResults).toHaveLength(2);
    expect(parsed?.result?.componentResults[0]).toMatchObject({
      pass: true,
      score: 1,
      reason: 'Valid JSON.',
      assertion: { type: 'is-json', metric: 'validity' },
      componentResults: [],
    });
    expect(parsed?.result?.componentResults[1]?.componentResults[0]).toMatchObject({
      pass: false,
      score: 0,
      reason: 'Missing citation.',
      assertion: { type: 'contains', value: 'POL-123' },
      componentResults: [],
    });
  });

  it('does not require or display old public grading fields', () => {
    const parsed = parseGradingArtifact(
      JSON.stringify({
        pass: true,
        score: 1,
        reason: 'Aggregate result is the source of truth.',
        assertion_results: [
          { text: 'stale assertion_results row', passed: false, evidence: 'old evidence' },
        ],
        evidence: 'old top-level evidence',
        graders: [{ name: 'old grader' }],
        checks: [{ text: 'old check' }],
      }),
    );

    expect(parsed?.result).toMatchObject({
      pass: true,
      score: 1,
      reason: 'Aggregate result is the source of truth.',
      componentResults: [],
    });
    expect(JSON.stringify(parsed)).not.toContain('stale assertion_results row');
    expect(JSON.stringify(parsed)).not.toContain('old evidence');
    expect(JSON.stringify(parsed)).not.toContain('old grader');
    expect(JSON.stringify(parsed)).not.toContain('old check');
  });

  it('reports missing, empty, and failed-parse artifact states', () => {
    expect(parseGradingArtifact(undefined)).toBeNull();
    expect(parseGradingArtifact('')).toBeNull();
    expect(parseGradingArtifact('[]')?.error).toBe('grading.json must contain a JSON object.');
    expect(parseGradingArtifact('{')?.error).toContain('JSON');
  });
});

describe('GradingArtifactView', () => {
  it('renders aggregate grading before recursive component details without empty clutter', () => {
    const parsed = parseGradingArtifact(
      JSON.stringify({
        pass: false,
        score: 0.5,
        reason: 'One component failed.',
        named_scores: { correctness: 0.5 },
        metadata: { grader_target: 'azure-llm' },
        component_results: [
          {
            pass: false,
            score: 0.5,
            reason: 'Authored rubric failed.',
            assertion: { type: 'llm-rubric', metric: 'correctness', value: 'cite policy' },
            component_results: [
              {
                pass: true,
                score: 1,
                reason: 'Required structure present.',
                assertion: { type: 'is-json' },
              },
            ],
          },
        ],
      }),
    );

    if (!parsed?.result) throw new Error('expected parsed grading result');

    const html = renderToStaticMarkup(
      createElement(GradingArtifactView, { result: parsed.result }),
    );

    expect(html.indexOf('Aggregate score')).toBeLessThan(html.indexOf('Component Results'));
    expect(html).toContain('One component failed.');
    expect(html).toContain('correctness');
    expect(html).toContain('value: cite policy');
    expect(html).toContain('Authored rubric failed.');
    expect(html).toContain('Required structure present.');
    expect(html).not.toContain('No assertion steps recorded');
  });
});
