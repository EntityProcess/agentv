import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveDefaultProviderLogDir } from '../../../src/evaluation/providers/log-directory.js';

describe('resolveDefaultProviderLogDir', () => {
  const previousRunDir = process.env.AGENTV_RUN_DIR;

  afterEach(() => {
    if (previousRunDir === undefined) {
      process.env.AGENTV_RUN_DIR = undefined;
    } else {
      process.env.AGENTV_RUN_DIR = previousRunDir;
    }
  });

  it('places default provider stream captures outside the active run bundle', () => {
    const runDir = path.join('/repo', '.agentv', 'results', 'default', 'run-001');
    process.env.AGENTV_RUN_DIR = runDir;
    const runHash = createHash('sha256').update(path.resolve(runDir)).digest('hex').slice(0, 12);

    expect(
      resolveDefaultProviderLogDir('copilot-cli', {
        suite: 'demo-suite',
        evalCaseId: 'case/one',
      }),
    ).toBe(
      path.join(
        tmpdir(),
        'agentv-provider-streams',
        `run-001-${runHash}`,
        'demo-suite',
        'case_one',
        'logs',
        'copilot-cli',
      ),
    );
  });

  it('does not fall back to .agentv/logs without an active run', () => {
    process.env.AGENTV_RUN_DIR = undefined;

    expect(resolveDefaultProviderLogDir('copilot-cli', { evalCaseId: 'case-one' })).toBeUndefined();
  });
});
