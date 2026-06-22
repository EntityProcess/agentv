import { afterEach, describe, expect, it } from 'bun:test';
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

  it('places default provider logs inside the case folder for the active run', () => {
    process.env.AGENTV_RUN_DIR = path.join('/repo', '.agentv', 'results', 'default', 'run-001');

    expect(
      resolveDefaultProviderLogDir('copilot-cli', {
        suite: 'demo-suite',
        evalCaseId: 'case/one',
      }),
    ).toBe(
      path.join(
        '/repo',
        '.agentv',
        'results',
        'default',
        'run-001',
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
