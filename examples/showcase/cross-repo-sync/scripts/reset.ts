/**
 * after_each script: removes agentevals checkout between tests.
 *
 * The before_each script re-clones for each test at the correct commit,
 * so this just needs to clean up the previous checkout.
 *
 * Reads stdin JSON with:
 *   - workspace_path: string
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';

interface StdinPayload {
  workspace_path: string;
  test_id: string;
  eval_run_id: string;
}

function main(): void {
  const input = readFileSync(0, 'utf-8');
  const payload: StdinPayload = JSON.parse(input);

  const agentevalsDir = `${payload.workspace_path}/agentevals`;

  if (existsSync(agentevalsDir)) {
    rmSync(agentevalsDir, { recursive: true, force: true });
    console.log(`Removed agentevals checkout in ${agentevalsDir}`);
  }
}

main();
