#!/usr/bin/env bun
/**
 * improve-description.ts
 *
 * Analyzes trigger observations and AgentV artifacts to generate
 * provider-agnostic description improvement recommendations.
 * Thin CLI entrypoint that calls src/description-optimizer.ts.
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  type BenchmarkSummary,
  type GradingSummary,
  readBenchmarkSummary,
  readGradingSummary,
} from '../src/artifact-readers.js';
import { buildDescriptionImprovementPlan } from '../src/description-optimizer.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(
      'Usage: bun scripts/improve-description.ts --benchmark <file> --grading <file> [--trigger-misses <file>] [--false-triggers <file>]',
    );
    process.exit(1);
  }

  let benchmarkPath: string | null = null;
  let gradingPath: string | null = null;
  let triggerMissesPath: string | null = null;
  let falseTriggersPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--benchmark' && i + 1 < args.length) {
      benchmarkPath = args[i + 1];
      i++;
    } else if (args[i] === '--grading' && i + 1 < args.length) {
      gradingPath = args[i + 1];
      i++;
    } else if (args[i] === '--trigger-misses' && i + 1 < args.length) {
      triggerMissesPath = args[i + 1];
      i++;
    } else if (args[i] === '--false-triggers' && i + 1 < args.length) {
      falseTriggersPath = args[i + 1];
      i++;
    }
  }

  if (!benchmarkPath || !gradingPath) {
    console.error('Error: --benchmark and --grading are required');
    process.exit(1);
  }

  if (!existsSync(benchmarkPath)) {
    console.error(`Error: Benchmark file not found: ${benchmarkPath}`);
    process.exit(1);
  }

  if (!existsSync(gradingPath)) {
    console.error(`Error: Grading file not found: ${gradingPath}`);
    process.exit(1);
  }

  const benchmark = readBenchmarkSummary(benchmarkPath);
  const grading = readGradingSummary(gradingPath);

  // Extract observations from artifacts
  const triggerMisses: string[] = [];
  const falseTriggers: string[] = [];

  // If explicit trigger files are provided, read them
  if (triggerMissesPath && existsSync(triggerMissesPath)) {
    const data = JSON.parse(readFileSync(triggerMissesPath, 'utf-8'));
    triggerMisses.push(...(Array.isArray(data) ? data : []));
  }

  if (falseTriggersPath && existsSync(falseTriggersPath)) {
    const data = JSON.parse(readFileSync(falseTriggersPath, 'utf-8'));
    falseTriggers.push(...(Array.isArray(data) ? data : []));
  }

  // Infer observations from grading artifacts if no explicit files provided
  if (triggerMisses.length === 0 && falseTriggers.length === 0) {
    // Example: extract patterns from failed test cases
    for (const [testId, result] of Object.entries(grading)) {
      if (typeof result === 'object' && result !== null) {
        if (result.error?.includes('provider_error')) {
          // Could be a trigger miss - placeholder logic
          triggerMisses.push(`test case ${testId} failed`);
        }
      }
    }
  }

  // Build improvement plan
  const plan = buildDescriptionImprovementPlan({
    triggerMisses: triggerMisses.length > 0 ? triggerMisses : undefined,
    falseTriggers: falseTriggers.length > 0 ? falseTriggers : undefined,
  });

  // Output results
  console.log('\n=== Description Improvement Plan ===\n');
  printArtifactContext(benchmark, grading);
  console.log(plan.summary);
  console.log('\n--- Suggested Changes ---\n');
  console.log(plan.diffPreview);
  console.log('\n--- Validation Experiments ---\n');

  for (let i = 0; i < plan.nextExperiments.length; i++) {
    const exp = plan.nextExperiments[i];
    console.log(`Experiment ${i + 1}:`);
    console.log(`  Prompt: "${exp.prompt}"`);
    console.log(`  Expected: ${exp.expectedOutcome}`);
    console.log('');
  }

  console.log('Next steps:');
  console.log('  1. Review and apply suggested description changes');
  console.log('  2. Add validation experiments to your eval suite');
  console.log('  3. Re-run benchmark to verify improvements');
}

function printArtifactContext(benchmark: BenchmarkSummary, grading: GradingSummary): void {
  const gradedCases = Object.keys(grading).length;
  const targets = benchmark.metadata.targets.join(', ');

  console.log(`Artifacts: ${benchmark.metadata.eval_file}`);
  console.log(`Targets: ${targets || 'N/A'}`);
  console.log(`Graded cases: ${gradedCases}`);
  console.log('');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
