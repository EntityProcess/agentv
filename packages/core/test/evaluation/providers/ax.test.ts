import { describe, expect, it, vi } from "vitest";

vi.mock("@ax-llm/ax", () => {
  const chat = vi.fn(async (request: { chatPrompt: unknown }) => ({
    results: [{ content: "ok" }],
    modelUsage: { tokens: 1, promptTokens: 1, completionTokens: 0, messages: request.chatPrompt },
  }));

  return {
    AxAI: {
      create: vi.fn(() => ({
        chat,
      })),
    },
  };
});

import { AzureProvider } from "../../../src/evaluation/providers/ax.js";
import type { ProviderRequest } from "../../../src/evaluation/providers/types.js";

const baseConfig = {
  apiKey: "key",
  resourceName: "res",
  deploymentName: "deploy",
  version: "2024-06-01-preview",
};

function buildRequest(partial: Partial<ProviderRequest>): ProviderRequest {
  return {
    question: "Q",
    guidelines: "",
    metadata: { systemPrompt: "SYS" },
    ...partial,
  };
}

describe("Ax providers buildChatPrompt", () => {
  it("uses provided chatPrompt when it already includes a system message", async () => {
    const provider = new AzureProvider("t", baseConfig);
    const request = buildRequest({
      chatPrompt: [
        { role: "system", content: "System" },
        { role: "user", content: "User turn" },
      ],
    });

    const response = await provider.invoke(request);

    expect(response.text).toBe("ok");
    const sent = (response.raw as { results: unknown; modelUsage: { messages: unknown } }).modelUsage.messages as {
      role: string;
      content: string;
    }[];
    expect(sent[0].role).toBe("system");
    expect(sent[1].content).toBe("User turn");
  });

  it("prepends system content when chatPrompt lacks system", async () => {
    const provider = new AzureProvider("t", baseConfig);
    const request = buildRequest({
      guidelines: "Guides",
      chatPrompt: [
        { role: "user", content: "First" },
        { role: "assistant", content: "Second" },
      ],
    });

    const response = await provider.invoke(request);
    const sent = (response.raw as { results: unknown; modelUsage: { messages: unknown } }).modelUsage.messages as {
      role: string;
      content: string;
    }[];

    expect(sent[0].role).toBe("system");
    expect(sent[0].content).toContain("SYS");
    expect(sent[0].content).toContain("Guides");
    expect(sent[1]).toEqual({ role: "user", content: "First" });
    expect(sent[2]).toEqual({ role: "assistant", content: "Second" });
  });

  it("falls back to question when chatPrompt is absent", async () => {
    const provider = new AzureProvider("t", baseConfig);
    const request = buildRequest({
      question: "What is 2+2?",
      guidelines: "Do math",
      chatPrompt: undefined,
    });

    const response = await provider.invoke(request);
    const sent = (response.raw as { results: unknown; modelUsage: { messages: unknown } }).modelUsage.messages as {
      role: string;
      content: string;
    }[];

    expect(sent[0].role).toBe("system");
    expect(sent[0].content).toContain("Do math");
    expect(sent[1]).toEqual({ role: "user", content: "What is 2+2?" });
  });
});
