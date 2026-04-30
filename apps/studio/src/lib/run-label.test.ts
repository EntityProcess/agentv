import { describe, expect, it } from 'bun:test';

import { formatRunLabel } from './run-label';

describe('formatRunLabel', () => {
  it('prefers target and experiment over the timestamp display name', () => {
    expect(
      formatRunLabel({
        filename: 'issue-1198::2026-04-29T09-17-30-111Z',
        display_name: '2026-04-29T09-17-30-111Z',
        target: 'llm-dry-run',
        experiment: 'issue-1198',
      }),
    ).toBe('llm-dry-run · issue-1198');
  });

  it('falls back to the display name when no richer metadata is available', () => {
    expect(
      formatRunLabel({
        filename: '2026-04-29T09-17-30-111Z',
        display_name: '2026-04-29T09-17-30-111Z',
      }),
    ).toBe('2026-04-29T09-17-30-111Z');
  });
});
