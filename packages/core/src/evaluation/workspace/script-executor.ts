import { execFileWithStdin } from '../../runtime/exec.js';
import type { WorkspaceScriptConfig } from '../types.js';

/**
 * Context passed to workspace lifecycle scripts via stdin.
 */
export interface ScriptExecutionContext {
  readonly workspacePath: string;
  readonly testId: string;
  readonly evalRunId: string;
  readonly caseInput?: string;
  readonly caseMetadata?: Record<string, unknown>;
}

export type ScriptFailureMode = 'fatal' | 'warn';

/**
 * Executes a workspace lifecycle script (before_all, after_all, before_each, after_each).
 *
 * @param config - Workspace script configuration (script, timeout_ms, cwd)
 * @param context - Context passed to script via stdin (JSON)
 * @param failureMode - 'fatal' throws on non-zero exit; 'warn' logs warning
 * @returns Captured stdout from the script
 * @throws Error if script exits with non-zero code (fatal mode) or times out
 */
export async function executeWorkspaceScript(
  config: WorkspaceScriptConfig,
  context: ScriptExecutionContext,
  failureMode: ScriptFailureMode = 'fatal',
): Promise<string> {
  const stdin = JSON.stringify({
    workspace_path: context.workspacePath,
    test_id: context.testId,
    eval_run_id: context.evalRunId,
    case_input: context.caseInput ?? null,
    case_metadata: context.caseMetadata ?? null,
  });

  const timeoutMs = config.timeout_ms ?? (failureMode === 'fatal' ? 60000 : 30000);
  const cwd = config.cwd;

  const result = await execFileWithStdin(config.script, stdin, {
    timeoutMs,
    cwd,
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    const message = stderr ? `${stderr}` : `Process exited with code ${result.exitCode}`;
    if (failureMode === 'fatal') {
      throw new Error(`Script failed: ${message}`);
    }
    console.warn(`Script warning: ${message}`);
  }

  return result.stdout;
}
