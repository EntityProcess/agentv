import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { StatsCards } from './StatsCards';

describe('StatsCards', () => {
  it('uses concise pass and failure labels while keeping execution errors distinct', () => {
    const html = renderToStaticMarkup(
      <StatsCards total={10} passed={7} failed={2} passRate={0.78} executionErrors={1} />,
    );

    expect(html).toContain('Pass Rate');
    expect(html).toContain('Passed');
    expect(html).toContain('Failures');
    expect(html).toContain('Execution Errors');
    expect(html).not.toContain('Quality Pass Rate');
    expect(html).not.toContain('Quality Failures');
  });
});
