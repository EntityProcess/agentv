export * from './evaluation/types.js';
export * from './evaluation/trace.js';
export * from './evaluation/yaml-parser.js';
export * from './evaluation/file-utils.js';
export * from './evaluation/providers/index.js';
export * from './evaluation/evaluators.js';
export * from './evaluation/orchestrator.js';
export * from './evaluation/generators/index.js';
export * from './evaluation/workspace/index.js';
export { toSnakeCaseDeep, toCamelCaseDeep } from './evaluation/case-conversion.js';
export { trimBaselineResult } from './evaluation/baseline.js';

export type AgentKernel = {
  status: string;
};

export function createAgentKernel(): AgentKernel {
  return { status: 'stub' };
}
