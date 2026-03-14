#!/usr/bin/env bun
/**
 * generate-review.ts
 *
 * Renders a static review page from AgentV artifacts.
 * This is a viewer renderer, not a separate artifact format.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReviewModel } from '../src/generate-report.js';
import { buildReviewModel } from '../src/generate-report.js';

export interface RenderOptions {
  title: string;
  sections: ReviewModel['sections'];
  testCases: ReviewModel['testCases'];
  metadata?: ReviewModel['metadata'];
}

/**
 * Renders review HTML from the report model.
 */
export function renderReviewHtml(options: RenderOptions): string {
  const { title, sections, testCases, metadata } = options;

  const sectionsHtml = sections
    .map(
      (section) => `
    <section class="report-section">
      <h2>${escapeHtml(section.heading)}</h2>
      <pre>${escapeHtml(section.body)}</pre>
    </section>
  `,
    )
    .join('\n');

  const testCasesHtml = testCases
    .map(
      (tc) => `
    <tr class="test-case test-${tc.status}">
      <td>${escapeHtml(tc.id)}</td>
      <td><span class="status-badge status-${tc.status}">${tc.status}</span></td>
      <td>${tc.score !== undefined ? tc.score.toFixed(2) : 'N/A'}</td>
      <td class="summary">${escapeHtml(tc.summary)}</td>
      <td>${tc.error ? escapeHtml(tc.error) : tc.rationale ? escapeHtml(tc.rationale) : ''}</td>
    </tr>
  `,
    )
    .join('\n');

  const metadataHtml = metadata
    ? `
    <section class="metadata">
      <p><strong>Timestamp:</strong> ${metadata.timestamp || 'N/A'}</p>
      <p><strong>Eval File:</strong> ${escapeHtml(metadata.eval_file || 'N/A')}</p>
      <p><strong>Targets:</strong> ${metadata.targets?.join(', ') || 'N/A'}</p>
    </section>
  `
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      background: #f5f5f5;
    }
    h1 {
      color: #333;
      border-bottom: 3px solid #0066cc;
      padding-bottom: 0.5rem;
    }
    .report-section {
      background: white;
      padding: 1.5rem;
      margin: 1rem 0;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .report-section h2 {
      color: #0066cc;
      margin-top: 0;
    }
    .report-section pre {
      background: #f8f8f8;
      padding: 1rem;
      border-radius: 4px;
      overflow-x: auto;
    }
    table {
      width: 100%;
      background: white;
      border-collapse: collapse;
      margin: 1rem 0;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    th {
      background: #0066cc;
      color: white;
      padding: 1rem;
      text-align: left;
    }
    td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #eee;
    }
    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-pass { background: #d4edda; color: #155724; }
    .status-fail { background: #f8d7da; color: #721c24; }
    .status-error { background: #fff3cd; color: #856404; }
    .test-case.test-pass { background: #f8fff9; }
    .test-case.test-fail { background: #fff8f8; }
    .test-case.test-error { background: #fffef8; }
    .summary {
      max-width: 400px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .metadata {
      background: white;
      padding: 1rem;
      margin: 1rem 0;
      border-radius: 8px;
      border-left: 4px solid #0066cc;
    }
    .metadata p {
      margin: 0.5rem 0;
    }
  </style>
</head>
<body id="agentv-optimizer-viewer">
  <h1>${escapeHtml(title)}</h1>
  
  ${metadataHtml}
  
  ${sectionsHtml}
  
  <section class="report-section">
    <h2>Test Cases</h2>
    <table>
      <thead>
        <tr>
          <th>Test ID</th>
          <th>Status</th>
          <th>Score</th>
          <th>Summary</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        ${testCasesHtml}
      </tbody>
    </table>
  </section>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(
      'Usage: bun eval-viewer/generate-review.ts --artifacts <dir> --out <html-file>',
    );
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

  console.log(`Review HTML written to: ${outFile}`);
}

if (import.meta.main) {
  main();
}
