import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn(async (_options: { messages: unknown }) => ({
  text: "ok",
  reasoningText: undefined,
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  content: [],
  reasoning: [],
  files: [],
  sources: [],
  toolCalls: [],
  staticToolCalls: [],
  dynamicToolCalls: [],
  toolResults: [],
  staticToolResults: [],
  dynamicToolResults: [],
  finishReason: "stop",
  warnings: undefined,
  providerMetadata: undefined,
}));

const azureFactory = vi.fn(() => (deployment: string) => ({ provider: "azure", deployment }));
const anthropicFactory = vi.fn(() => (model: string) => ({ provider: "anthropic", model }));
const geminiFactory = vi.fn(() => (model: string) => ({ provider: "gemini", model }));

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock("@ai-sdk/azure", () => ({
  createAzure: (...args: unknown[]) => azureFactory(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: (...args: unknown[]) => anthropicFactory(...args),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: (...args: unknown[]) => geminiFactory(...args),
}));

import { AnthropicProvider, AzureProvider, GeminiProvider } from "../../../src/evaluation/providers/ai-sdk.js";
import type { ProviderRequest } from "../../../src/evaluation/providers/types.js";

const azureConfig = {
  apiKey: "key",
  resourceName: "https://example.openai.azure.com",
  deploymentName: "deploy",
  version: "2024-10-01-preview",
};

const anthropicConfig = {
  apiKey: "key",
  model: "claude",
};

const geminiConfig = {
  apiKey: "key",
  model: "gemini-2.5-flash",
};

function buildRequest(partial: Partial<ProviderRequest>): ProviderRequest {
  return {
    question: "Q",
    guidelines: "",
    systemPrompt: "SYS",
    ...partial,
  };
}

describe.each([
  ["Azure", () => new AzureProvider("t", azureConfig)],
  ["Anthropic", () => new AnthropicProvider("t", anthropicConfig)],
  ["Gemini", () => new GeminiProvider("t", geminiConfig)],
])("Vercel AI providers (%s)", (_label, createProvider) => {
  beforeEach(() => {
    generateTextMock.mockClear();
    azureFactory.mockClear();
    anthropicFactory.mockClear();
    geminiFactory.mockClear();
  });

  it("uses provided chatPrompt when it already includes a system message", async () => {
    const provider = createProvider();
    const request = buildRequest({
      chatPrompt: [
        { role: "system", content: "System" },
        { role: "user", content: "User turn" },
      ],
      guidelines: "Ignored",
    });

    await provider.invoke(request);

    const call = generateTextMock.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages[0]).toEqual({ role: "system", content: "System" });
    expect(call.messages[1]).toEqual({ role: "user", content: "User turn" });
  });

  it("prepends system content when chatPrompt lacks system", async () => {
    const provider = createProvider();
    const request = buildRequest({
      systemPrompt: "SYS",
      guidelines: "Guides",
      chatPrompt: [
        { role: "user", content: "First" },
        { role: "assistant", content: "Second" },
      ],
    });

    await provider.invoke(request);
    const call = generateTextMock.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };

    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toContain("SYS");
    expect(call.messages[0].content).not.toContain("Guides");
    expect(call.messages[1]).toEqual({ role: "user", content: "First" });
    expect(call.messages[2]).toEqual({ role: "assistant", content: "Second" });
  });

  it("falls back to question when chatPrompt is absent", async () => {
    const provider = createProvider();
    const request = buildRequest({
      question: "What is 2+2?",
      guidelines: "Do math",
      chatPrompt: undefined,
      systemPrompt: undefined,
    });

    await provider.invoke(request);
    const call = generateTextMock.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };

    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toContain("Do math");
    expect(call.messages[1]).toEqual({ role: "user", content: "What is 2+2?" });
  });
});
