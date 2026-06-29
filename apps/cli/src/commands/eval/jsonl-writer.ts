import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { type EvaluationResult, serializeEvaluationResultWire } from '@agentv/core';
import { Mutex } from 'async-mutex';

export class JsonlWriter {
  private readonly stream: ReturnType<typeof createWriteStream>;
  private readonly mutex = new Mutex();
  private closed = false;

  private constructor(stream: ReturnType<typeof createWriteStream>) {
    this.stream = stream;
  }

  static async open(filePath: string, options?: { append?: boolean }): Promise<JsonlWriter> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const flags = options?.append ? 'a' : 'w';
    const stream = createWriteStream(filePath, { flags, encoding: 'utf8' });
    return new JsonlWriter(stream);
  }

  async append(record: EvaluationResult): Promise<void> {
    await this.mutex.runExclusive(async () => {
      if (this.closed) {
        throw new Error('Cannot write to closed JSONL writer');
      }
      const snakeCaseRecord = serializeEvaluationResultWire(record);
      const line = `${JSON.stringify(snakeCaseRecord)}\n`;
      if (!this.stream.write(line)) {
        await new Promise<void>((resolve, reject) => {
          this.stream.once('drain', resolve);
          this.stream.once('error', reject);
        });
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stream.end();
    await finished(this.stream);
  }
}
