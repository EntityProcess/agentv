import { describe, expect, it } from 'bun:test';

import {
  buildRunEvalRequest,
  getDefaultThresholdInputValue,
  getThresholdFieldValue,
} from './run-eval-threshold';

describe('getDefaultThresholdInputValue', () => {
  it('uses the configured studio threshold when the modal threshold is blank', () => {
    expect(getDefaultThresholdInputValue('', 0.75)).toBe('0.75');
  });

  it('falls back to the CLI default when no studio threshold is configured', () => {
    expect(getDefaultThresholdInputValue('', undefined)).toBe('0.8');
  });

  it('preserves a per-run override when the user edits the threshold', () => {
    expect(getDefaultThresholdInputValue('0.9', 0.75)).toBe('0.9');
  });
});

describe('buildRunEvalRequest', () => {
  it('submits the studio threshold when the modal threshold input is left blank', () => {
    expect(
      buildRunEvalRequest({
        suiteFilter: 'evals/**/*.eval.yaml',
        testIds: [],
        target: '',
        thresholdInput: '',
        studioThreshold: 0.75,
        workers: '',
        dryRun: false,
      }),
    ).toEqual({
      suite_filter: 'evals/**/*.eval.yaml',
      threshold: 0.75,
    });
  });

  it('submits a per-run threshold override when the user changes the field', () => {
    expect(
      buildRunEvalRequest({
        suiteFilter: 'evals/**/*.eval.yaml',
        testIds: [],
        target: '',
        thresholdInput: '0.9',
        studioThreshold: 0.75,
        workers: '',
        dryRun: false,
      }),
    ).toEqual({
      suite_filter: 'evals/**/*.eval.yaml',
      threshold: 0.9,
    });
  });
});

describe('getThresholdFieldValue', () => {
  it('shows the default threshold before the user edits the field', () => {
    expect(getThresholdFieldValue('', false, 0.75)).toBe('0.75');
  });

  it('lets the user clear the field while editing', () => {
    expect(getThresholdFieldValue('', true, 0.75)).toBe('');
  });
});
