/**
 * AgentV-owned result artifact contract.
 *
 * This module centralizes the git refs and portable pointer shapes used by run
 * records. Local run workspaces still write their files under the existing
 * per-result artifact directories; these pointers describe where those same
 * AgentV-owned artifacts belong when projected to a results ref, sidecar ref,
 * or object store.
 */

export const AGENTV_RESULTS_PRIMARY_REF = 'agentv/results/v1' as const;
export const AGENTV_RESULTS_ARTIFACTS_REF = 'agentv/results/v1/artifacts' as const;
export const AGENTV_RESULTS_OPLOG_REF = 'agentv/results/v1/oplog' as const;

export const AGENTV_RESULTS_REFS = {
  primary: AGENTV_RESULTS_PRIMARY_REF,
  artifacts: AGENTV_RESULTS_ARTIFACTS_REF,
  oplog: AGENTV_RESULTS_OPLOG_REF,
} as const;

export const CANONICAL_TRACE_ARTIFACT_PATH = 'outputs/trace.json' as const;
export const CANONICAL_TRANSCRIPT_ARTIFACT_PATH = 'outputs/transcript.jsonl' as const;

export const TRANSCRIPT_SCHEMA_VERSION = 'agentv.transcript.v1' as const;
export const TRANSCRIPT_JSONL_MEDIA_TYPE = 'application/x-ndjson' as const;
export const TRACE_JSON_MEDIA_TYPE = 'application/vnd.agentv.trace.v1+json' as const;

export type AgentVResultsRefName = (typeof AGENTV_RESULTS_REFS)[keyof typeof AGENTV_RESULTS_REFS];

export type ResultArtifactFamily = 'traces' | 'transcripts' | 'outputs' | 'raw-logs' | 'screenshots';

export interface ResultArtifactPointer {
  readonly ref: AgentVResultsRefName | string;
  readonly key: string;
  readonly objectVersion: string;
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly schemaVersion: string;
  readonly mediaType: string;
  readonly family?: ResultArtifactFamily;
}

export interface ResultArtifactPointerWire {
  readonly ref: AgentVResultsRefName | string;
  readonly key: string;
  readonly object_version: string;
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly schema_version: string;
  readonly media_type: string;
  readonly family?: ResultArtifactFamily;
}

export type TranscriptArtifactPointer = ResultArtifactPointer & {
  readonly schemaVersion: typeof TRANSCRIPT_SCHEMA_VERSION;
  readonly mediaType: typeof TRANSCRIPT_JSONL_MEDIA_TYPE;
  readonly family: 'transcripts';
};

export type TranscriptArtifactPointerWire = ResultArtifactPointerWire & {
  readonly schema_version: typeof TRANSCRIPT_SCHEMA_VERSION;
  readonly media_type: typeof TRANSCRIPT_JSONL_MEDIA_TYPE;
  readonly family: 'transcripts';
};

export interface ResultArtifactPointersWire {
  readonly trace?: ResultArtifactPointerWire;
  readonly transcript?: TranscriptArtifactPointerWire;
}

export function toResultArtifactPointerWire(
  pointer: ResultArtifactPointer,
): ResultArtifactPointerWire {
  return {
    ref: pointer.ref,
    key: pointer.key,
    object_version: pointer.objectVersion,
    path: pointer.path,
    sha256: pointer.sha256,
    size: pointer.size,
    schema_version: pointer.schemaVersion,
    media_type: pointer.mediaType,
    family: pointer.family,
  };
}

export function fromResultArtifactPointerWire(
  pointer: ResultArtifactPointerWire,
): ResultArtifactPointer {
  return {
    ref: pointer.ref,
    key: pointer.key,
    objectVersion: pointer.object_version,
    path: pointer.path,
    sha256: pointer.sha256,
    size: pointer.size,
    schemaVersion: pointer.schema_version,
    mediaType: pointer.media_type,
    family: pointer.family,
  };
}
