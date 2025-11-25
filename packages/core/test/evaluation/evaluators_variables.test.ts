import { describe, expect, it } from "vitest";

import { LlmJudgeEvaluator } from "../../src/evaluation/evaluators.js";
import type { ResolvedTarget } from "../../src/evaluation/providers/targets.js";
import type { Provider, ProviderRequest, ProviderResponse } from "../../src/evaluation/providers/types.js";
import type { EvalCase, JsonObject } from "../../src/evaluation/types.js";

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
  input_segments: [{ type: "text", value: "User Input Message" }],
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
    const customPrompt = `
Question: \${question}
Outcome: \${outcome}
Reference: \${referenceAnswer}
Candidate: \${candidateAnswer}
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
      promptInputs: { question: "", guidelines: "" },
      now: new Date(),
    });

    const request = judgeProvider.lastRequest;
    expect(request).toBeDefined();

    // Verify substitutions
    expect(request?.question).toContain("Question: Original Question Text");
    expect(request?.question).toContain("Outcome: Expected Outcome Text");
    expect(request?.question).toContain("Reference: Reference Answer Text");
    expect(request?.question).toContain("Candidate: Candidate Answer Text");
    
    // Verify input_messages JSON stringification
    expect(request?.question).toContain('Input Messages: [');
    expect(request?.question).toContain('"value": "User Input Message"');

    // Verify output_messages (same as candidateAnswer for now)
    expect(request?.question).toContain("Output Messages: Candidate Answer Text");

    // Verify system prompt is reset to default when variables are used
    // The implementation sets systemPrompt = QUALITY_SYSTEM_PROMPT when variables are substituted
    // and passes it in metadata
    expect(request?.metadata?.systemPrompt).toContain("You are an expert evaluator");
  });

  it("does not substitute if no variables are present", async () => {
    const customPrompt = "Fixed prompt without variables";

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
      promptInputs: { question: "", guidelines: "" },
      now: new Date(),
    });

    const request = judgeProvider.lastRequest;
    
    // Should use the standard buildQualityPrompt logic which appends context
    // But wait, if customPrompt is provided, it overrides the systemPrompt in the implementation?
    // Let's check the implementation logic again.
    // evaluateWithPrompt:
    // let prompt = buildQualityPrompt(...)
    // let systemPrompt = context.systemPrompt ?? this.customPrompt ?? QUALITY_SYSTEM_PROMPT
    // if (systemPrompt && hasTemplateVariables(systemPrompt)) { ... }
    
    // If NO variables:
    // prompt is the standard built prompt (with [[ ## expected_outcome ## ]] etc)
    // systemPrompt is the customPrompt
    
    expect(request?.question).toContain("[[ ## expected_outcome ## ]]");
    expect(request?.metadata?.systemPrompt).toBe(customPrompt);
  });
});
