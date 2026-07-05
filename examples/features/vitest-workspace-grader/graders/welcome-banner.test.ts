import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspacePath = process.env.AGENTV_WORKSPACE_PATH;

function readWorkspaceFile(relativePath: string) {
  if (!workspacePath) {
    throw new Error('AGENTV_WORKSPACE_PATH is required');
  }
  return readFileSync(join(workspacePath, relativePath), 'utf8');
}

const describeWithWorkspace = workspacePath ? describe : describe.skip;

describeWithWorkspace('welcome banner', () => {
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
