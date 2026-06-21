import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';

import {
  RUN_OPERATION_SCHEMA_VERSION,
  RUN_OPLOG_REF,
  buildRunIdFromRelativePath,
  createRunTagsSetOperation,
  materializeRunState,
  watermarkFromRunOperation,
} from '../../../src/commands/results/run-oplog.js';

const PRIMARY_RESULTS_REF = 'agentv/results/v1';
const ARTIFACTS_REF = 'agentv/artifacts/v1';

function refsHavePrefixConflict(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function isValidGitBranchRef(ref: string): boolean {
  try {
    execFileSync('git', ['check-ref-format', `refs/heads/${ref}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('run operation log contract', () => {
  it('defines the stable oplog ref', () => {
    expect(RUN_OPLOG_REF).toBe('agentv/oplog/v1');
  });

  it('keeps results, artifacts, and oplog refs non-prefix-conflicting', () => {
    const refs = [PRIMARY_RESULTS_REF, ARTIFACTS_REF, RUN_OPLOG_REF];

    for (const left of refs) {
      expect(isValidGitBranchRef(left)).toBe(true);
    }

    for (const [index, left] of refs.entries()) {
      for (const right of refs.slice(index + 1)) {
        expect(refsHavePrefixConflict(left, right)).toBe(false);
      }
    }
  });

  it('builds a typed tag replacement operation envelope', () => {
    const operation = createRunTagsSetOperation({
      runId: 'smoke::2026-06-21T10-00-00-000Z',
      runPath: 'smoke/2026-06-21T10-00-00-000Z',
      tags: ['baseline', 'reviewed'],
      actor: { kind: 'dashboard', id: 'local' },
      authoredAt: '2026-06-21T10:15:00.000Z',
      operationId: 'op-123',
    });

    expect(operation).toEqual({
      schema_version: RUN_OPERATION_SCHEMA_VERSION,
      operation_id: 'op-123',
      operation_type: 'run.tags.set',
      authored_at: '2026-06-21T10:15:00.000Z',
      actor: { kind: 'dashboard', id: 'local' },
      subject: {
        run_id: 'smoke::2026-06-21T10-00-00-000Z',
        run_path: 'smoke/2026-06-21T10-00-00-000Z',
      },
      payload: {
        tags: ['baseline', 'reviewed'],
      },
    });
  });

  it('materializes final run state from tags and an operation watermark', () => {
    const operation = createRunTagsSetOperation({
      runId: '2026-06-21T10-00-00-000Z',
      tags: ['accepted'],
      authoredAt: '2026-06-21T10:15:00.000Z',
      operationId: 'op-456',
    });

    expect(
      materializeRunState({
        tags: operation.payload.tags,
        watermark: watermarkFromRunOperation(operation),
      }),
    ).toEqual({
      final_state: {
        lifecycle: 'active',
        tags: ['accepted'],
      },
      oplog_watermark: {
        ref: RUN_OPLOG_REF,
        operation_id: 'op-456',
        updated_at: '2026-06-21T10:15:00.000Z',
      },
    });
  });

  it('derives run IDs from results branch paths', () => {
    expect(buildRunIdFromRelativePath('default/2026-06-21T10-00-00-000Z')).toBe(
      '2026-06-21T10-00-00-000Z',
    );
    expect(buildRunIdFromRelativePath('smoke/2026-06-21T10-00-00-000Z')).toBe(
      'smoke::2026-06-21T10-00-00-000Z',
    );
  });
});
