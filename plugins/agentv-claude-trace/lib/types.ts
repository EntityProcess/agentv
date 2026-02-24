/** Input provided via stdin to Claude Code hooks */
export interface HookInput {
  session_id: string;
  session_dir?: string;
  cwd?: string;
  tool_name?: string; // PostToolUse
  tool_input?: unknown; // PostToolUse
  tool_output?: unknown; // PostToolUse
  tool_duration_ms?: number; // PostToolUse
  prompt?: string; // UserPromptSubmit
  stop_reason?: string; // Stop
}

export function readHookInput(): HookInput {
  // Claude Code hooks receive input via stdin as JSON
  const stdin = require('node:fs').readFileSync(0, 'utf8');
  try {
    return JSON.parse(stdin);
  } catch {
    return { session_id: 'unknown' };
  }
}
