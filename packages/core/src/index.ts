export * from "./bbeval/types.js";
export * from "./bbeval/yaml-parser.js";

export type AgentKernel = {
  status: string;
};

export function createAgentKernel(): AgentKernel {
  return { status: "stub" };
}
