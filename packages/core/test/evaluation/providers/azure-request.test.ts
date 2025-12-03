import { beforeEach, describe, expect, it, vi } from "vitest";

const createAzureMock = vi.fn((options: unknown) => {
  return (deployment: string) => ({ provider: "azure", deployment, options });
});

const generateTextMock = vi.fn(async () => ({
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

vi.mock("@ai-sdk/azure", () => ({
  createAzure: (...args: unknown[]) => createAzureMock(...args),
}));

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

const providerModule = await import("../../../src/evaluation/providers/index.js");
const { resolveTargetDefinition, createProvider } = providerModule;

describe("Azure provider request diagnostics", () => {
  const env = {
    AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
    AZURE_OPENAI_API_KEY: "key",
    AZURE_DEPLOYMENT_NAME: "gpt-4o",
  } satisfies Record<string, string>;

  beforeEach(() => {
    createAzureMock.mockClear();
    generateTextMock.mockClear();
  });

  it("exposes resolved Azure configuration", () => {
    const target = resolveTargetDefinition(
      {
        name: "azure",
        provider: "azure",
        endpoint: "${{ AZURE_OPENAI_ENDPOINT }}",
        api_key: "${{ AZURE_OPENAI_API_KEY }}",
        model: "${{ AZURE_DEPLOYMENT_NAME }}",
      },
      env,
    );

    expect(target.kind).toBe("azure");
    if (target.kind !== "azure") {
      throw new Error("expected azure target");
    }

    expect(target.config).toMatchObject({
      resourceName: "https://example.openai.azure.com",
      deploymentName: "gpt-4o",
      version: "2024-10-01-preview",
    });
  });

  it("normalizes endpoint when constructing provider", async () => {
    const resolved = resolveTargetDefinition(
      {
        name: "azure",
        provider: "azure",
        endpoint: "${{ AZURE_OPENAI_ENDPOINT }}",
        api_key: "${{ AZURE_OPENAI_API_KEY }}",
        model: "${{ AZURE_DEPLOYMENT_NAME }}",
      },
      env,
    );

    if (resolved.kind !== "azure") {
      throw new Error("expected azure target");
    }

    const provider = createProvider(resolved);
    await provider.invoke({ question: "Hello" });

    expect(createAzureMock).toHaveBeenCalledTimes(1);
    expect(createAzureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "key",
        apiVersion: "2024-10-01-preview",
        baseURL: "https://example.openai.azure.com/openai",
        useDeploymentBasedUrls: true,
      }),
    );
  });
});
