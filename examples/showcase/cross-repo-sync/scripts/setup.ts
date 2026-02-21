/**
 * before_each script: clones agentevals at the correct commit.
 *
 * Reads stdin JSON with:
 *   - workspace_path: string
 *   - case_metadata: { agentevals_before: string }
 *
 * Clones the repo, checks out the specified commit, then removes .git
 * so the workspace-level git can track file changes made by the agent.
 * Uses node:child_process execFile (no shell, safe from injection).
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface StdinPayload {
  workspace_path: string;
  test_id: string;
  eval_run_id: string;
  case_input?: string;
  case_metadata?: {
    agentevals_before: string;
    [key: string]: unknown;
  };
}

const AGENTEVALS_REPO = 'https://github.com/agentevals/agentevals.git';

async function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd,
    timeout: 60000,
  });
  if (stderr) {
    process.stderr.write(stderr);
  }
  return stdout.trim();
}

async function main(): Promise<void> {
  const input = readFileSync(0, 'utf-8');
  const payload: StdinPayload = JSON.parse(input);

  const { workspace_path, case_metadata } = payload;
  if (!case_metadata?.agentevals_before) {
    throw new Error('case_metadata must include agentevals_before commit SHA');
  }

  const offline = process.env.OFFLINE === '1';
  if (offline) {
    console.log('OFFLINE mode: skipping clone, expecting local snapshots');
    return;
  }

  const agentevalsDir = `${workspace_path}/agentevals`;
  const commit = case_metadata.agentevals_before;

  // Remove existing checkout (clean slate for each test)
  if (existsSync(agentevalsDir)) {
    rmSync(agentevalsDir, { recursive: true, force: true });
  }

  // Clone and checkout
  await run('git', ['clone', AGENTEVALS_REPO, agentevalsDir]);
  await run('git', ['checkout', commit], agentevalsDir);

  // Remove .git so workspace-level git can track file changes
  rmSync(`${agentevalsDir}/.git`, { recursive: true, force: true });

  console.log(`Cloned agentevals at ${commit} → ${agentevalsDir} (.git removed)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
