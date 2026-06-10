import type { EvaluationResult } from '@agentv/core';

import { JsonlWriter } from './jsonl-writer.js';

export interface OutputWriter {
  append(result: EvaluationResult): Promise<void>;
  close(): Promise<void>;
}

export async function createOutputWriter(
  filePath: string,
  options?: { append?: boolean },
): Promise<OutputWriter> {
  return JsonlWriter.open(filePath, { append: options?.append });
}
