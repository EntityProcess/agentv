import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProjectChromeTitle } from './ProjectChromeTitle';

describe('ProjectChromeTitle', () => {
  it('renders the registry project name as the primary chrome title', () => {
    const html = renderToStaticMarkup(
      <ProjectChromeTitle projectId="wtg-ai-prompts" displayName="WTG.AI.Prompts" />,
    );

    expect(html).toContain('WTG.AI.Prompts');
    expect(html).toContain('wtg-ai-prompts');
    expect(html.indexOf('WTG.AI.Prompts')).toBeLessThan(html.indexOf('wtg-ai-prompts'));
  });
});
