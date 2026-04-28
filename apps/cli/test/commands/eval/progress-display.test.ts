import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { ProgressDisplay } from '../../../src/commands/eval/progress-display.js';

describe('ProgressDisplay', () => {
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    process.env.NO_COLOR = '1';
  });

  afterEach(() => {
    if (originalNoColor === undefined) {
      process.env.NO_COLOR = undefined;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  });

  it('prints agent and total durations after the verdict', () => {
    const display = new ProgressDisplay(1);
    const logs: string[] = [];
    const logSpy = mock((message?: unknown) => {
      logs.push(String(message ?? ''));
    });
    const originalLog = console.log;
    console.log = logSpy as typeof console.log;

    try {
      display.start();
      display.setTotalTests(1);
      display.updateWorker({
        workerId: 1,
        testId: 'test-42-billing-negative-margin',
        status: 'completed',
        targetLabel: 'wtalms-stg',
        score: 0.94,
        verdict: 'PASS',
        durationMs: 18342,
        totalDurationMs: 22109,
      });
    } finally {
      console.log = originalLog;
    }

    expect(logs).toEqual([
      '1/1   ✅ test-42-billing-negative-margin | wtalms-stg | 94% PASS | agent 18342ms | total 22109ms',
    ]);
  });

  it('omits duration segments when metrics are unavailable', () => {
    const display = new ProgressDisplay(1);
    const logs: string[] = [];
    const logSpy = mock((message?: unknown) => {
      logs.push(String(message ?? ''));
    });
    const originalLog = console.log;
    console.log = logSpy as typeof console.log;

    try {
      display.start();
      display.setTotalTests(1);
      display.updateWorker({
        workerId: 1,
        testId: 'test-01-biosecurity',
        status: 'completed',
        targetLabel: 'wtalms-stg',
        score: 0.98,
        verdict: 'PASS',
      });
    } finally {
      console.log = originalLog;
    }

    expect(logs).toEqual(['1/1   ✅ test-01-biosecurity | wtalms-stg | 98% PASS']);
  });
});
