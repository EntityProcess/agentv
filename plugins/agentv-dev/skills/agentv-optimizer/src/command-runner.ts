import { resolveAgentvCommand } from "./paths.js";

export interface RunEvalOptions {
  evalPath: string;
  target?: string;
  targets?: string[];
  artifactsDir?: string;
  dryRun?: boolean;
}

export interface PromptEvalOptions {
  subcommand: "overview" | "input" | "judge";
  evalPath: string;
  testId?: string;
}

export function buildRunEvalCommand(options: RunEvalOptions): string[] {
  const cmd = [...resolveAgentvCommand(), "eval", options.evalPath];

  if (options.target) {
    cmd.push("--target", options.target);
  }

  if (options.targets && options.targets.length > 0) {
    cmd.push("--targets", options.targets.join(","));
  }

  if (options.artifactsDir) {
    cmd.push("--artifacts", options.artifactsDir);
  }

  if (options.dryRun) {
    cmd.push("--dry-run");
  }

  return cmd;
}

export function buildPromptEvalCommand(args: string[]): string[] {
  return [...resolveAgentvCommand(), "prompt", "eval", ...args];
}

export function buildConvertCommand(args: string[]): string[] {
  return [...resolveAgentvCommand(), "convert", ...args];
}

export function buildCompareCommand(args: string[]): string[] {
  return [...resolveAgentvCommand(), "compare", ...args];
}

export async function runCommand(cmd: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}
