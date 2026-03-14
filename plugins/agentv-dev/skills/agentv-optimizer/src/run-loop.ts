import { resolveAgentvCommand } from './paths.js';

export interface LoopPlan {
  commands: string[][];
  iterations: number;
  evalPath: string;
}

export interface PlanLoopOptions {
  evalPath: string;
  iterations: number;
  extraArgs?: string[];
}

/**
 * Plans iteration commands without owning evaluator execution.
 * Returns explicit argv arrays that remain provider-agnostic.
 */
export function planLoopCommands(options: PlanLoopOptions): LoopPlan {
  const { evalPath, iterations, extraArgs = [] } = options;
  const commands: string[][] = [];

  for (let i = 0; i < iterations; i++) {
    const cmd = [...resolveAgentvCommand(), 'eval', evalPath, ...extraArgs];
    commands.push(cmd);
  }

  return {
    commands,
    iterations,
    evalPath,
  };
}
