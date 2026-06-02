import type { AgentVMessage, JsonObject, NormalizedAssertion } from '../agentv/types.js';

export interface PhoenixDatasetExamplePayload {
  readonly input: {
    readonly messages: readonly AgentVMessage[];
    readonly criteria?: string;
    readonly agentv_assertion_configs: readonly unknown[];
  };
  readonly output?: unknown;
  readonly metadata: JsonObject & {
    readonly agentv_source: string;
    readonly agentv_test_id: string;
    readonly agentv_assertions: readonly string[];
    readonly agentv_assertion_configs: readonly unknown[];
  };
}

export interface PhoenixDatasetPayload {
  readonly name: string;
  readonly description?: string;
  readonly examples: readonly PhoenixDatasetExamplePayload[];
  readonly assertions: readonly NormalizedAssertion[];
}
