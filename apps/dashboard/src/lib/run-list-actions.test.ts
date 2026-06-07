import { describe, expect, it } from 'bun:test';

import {
  buildCombineSuccessMessage,
  buildDeleteSuccessMessage,
  formatSelectedRunCount,
  runSelectionDisabledReason,
} from './run-list-actions';

describe('runSelectionDisabledReason', () => {
  it('explains why remote runs are not local workspace actions', () => {
    expect(runSelectionDisabledReason({ source: 'remote' })).toContain('Remote runs');
  });

  it('explains why active runs cannot be selected', () => {
    expect(runSelectionDisabledReason({ source: 'local', status: 'running' })).toContain(
      'Running runs',
    );
  });

  it('allows completed local runs', () => {
    expect(runSelectionDisabledReason({ source: 'local', status: 'finished' })).toBeUndefined();
  });
});

describe('run action copy', () => {
  it('uses local-run wording for selection, combine, and delete feedback', () => {
    expect(formatSelectedRunCount(2)).toBe('2 local runs selected');
    expect(buildCombineSuccessMessage(2, 'combined/demo')).toBe(
      'Combined 2 local runs into combined/demo.',
    );
    expect(buildDeleteSuccessMessage(1)).toBe('Deleted 1 local run.');
  });
});
