import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { EvaluationResult } from '@agentv/core';

export interface JunitWriterOptions {
  readonly threshold?: number;
}

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
  private readonly threshold: number;
  private closed = false;

  private constructor(filePath: string, options?: JunitWriterOptions) {
    this.filePath = filePath;
    this.threshold = options?.threshold ?? 0.5;
  }

  static async open(filePath: string, options?: JunitWriterOptions): Promise<JunitWriter> {
    await mkdir(path.dirname(filePath), { recursive: true });
    return new JunitWriter(filePath, options);
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
      const errors = results.filter((r) => r.executionStatus === 'execution_error').length;
      const failures = results.filter(
        (r) => r.executionStatus !== 'execution_error' && r.score < this.threshold,
      ).length;

      const testCases = results.map((r) => {
        const time = r.durationMs ? (r.durationMs / 1000).toFixed(3) : '0.000';

        let inner = '';
        if (r.executionStatus === 'execution_error') {
          const errorMsg = r.error ?? 'Execution error';
          inner = `\n      <error message="${escapeXml(errorMsg)}">${escapeXml(errorMsg)}</error>\n    `;
        } else if (r.score < this.threshold) {
          const message = `score=${r.score.toFixed(3)}`;
          const failedAssertions = r.assertions.filter((a) => !a.passed);
          const detail = [
            `Score: ${r.score.toFixed(3)}`,
            failedAssertions.length > 0
              ? `Failed: ${failedAssertions.map((a) => a.text).join(', ')}`
              : '',
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
    const totalErrors = this.results.filter((r) => r.executionStatus === 'execution_error').length;
    const totalFailures = this.results.filter(
      (r) => r.executionStatus !== 'execution_error' && r.score < this.threshold,
    ).length;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}">\n${suiteXmls.join('\n')}\n</testsuites>\n`;

    await writeFile(this.filePath, xml, 'utf8');
  }
}
