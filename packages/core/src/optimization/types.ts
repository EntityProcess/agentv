import type { AxACEPlaybook } from "@ax-llm/ax";

export interface OptimizationResult {
  readonly playbookPath: string;
  readonly playbook: AxACEPlaybook;
  readonly scores: readonly number[];
  readonly epochsCompleted: number;
}

export interface Optimizer {
  optimize(): Promise<OptimizationResult>;
}
