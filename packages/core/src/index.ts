export * from "./evaluation/types.js";
export * from "./evaluation/yaml-parser.js";
export * from "./evaluation/file-utils.js";
export * from "./evaluation/providers/index.js";
export * from "./evaluation/evaluators.js";
export * from "./evaluation/orchestrator.js";
export * from "./optimization/config.js";
export * from "./optimization/types.js";
export * from "./optimization/ace-optimizer.js";

export type AgentKernel = {
  status: string;
};

export function createAgentKernel(): AgentKernel {
  return { status: "stub" };
}
