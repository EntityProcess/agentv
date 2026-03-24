declare module '@mariozechner/pi-coding-agent' {
  interface PiEvent {
    type: string;
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
    };
  }>;
}

declare module '@mariozechner/pi-ai' {
  export function getModel(...args: unknown[]): unknown;
}
