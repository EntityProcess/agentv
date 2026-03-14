import { describe, expect, it } from "vitest";
import { buildRunEvalCommand, buildPromptEvalCommand, buildConvertCommand, buildCompareCommand } from "../command-runner";

describe("command runner", () => {
  it("builds an agentv eval command without embedding provider-specific logic", () => {
    expect(buildRunEvalCommand({
      evalPath: "evals.json",
      target: "copilot-haiku",
      artifactsDir: ".agentv/artifacts"
    })).toEqual([
      "bun",
      expect.stringContaining("apps/cli/src/cli.ts"),
      "eval",
      "evals.json",
      "--target",
      "copilot-haiku",
      "--artifacts",
      ".agentv/artifacts",
    ]);
  });

  it("builds prompt, convert, and compare commands as thin wrappers", () => {
    expect(buildPromptEvalCommand(["overview", "evals.json"])).toContain("prompt");
    expect(buildPromptEvalCommand(["input", "evals.json", "--test-id", "1"])).toContain("input");
    expect(buildPromptEvalCommand(["judge", "evals.json", "--test-id", "1"])).toContain("judge");
    expect(buildConvertCommand(["evals.json", "-o", "eval.yaml"])).toContain("convert");
    expect(buildCompareCommand(["before.jsonl", "after.jsonl"])).toContain("compare");
  });
});
