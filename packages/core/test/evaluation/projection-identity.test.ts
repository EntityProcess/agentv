import { describe, expect, it } from 'bun:test';

import {
  ProjectionIdentityError,
  buildProjectionIdentity,
  buildProjectionIdentityKey,
  fromProjectionIdentityWire,
  toProjectionIdentityWire,
} from '../../src/evaluation/projection-identity.js';

const BASE_INPUT = {
  runId: '2026-06-19T10-00-00-000Z',
  suite: 'demo-suite',
  evalPath: 'evals/demo.eval.yaml',
  testId: 'case-alpha',
  target: 'candidate',
  sourceTarget: 'candidate',
  attempt: 0,
  variant: null,
  envelopeId: 'execution-trace-abc123',
  traceId: 'trace-abc123',
  rootSpanId: 'root-abc123',
  projectionFormat: 'execution_trace',
  projectionVersion: 'agentv.trace.v1',
};

describe('projection identity', () => {
  it('builds a stable canonical key and wire shape', () => {
    const first = buildProjectionIdentity(BASE_INPUT);
    const second = buildProjectionIdentity({ ...BASE_INPUT });

    expect(first.id).toBe(second.id);
    expect(first.key).toBe(second.key);
    expect(first.key).toBe(buildProjectionIdentityKey(first.dimensions));
    expect(first.key).toContain('projection_format=execution_trace');
    expect(first.key).toContain('run_id=2026-06-19T10-00-00-000Z');
    expect(first.key).toContain('variant=~');

    const wire = toProjectionIdentityWire(first);
    expect(wire.schema_version).toBe('agentv.projection_identity.v1');
    expect(wire.dimensions.run_id).toBe(BASE_INPUT.runId);
    expect(wire.dimensions.root_span_id).toBe(BASE_INPUT.rootSpanId);
    expect(fromProjectionIdentityWire(wire)).toEqual(first);
  });

  it('makes attempt, variant, and source_target part of the identity', () => {
    const base = buildProjectionIdentity(BASE_INPUT);
    const attempt = buildProjectionIdentity({ ...BASE_INPUT, attempt: 1 });
    const variant = buildProjectionIdentity({ ...BASE_INPUT, variant: 'canary' });
    const sourceTarget = buildProjectionIdentity({ ...BASE_INPUT, sourceTarget: 'baseline' });

    expect(new Set([base.id, attempt.id, variant.id, sourceTarget.id]).size).toBe(4);
  });

  it('fails clearly when required dimensions are missing', () => {
    expect(() =>
      buildProjectionIdentity({
        ...BASE_INPUT,
        runId: undefined,
        traceId: '',
      }),
    ).toThrow(ProjectionIdentityError);

    try {
      buildProjectionIdentity({ ...BASE_INPUT, runId: undefined, traceId: '' });
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectionIdentityError);
      expect((error as ProjectionIdentityError).issues.map((issue) => issue.field)).toEqual([
        'runId',
        'traceId',
      ]);
    }
  });

  it('warns but remains stable when suite and eval_path are absent', () => {
    const identity = buildProjectionIdentity({
      ...BASE_INPUT,
      suite: undefined,
      evalPath: undefined,
    });

    expect(identity.issues).toEqual([
      {
        code: 'missing_suite_or_eval_path',
        severity: 'warning',
        field: 'suite/evalPath',
        message:
          'Projection identity is more portable when at least one of suite or evalPath is present.',
      },
    ]);
    expect(identity.key).toContain('suite=~|eval_path=~');
  });
});
