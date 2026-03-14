import { describe, expect, it } from "vitest";
import { createAgentvCliInvocation } from "../cli";
import { resolveSkillRoot, resolveRepoRoot, resolveAgentvCommand } from "../paths";

describe("paths", () => {
  it("resolves skill root, repo root, and an agentv command without hardcoded relative cwd assumptions", () => {
    expect(resolveSkillRoot().endsWith("plugins/agentv-dev/skills/agentv-optimizer")).toBe(true);
    expect(resolveRepoRoot().endsWith("/agentv")).toBe(true);
    expect(resolveAgentvCommand()[0]).toBe("bun");
    expect(resolveAgentvCommand()[1]).toContain("apps/cli/src/cli.ts");
    expect(createAgentvCliInvocation(["eval", "examples/sample.eval.yaml"]).slice(-2)).toEqual([
      "eval",
      "examples/sample.eval.yaml",
    ]);
  });
});
