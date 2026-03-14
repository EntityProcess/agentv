#!/usr/bin/env bun
/**
 * generate-report.ts
 *
 * Builds a presentation model from AgentV artifacts and renders HTML.
 * Thin CLI entrypoint that calls src/generate-report.ts helper and eval-viewer/generate-review.ts.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderReviewHtml } from '../eval-viewer/generate-review.js';
import { buildReviewModel } from '../src/generate-report.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: bun scripts/generate-report.ts --artifacts <dir> --out <html-file>');
    process.exit(1);
  }

  let artifactsDir: string | null = null;
  let outFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--artifacts' && i + 1 < args.length) {
      artifactsDir = args[i + 1];
      i++;
    } else if (args[i] === '--out' && i + 1 < args.length) {
      outFile = args[i + 1];
      i++;
    }
  }

  if (!artifactsDir || !outFile) {
    console.error('Error: --artifacts and --out are required');
    process.exit(1);
  }

  const reviewModel = buildReviewModel({
    gradingPath: resolve(artifactsDir, 'grading.json'),
    benchmarkPath: resolve(artifactsDir, 'benchmark.json'),
    timingPath: resolve(artifactsDir, 'timing.json'),
    resultsPath: resolve(artifactsDir, 'results.jsonl'),
  });

  const html = renderReviewHtml(reviewModel);
  writeFileSync(outFile, html, 'utf-8');

  console.log(`Report HTML written to: ${outFile}`);
}

main();
