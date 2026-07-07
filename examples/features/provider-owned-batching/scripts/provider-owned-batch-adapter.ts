#!/usr/bin/env bun
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

type QueuedRequest = {
  readonly id: string;
  readonly prompt: string;
  readonly outputFile: string;
  readonly queuedAt: string;
};

type BatchResponse = {
  readonly id: string;
  readonly text?: string;
  readonly error?: string;
  readonly duration_ms: number;
};

const [promptFile, outputFile, requestIdArg] = process.argv.slice(2);
if (!promptFile || !outputFile) {
  console.error('Usage: provider-owned-batch-adapter.ts <prompt-file> <output-file>');
  process.exit(2);
}

const stateRoot = path.resolve(
  process.env.PROVIDER_OWNED_BATCH_STATE_DIR ?? '.agentv/provider-owned-batching-state',
);
const queueDir = path.join(stateRoot, 'queue');
const responseDir = path.join(stateRoot, 'responses');
const batchLogPath = path.join(stateRoot, 'batches.jsonl');
const lockDir = path.join(stateRoot, 'flush.lock');
const flushDelayMs = Number(process.env.PROVIDER_OWNED_BATCH_FLUSH_DELAY_MS ?? 120);
const waitTimeoutMs = Number(process.env.PROVIDER_OWNED_BATCH_WAIT_TIMEOUT_MS ?? 4_000);

await mkdir(queueDir, { recursive: true });
await mkdir(responseDir, { recursive: true });

const prompt = await readFile(promptFile, 'utf8');
const requestId = requestIdArg || process.env.AGENTV_EVAL_ID || stableRequestId(prompt, outputFile);
const requestPath = path.join(queueDir, `${requestId}.${process.pid}.json`);
const responsePath = path.join(responseDir, `${requestId}.json`);

await writeJsonAtomic(requestPath, {
  id: requestId,
  prompt,
  outputFile,
  queuedAt: new Date().toISOString(),
} satisfies QueuedRequest);

await tryFlushBatch();

const response = await waitForResponse(responsePath, waitTimeoutMs);
await writeJsonAtomic(outputFile, response);

async function tryFlushBatch(): Promise<void> {
  try {
    await mkdir(lockDir);
  } catch {
    return;
  }

  try {
    await sleep(flushDelayMs);
    const requestFiles = (await readdir(queueDir))
      .filter((entry) => entry.endsWith('.json'))
      .sort();
    if (requestFiles.length === 0) {
      return;
    }

    const requests: QueuedRequest[] = [];
    for (const requestFile of requestFiles) {
      const filePath = path.join(queueDir, requestFile);
      try {
        requests.push(JSON.parse(await readFile(filePath, 'utf8')) as QueuedRequest);
      } catch {
        // A concurrent writer has not finished its atomic rename yet. Leave it
        // for the next provider-owned timeout flush.
      }
    }

    const responses = runSyntheticBatch(requests);
    const batchId = `batch-${Date.now()}-${process.pid}`;
    await writeFile(
      batchLogPath,
      `${JSON.stringify({
        batch_id: batchId,
        trigger: 'timeout',
        request_ids: requests.map((request) => request.id),
        request_count: requests.length,
      })}\n`,
      { flag: 'a' },
    );

    for (const response of responses) {
      await writeJsonAtomic(path.join(responseDir, `${response.id}.json`), response);
    }
    for (const requestFile of requestFiles) {
      await rm(path.join(queueDir, requestFile), { force: true });
    }
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

function runSyntheticBatch(requests: readonly QueuedRequest[]): readonly BatchResponse[] {
  const startedAt = Date.now();
  return requests.map((request) => {
    const normalized = request.prompt.toLowerCase();
    if (normalized.includes('fraud') || normalized.includes('blocked')) {
      return buildResponse(request.id, 'BLOCK', startedAt);
    }
    if (normalized.includes('dispute') || normalized.includes('escalation')) {
      return buildResponse(request.id, 'REVIEW', startedAt);
    }
    return buildResponse(request.id, 'CLEAR', startedAt);
  });
}

function buildResponse(id: string, decision: string, startedAt: number): BatchResponse {
  return {
    id,
    text: `decision=${decision}; request_id=${id}`,
    duration_ms: Date.now() - startedAt,
  };
}

async function waitForResponse(filePath: string, timeoutMs: number): Promise<BatchResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as BatchResponse;
    } catch {
      await sleep(25);
      await tryFlushBatch();
    }
  }
  return {
    id: requestId,
    error: `Timed out waiting for provider-owned batch response for ${requestId}`,
    duration_ms: timeoutMs,
  };
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await rename(tempPath, filePath);
}

function stableRequestId(promptText: string, fallback: string): string {
  const source = `${promptText}\n${fallback}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return `request-${hash.toString(16)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
