declare module '@mariozechner/pi-coding-agent' {
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
  export function createAgentSession(...args: any[]): {
    subscribe(callback: (event: any) => void): () => void;
  };
}

declare module '@mariozechner/pi-ai' {
  export function getModel(...args: any[]): unknown;
}
