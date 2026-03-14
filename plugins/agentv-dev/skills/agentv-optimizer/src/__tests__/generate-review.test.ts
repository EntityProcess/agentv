import { describe, expect, it } from 'vitest';
import { renderReviewHtml } from '../../eval-viewer/generate-review';

describe('generate review', () => {
  it('renders review html from the report model', () => {
    const html = renderReviewHtml({
      title: 'Optimizer Review',
      sections: [{ heading: 'Summary', body: 'Pass rate improved' }],
      testCases: [{ id: 'case-1', status: 'pass', summary: 'baseline' }],
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<body id="agentv-optimizer-viewer">');
    expect(html).toContain('<table>');
    expect(html).toContain('Optimizer Review');
    expect(html).toContain('case-1');
  });
});
