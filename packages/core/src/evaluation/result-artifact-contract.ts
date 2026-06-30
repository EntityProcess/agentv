/**
 * AgentV-owned result artifact contract.
 *
 * This module centralizes the git refs and portable pointer shapes used by run
 * records. Local run workspaces still write their files under the existing
 * per-result artifact directories; these pointers describe where those same
 * AgentV-owned artifacts belong when projected to a results ref, sidecar ref,
 * or object store. Use pointers for large detached payload bytes, not as the
 * discovery path for ordinary sidecars such as `metrics.json`; normal
 * sidecars should use explicit path fields such as `metrics_path` and
 * `file_changes_path`.
 *
 * Git remote publishing treats the configured results branch as the
 * metadata/control plane and stores transcript payload bytes whose
 * `ref` is `agentv/artifacts/v1` on that artifact ref at the published pointer
 * `key` (`runs/<run-path>/<pointer.path>` for the git backend).
 */

export const AGENTV_RESULTS_PRIMARY_REF = 'agentv/results/v1' as const;
export const AGENTV_RESULTS_ARTIFACTS_REF = 'agentv/artifacts/v1' as const;
export const AGENTV_RESULTS_OPLOG_REF = 'agentv/oplog/v1' as const;

export const AGENTV_RESULTS_REFS = {
  primary: AGENTV_RESULTS_PRIMARY_REF,
  artifacts: AGENTV_RESULTS_ARTIFACTS_REF,
  oplog: AGENTV_RESULTS_OPLOG_REF,
} as const;

export const CANONICAL_TRANSCRIPT_ARTIFACT_PATH = 'transcript.jsonl' as const;
export const CANONICAL_METRICS_ARTIFACT_PATH = 'metrics.json' as const;
export const CANONICAL_FILE_CHANGES_ARTIFACT_PATH = 'outputs/file_changes.diff' as const;

export const TRANSCRIPT_SCHEMA_VERSION = 'agentv.transcript.v1' as const;
export const METRICS_SCHEMA_VERSION = 'agentv.metrics.v1' as const;
export const TRANSCRIPT_JSONL_MEDIA_TYPE = 'application/x-ndjson' as const;
export const METRICS_JSON_MEDIA_TYPE = 'application/vnd.agentv.metrics.v1+json' as const;

export type AgentVResultsRefName = (typeof AGENTV_RESULTS_REFS)[keyof typeof AGENTV_RESULTS_REFS];

export type ResultArtifactFamily =
  | 'traces'
  | 'transcripts'
  | 'outputs'
  | 'raw-logs'
  | 'screenshots';

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
