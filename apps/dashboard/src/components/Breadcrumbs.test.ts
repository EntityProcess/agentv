import { describe, expect, it } from 'bun:test';

import { formatBreadcrumbRunLabel } from './Breadcrumbs';

describe('formatBreadcrumbRunLabel', () => {
  it('shows the timestamp segment for experiment-prefixed run ids', () => {
    expect(
      formatBreadcrumbRunLabel('age-14-task-bundle-dogfood::2026-06-10T08-35-26Z-age-14-codex'),
    ).toBe('2026-06-10T08-35-26Z');
  });

  it('keeps non-timestamp run labels readable', () => {
    expect(formatBreadcrumbRunLabel('remote::smoke-wtg-2026-06-04T02-19-00Z')).toBe(
      'smoke-wtg-2026-06-04T02-19-00Z',
    );
  });
});
