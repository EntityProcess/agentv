import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { EvaluationResult } from '@agentv/core';

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export class JunitWriter {
  private readonly filePath: string;
  private readonly results: EvaluationResult[] = [];
  private closed = false;

  private constructor(filePath: string) {
    this.filePath = filePath;
  }

  static async open(filePath: string): Promise<JunitWriter> {
    await mkdir(path.dirname(filePath), { recursive: true });
    return new JunitWriter(filePath);
  }

  async append(result: EvaluationResult): Promise<void> {
    if (this.closed) {
      throw new Error('Cannot write to closed JUnit writer');
    }
    this.results.push(result);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    const grouped = new Map<string, EvaluationResult[]>();
    for (const result of this.results) {
      const suite = result.dataset ?? 'default';
      const existing = grouped.get(suite);
      if (existing) {
        existing.push(result);
      } else {
        grouped.set(suite, [result]);
      }
    }

    const suiteXmls: string[] = [];
    for (const [suiteName, results] of grouped) {
      const failures = results.filter((r) => r.score < 0.5).length;
      const errors = results.filter((r) => r.error !== undefined).length;

      const testCases = results.map((r) => {
        const time = r.trace?.durationMs
          ? (r.trace.durationMs / 1000).toFixed(3)
          : '0.000';

        let inner = '';
        if (r.error) {
          inner = `\n      <error message="${escapeXml(r.error)}">${escapeXml(r.error)}</error>\n    `;
        } else if (r.score < 0.5) {
          const message = `score=${r.score.toFixed(3)}`;
          const detail = [
            `Score: ${r.score.toFixed(3)}`,
            r.reasoning ? `Reasoning: ${r.reasoning}` : '',
            r.misses.length > 0 ? `Misses: ${r.misses.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('\n');
          inner = `\n      <failure message="${escapeXml(message)}">${escapeXml(detail)}</failure>\n    `;
        }

        return `    <testcase name="${escapeXml(r.testId)}" classname="${escapeXml(suiteName)}" time="${time}">${inner}</testcase>`;
      });

      suiteXmls.push(
        `  <testsuite name="${escapeXml(suiteName)}" tests="${results.length}" failures="${failures}" errors="${errors}">\n${testCases.join('\n')}\n  </testsuite>`,
      );
    }

    const totalTests = this.results.length;
    const totalFailures = this.results.filter((r) => r.score < 0.5).length;
    const totalErrors = this.results.filter((r) => r.error !== undefined).length;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}">\n${suiteXmls.join('\n')}\n</testsuites>\n`;

    await writeFile(this.filePath, xml, 'utf8');
  }
}
