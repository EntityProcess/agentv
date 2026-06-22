import { createHash } from 'node:crypto';

export type RunFinalStateLifecycle = 'active' | 'hidden' | 'deleted';

export interface RunFinalState {
  readonly lifecycle: RunFinalStateLifecycle;
  readonly tags: string[];
}

export interface RunReadStateFields {
  readonly final_state: RunFinalState;
  readonly tag_revision: string;
}

export class TagRevisionConflictError extends Error {
  readonly expectedRevision: string;
  readonly currentRevision: string;

  constructor(expectedRevision: string, currentRevision: string) {
    super('Run tags changed. Refresh the run and try again.');
    this.name = 'TagRevisionConflictError';
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

export function createTagRevision(tags: readonly string[], updatedAt?: string): string {
  const hash = createHash('sha256');
  hash.update('agentv.run_tags.v1\0');
  hash.update(JSON.stringify({ tags: [...tags], updated_at: updatedAt ?? '' }));
  return `sha256:${hash.digest('hex')}`;
}

export function normalizeTagRevision(
  input: unknown,
  tags: readonly string[],
  updatedAt?: string,
): string {
  return typeof input === 'string' && input.trim().length > 0
    ? input
    : createTagRevision(tags, updatedAt);
}

export function assertExpectedTagRevision(
  expectedRevision: string | undefined,
  currentRevision: string,
): void {
  if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
    throw new TagRevisionConflictError(expectedRevision, currentRevision);
  }
}

export function materializeRunState(input?: {
  readonly lifecycle?: RunFinalStateLifecycle;
  readonly tags?: readonly string[];
  readonly tagRevision?: string;
  readonly updatedAt?: string;
}): RunReadStateFields {
  const tags = [...(input?.tags ?? [])];

  return {
    final_state: {
      lifecycle: input?.lifecycle ?? 'active',
      tags,
    },
    tag_revision: input?.tagRevision ?? createTagRevision(tags, input?.updatedAt),
  };
}
