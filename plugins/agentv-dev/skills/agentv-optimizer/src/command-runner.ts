import { isAgentvCliAvailable, resolveAgentvCommand, resolveRepoRoot } from './paths.js';

/**
 * Builds agentv eval command by forwarding all arguments verbatim.
 * This preserves exact CLI semantics without re-parsing flags.
 */
export function buildRunEvalCommand(args: string[]): string[] {
  return [...resolveAgentvCommand(), 'eval', ...args];
}

export function buildPromptEvalCommand(args: string[]): string[] {
  return [...resolveAgentvCommand(), 'prompt', 'eval', ...args];
}

export function buildConvertCommand(args: string[]): string[] {
  return [...resolveAgentvCommand(), 'convert', ...args];
}

export function buildCompareCommand(args: string[]): string[] {
  return [...resolveAgentvCommand(), 'compare', ...args];
}

export async function runCommand(
  cmd: string[],
  cwd?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (cmd.some(part => part.includes('cli.ts'))) {
    const { available, reason } = isAgentvCliAvailable();
    if (!available) {
      throw new Error(
        `AgentV CLI not available: ${reason}\n\nTo use eval commands, ensure you are running inside the AgentV repository\nwith Bun installed. See: https://github.com/EntityProcess/agentv#installation`
      );
    }
  }

  const proc = Bun.spawn(cmd, {
    cwd: cwd || process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}
