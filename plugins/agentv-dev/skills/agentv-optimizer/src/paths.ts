import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";

/**
 * Resolves the skill root directory (where this module is located)
 */
export function resolveSkillRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return resolve(__dirname, "..");
}

/**
 * Resolves the repository root by using git and following worktree links
 */
export function resolveRepoRoot(): string {
  try {
    const skillRoot = resolveSkillRoot();
    // For git worktrees, get the actual common dir
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: skillRoot,
      encoding: "utf-8",
    }).trim();
    // The common dir is typically .git, so we go one level up
    return resolve(gitCommonDir, "..");
  } catch {
    // Fallback to traversing up from the skill root
    const skillRoot = resolveSkillRoot();
    return resolve(skillRoot, "../../../../..");
  }
}

/**
 * Returns the command array to invoke agentv CLI
 */
export function resolveAgentvCommand(): string[] {
  const repoRoot = resolveRepoRoot();
  return ["bun", `${repoRoot}/apps/cli/src/cli.ts`];
}
