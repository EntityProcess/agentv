import { describe, expect, it, vi } from "vitest";
import { runEvalCase } from "../../../src/evaluation/orchestrator.js";
import { CodexProvider } from "../../../src/evaluation/providers/codex.js";
import type { Provider, ProviderRequest } from "../../../src/evaluation/providers/types.js";
import { LlmJudgeEvaluator } from "../../../src/evaluation/evaluators.js";
import type { EvalCase } from "../../../src/evaluation/types.js";

describe("CodexProvider integration with orchestrator", () => {
  it("receives file references (not embedded content) from orchestrator", async () => {
    let capturedRequest: ProviderRequest | undefined;

    // Mock Codex provider that captures the request
    class MockCodexProvider implements Provider {
      readonly id = "codex:test";
      readonly kind = "codex" as const;
      readonly targetName = "test";
      readonly supportsBatch = false;

      async invoke(request: ProviderRequest) {
        capturedRequest = request;
        return { text: "Test response" };
      }
    }

    const provider = new MockCodexProvider();
    
    const mockJudge: Provider = {
      id: "mock-judge",
      kind: "mock",
      targetName: "mock",
      supportsBatch: false,
      async invoke() {
        return { text: "PASS" };
      },
    };

    const evaluators = {
      llm_judge: new LlmJudgeEvaluator({
        resolveJudgeProvider: async () => mockJudge,
      }),
    };

    const evalCase: EvalCase = {
      id: "test-codex-file-refs",
      dataset: "test",
      question: "placeholder",
      input_messages: [
        {
          role: "user",
          content: [
            { type: "file", value: "src/main.ts" },
            { type: "text", value: "Review this code" },
          ],
        },
      ],
      input_segments: [
        { type: "file", path: "src/main.ts", text: "export const main = () => { console.log('hello'); }" },
        { type: "text", value: "Review this code" },
      ],
      output_segments: [],
      reference_answer: "",
      guideline_paths: [],
      file_paths: ["src/main.ts"],
      code_snippets: [],
      expected_outcome: "PASS",
      evaluator: "llm_judge",
    };

    await runEvalCase({
      evalCase,
      provider,
      target: {
        name: "codex-test",
        kind: "codex",
        config: { executable: "echo" },
      },
      evaluators,
      judgeProvider: mockJudge,
    });

    // Verify the request was captured
    expect(capturedRequest).toBeDefined();
    
    // The key assertion: question should contain file reference, not content
    expect(capturedRequest!.question).toContain("<Attached: src/main.ts>");
    expect(capturedRequest!.question).not.toContain("export const main");
    expect(capturedRequest!.question).not.toContain("console.log('hello')");
    expect(capturedRequest!.question).toContain("Review this code");
  });

  it("receives guideline file references in question", async () => {
    let capturedRequest: ProviderRequest | undefined;

    class MockCodexProvider implements Provider {
      readonly id = "codex:test";
      readonly kind = "codex" as const;
      readonly targetName = "test";
      readonly supportsBatch = false;

      async invoke(request: ProviderRequest) {
        capturedRequest = request;
        return { text: "Test response" };
      }
    }

    const provider = new MockCodexProvider();
    
    const mockJudge: Provider = {
      id: "mock-judge",
      kind: "mock",
      targetName: "mock",
      supportsBatch: false,
      async invoke() {
        return { text: "PASS" };
      },
    };

    const evaluators = {
      llm_judge: new LlmJudgeEvaluator({
        resolveJudgeProvider: async () => mockJudge,
      }),
    };

    const evalCase: EvalCase = {
      id: "test-codex-guideline-refs",
      dataset: "test",
      question: "placeholder",
      input_messages: [
        {
          role: "user",
          content: [
            { type: "file", value: "guide.instructions.md" },
            { type: "file", value: "src/code.ts" },
            { type: "text", value: "Follow the guidelines" },
          ],
        },
      ],
      input_segments: [
        { type: "file", path: "guide.instructions.md", text: "Guideline content here" },
        { type: "file", path: "src/code.ts", text: "const x = 1;" },
        { type: "text", value: "Follow the guidelines" },
      ],
      output_segments: [],
      reference_answer: "",
      guideline_paths: [],
      guideline_patterns: ["**/*.instructions.md"],
      file_paths: ["guide.instructions.md", "src/code.ts"],
      code_snippets: [],
      expected_outcome: "PASS",
      evaluator: "llm_judge",
    };

    await runEvalCase({
      evalCase,
      provider,
      target: {
        name: "codex-test",
        kind: "codex",
        config: { executable: "echo" },
      },
      evaluators,
      judgeProvider: mockJudge,
    });

    expect(capturedRequest).toBeDefined();
    
    // Both guideline and code files should be file references
    expect(capturedRequest!.question).toContain("<Attached: guide.instructions.md>");
    expect(capturedRequest!.question).toContain("<Attached: src/code.ts>");
    
    // Content should not be embedded
    expect(capturedRequest!.question).not.toContain("Guideline content here");
    expect(capturedRequest!.question).not.toContain("const x = 1");
    
    expect(capturedRequest!.question).toContain("Follow the guidelines");
  });
});
