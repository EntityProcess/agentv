import { describe, expect, it } from 'bun:test';

import { formatRunDisplay, formatRunLabel } from './run-label';

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

  it('uses a non-default experiment as the primary label when no display name is present', () => {
    expect(
      formatRunLabel({
        target: 'llm-dry-run',
        experiment: 'issue-1198',
        timestamp: '2026-04-29T09:17:30.111Z',
        pass_rate: 0.8,
      }),
    ).toBe('issue-1198 · 29/04 09:17 · llm-dry-run · 80%');
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

  it('uses one compact timestamp for remote timestamp-only run names', () => {
    const display = formatRunDisplay({
      display_name: '2026-03-27T05-00-00-000Z',
      filename: 'remote::2026-03-27T05-00-00-000Z',
      target: 'av-fis-target',
      timestamp: '2026-03-27T05:00:00.000Z',
      pass_rate: 1,
    });

    expect(display.primary).toBe('27/03 05:00');
    expect(display.secondary).toBe('av-fis-target · 100%');
    expect(display.label).toBe('27/03 05:00 · av-fis-target · 100%');
    expect(display.label.match(/27\/03 05:00/g)).toHaveLength(1);
    expect(display.title).toContain('Run ID: remote::2026-03-27T05-00-00-000Z');
    expect(display.title).toContain('Display name: 2026-03-27T05-00-00-000Z');
  });

  it('keeps a local human display name as the primary label', () => {
    const display = formatRunDisplay({
      display_name: 'local fixture run',
      filename: '2026-06-08T20-00-00-000Z',
      target: 'local-target',
      timestamp: '2026-06-08T20:00:00.000Z',
      pass_rate: 1,
    });

    expect(display.primary).toBe('local fixture run');
    expect(display.secondary).toBe('08/06 20:00 · local-target · 100%');
    expect(display.label).toBe('local fixture run · 08/06 20:00 · local-target · 100%');
  });

  it('falls back to a non-default experiment before timestamp-only run IDs', () => {
    const display = formatRunDisplay({
      display_name: '2026-03-27T05-00-00-000Z',
      filename: 'remote::smoke-regression::2026-03-27T05-00-00-000Z',
      experiment: 'smoke-regression',
      target: 'azure',
      timestamp: '2026-03-27T05:00:00.000Z',
      pass_rate: 0.5,
    });

    expect(display.primary).toBe('smoke-regression');
    expect(display.secondary).toBe('27/03 05:00 · azure · 50%');
  });

  it('can omit pass rate when another UI column already shows it', () => {
    const display = formatRunDisplay(
      {
        display_name: 'local fixture run',
        target: 'local-target',
        timestamp: '2026-06-08T20:00:00.000Z',
        pass_rate: 1,
      },
      { includePassRate: false },
    );

    expect(display.label).toBe('local fixture run · 08/06 20:00 · local-target');
  });
});
