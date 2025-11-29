import { describe, it, expect } from "vitest";

import { resolveTargetDefinition } from "../src/evaluation/providers/targets.js";
import type { TargetDefinition } from "../src/evaluation/providers/types.js";

describe("Retry Configuration", () => {
  const mockEnv = {
    AZURE_ENDPOINT: "test-resource",
    AZURE_API_KEY: "test-key",
    AZURE_DEPLOYMENT: "test-deployment",
    ANTHROPIC_API_KEY: "test-anthropic-key",
    GEMINI_API_KEY: "test-gemini-key",
  };

  describe("resolveTargetDefinition with retry config", () => {
    it("should extract retry config with snake_case fields", () => {
      const target: TargetDefinition = {
        name: "test_azure",
        provider: "azure",
        endpoint: "${{ AZURE_ENDPOINT }}",
        api_key: "${{ AZURE_API_KEY }}",
        model: "${{ AZURE_DEPLOYMENT }}",
        max_retries: 5,
        retry_initial_delay_ms: 2000,
        retry_max_delay_ms: 120000,
        retry_backoff_factor: 2.5,
        retry_status_codes: [429, 500, 503],
      };

      const resolved = resolveTargetDefinition(target, mockEnv);

      expect(resolved.kind).toBe("azure");
      expect(resolved.config.retry).toEqual({
        maxRetries: 5,
        initialDelayMs: 2000,
        maxDelayMs: 120000,
        backoffFactor: 2.5,
        retryableStatusCodes: [429, 500, 503],
      });
    });

    it("should extract retry config with camelCase fields", () => {
      const target: TargetDefinition = {
        name: "test_azure",
        provider: "azure",
        endpoint: "${{ AZURE_ENDPOINT }}",
        api_key: "${{ AZURE_API_KEY }}",
        model: "${{ AZURE_DEPLOYMENT }}",
        maxRetries: 3,
        retryInitialDelayMs: 1000,
        retryMaxDelayMs: 60000,
        retryBackoffFactor: 2,
        retryStatusCodes: [408, 429, 502],
      };

      const resolved = resolveTargetDefinition(target, mockEnv);

      expect(resolved.kind).toBe("azure");
      expect(resolved.config.retry).toEqual({
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 60000,
        backoffFactor: 2,
        retryableStatusCodes: [408, 429, 502],
      });
    });

    it("should handle partial retry config", () => {
      const target: TargetDefinition = {
        name: "test_azure",
        provider: "azure",
        endpoint: "${{ AZURE_ENDPOINT }}",
        api_key: "${{ AZURE_API_KEY }}",
        model: "${{ AZURE_DEPLOYMENT }}",
        max_retries: 10,
        retry_backoff_factor: 3,
      };

      const resolved = resolveTargetDefinition(target, mockEnv);

      expect(resolved.kind).toBe("azure");
      expect(resolved.config.retry).toEqual({
        maxRetries: 10,
        initialDelayMs: undefined,
        maxDelayMs: undefined,
        backoffFactor: 3,
        retryableStatusCodes: undefined,
      });
    });

    it("should return undefined retry config when no retry fields are set", () => {
      const target: TargetDefinition = {
        name: "test_azure",
        provider: "azure",
        endpoint: "${{ AZURE_ENDPOINT }}",
        api_key: "${{ AZURE_API_KEY }}",
        model: "${{ AZURE_DEPLOYMENT }}",
      };

      const resolved = resolveTargetDefinition(target, mockEnv);

      expect(resolved.kind).toBe("azure");
      expect(resolved.config.retry).toBeUndefined();
    });

    it("should work with Anthropic provider", () => {
      const target: TargetDefinition = {
        name: "test_anthropic",
        provider: "anthropic",
        api_key: "${{ ANTHROPIC_API_KEY }}",
        model: "${{ ANTHROPIC_API_KEY }}", // Using as placeholder
        max_retries: 5,
        retry_initial_delay_ms: 2000,
      };

      const resolved = resolveTargetDefinition(target, mockEnv);

      expect(resolved.kind).toBe("anthropic");
      expect(resolved.config.retry).toEqual({
        maxRetries: 5,
        initialDelayMs: 2000,
        maxDelayMs: undefined,
        backoffFactor: undefined,
        retryableStatusCodes: undefined,
      });
    });

    it("should work with Gemini provider", () => {
      const target: TargetDefinition = {
        name: "test_gemini",
        provider: "gemini",
        api_key: "${{ GEMINI_API_KEY }}",
        model: "gemini-2.5-flash", // Literal model name is allowed for Gemini
        max_retries: 5,
        retry_max_delay_ms: 120000,
      };

      const resolved = resolveTargetDefinition(target, mockEnv);

      expect(resolved.kind).toBe("gemini");
      expect(resolved.config.retry).toEqual({
        maxRetries: 5,
        initialDelayMs: undefined,
        maxDelayMs: 120000,
        backoffFactor: undefined,
        retryableStatusCodes: undefined,
      });
    });

    it("should prefer snake_case over camelCase when both are present", () => {
      const target: TargetDefinition = {
        name: "test_azure",
        provider: "azure",
        endpoint: "${{ AZURE_ENDPOINT }}",
        api_key: "${{ AZURE_API_KEY }}",
        model: "${{ AZURE_DEPLOYMENT }}",
        max_retries: 5,
        maxRetries: 3, // camelCase should be ignored
        retry_initial_delay_ms: 2000,
        retryInitialDelayMs: 1000, // camelCase should be ignored
      };

      const resolved = resolveTargetDefinition(target, mockEnv);

      expect(resolved.kind).toBe("azure");
      expect(resolved.config.retry?.maxRetries).toBe(5);
      expect(resolved.config.retry?.initialDelayMs).toBe(2000);
    });

    it("should validate retry_status_codes is an array of numbers", () => {
      const target: TargetDefinition = {
        name: "test_azure",
        provider: "azure",
        endpoint: "${{ AZURE_ENDPOINT }}",
        api_key: "${{ AZURE_API_KEY }}",
        model: "${{ AZURE_DEPLOYMENT }}",
        retry_status_codes: ["429", "500"], // Invalid: strings instead of numbers
      };

      expect(() => resolveTargetDefinition(target, mockEnv)).toThrow();
    });

    it("should handle empty retry_status_codes array", () => {
      const target: TargetDefinition = {
        name: "test_azure",
        provider: "azure",
        endpoint: "${{ AZURE_ENDPOINT }}",
        api_key: "${{ AZURE_API_KEY }}",
        model: "${{ AZURE_DEPLOYMENT }}",
        max_retries: 5,
        retry_status_codes: [],
      };

      const resolved = resolveTargetDefinition(target, mockEnv);

      expect(resolved.kind).toBe("azure");
      expect(resolved.config.retry).toEqual({
        maxRetries: 5,
        initialDelayMs: undefined,
        maxDelayMs: undefined,
        backoffFactor: undefined,
        retryableStatusCodes: undefined,
      });
    });
  });
});
