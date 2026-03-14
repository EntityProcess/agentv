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
 * Resolves the repository root of the current working tree
 */
export function resolveRepoRoot(): string {
  const skillRoot = resolveSkillRoot();
  // Use --show-toplevel to get the current worktree root, not the shared repo
  const topLevel = execSync("git rev-parse --show-toplevel", {
    cwd: skillRoot,
    encoding: "utf-8",
  }).trim();
  return topLevel;
}

/**
 * Returns the command array to invoke agentv CLI
 */
export function resolveAgentvCommand(): string[] {
  const repoRoot = resolveRepoRoot();
  return ["bun", `${repoRoot}/apps/cli/src/cli.ts`];
}
