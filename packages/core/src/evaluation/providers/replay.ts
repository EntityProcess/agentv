/**
 * Replay provider — substitutes recorded target outputs for live target calls.
 *
 * Configure it in targets.yaml with `provider: replay`, a `fixtures` JSONL path,
 * and the `source_target` whose live outputs were recorded. The provider does
 * not invoke the source target; it only performs strict fixture lookup and
 * returns the recorded ProviderResponse so graders can run fresh.
 */

import {
  findReplayFixtureRecord,
  readReplayFixtureRecords,
  replayFixtureRecordToProviderResponse,
} from '../replay-fixtures.js';
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
    const records = await readReplayFixtureRecords(this.config.fixturesPath);
    return this.responseForRequest(records, request);
  }

  async invokeBatch(requests: readonly ProviderRequest[]): Promise<readonly ProviderResponse[]> {
    const records = await readReplayFixtureRecords(this.config.fixturesPath);
    return requests.map((request) => this.responseForRequest(records, request));
  }

  private responseForRequest(
    records: Awaited<ReturnType<typeof readReplayFixtureRecords>>,
    request: ProviderRequest,
  ): ProviderResponse {
    const testId = request.evalCaseId;
    if (!testId) {
      throw new Error('Replay provider requires evalCaseId on provider requests');
    }

    const record = findReplayFixtureRecord(records, {
      suite: this.config.suite ?? request.suite,
      evalPath: this.config.evalPath ?? request.evalFilePath,
      testId,
      sourceTarget: this.config.sourceTarget,
      attempt: request.attempt ?? 0,
      variant: this.config.variant,
    });

    return replayFixtureRecordToProviderResponse(record);
  }
}
