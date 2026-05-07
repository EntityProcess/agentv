import { describe, expect, it } from 'bun:test';

import { isTerminalRunStatus, shouldShowStopButton } from './stop-run-helpers';

describe('isTerminalRunStatus', () => {
  it('treats finished and failed as terminal', () => {
    expect(isTerminalRunStatus('finished')).toBe(true);
    expect(isTerminalRunStatus('failed')).toBe(true);
  });

  it('treats live states and unknowns as non-terminal', () => {
    expect(isTerminalRunStatus('starting')).toBe(false);
    expect(isTerminalRunStatus('running')).toBe(false);
    expect(isTerminalRunStatus(undefined)).toBe(false);
  });
});

describe('shouldShowStopButton', () => {
  it('shows while the run is live', () => {
    expect(shouldShowStopButton('starting', false)).toBe(true);
    expect(shouldShowStopButton('running', false)).toBe(true);
  });

  it('hides once the run reaches a terminal state', () => {
    expect(shouldShowStopButton('finished', false)).toBe(false);
    expect(shouldShowStopButton('failed', false)).toBe(false);
  });

  it('hides in read-only mode regardless of status', () => {
    expect(shouldShowStopButton('running', true)).toBe(false);
  });

  it('hides when the status is undefined', () => {
    expect(shouldShowStopButton(undefined, false)).toBe(false);
  });
});
