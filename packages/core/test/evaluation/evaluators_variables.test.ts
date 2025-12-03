import { describe, expect, it } from "vitest";

import { LlmJudgeEvaluator } from "../../src/evaluation/evaluators.js";
import type { ResolvedTarget } from "../../src/evaluation/providers/targets.js";
import type { Provider, ProviderRequest, ProviderResponse } from "../../src/evaluation/providers/types.js";
import type { EvalCase } from "../../src/evaluation/types.js";

class CapturingProvider implements Provider {
  readonly id = "capturing";
  readonly kind = "mock" as const;
  readonly targetName = "capturing";
  lastRequest?: ProviderRequest;

  constructor(private readonly response: ProviderResponse) {}

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

const baseTestCase: EvalCase = {
  id: "case-1",
  dataset: "test-dataset",
  question: "Original Question Text",
  input_messages: [{ role: "user", content: "User Input Message" }],
  input_segments: [{ type: "text", value: "User Input Message" }],
  output_segments: [{ type: "text", value: "Expected Output Message" }],
  reference_answer: "Reference Answer Text",
  guideline_paths: [],
  file_paths: [],
  code_snippets: [],
  expected_outcome: "Expected Outcome Text",
  evaluator: "llm_judge",
};

const baseTarget: ResolvedTarget = {
  kind: "mock",
  name: "mock",
  config: { response: "{}" },
};

describe("LlmJudgeEvaluator Variable Substitution", () => {
  it("substitutes template variables in custom prompt", async () => {
    const formattedQuestion = `@[User]: What is the status?\n\n@[Assistant]: Requesting more info.`;
    const customPrompt = `
Question: \${question}
Outcome: \${expected_outcome}
Reference: \${reference_answer}
Candidate: \${candidate_answer}
Input Messages: \${input_messages}
Output Messages: \${output_messages}
`;

    const judgeProvider = new CapturingProvider({
      text: JSON.stringify({
        score: 0.8,
        hits: ["Good"],
        misses: [],
        reasoning: "Reasoning",
      }),
    });

    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
      customPrompt,
    });

    const candidateAnswer = "Candidate Answer Text";

    await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: "llm_judge" },
      candidate: candidateAnswer,
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: formattedQuestion, guidelines: "" },
      now: new Date(),
    });

    const request = judgeProvider.lastRequest;
    expect(request).toBeDefined();

    // User prompt always uses the standard format (custom prompt goes in system prompt)
    expect(request?.question).toContain("[[ ## expected_outcome ## ]]");
    expect(request?.question).toContain(formattedQuestion);
    
    // System prompt contains the custom prompt with variables substituted + default instructions
    expect(request?.metadata?.systemPrompt).toContain(`Question: ${formattedQuestion}`);
    expect(request?.metadata?.systemPrompt).not.toContain("Original Question Text");
    expect(request?.metadata?.systemPrompt).toContain("Outcome: Expected Outcome Text");
    expect(request?.metadata?.systemPrompt).toContain("Reference: Reference Answer Text");
    expect(request?.metadata?.systemPrompt).toContain("Candidate: Candidate Answer Text");
    
    // Verify input_messages JSON stringification
    expect(request?.metadata?.systemPrompt).toContain('Input Messages: [');
    expect(request?.metadata?.systemPrompt).toContain('"value": "User Input Message"');

    // Verify output_messages JSON stringification
    expect(request?.metadata?.systemPrompt).toContain('Output Messages: [');
    expect(request?.metadata?.systemPrompt).toContain('"value": "Expected Output Message"');

    // Verify system prompt includes default instructions
    expect(request?.metadata?.systemPrompt).toContain("You are an expert evaluator");
  });

  it("does not substitute if no variables are present", async () => {
    const customPrompt = "Fixed prompt without variables";
    const promptQuestion = "Summarize the latest logs without markers.";

    const judgeProvider = new CapturingProvider({
      text: JSON.stringify({ score: 0.5, hits: [], misses: [] }),
    });

    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
      customPrompt,
    });

    await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: "llm_judge" },
      candidate: "Answer",
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: promptQuestion, guidelines: "" },
      now: new Date(),
    });

    const request = judgeProvider.lastRequest;
    
    // User prompt always uses the standard format
    expect(request?.question).toContain("[[ ## expected_outcome ## ]]");
    expect(request?.question).toContain(promptQuestion);
    
    // System prompt is custom prompt + default instructions
    expect(request?.metadata?.systemPrompt).toContain(customPrompt);
    expect(request?.metadata?.systemPrompt).toContain("You are an expert evaluator");
    expect(request?.metadata?.systemPrompt).toContain("You must respond with a single JSON object");
  });
});
