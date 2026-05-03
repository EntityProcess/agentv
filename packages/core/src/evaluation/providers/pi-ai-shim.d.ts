// Augments '@mariozechner/pi-ai' types with the subset we use.
// Pi-ai's published d.ts has cross-module re-exports (`export * from`,
// `export { X } from`) that TypeScript's NodeNext resolution does not surface
// at the top-level — only direct primary declarations make it through (e.g.
// `getModel` from models.d.ts is fine; `complete` from stream.d.ts isn't).
// This shim re-declares the surface we depend on so our code can use plain
// static imports and real types instead of dynamic-import + any casts.
//
// Keep this minimal: only what we actively call. Mirror the upstream shape
// from node_modules/.bun/@mariozechner+pi-ai@*/dist/*.d.ts.

declare module '@mariozechner/pi-ai' {
  // ---- types/types.d.ts ----
  export type Api = string;
  export type KnownProvider = string;
  export type Provider = string;
  export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

  export interface TextContent {
    type: 'text';
    text: string;
  }
  export interface ThinkingContent {
    type: 'thinking';
    thinking: string;
  }
  export interface ImageContent {
    type: 'image';
    /** Base64 data, data URL, or absolute URL. */
    data: string;
    /** MIME type, e.g. "image/png". */
    mimeType: string;
  }
  export interface ToolCall {
    type: 'toolCall';
    id: string;
    name: string;
    arguments: unknown;
    thoughtSignature?: string;
  }

  export interface Usage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  }

  export interface UserMessage {
    role: 'user';
    content: string | Array<TextContent | ImageContent>;
    timestamp: number;
  }
  export interface AssistantMessage {
    role: 'assistant';
    content: Array<TextContent | ThinkingContent | ToolCall>;
    api: Api;
    provider: Provider;
    model: string;
    usage: Usage;
    stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
    timestamp: number;
  }
  export interface ToolResultMessage {
    role: 'toolResult';
    toolCallId: string;
    toolName: string;
    content: Array<TextContent | ImageContent>;
    isError: boolean;
    timestamp: number;
  }
  export type Message = UserMessage | AssistantMessage | ToolResultMessage;

  export interface Model {
    id: string;
    name: string;
    api: Api;
    provider: Provider;
    baseUrl: string;
    reasoning: boolean;
    input: ReadonlyArray<'text' | 'image'>;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
  }

  /**
   * Pi-ai's Tool wraps a TypeBox schema; we send JSON Schema directly via the
   * adapter, so the relaxed `parameters: object` here lets us pass plain
   * JSON-Schema objects without round-tripping through TypeBox builders. Pi-ai
   * forwards `parameters` to the provider's wire format unchanged (it
   * stringifies it for OpenAI completions, etc.) so this is safe at runtime.
   */
  export interface Tool {
    name: string;
    description: string;
    parameters: object;
  }

  export interface Context {
    systemPrompt?: string;
    messages: Message[];
    tools?: Tool[];
  }

  export interface StreamOptions {
    temperature?: number;
    maxTokens?: number;
    apiKey?: string;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  }

  // ---- stream.d.ts ----
  export function complete(
    model: Model,
    context: Context,
    options?: StreamOptions,
  ): Promise<AssistantMessage>;

  // ---- providers/register-builtins.d.ts ----
  export function registerBuiltInApiProviders(): void;
}
