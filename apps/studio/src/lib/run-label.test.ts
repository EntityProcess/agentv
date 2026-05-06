import { describe, expect, it } from 'bun:test';

import { formatRunLabel } from './run-label';

describe('formatRunLabel', () => {
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
});
