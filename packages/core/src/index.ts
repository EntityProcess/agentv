export * from "./bbeval/types.js";
export * from "./bbeval/yaml-parser.js";
export * from "./bbeval/providers/index.js";

export type AgentKernel = {
  status: string;
};

export function createAgentKernel(): AgentKernel {
  return { status: "stub" };
}
