import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readWorkspaceFile(relativePath: string) {
  return readFileSync(
    join(process.env.AGENTV_WORKSPACE_PATH ?? process.cwd(), relativePath),
    'utf8',
  );
}

describe('welcome banner', () => {
  const page = () => readWorkspaceFile('app/page.tsx');

  it('shows ready status text', () => {
    expect(page()).toContain('Status: All systems ready');
  });

  it('shows the dashboard call to action', () => {
    expect(page()).toContain('Open dashboard');
  });

  it('links the call to action to /dashboard', () => {
    expect(page()).toMatch(/href=["']\/dashboard["']/);
  });

  it('does not leave TODO markers behind', () => {
    expect(page()).not.toMatch(/TODO/i);
  });
});
