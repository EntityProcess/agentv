import fs from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[];
type JsonObject = { readonly [key: string]: JsonValue };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getArg(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function toStringValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

type RowRecord = {
  readonly id: string;
  readonly customer_name: string;
  readonly origin_country: string;
  readonly destination_country: string;
  readonly transaction_type: string;
  readonly amount: string;
  readonly currency: string;
  readonly jurisdiction: string;
  readonly effective_date: string;
};

function extractRowFromEvalCase(evalCase: Record<string, unknown>): RowRecord | undefined {
  const id = typeof evalCase.id === 'string' ? evalCase.id : undefined;
  const inputMessages = Array.isArray(evalCase.input_messages)
    ? evalCase.input_messages
    : undefined;
  if (!id || !inputMessages) return undefined;

  // Find the first user message with object content.
  const userMessage = inputMessages.find(
    (m) => isObject(m) && m.role === 'user' && isObject((m as Record<string, unknown>).content),
  ) as Record<string, unknown> | undefined;

  if (!userMessage) return undefined;

  const content = userMessage.content as Record<string, unknown>;
  const request = isObject(content.request) ? (content.request as Record<string, unknown>) : {};
  const row = isObject(content.row) ? (content.row as Record<string, unknown>) : {};

  return {
    id,
    customer_name: typeof row.customer_name === 'string' ? row.customer_name : '',
    origin_country: typeof row.origin_country === 'string' ? row.origin_country : '',
    destination_country: typeof row.destination_country === 'string' ? row.destination_country : '',
    transaction_type: typeof row.transaction_type === 'string' ? row.transaction_type : '',
    amount:
      typeof row.amount === 'string' || typeof row.amount === 'number' ? String(row.amount) : '',
    currency: typeof row.currency === 'string' ? row.currency : '',
    jurisdiction: typeof request.jurisdiction === 'string' ? request.jurisdiction : '',
    effective_date: typeof request.effective_date === 'string' ? request.effective_date : '',
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const evalPathRaw = getArg(args, '--eval');
  const outPathRaw = getArg(args, '--out');

  if (!evalPathRaw || !outPathRaw) {
    throw new Error('Usage: bun run build-csv-from-eval.ts --eval <eval.yaml> --out <out.csv>');
  }

  const evalPath = path.resolve(evalPathRaw);
  const outPath = path.resolve(outPathRaw);

  const yamlText = await fs.readFile(evalPath, 'utf8');
  const parsed = parse(yamlText) as unknown;
  if (!isObject(parsed)) {
    throw new Error(`Invalid eval file: ${evalPathRaw}`);
  }

  const evalcases = (parsed as Record<string, unknown>).evalcases;
  if (!Array.isArray(evalcases)) {
    throw new Error(`Invalid eval file: missing evalcases array: ${evalPathRaw}`);
  }

  const rows: RowRecord[] = [];
  for (const item of evalcases) {
    if (!isObject(item)) continue;
    const row = extractRowFromEvalCase(item);
    if (row) rows.push(row);
  }

  if (rows.length === 0) {
    throw new Error(
      'No rows extracted. Ensure evalcases have a user input_message with object content.request/content.row',
    );
  }

  const headers: (keyof RowRecord)[] = [
    'id',
    'customer_name',
    'origin_country',
    'destination_country',
    'transaction_type',
    'amount',
    'currency',
    'jurisdiction',
    'effective_date',
  ];

  const lines: string[] = [];
  lines.push(headers.join(','));

  for (const row of rows) {
    const line = headers.map((h) => csvEscape(toStringValue(row[h]))).join(',');
    lines.push(line);
  }

  await fs.writeFile(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote CSV (${rows.length} rows): ${outPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
