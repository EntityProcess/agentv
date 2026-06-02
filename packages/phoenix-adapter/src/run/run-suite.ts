import path from 'node:path';
import { discoverAgentVEvals } from '../agentv/discovery.js';
import { loadAgentVEvalSuite } from '../agentv/load-spec.js';
import { relativePosix } from '../agentv/path.js';
import { compareDryRunSuite } from '../parity/compare.js';
import { buildRunReport, writeJsonReport } from '../parity/report.js';
import type { RunReport } from '../parity/types.js';
import { createPhoenixDatasetPayload } from '../phoenix/datasets.js';
import { runPhoenixExperiment } from '../phoenix/run-experiment.js';
import type { RunOptions } from './options.js';

function sourceMatches(relativePath: string, options: RunOptions): boolean {
  if (options.evalFile) {
    const requested = relativePosix(options.agentvRoot, path.resolve(options.evalFile));
    return relativePath === requested || relativePath === options.evalFile;
  }
  if (options.filter) return relativePath.includes(options.filter);
  return true;
}

export async function runSuite(options: RunOptions): Promise<RunReport> {
  const sources = (await discoverAgentVEvals(options.agentvRoot)).filter((source) =>
    sourceMatches(source.relativePath, options),
  );
  if (sources.length === 0) {
    throw new Error('No AgentV eval sources matched the requested options.');
  }

  const summaries = [];
  for (const source of sources) {
    const suite = await loadAgentVEvalSuite(source);
    const dataset = createPhoenixDatasetPayload(suite, { namespace: options.namespace });
    let summary = compareDryRunSuite(suite, dataset);
    if (options.failOnUnsupported && summary.unsupportedFeatures.length > 0) {
      summary = {
        ...summary,
        status: 'failed' as const,
        failures: [
          ...summary.failures,
          `Unsupported features present: ${summary.unsupportedFeatures.join(', ')}`,
        ],
      };
    }
    if (!options.dryRun) {
      const experiment = await runPhoenixExperiment(dataset);
      summary = {
        ...summary,
        phoenixExperimentId: experiment.experimentId,
        phoenixRunCount: experiment.runCount,
        phoenixEvaluationRunCount: experiment.evaluationRunCount,
      };
      if (experiment.runCount !== suite.cases.length) {
        summary = {
          ...summary,
          status: 'failed',
          failures: [
            ...summary.failures,
            `Phoenix run count ${experiment.runCount} does not match case count ${suite.cases.length}`,
          ],
        };
      }
    }
    summaries.push(summary);
  }

  const report = buildRunReport({
    dryRun: options.dryRun,
    agentvRoot: options.agentvRoot,
    suites: summaries,
  });
  await writeJsonReport(report, options.out);
  return report;
}
