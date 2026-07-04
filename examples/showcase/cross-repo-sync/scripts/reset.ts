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
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface StdinPayload {
  workspace_path: string;
  test_id: string;
  eval_run_id: string;
}

export function afterEach(context: StdinPayload): void {
  const agentevalsDir = `${context.workspace_path}/agentevals`;

  if (existsSync(agentevalsDir)) {
    rmSync(agentevalsDir, { recursive: true, force: true });
    console.log(`Removed agentevals checkout in ${agentevalsDir}`);
  }
}

function main(): void {
  const input = readFileSync(0, 'utf-8');
  afterEach(JSON.parse(input));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
