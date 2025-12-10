import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LlmJudgeEvaluator } from "../../src/evaluation/evaluators.js";
import { runEvalCase, type EvaluationCache } from "../../src/evaluation/orchestrator.js";
import type { ResolvedTarget } from "../../src/evaluation/providers/targets.js";
import type { Provider, ProviderRequest, ProviderResponse } from "../../src/evaluation/providers/types.js";
import type { EvalCase } from "../../src/evaluation/types.js";

class SequenceProvider implements Provider {
  readonly id: string;
  readonly kind = "mock" as const;
  readonly targetName: string;

  private readonly sequence: Array<() => ProviderResponse>;
  private readonly errors: Array<() => Error>;
  callIndex = 0;

  constructor(targetName: string, options: { responses?: ProviderResponse[]; errors?: Error[] }) {
    this.id = `mock:${targetName}`;
    this.targetName = targetName;
    this.sequence = (options.responses ?? []).map((response) => () => response);
    this.errors = (options.errors ?? []).map((error) => () => error);
  }

  async invoke(): Promise<ProviderResponse> {
    if (this.callIndex < this.errors.length) {
      const errorFactory = this.errors[this.callIndex];
      this.callIndex += 1;
      throw errorFactory();
    }
    if (this.callIndex - this.errors.length < this.sequence.length) {
      const responseFactory = this.sequence[this.callIndex - this.errors.length];
      this.callIndex += 1;
      return responseFactory();
    }
    throw new Error("No more responses configured");
  }
}

class CapturingJudgeProvider implements Provider {
  readonly id: string;
  readonly kind = "mock" as const;
  readonly targetName: string;
  lastRequest?: ProviderRequest;

  constructor(targetName: string, private readonly response: ProviderResponse) {
    this.id = `judge:${targetName}`;
    this.targetName = targetName;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

class CapturingProvider implements Provider {
  readonly id: string;
  readonly kind = "mock" as const;
  readonly targetName: string;
  lastRequest?: ProviderRequest;

  constructor(targetName: string, private readonly response: ProviderResponse) {
    this.id = `cap:${targetName}`;
    this.targetName = targetName;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

const baseTestCase: EvalCase = {
  id: "case-1",
  dataset: "test-dataset",
  question: "Explain logging improvements",
  input_messages: [{ role: "user", content: "Explain logging improvements" }],
  input_segments: [{ type: "text", value: "Explain logging improvements" }],
  output_segments: [],
  reference_answer: "- add structured logging\n- avoid global state",
  guideline_paths: [],
  file_paths: [],
  code_snippets: [],
  expected_outcome: "Logging improved",
  evaluator: "llm_judge",
};

const baseTarget: ResolvedTarget = {
  kind: "mock",
  name: "mock",
  config: { response: "{}" },
};

const evaluatorRegistry = {
  llm_judge: {
    kind: "llm_judge",
    async evaluate() {
      return {
        score: 0.8,
        hits: ["hit"],
        misses: [],
        expectedAspectCount: 1,
      };
    },
  },
};

describe("runTestCase", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces evaluation result using default grader", async () => {
    const provider = new SequenceProvider("mock", {
      responses: [{ text: "You should add structured logging and avoid global state." }],
    });

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      now: () => new Date("2024-01-01T00:00:00Z"),
    });

    expect(result.score).toBeGreaterThan(0);
    expect(result.hits).toHaveLength(1);
    expect(result.misses).toHaveLength(0);
    expect(result.timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  it("reuses cached provider response when available", async () => {
    const provider = new SequenceProvider("mock", {
      responses: [{ text: "Use structured logging." }],
    });

    const cache: EvaluationCache = {
      store: new Map<string, ProviderResponse>(),
      async get(key: string) {
        return (this as unknown as { store: Map<string, ProviderResponse> }).store.get(key);
      },
      async set(key: string, value: ProviderResponse) {
        (this as unknown as { store: Map<string, ProviderResponse> }).store.set(key, value);
      },
    } as EvaluationCache & { store: Map<string, ProviderResponse> };

    const first = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      cache,
      useCache: true,
    });

    expect(first.candidate_answer).toContain("structured logging");

    const second = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      cache,
      useCache: true,
    });

    expect(second.candidate_answer).toContain("structured logging");
    expect(provider["callIndex"]).toBe(1);
  });

  it("retries timeout errors up to maxRetries", async () => {
    const provider = new SequenceProvider("mock", {
      errors: [new Error("Request timeout")],
      responses: [{ text: "Add structured logging." }],
    });

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      maxRetries: 1,
    });

    expect(result.score).toBeGreaterThan(0);
  });

  it("returns error result on unrecoverable failure", async () => {
    const provider = new SequenceProvider("mock", {
      errors: [new Error("Provider failure")],
    });

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(0);
    expect(result.misses[0]).toContain("Provider failure");
  });

  it("dumps prompt payloads when directory provided", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "agentv-prompts-"));
    const provider = new SequenceProvider("mock", {
      responses: [{ text: "Add structured logging." }],
    });

    await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      promptDumpDir: directory,
    });

    const files = readdirSync(directory);
    expect(files.length).toBeGreaterThan(0);

    const payload = JSON.parse(readFileSync(path.join(directory, files[0]), "utf8")) as {
      question: string;
      guideline_paths: unknown;
    };
    expect(payload.question).toContain("Explain logging improvements");
    expect(Array.isArray(payload.guideline_paths)).toBe(true);
  });

  it("uses a custom evaluator prompt when provided", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "agentv-custom-judge-"));
    const promptPath = path.join(directory, "judge.md");
    writeFileSync(promptPath, "CUSTOM PROMPT CONTENT with {{ candidate_answer }}", "utf8");

    const provider = new SequenceProvider("mock", {
      responses: [{ text: "Answer text" }],
    });

    const judgeProvider = new CapturingJudgeProvider("judge", {
      text: JSON.stringify({
        score: 0.9,
        hits: ["used prompt"],
        misses: [],
      }),
      reasoning: "ok",
    });

    const evaluatorRegistry = {
      llm_judge: new LlmJudgeEvaluator({
        resolveJudgeProvider: async () => judgeProvider,
      }),
    };

    const result = await runEvalCase({
      evalCase: {
        ...baseTestCase,
        evaluators: [{ name: "semantic", type: "llm_judge", promptPath }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      now: () => new Date("2024-01-01T00:00:00Z"),
    });

    // Custom template goes in user prompt, system prompt only has output schema
    expect(judgeProvider.lastRequest?.question).toContain("CUSTOM PROMPT CONTENT");
    expect(judgeProvider.lastRequest?.systemPrompt).toContain("You must respond with a single JSON object");
    expect(judgeProvider.lastRequest?.systemPrompt).not.toContain("CUSTOM PROMPT CONTENT");
    
    expect(result.evaluator_results?.[0]?.evaluator_provider_request?.userPrompt).toContain("CUSTOM PROMPT CONTENT");
    expect(result.evaluator_results?.[0]?.evaluator_provider_request?.systemPrompt).toContain("You must respond with a single JSON object");
    expect(result.evaluator_results?.[0]?.evaluator_provider_request?.systemPrompt).not.toContain("CUSTOM PROMPT CONTENT");
  });

  it("passes chatPrompt for multi-turn evals", async () => {
    const provider = new CapturingProvider("mock", { text: "Candidate" });

    const result = await runEvalCase({
      evalCase: {
        id: "multi",
        dataset: "ds",
        question: "",
        input_messages: [
          { role: "system", content: "Guide" },
          { role: "user", content: [{ type: "file", value: "snippet.txt" }, { type: "text", value: "Review" }] },
          { role: "assistant", content: "Ack" },
        ],
        input_segments: [
          { type: "text", value: "Guide" },
          { type: "file", path: "snippet.txt", text: "code()" },
          { type: "text", value: "Review" },
          { type: "text", value: "Ack" },
        ],
        output_segments: [],
        reference_answer: "",
        guideline_paths: [],
        file_paths: [],
        code_snippets: [],
        expected_outcome: "",
        evaluator: "llm_judge",
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    const chatPrompt = provider.lastRequest?.chatPrompt;
    expect(chatPrompt).toBeDefined();
    if (!chatPrompt) throw new Error("chatPrompt is undefined");
    expect(chatPrompt[0].role).toBe("system");
    expect(chatPrompt[1]).toEqual({ role: "user", content: "<file path=\"snippet.txt\">\ncode()\n</file>\nReview" });
    expect(chatPrompt[2]).toEqual({ role: "assistant", content: "Ack" });
    expect(result.lm_provider_request?.chat_prompt).toBeDefined();
  });

  it("omits chatPrompt for single-turn evals", async () => {
    const provider = new CapturingProvider("mock", { text: "Candidate" });

    await runEvalCase({
      evalCase: {
        id: "single",
        dataset: "ds",
        question: "",
        input_messages: [{ role: "user", content: "Hello" }],
        input_segments: [{ type: "text", value: "Hello" }],
        output_segments: [],
        reference_answer: "",
        guideline_paths: [],
        file_paths: [],
        code_snippets: [],
        expected_outcome: "",
        evaluator: "llm_judge",
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(provider.lastRequest?.chatPrompt).toBeUndefined();
    expect(provider.lastRequest?.question.trim()).toBe("Hello");
  });

  it("populates agent_provider_request for agent providers", async () => {
    class AgentProvider implements Provider {
      readonly id = "agent";
      readonly kind = "codex"; // Agent provider kind
      readonly targetName = "agent";
      async invoke() { return { text: "ok" }; }
    }
    
    const provider = new AgentProvider();
    
    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: { 
        ...baseTarget, 
        kind: "codex",
        config: { executable: "echo" }
      },
      evaluators: evaluatorRegistry,
    });

    expect(result.agent_provider_request).toBeDefined();
    expect(result.lm_provider_request).toBeUndefined();
    expect(result.agent_provider_request?.question).toBe("Explain logging improvements");
  });

  describe("custom prompt validation", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let consoleWarnSpy: any;

    afterEach(() => {
      consoleWarnSpy?.mockRestore();
    });

    it("warns when custom prompt file is missing required fields", async () => {
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const directory = mkdtempSync(path.join(tmpdir(), "agentv-validation-"));
      const promptPath = path.join(directory, "minimal.md");
      writeFileSync(promptPath, "{{ question }}", "utf8");

      const provider = new SequenceProvider("mock", {
        responses: [{ text: "Answer" }],
      });

      const judgeProvider = new CapturingJudgeProvider("judge", {
        text: JSON.stringify({ score: 0.5, hits: [], misses: [] }),
      });

      const evaluatorRegistry = {
        llm_judge: new LlmJudgeEvaluator({
          resolveJudgeProvider: async () => judgeProvider,
        }),
      };

      await runEvalCase({
        evalCase: {
          ...baseTestCase,
          evaluators: [{ name: "minimal", type: "llm_judge", promptPath }],
        },
        provider,
        target: baseTarget,
        evaluators: evaluatorRegistry,
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Custom evaluator template at"),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("missing required fields"),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("candidate_answer"),
      );
    });

    it("does not warn when candidate_answer is present", async () => {
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const directory = mkdtempSync(path.join(tmpdir(), "agentv-validation-"));
      const promptPath = path.join(directory, "has-candidate.md");
      writeFileSync(
        promptPath,
        "This template has {{ question }} and {{ candidate_answer }} to evaluate.",
        "utf8",
      );

      const provider = new SequenceProvider("mock", {
        responses: [{ text: "Answer" }],
      });

      const judgeProvider = new CapturingJudgeProvider("judge", {
        text: JSON.stringify({ score: 0.5, hits: [], misses: [] }),
      });

      const evaluatorRegistry = {
        llm_judge: new LlmJudgeEvaluator({
          resolveJudgeProvider: async () => judgeProvider,
        }),
      };

      await runEvalCase({
        evalCase: {
          ...baseTestCase,
          evaluators: [{ name: "has-candidate", type: "llm_judge", promptPath }],
        },
        provider,
        target: baseTarget,
        evaluators: evaluatorRegistry,
      });

      // Should not have validation warnings
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("does not warn when expected_messages is present", async () => {
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const directory = mkdtempSync(path.join(tmpdir(), "agentv-validation-"));
      const promptPath = path.join(directory, "has-expected.md");
      writeFileSync(
        promptPath,
        "Compare {{ question }} with {{ expected_messages }} for validation.",
        "utf8",
      );

      const provider = new SequenceProvider("mock", {
        responses: [{ text: "Answer" }],
      });

      const judgeProvider = new CapturingJudgeProvider("judge", {
        text: JSON.stringify({ score: 0.9, hits: [], misses: [] }),
      });

      const evaluatorRegistry = {
        llm_judge: new LlmJudgeEvaluator({
          resolveJudgeProvider: async () => judgeProvider,
        }),
      };

      await runEvalCase({
        evalCase: {
          ...baseTestCase,
          evaluators: [{ name: "has-expected", type: "llm_judge", promptPath }],
        },
        provider,
        target: baseTarget,
        evaluators: evaluatorRegistry,
      });

      // Should not have validation warnings
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("warns when template contains invalid variables", async () => {
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const directory = mkdtempSync(path.join(tmpdir(), "agentv-validation-"));
      const promptPath = path.join(directory, "invalid-vars.md");
      writeFileSync(
        promptPath,
        "Evaluate {{ candiate_answer }} for {{ questoin }} with {{ invalid_var }}",
        "utf8",
      );

      const provider = new SequenceProvider("mock", {
        responses: [{ text: "Answer" }],
      });

      const judgeProvider = new CapturingJudgeProvider("judge", {
        text: JSON.stringify({ score: 0.5, hits: [], misses: [] }),
      });

      const evaluatorRegistry = {
        llm_judge: new LlmJudgeEvaluator({
          resolveJudgeProvider: async () => judgeProvider,
        }),
      };

      await runEvalCase({
        evalCase: {
          ...baseTestCase,
          evaluators: [{ name: "invalid-vars", type: "llm_judge", promptPath }],
        },
        provider,
        target: baseTarget,
        evaluators: evaluatorRegistry,
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("contains invalid variables"),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("candiate_answer"),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("questoin"),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("invalid_var"),
      );
    });
  });
});
