export type {
  BatchDispatchOptions,
  BatchDispatchResult,
  DispatchOptions,
  DispatchSessionResult,
} from './vscode/agentDispatch.js';

export type {
  ProvisionOptions,
  ProvisionResult,
} from './vscode/provision.js';

export {
  dispatchAgentSession,
  dispatchBatchAgent,
  getSubagentRoot,
} from './vscode/agentDispatch.js';

export { provisionSubagents } from './vscode/provision.js';
