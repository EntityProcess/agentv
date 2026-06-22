import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import {
  buildDefaultRunDir,
  buildDefaultRunDirFromName,
  normalizeExperimentName,
  relativeRunPathFromCwd,
} from '../../../src/commands/eval/result-layout.js';

describe('result layout', () => {
  it('groups default run directories under the default experiment', () => {
    const cwd = '/repo';
    const timestamp = new Date('2026-06-22T12:34:56.789Z');

    expect(buildDefaultRunDir(cwd, undefined, timestamp)).toBe(
      path.join('/repo', '.agentv', 'results', 'default', '2026-06-22T12-34-56-789Z'),
    );
  });

  it('groups named experiment run directories under the experiment', () => {
    expect(buildDefaultRunDirFromName('/repo', 'with-skills', '2026-run')).toBe(
      path.join('/repo', '.agentv', 'results', 'with-skills', '2026-run'),
    );
  });

  it('reserves the deprecated runs namespace', () => {
    expect(() => normalizeExperimentName('runs')).toThrow('reserved');
    expect(
      relativeRunPathFromCwd(
        '/repo',
        path.join('/repo', '.agentv', 'results', 'runs', 'default', '2026-run'),
      ),
    ).toBeUndefined();
    expect(
      relativeRunPathFromCwd(
        '/repo',
        path.join('/repo', '.agentv', 'results', 'default', '2026-run'),
      ),
    ).toBe('default/2026-run');
  });
});
