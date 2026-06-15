/**
 * Replay provider — substitutes recorded target outputs for live target calls.
 *
 * Configure it in targets.yaml with `provider: replay`, the `source_target`
 * whose live outputs were recorded, and exactly one replay source: `fixtures`
 * JSONL or `trace_envelopes`. The provider does not invoke the source target;
 * it only performs strict replay lookup and returns the recorded
 * ProviderResponse so graders can run fresh.
 */

import {
  findReplayFixtureRecord,
  readReplayFixtureRecords,
  replayFixtureRecordToProviderResponse,
} from '../replay-fixtures.js';
import {
  findTraceEnvelopeReplayRecord,
  readTraceEnvelopeReplayRecords,
  traceEnvelopeReplayRecordToProviderResponse,
} from '../replay-trace-envelopes.js';
import type { ReplayResolvedConfig } from './targets.js';
import type { Provider, ProviderRequest, ProviderResponse } from './types.js';

export class ReplayProvider implements Provider {
  readonly id: string;
  readonly kind = 'replay' as const;
  readonly targetName: string;
  readonly supportsBatch = true;

  private readonly config: ReplayResolvedConfig;

  constructor(targetName: string, config: ReplayResolvedConfig) {
    this.id = `replay:${targetName}`;
    this.targetName = targetName;
    this.config = config;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    const source = resolveReplaySource(this.config);
    switch (source.kind) {
      case 'fixtures': {
        const records = await readReplayFixtureRecords(source.path);
        const record = findReplayFixtureRecord(records, this.lookupForRequest(request));
        return replayFixtureRecordToProviderResponse(record);
      }
      case 'trace_envelopes': {
        const records = await readTraceEnvelopeReplayRecords(source.path);
        const record = findTraceEnvelopeReplayRecord(records, this.lookupForRequest(request));
        return traceEnvelopeReplayRecordToProviderResponse(record);
      }
    }
  }

  async invokeBatch(requests: readonly ProviderRequest[]): Promise<readonly ProviderResponse[]> {
    const source = resolveReplaySource(this.config);
    switch (source.kind) {
      case 'fixtures': {
        const records = await readReplayFixtureRecords(source.path);
        return requests.map((request) =>
          replayFixtureRecordToProviderResponse(
            findReplayFixtureRecord(records, this.lookupForRequest(request)),
          ),
        );
      }
      case 'trace_envelopes': {
        const records = await readTraceEnvelopeReplayRecords(source.path);
        return requests.map((request) =>
          traceEnvelopeReplayRecordToProviderResponse(
            findTraceEnvelopeReplayRecord(records, this.lookupForRequest(request)),
          ),
        );
      }
    }
  }

  private lookupForRequest(request: ProviderRequest) {
    const testId = request.evalCaseId;
    if (!testId) {
      throw new Error('Replay provider requires evalCaseId on provider requests');
    }

    return {
      suite: this.config.suite ?? request.suite,
      evalPath: this.config.evalPath ?? request.evalFilePath,
      testId,
      sourceTarget: this.config.sourceTarget,
      attempt: request.attempt ?? 0,
      variant: this.config.variant,
    };
  }
}

function resolveReplaySource(
  config: ReplayResolvedConfig,
): NonNullable<ReplayResolvedConfig['source']> {
  if (config.source) {
    return config.source;
  }
  if (config.fixturesPath) {
    return { kind: 'fixtures', path: config.fixturesPath };
  }
  throw new Error(
    'Replay provider requires exactly one replay source: fixtures or trace_envelopes',
  );
}
