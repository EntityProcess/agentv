import { describe, expect, it } from 'bun:test';

import { formatRunLabel } from './run-label';

describe('formatRunLabel', () => {
  it('starts with the run display name when available', () => {
    expect(
      formatRunLabel({
        display_name: 'dogfood-run-a',
        filename: 'dogfood-run-a',
        target: 'codex',
        timestamp: '2026-06-01T10:00:00.000Z',
        pass_rate: 1,
      }),
    ).toBe('dogfood-run-a · 01/06 10:00 · codex · 100%');
  });

  it('shows DD/MM HH:mm · target · experiment · score', () => {
    expect(
      formatRunLabel({
        target: 'llm-dry-run',
        experiment: 'issue-1198',
        timestamp: '2026-04-29T09:17:30.111Z',
        pass_rate: 0.8,
      }),
    ).toBe('29/04 09:17 · llm-dry-run · issue-1198 · 80%');
  });

  it('omits experiment when it is the default', () => {
    expect(
      formatRunLabel({
        target: 'azure',
        experiment: 'default',
        timestamp: '2026-04-29T09:17:30.111Z',
        pass_rate: 1,
      }),
    ).toBe('29/04 09:17 · azure · 100%');
  });

  it('shows just timestamp and score when no target is present', () => {
    expect(
      formatRunLabel({
        timestamp: '2026-04-29T09:17:30.111Z',
        pass_rate: 0,
      }),
    ).toBe('29/04 09:17 · 0%');
  });

  it('shows target even when pass rate is 0 (active/in-progress run)', () => {
    expect(
      formatRunLabel({
        target: 'wtalms-stg',
        timestamp: '2026-05-07T10:56:00.000Z',
        pass_rate: 0,
      }),
    ).toBe('07/05 10:56 · wtalms-stg · 0%');
  });
});
