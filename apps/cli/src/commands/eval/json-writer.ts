import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { EvaluationResult } from '@agentv/core';

import { toSnakeCaseDeep } from '../../utils/case-conversion.js';

export class JsonWriter {
  private readonly filePath: string;
  private readonly results: EvaluationResult[] = [];
  private closed = false;

  private constructor(filePath: string) {
    this.filePath = filePath;
  }

  static async open(filePath: string): Promise<JsonWriter> {
    await mkdir(path.dirname(filePath), { recursive: true });
    return new JsonWriter(filePath);
  }

  async append(result: EvaluationResult): Promise<void> {
    if (this.closed) {
      throw new Error('Cannot write to closed JSON writer');
    }
    this.results.push(result);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    const passed = this.results.filter((r) => r.score >= 0.5).length;
    const failed = this.results.length - passed;
    const total = this.results.length;

    const output = {
      stats: {
        total,
        passed,
        failed,
        passRate: total > 0 ? passed / total : 0,
      },
      results: this.results,
    };

    const snakeCaseOutput = toSnakeCaseDeep(output);
    await writeFile(this.filePath, `${JSON.stringify(snakeCaseOutput, null, 2)}\n`, 'utf8');
  }
}
