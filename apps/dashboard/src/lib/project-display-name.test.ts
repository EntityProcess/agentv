import { describe, expect, it } from 'bun:test';

import { resolveProjectDisplayName } from './project-display-name';

describe('resolveProjectDisplayName', () => {
  it('uses the registry name for project-scoped dashboard chrome', () => {
    expect(
      resolveProjectDisplayName('wtg-ai-prompts', [
        {
          id: 'wtg-ai-prompts',
          name: 'WTG.AI.Prompts',
        },
      ]),
    ).toBe('WTG.AI.Prompts');
  });

  it('falls back to the URL-safe ID when the registry name is unavailable', () => {
    expect(resolveProjectDisplayName('wtg-ai-prompts', [])).toBe('wtg-ai-prompts');
    expect(
      resolveProjectDisplayName('wtg-ai-prompts', [{ id: 'wtg-ai-prompts', name: '  ' }]),
    ).toBe('wtg-ai-prompts');
  });
});
