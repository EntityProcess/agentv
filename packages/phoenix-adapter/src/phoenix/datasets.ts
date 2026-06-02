import type { NormalizedSuite } from '../agentv/types.js';
import { stableDatasetName } from './names.js';
import type { PhoenixDatasetPayload } from './types.js';

export function createPhoenixDatasetPayload(
  suite: NormalizedSuite,
  options: { namespace?: string } = {},
): PhoenixDatasetPayload {
  return {
    name: stableDatasetName(suite.source.relativePath, options.namespace),
    description: suite.description,
    assertions: suite.suiteAssertions,
    examples: suite.cases.map((testCase) => ({
      input: {
        messages: testCase.input,
        criteria: testCase.criteria,
        agentv_assertion_configs: testCase.assertions.map((assertion) => assertion.source),
      },
      output: testCase.expectedOutput,
      metadata: {
        ...testCase.metadata,
        agentv_source: testCase.sourcePath,
        agentv_test_id: testCase.id,
        agentv_assertions: testCase.assertions.map((assertion) => assertion.name ?? assertion.type),
        agentv_assertion_configs: testCase.assertions.map((assertion) => assertion.source),
      },
    })),
  };
}
