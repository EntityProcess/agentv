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
  /** Directory containing the eval YAML file. Used as fallback cwd. */
  readonly evalDir?: string;
  /** Directory containing the workspace file (when workspace is a file reference).
   *  Takes priority over evalDir as default cwd so that file-referenced templates
   *  resolve relative paths from their own directory. */
  readonly workspaceFileDir?: string;
}

export type ScriptFailureMode = 'fatal' | 'warn';

/**
 * Interpolates {{variable}} placeholders in command args with values from the script context.
 * Unrecognized variables are left as-is.
 * Note: optional fields (case_input, case_metadata) coerce to empty string for arg interpolation,
 * while stdin JSON uses null — empty string is more useful as a command arg than "null".
 */
function interpolateArgs(args: readonly string[], context: ScriptExecutionContext): string[] {
  const vars: Record<string, string> = {
    workspace_path: context.workspacePath,
    test_id: context.testId,
    eval_run_id: context.evalRunId,
    case_input: context.caseInput ?? '',
    case_metadata: context.caseMetadata ? JSON.stringify(context.caseMetadata) : '',
  };

  return args.map((arg) => arg.replace(/\{\{(\w+)\}\}/g, (match, name) => vars[name] ?? match));
}

/**
 * Executes a workspace lifecycle command (before_all, after_all, before_each, after_each).
 *
 * @param config - Workspace command configuration (command, timeout_ms, cwd)
 * @param context - Context passed to command via stdin (JSON)
 * @param failureMode - 'fatal' throws on non-zero exit; 'warn' logs warning
 * @returns Captured stdout from the command
 * @throws Error if command exits with non-zero code (fatal mode) or times out
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
  const cwd = config.cwd ?? context.workspaceFileDir ?? context.evalDir;

  // Support both command (canonical) and script (deprecated alias)
  if (config.script !== undefined && config.command === undefined) {
    console.warn(
      "\u001b[33mWarning: 'script' is deprecated in workspace config. Use 'command' instead.\u001b[0m",
    );
  }
  const rawCommand = config.command ?? config.script ?? [];
  const commandArray = interpolateArgs(rawCommand, context);

  const result = await execFileWithStdin(commandArray, stdin, {
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
