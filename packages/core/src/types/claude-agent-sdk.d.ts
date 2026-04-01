declare module '@anthropic-ai/claude-agent-sdk' {
  interface ClaudeMessage {
    type: string;
    message?: unknown;
    [key: string]: unknown;
  }

  interface ClaudeQueryOptions {
    permissionMode?: string;
    allowDangerouslySkipPermissions?: boolean;
    env?: Record<string, string | undefined>;
    model?: string;
    cwd?: string;
    systemPrompt?: string;
    maxTurns?: number;
    maxBudgetUsd?: number;
    abortController?: AbortController;
    [key: string]: unknown;
  }

  interface ClaudeQueryIterable extends AsyncIterable<ClaudeMessage> {
    return(value: never): Promise<IteratorResult<ClaudeMessage>>;
  }

  export function query(params: {
    prompt: string;
    options?: ClaudeQueryOptions;
  }): ClaudeQueryIterable;
}
