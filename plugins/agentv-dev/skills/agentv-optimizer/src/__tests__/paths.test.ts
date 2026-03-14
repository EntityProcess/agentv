import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { createAgentvCliInvocation } from "../cli";
import { resolveSkillRoot, resolveRepoRoot, resolveAgentvCommand } from "../paths";

describe("paths", () => {
  it("resolves skill root, repo root, and an agentv command without hardcoded relative cwd assumptions", () => {
    const skillRoot = resolveSkillRoot();
    const repoRoot = resolveRepoRoot();
    const agentvCmd = resolveAgentvCommand();
    
    // Validate skill root suffix
    expect(skillRoot.endsWith("plugins/agentv-dev/skills/agentv-optimizer")).toBe(true);
    
    // Validate repo root matches git's worktree root (not shared repo)
    const gitTopLevel = execSync("git rev-parse --show-toplevel", {
      cwd: skillRoot,
      encoding: "utf-8",
    }).trim();
    expect(repoRoot).toBe(gitTopLevel);
    
    // Validate agentv command is rooted under the resolved worktree
    expect(agentvCmd[0]).toBe("bun");
    expect(agentvCmd[1]).toBe(`${repoRoot}/apps/cli/src/cli.ts`);
    
    // Validate CLI helper constructs full command correctly
    const invocation = createAgentvCliInvocation(["eval", "examples/sample.eval.yaml"]);
    expect(invocation).toEqual([...agentvCmd, "eval", "examples/sample.eval.yaml"]);
  });
});
