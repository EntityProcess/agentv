// pi-coding-agent is an optional peerDependency (loaded lazily by
// pi-coding-agent.ts when the user explicitly opts in to pi as an agent
// target). It is not always installed, so we declare a minimal type stub
// here to keep TypeScript happy in the common path.
//
// Do NOT add a parallel `declare module '@mariozechner/pi-ai'` block —
// pi-ai is a regular dependency with proper published types, and a stub
// here would shadow them and break named imports.

declare module '@mariozechner/pi-coding-agent' {
  interface PiEvent {
    type: string;
    toolCallId: string;
    toolName: string;
    args: unknown;
    result: unknown;
    message: unknown;
    [key: string]: unknown;
  }

  export const readTool: unknown;
  export const bashTool: unknown;
  export const editTool: unknown;
  export const writeTool: unknown;
  export const grepTool: unknown;
  export const findTool: unknown;
  export const lsTool: unknown;
  export const codingTools: unknown;
  export const SessionManager: {
    inMemory(cwd: string): unknown;
  };
  export function createAgentSession(...args: unknown[]): Promise<{
    session: {
      subscribe(callback: (event: PiEvent) => void): () => void;
      prompt(prompt: string): Promise<void>;
      agent: {
        state: {
          messages: unknown[];
        };
      };
      dispose(): void;
    };
  }>;
}
