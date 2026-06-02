export type JsonObject = Record<string, unknown>;

export type AgentVSourceKind = 'eval-yaml' | 'agent-skills-json';

export interface AgentVSource {
  readonly path: string;
  readonly relativePath: string;
  readonly kind: AgentVSourceKind;
}

export interface AgentVMessage {
  readonly role: string;
  readonly content: unknown;
}

export interface NormalizedAssertion {
  readonly name?: string;
  readonly type: string;
  readonly source: unknown;
}

export interface NormalizedCase {
  readonly id: string;
  readonly criteria?: string;
  readonly input: readonly AgentVMessage[];
  readonly expectedOutput?: unknown;
  readonly assertions: readonly NormalizedAssertion[];
  readonly metadata: JsonObject;
  readonly sourcePath: string;
}

export interface NormalizedSuite {
  readonly name: string;
  readonly description?: string;
  readonly source: AgentVSource;
  readonly cases: readonly NormalizedCase[];
  readonly suiteAssertions: readonly NormalizedAssertion[];
  readonly warnings: readonly string[];
  readonly unsupportedFeatures: readonly string[];
}
