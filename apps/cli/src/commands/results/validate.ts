/**
 * `agentv results validate` — Validate that a run directory contains well-formed
 * artifacts compatible with the AgentV dashboard and results commands.
 *
 * Checks:
 *   1. Directory follows the `.agentv/results/<run_id>` naming convention
 *   2. index.jsonl exists and each line has required fields
 *   3. Per-case summary.json exists for every entry in the index
 *   4. Per-run result.json and grading.json exist for every materialized trial
 *   5. summary.json exists
 *   6. Scores are within [0, 1]
 *   7. Run manifest entries have `scores[]` array (warning if missing — dashboard needs it)
 *
 * Exit code 0 = valid, 1 = errors found.
 *
 * To extend: add new check functions to the `checks` array.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  LEGACY_METRICS_SCHEMA_VERSION,
  METRICS_SCHEMA_VERSION,
  normalizeMetricsArtifactWire,
} from '@agentv/core';
import { command, positional, string } from 'cmd-ts';

import { RESULT_INDEX_FILENAME, resolveExistingRunPrimaryPath } from '../eval/result-layout.js';

// ── Types ────────────────────────────────────────────────────────────────

interface Diagnostic {
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

interface IndexEntry {
  readonly timestamp?: string;
  readonly test_id?: string;
  readonly score?: number;
  readonly target?: string;
  readonly scores?: unknown[];
  readonly execution_status?: string;
  readonly summary_path?: string;
  readonly grading_path?: string;
  readonly timing_path?: string;
  readonly metrics_path?: string;
  readonly result_dir?: string;
  readonly samples?: readonly {
    readonly sample_path?: string;
    readonly attempt_path?: string;
    readonly run_path?: string;
  }[];
  readonly attempts?: readonly {
    readonly attempt_path?: string;
    readonly sample_path?: string;
    readonly run_path?: string;
  }[];
  readonly trials?: readonly {
    readonly attempt_path?: string;
    readonly sample_path?: string;
    readonly run_path?: string;
  }[];
  readonly [key: string]: unknown;
}

const LEGACY_GRADING_FIELDS = [
  'assertion_results',
  'assertions',
  'passed',
  'evidence',
  'verdict',
  'graders',
  'checks',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateGradingNode(value: unknown, pathLabel: string): string[] {
  if (!isRecord(value)) {
    return [`${pathLabel} must be an object`];
  }

  const errors: string[] = [];
  if (
    typeof value.pass !== 'boolean' ||
    typeof value.score !== 'number' ||
    typeof value.reason !== 'string'
  ) {
    errors.push(`${pathLabel} must include pass, score, and reason`);
  }
  if (value.component_results !== undefined) {
    if (!Array.isArray(value.component_results)) {
      errors.push(`${pathLabel}.component_results must be an array when present`);
    } else {
      value.component_results.forEach((component, index) => {
        errors.push(...validateGradingNode(component, `${pathLabel}.component_results[${index}]`));
      });
    }
  }
  return errors;
}

function validateNoLegacyGradingFields(value: unknown, pathLabel: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      validateNoLegacyGradingFields(entry, `${pathLabel}[${index}]`),
    );
  }
  if (!isRecord(value)) {
    return [];
  }

  const errors: string[] = [];
  const legacyFields = LEGACY_GRADING_FIELDS.filter((field) => Object.hasOwn(value, field));
  if (legacyFields.length > 0) {
    errors.push(`${pathLabel} uses legacy field(s): ${legacyFields.join(', ')}`);
  }
  for (const [key, entry] of Object.entries(value)) {
    errors.push(...validateNoLegacyGradingFields(entry, `${pathLabel}.${key}`));
  }
  return errors;
}

function validateMetricsArtifact(value: unknown): Diagnostic[] {
  if (!isRecord(value)) {
    return [{ severity: 'error', message: 'metrics.json must be an object' }];
  }

  const diagnostics: Diagnostic[] = [];
  const schemaVersion = value.schema_version;
  const isCurrentSchema = schemaVersion === METRICS_SCHEMA_VERSION;
  const isLegacySchema = schemaVersion === LEGACY_METRICS_SCHEMA_VERSION;

  if (isCurrentSchema && Object.hasOwn(value, 'trace')) {
    diagnostics.push({
      severity: 'error',
      message: 'metrics.json must not include trace in agentv.metrics.v2',
    });
  } else if (isLegacySchema && Object.hasOwn(value, 'trace')) {
    diagnostics.push({
      severity: 'warning',
      message: 'metrics.json uses legacy trace identity; readers ignore it',
    });
  }

  if (isCurrentSchema && Object.hasOwn(value, 'metrics')) {
    diagnostics.push({
      severity: 'error',
      message: 'metrics.json must not include nested metrics in agentv.metrics.v2',
    });
  } else if (isLegacySchema && Object.hasOwn(value, 'metrics')) {
    diagnostics.push({
      severity: 'warning',
      message: 'metrics.json uses legacy nested metrics; readers flatten it',
    });
  }

  if (!normalizeMetricsArtifactWire(value)) {
    diagnostics.push({
      severity: 'error',
      message: 'metrics.json does not match a supported metrics artifact shape',
    });
  }

  return diagnostics;
}

// ── Checks ───────────────────────────────────────────────────────────────

function checkDirectoryNaming(runDir: string): Diagnostic[] {
  const dirName = path.basename(runDir);
  const pathSegments = path.normalize(runDir).split(path.sep).filter(Boolean);
  const resultsIndex = pathSegments.lastIndexOf('results');
  const diagnostics: Diagnostic[] = [];

  if (resultsIndex >= 0 && pathSegments[resultsIndex + 1] === 'runs') {
    diagnostics.push({
      severity: 'error',
      message:
        'The .agentv/results/runs namespace is no longer supported. Expected: .agentv/results/<run_id>',
    });
  } else if (resultsIndex < 0 || resultsIndex !== pathSegments.length - 2) {
    diagnostics.push({
      severity: 'warning',
      message:
        'Directory is not under the canonical results tree. Expected: .agentv/results/<run_id>',
    });
  }

  const isNewFormat = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(dirName);
  if (!isNewFormat) {
    diagnostics.push({
      severity: 'warning',
      message: `Directory name '${dirName}' does not match the expected pattern '<ISO-timestamp>'. Example: 2026-03-27T12-42-24-429Z`,
    });
  }

  return diagnostics;
}

export function validateRunDirectory(runDir: string): {
  diagnostics: Diagnostic[];
  entries: IndexEntry[];
} {
  const diagnostics: Diagnostic[] = [];

  diagnostics.push(...checkDirectoryNaming(runDir));

  const { diagnostics: indexDiags, entries } = checkIndexJsonl(runDir);
  diagnostics.push(...indexDiags);

  if (entries.length > 0) {
    diagnostics.push(...checkArtifactFiles(runDir, entries));
  }

  return { diagnostics, entries };
}

function checkIndexJsonl(runDir: string): { diagnostics: Diagnostic[]; entries: IndexEntry[] } {
  const indexPath = resolveExistingRunPrimaryPath(runDir);
  const diagnostics: Diagnostic[] = [];
  const entries: IndexEntry[] = [];
  const manifestLabel = indexPath ? path.basename(indexPath) : RESULT_INDEX_FILENAME;

  if (!indexPath || !existsSync(indexPath)) {
    diagnostics.push({
      severity: 'error',
      message: `${RESULT_INDEX_FILENAME} is missing`,
    });
    return { diagnostics, entries };
  }

  const content = readFileSync(indexPath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    diagnostics.push({ severity: 'error', message: `${manifestLabel} is empty` });
    return { diagnostics, entries };
  }

  for (let i = 0; i < lines.length; i++) {
    try {
      const entry: IndexEntry = JSON.parse(lines[i]);
      entries.push(entry);

      if (!entry.test_id) {
        diagnostics.push({
          severity: 'error',
          message: `${manifestLabel} line ${i + 1}: missing 'test_id'`,
        });
      }

      if (entry.score === undefined || entry.score === null) {
        diagnostics.push({
          severity: 'error',
          message: `${manifestLabel} line ${i + 1} (${entry.test_id ?? '?'}): missing 'score'`,
        });
      } else if (typeof entry.score !== 'number' || entry.score < 0 || entry.score > 1) {
        diagnostics.push({
          severity: 'error',
          message: `${manifestLabel} line ${i + 1} (${entry.test_id ?? '?'}): score ${entry.score} is outside [0, 1]`,
        });
      }

      if (!entry.target) {
        diagnostics.push({
          severity: 'error',
          message: `${manifestLabel} line ${i + 1} (${entry.test_id ?? '?'}): missing 'target'`,
        });
      }

      if (!entry.summary_path) {
        diagnostics.push({
          severity: 'error',
          message: `${manifestLabel} line ${i + 1} (${entry.test_id ?? '?'}): missing 'summary_path'`,
        });
      }

      if (typeof entry.trace_path === 'string') {
        diagnostics.push({
          severity: 'error',
          message: `${manifestLabel} line ${i + 1} (${entry.test_id ?? '?'}): trace_path is no longer supported; use transcript_path and metrics_path`,
        });
      }

      const artifactPointers = entry.artifact_pointers;
      if (
        artifactPointers &&
        typeof artifactPointers === 'object' &&
        !Array.isArray(artifactPointers) &&
        Object.hasOwn(artifactPointers, 'trace')
      ) {
        diagnostics.push({
          severity: 'error',
          message: `${manifestLabel} line ${i + 1} (${entry.test_id ?? '?'}): artifact_pointers.trace is no longer supported`,
        });
      }

      if (!entry.scores || !Array.isArray(entry.scores) || entry.scores.length === 0) {
        diagnostics.push({
          severity: 'warning',
          message: `${manifestLabel} line ${i + 1} (${entry.test_id ?? '?'}): missing 'scores[]' array — dashboard may not show per-grader breakdown`,
        });
      } else {
        for (let j = 0; j < entry.scores.length; j++) {
          const s = entry.scores[j] as Record<string, unknown> | null;
          if (!s || typeof s !== 'object') {
            diagnostics.push({
              severity: 'error',
              message: `${manifestLabel} line ${i + 1} (${entry.test_id ?? '?'}): scores[${j}] is not an object`,
            });
            continue;
          }
          const missing: string[] = [];
          if (typeof s.name !== 'string') missing.push('name');
          if (typeof s.type !== 'string') missing.push('type');
          if (typeof s.score !== 'number') missing.push('score');
          if (typeof s.pass !== 'boolean') missing.push('pass');
          if (typeof s.reason !== 'string') missing.push('reason');
          if (missing.length > 0) {
            diagnostics.push({
              severity: 'warning',
              message: `${manifestLabel} line ${i + 1} (${entry.test_id ?? '?'}): scores[${j}] missing fields: ${missing.join(', ')}`,
            });
          }
        }
      }

      if (!entry.execution_status) {
        diagnostics.push({
          severity: 'warning',
          message: `${manifestLabel} line ${i + 1} (${entry.test_id ?? '?'}): missing 'execution_status'`,
        });
      } else if (!['ok', 'quality_failure', 'execution_error'].includes(entry.execution_status)) {
        diagnostics.push({
          severity: 'warning',
          message: `${manifestLabel} line ${i + 1} (${entry.test_id ?? '?'}): unknown execution_status '${entry.execution_status}' (expected: ok, quality_failure, execution_error)`,
        });
      }
    } catch {
      diagnostics.push({
        severity: 'error',
        message: `${manifestLabel} line ${i + 1}: invalid JSON`,
      });
    }
  }

  return { diagnostics, entries };
}

function checkArtifactFiles(runDir: string, entries: IndexEntry[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const entry of entries) {
    const testId = entry.test_id ?? '?';

    if (entry.summary_path) {
      const summaryPath = path.join(runDir, entry.summary_path);
      if (!existsSync(summaryPath)) {
        diagnostics.push({
          severity: 'error',
          message: `${testId}: summary.json not found at '${entry.summary_path}'`,
        });
      }
    }

    for (const sample of entry.samples ?? entry.attempts ?? entry.trials ?? []) {
      const samplePath = sample.sample_path ?? sample.attempt_path ?? sample.run_path;
      if (!entry.result_dir || !samplePath) {
        continue;
      }
      const runDirPath = path.join(runDir, entry.result_dir, samplePath);
      const resultPath = path.join(runDirPath, 'result.json');
      const gradingPath = path.join(runDirPath, 'grading.json');
      if (!existsSync(resultPath)) {
        diagnostics.push({
          severity: 'error',
          message: `${testId}: result.json not found at '${path.posix.join(entry.result_dir, samplePath, 'result.json')}'`,
        });
      }
      if (!existsSync(gradingPath)) {
        diagnostics.push({
          severity: 'error',
          message: `${testId}: grading.json not found at '${path.posix.join(entry.result_dir, samplePath, 'grading.json')}'`,
        });
      }
    }

    // Check grading.json
    if (entry.grading_path) {
      const gradingPath = path.join(runDir, entry.grading_path);
      if (!existsSync(gradingPath)) {
        diagnostics.push({
          severity: 'error',
          message: `${testId}: grading.json not found at '${entry.grading_path}'`,
        });
      } else {
        try {
          const grading = JSON.parse(readFileSync(gradingPath, 'utf8'));
          for (const error of [
            ...validateGradingNode(grading, 'grading.json'),
            ...validateNoLegacyGradingFields(grading, 'grading.json'),
          ]) {
            diagnostics.push({
              severity: 'error',
              message: `${testId}: ${error}`,
            });
          }
        } catch {
          diagnostics.push({
            severity: 'error',
            message: `${testId}: grading.json is not valid JSON`,
          });
        }
      }
    }

    // Check metrics.json. Legacy timing_path is tolerated for old bundles.
    if (entry.metrics_path) {
      const metricsPath = path.join(runDir, entry.metrics_path);
      if (!existsSync(metricsPath)) {
        diagnostics.push({
          severity: 'warning',
          message: `${testId}: metrics.json not found at '${entry.metrics_path}'`,
        });
      } else {
        try {
          const metrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
          for (const diagnostic of validateMetricsArtifact(metrics)) {
            diagnostics.push({
              severity: diagnostic.severity,
              message: `${testId}: ${diagnostic.message}`,
            });
          }
        } catch {
          diagnostics.push({
            severity: 'error',
            message: `${testId}: metrics.json is not valid JSON`,
          });
        }
      }
    }
  }

  // Check run summary.json
  const summaryPath = path.join(runDir, 'summary.json');
  if (!existsSync(summaryPath)) {
    diagnostics.push({ severity: 'error', message: 'summary.json is missing' });
  }

  return diagnostics;
}

// ── Command ──────────────────────────────────────────────────────────────

export const resultsValidateCommand = command({
  name: 'validate',
  description: 'Validate that a run directory contains well-formed result artifacts',
  args: {
    runDir: positional({
      type: string,
      displayName: 'run-dir',
      description: 'Path to the run directory to validate',
    }),
  },
  handler: async ({ runDir }) => {
    const resolvedDir = path.resolve(runDir);

    if (!existsSync(resolvedDir) || !statSync(resolvedDir).isDirectory()) {
      console.error(`Error: '${runDir}' is not a directory`);
      process.exit(1);
    }

    const { diagnostics: allDiagnostics, entries } = validateRunDirectory(resolvedDir);

    // Report
    const errors = allDiagnostics.filter((d) => d.severity === 'error');
    const warnings = allDiagnostics.filter((d) => d.severity === 'warning');

    if (allDiagnostics.length === 0) {
      console.log(`✓ Valid run directory: ${entries.length} test(s), no issues found`);
      return;
    }

    for (const d of errors) {
      console.error(`  ERROR: ${d.message}`);
    }
    for (const d of warnings) {
      console.warn(`  WARN:  ${d.message}`);
    }

    console.log(
      `\n${entries.length} test(s), ${errors.length} error(s), ${warnings.length} warning(s)`,
    );

    if (errors.length > 0) {
      process.exit(1);
    }
  },
});
