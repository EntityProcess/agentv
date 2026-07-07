import { describe, expect, it } from 'bun:test';

import { createProvider } from '../../../src/evaluation/providers/index.js';
import type { ResolvedProviderBackend } from '../../../src/evaluation/providers/targets.js';

describe('sandbox target runtime', () => {
  it('returns deliberate unsupported envelopes for sandbox coding-agent adapters', async () => {
    const target: ResolvedProviderBackend = {
      name: 'codex-sandbox',
      kind: 'codex-cli',
      runtime: { mode: 'sandbox', image: 'agentv-codex:sha256' },
      config: {
        executable: 'codex',
      },
    };

    const provider = createProvider(target);
    const response = await provider.invoke({ question: 'Fix the test' });

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.runtimeMode).toBe('sandbox');
    expect(response.targetExecution?.errorKind).toBe('sandbox_infra_failure');
    expect(response.targetExecution?.providerKind).toBe('codex-cli');
    expect(response.targetExecution?.message).toContain("provider 'codex-cli'");
    expect(response.targetExecution?.details).toMatchObject({
      unsupported_provider: 'codex-cli',
      supported_sandbox_provider: 'cli',
    });
  });
});
