import { execFileWithStdin } from '../../runtime/exec.js';
import type { WorkspaceScriptConfig } from '../types.js';

/**
 * Context passed to setup/teardown scripts via stdin.
 */
export interface ScriptExecutionContext {
  readonly workspacePath: string;
  readonly testId: string;
  /** @deprecated Use `testId` instead */
  readonly evalCaseId?: string;
  readonly evalRunId: string;
  readonly caseInput?: string;
  readonly caseMetadata?: Record<string, unknown>;
}

/**
 * Executes a workspace setup script.
 * Setup script failure aborts the eval case.
 *
 * @param config - Workspace script configuration (script, timeout_ms, cwd)
 * @param context - Context passed to script via stdin (JSON)
 * @returns Captured stdout from the script
 * @throws Error if script exits with non-zero code or times out
 */
export async function executeWorkspaceSetup(
  config: WorkspaceScriptConfig,
  context: ScriptExecutionContext,
): Promise<string> {
  const stdin = JSON.stringify({
    workspace_path: context.workspacePath,
    eval_case_id: context.testId,
    eval_run_id: context.evalRunId,
    case_input: context.caseInput ?? null,
    case_metadata: context.caseMetadata ?? null,
  });

  const timeoutMs = config.timeout_ms ?? 60000; // Default 60s for setup
  const cwd = config.cwd; // Optional cwd for script execution

  const result = await execFileWithStdin(config.script, stdin, {
    timeoutMs,
    cwd,
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    const message = stderr ? `${stderr}` : `Process exited with code ${result.exitCode}`;
    throw new Error(`Setup script failed: ${message}`);
  }

  return result.stdout;
}

/**
 * Executes a workspace teardown script.
 * Teardown script failure only logs a warning but doesn't fail the eval.
 *
 * @param config - Workspace script configuration (script, timeout_ms, cwd)
 * @param context - Context passed to script via stdin (JSON)
 * @returns Captured stdout from the script
 * @throws Error if script times out (other exit codes are ignored)
 */
export async function executeWorkspaceTeardown(
  config: WorkspaceScriptConfig,
  context: ScriptExecutionContext,
): Promise<string> {
  const stdin = JSON.stringify({
    workspace_path: context.workspacePath,
    eval_case_id: context.testId,
    eval_run_id: context.evalRunId,
    case_input: context.caseInput ?? null,
    case_metadata: context.caseMetadata ?? null,
  });

  const timeoutMs = config.timeout_ms ?? 30000; // Default 30s for teardown
  const cwd = config.cwd; // Optional cwd for script execution

  const result = await execFileWithStdin(config.script, stdin, {
    timeoutMs,
    cwd,
  });

  // For teardown, non-zero exit codes are warnings only, not failures
  // But timeouts are still errors
  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    const message = stderr ? `${stderr}` : `Process exited with code ${result.exitCode}`;
    console.warn(`Teardown script warning: ${message}`);
  }

  return result.stdout;
}
