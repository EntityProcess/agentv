#!/usr/bin/env bun
import path from 'node:path';
import { resolveAgentVRoot } from './agentv/path.js';
import { formatMarkdownReport } from './parity/report.js';
import type { RunOptions } from './run/options.js';
import { runSuite } from './run/run-suite.js';

function usage(): string {
  return `Usage:
  bun src/cli.ts run --dry-run [--agentv-root ../agentv] [--filter features/assert] [--eval-file path] [--out reports/dry-run.json]

Boundary note:
  Internal legacy fixture only. AgentV does not export/project completed runs,
  traces, transcripts, datasets, experiments, or indexes into Phoenix.
  Dashboard does not depend on Phoenix, px, or Phoenix database tables.

Options:
  --agentv-root <path>       Source AgentV checkout. Defaults to AGENTV_ROOT or ../agentv.
  --eval-file <path>         Run one eval source.
  --filter <text>            Run sources whose repo-relative path contains text.
  --dry-run                  Build and verify a legacy in-memory report without contacting Phoenix.
  --out <path>               JSON report path. Defaults to reports/phoenix-report.json.
  --namespace <name>         Legacy Phoenix dataset name prefix for internal fixture runs.
  --fail-on-unsupported      Treat unsupported features as failures.
`;
}

function parseArgs(argv: readonly string[]): RunOptions | undefined {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return undefined;
  }

  const [command, ...rest] = argv;
  if (command !== 'run') {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }

  const values = new Map<string, string | boolean>();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) continue;
    if (arg === '--dry-run' || arg === '--fail-on-unsupported') {
      values.set(arg, true);
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    values.set(arg, value);
    index += 1;
  }

  const agentvRoot = resolveAgentVRoot(values.get('--agentv-root') as string | undefined);
  const evalFile = values.get('--eval-file') as string | undefined;

  return {
    agentvRoot,
    evalFile: evalFile ? path.resolve(evalFile) : undefined,
    filter: values.get('--filter') as string | undefined,
    dryRun: values.get('--dry-run') === true,
    out: path.resolve((values.get('--out') as string | undefined) ?? 'reports/phoenix-report.json'),
    namespace: values.get('--namespace') as string | undefined,
    failOnUnsupported: values.get('--fail-on-unsupported') === true,
  };
}

const options = parseArgs(Bun.argv.slice(2));
if (options) {
  const report = await runSuite(options);
  console.log(formatMarkdownReport(report));
  if (report.failedSuites > 0) process.exit(1);
}
