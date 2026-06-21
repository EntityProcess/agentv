import { randomUUID } from 'node:crypto';

/**
 * Minimal run operation-log contract used by Dashboard read models.
 *
 * The raw oplog storage branch is intentionally not implemented here. This
 * module only centralizes the ref name, a small typed operation envelope for
 * tag replacement, and the materialized final-state shape that readers consume.
 */

export const RUN_OPLOG_REF = 'agentv/oplog/v1';
export const RUN_OPERATION_SCHEMA_VERSION = 'agentv.run_operation.v1';

export type RunFinalStateLifecycle = 'active' | 'hidden' | 'deleted';

export interface RunOplogWatermark {
  readonly ref: typeof RUN_OPLOG_REF;
  readonly operation_id?: string;
  readonly updated_at?: string;
}

export interface RunFinalState {
  readonly lifecycle: RunFinalStateLifecycle;
  readonly tags: string[];
}

export interface RunReadStateFields {
  readonly final_state: RunFinalState;
  readonly oplog_watermark: RunOplogWatermark;
}

export type RunOperationActorKind = 'dashboard' | 'cli' | 'ci' | 'agent' | 'unknown';

export interface RunOperationActor {
  readonly kind: RunOperationActorKind;
  readonly id?: string;
}

export interface RunOperationSubject {
  readonly run_id: string;
  readonly run_path?: string;
}

export interface RunTagsSetOperation {
  readonly schema_version: typeof RUN_OPERATION_SCHEMA_VERSION;
  readonly operation_id: string;
  readonly operation_type: 'run.tags.set';
  readonly authored_at: string;
  readonly actor: RunOperationActor;
  readonly subject: RunOperationSubject;
  readonly payload: {
    readonly tags: string[];
  };
}

export type RunOperationEnvelope = RunTagsSetOperation;

export function buildRunIdFromRelativePath(relativeRunPath: string): string {
  const segments = relativeRunPath.split(/[\\/]+/).filter(Boolean);
  if (segments.length >= 2) {
    const experiment = segments.slice(0, -1).join('/');
    const runName = segments.at(-1) ?? relativeRunPath;
    return experiment === 'default' ? runName : `${experiment}::${runName}`;
  }
  return segments[0] ?? relativeRunPath;
}

export function createRunTagsSetOperation(input: {
  readonly runId: string;
  readonly runPath?: string;
  readonly tags: readonly string[];
  readonly actor?: RunOperationActor;
  readonly authoredAt?: string;
  readonly operationId?: string;
}): RunTagsSetOperation {
  return {
    schema_version: RUN_OPERATION_SCHEMA_VERSION,
    operation_id: input.operationId ?? randomUUID(),
    operation_type: 'run.tags.set',
    authored_at: input.authoredAt ?? new Date().toISOString(),
    actor: input.actor ?? { kind: 'unknown' },
    subject: {
      run_id: input.runId,
      ...(input.runPath ? { run_path: input.runPath } : {}),
    },
    payload: {
      tags: [...input.tags],
    },
  };
}

export function watermarkFromRunOperation(operation: RunOperationEnvelope): RunOplogWatermark {
  return {
    ref: RUN_OPLOG_REF,
    operation_id: operation.operation_id,
    updated_at: operation.authored_at,
  };
}

export function normalizeRunOplogWatermark(
  input: unknown,
  fallbackUpdatedAt?: string,
): RunOplogWatermark {
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    const operationId = record.operation_id;
    const updatedAt = record.updated_at;
    return {
      ref: RUN_OPLOG_REF,
      ...(typeof operationId === 'string' && operationId ? { operation_id: operationId } : {}),
      ...(typeof updatedAt === 'string' && updatedAt
        ? { updated_at: updatedAt }
        : fallbackUpdatedAt
          ? { updated_at: fallbackUpdatedAt }
          : {}),
    };
  }

  return {
    ref: RUN_OPLOG_REF,
    ...(fallbackUpdatedAt ? { updated_at: fallbackUpdatedAt } : {}),
  };
}

export function materializeRunState(input?: {
  readonly lifecycle?: RunFinalStateLifecycle;
  readonly tags?: readonly string[];
  readonly watermark?: RunOplogWatermark;
  readonly updatedAt?: string;
}): RunReadStateFields {
  const tags = [...(input?.tags ?? [])];
  const watermark = input?.watermark ?? normalizeRunOplogWatermark(undefined, input?.updatedAt);

  return {
    final_state: {
      lifecycle: input?.lifecycle ?? 'active',
      tags,
    },
    oplog_watermark: watermark,
  };
}
