import type { JsonObject } from '../types.js';
import { deriveSkillCallMetadataFromMessages } from './skill-calls.js';
import type {
  ChatPrompt,
  Message,
  ProviderRequest,
  ProviderResponse,
  ProviderTokenUsage,
} from './types.js';

export const SDK_CHILD_PROTOCOL_VERSION = 1;

export type SdkChildProviderKind = 'codex-sdk' | 'claude-sdk' | 'copilot-sdk' | 'pi-sdk';

export interface SdkChildRequestEnvelope {
  readonly protocol_version: typeof SDK_CHILD_PROTOCOL_VERSION;
  readonly provider_kind: SdkChildProviderKind;
  readonly target_name: string;
  readonly config: unknown;
  readonly request: SdkChildProviderRequestWire;
}

export interface SdkChildProviderRequestWire {
  readonly question: string;
  readonly system_prompt?: string;
  readonly chat_prompt?: ChatPrompt;
  readonly input_files?: readonly string[];
  readonly eval_case_id?: string;
  readonly suite?: string;
  readonly eval_file_path?: string;
  readonly attempt?: number;
  readonly max_output_tokens?: number;
  readonly temperature?: number;
  readonly metadata?: JsonObject;
  readonly cwd?: string;
  readonly workspace_file?: string;
  readonly capture_file_changes?: boolean;
  readonly braintrust_span_ids?: { readonly parent_span_id: string; readonly root_span_id: string };
  readonly images?: ProviderRequest['images'];
}

export type SdkChildOutputEnvelope =
  | {
      readonly protocol_version: typeof SDK_CHILD_PROTOCOL_VERSION;
      readonly type: 'event';
      readonly event: SdkChildEventWire;
    }
  | {
      readonly protocol_version: typeof SDK_CHILD_PROTOCOL_VERSION;
      readonly type: 'result';
      readonly response: SdkChildProviderResponseWire;
    }
  | {
      readonly protocol_version: typeof SDK_CHILD_PROTOCOL_VERSION;
      readonly type: 'error';
      readonly error: SdkChildErrorWire;
    };

export interface SdkChildEventWire {
  readonly kind: 'log' | 'provider_event' | 'lifecycle';
  readonly stream?: 'stdout' | 'stderr';
  readonly message?: string;
  readonly provider_event_type?: string;
  readonly data?: unknown;
}

export interface SdkChildErrorWire {
  readonly code: string;
  readonly message: string;
  readonly stack?: string;
}

export interface SdkChildProviderResponseWire {
  readonly raw?: unknown;
  readonly usage?: JsonObject;
  readonly metadata?: ProviderResponse['metadata'];
  readonly output?: readonly Message[];
  readonly token_usage?: ProviderTokenUsage;
  readonly cost_usd?: number;
  readonly duration_ms?: number;
  readonly start_time?: string;
  readonly end_time?: string;
  readonly steps?: ProviderResponse['steps'];
  readonly file_changes?: string;
}

export function providerRequestToWire(request: ProviderRequest): SdkChildProviderRequestWire {
  if (request.tools && request.tools.length > 0) {
    throw new Error('SDK child providers do not support in-process tool callbacks');
  }

  return {
    question: request.question,
    system_prompt: request.systemPrompt,
    chat_prompt: request.chatPrompt,
    input_files: request.inputFiles,
    eval_case_id: request.evalCaseId,
    suite: request.suite,
    eval_file_path: request.evalFilePath,
    attempt: request.attempt,
    max_output_tokens: request.maxOutputTokens,
    temperature: request.temperature,
    metadata: request.metadata,
    cwd: request.cwd,
    workspace_file: request.workspaceFile,
    capture_file_changes: request.captureFileChanges,
    braintrust_span_ids: request.braintrustSpanIds
      ? {
          parent_span_id: request.braintrustSpanIds.parentSpanId,
          root_span_id: request.braintrustSpanIds.rootSpanId,
        }
      : undefined,
    images: request.images,
  };
}

export function providerRequestFromWire(request: SdkChildProviderRequestWire): ProviderRequest {
  return {
    question: request.question,
    systemPrompt: request.system_prompt,
    chatPrompt: request.chat_prompt,
    inputFiles: request.input_files,
    evalCaseId: request.eval_case_id,
    suite: request.suite,
    evalFilePath: request.eval_file_path,
    attempt: request.attempt,
    maxOutputTokens: request.max_output_tokens,
    temperature: request.temperature,
    metadata: request.metadata,
    cwd: request.cwd,
    workspaceFile: request.workspace_file,
    captureFileChanges: request.capture_file_changes,
    braintrustSpanIds: request.braintrust_span_ids
      ? {
          parentSpanId: request.braintrust_span_ids.parent_span_id,
          rootSpanId: request.braintrust_span_ids.root_span_id,
        }
      : undefined,
    images: request.images,
  };
}

export function providerResponseToWire(response: ProviderResponse): SdkChildProviderResponseWire {
  return {
    raw: response.raw,
    usage: response.usage,
    metadata: response.metadata,
    output: response.output,
    token_usage: response.tokenUsage,
    cost_usd: response.costUsd,
    duration_ms: response.durationMs,
    start_time: response.startTime,
    end_time: response.endTime,
    steps: response.steps,
    file_changes: response.fileChanges,
  };
}

export function providerResponseFromWire(response: SdkChildProviderResponseWire): ProviderResponse {
  const derivedMetadata = deriveSkillCallMetadataFromMessages(response.output);
  const metadata = { ...derivedMetadata, ...response.metadata };
  return {
    raw: response.raw,
    usage: response.usage,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    output: response.output,
    tokenUsage: response.token_usage,
    costUsd: response.cost_usd,
    durationMs: response.duration_ms,
    startTime: response.start_time,
    endTime: response.end_time,
    steps: response.steps,
    fileChanges: response.file_changes,
  };
}

export function writeSdkChildEnvelope(envelope: SdkChildOutputEnvelope): void {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}
