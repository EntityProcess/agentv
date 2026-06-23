// The ai-sdk-agent provider loads Vercel AI SDK packages lazily only when the
// target is used. They are intentionally not normal AgentV startup
// dependencies, so keep a small type stub for dynamic imports.

declare module 'ai' {
  export function generateText(options: Record<string, unknown>): Promise<Record<string, unknown>>;
  export function stepCountIs(stepCount: number): unknown;
  export function tool<T extends Record<string, unknown>>(definition: T): T;
  export function jsonSchema(schema: unknown): unknown;
}

declare module '@ai-sdk/openai' {
  interface OpenAIProviderStub {
    (modelId: string): unknown;
    chat(modelId: string): unknown;
  }

  export function createOpenAI(options?: {
    baseURL?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    name?: string;
  }): OpenAIProviderStub;
}
