import fs from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

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

export type EvalRow = {
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

function findFirstUserContentObject(input: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(input)) return undefined;

  for (const msg of input) {
    if (!isObject(msg)) continue;
    if ((msg as Record<string, unknown>).role !== 'user') continue;
    const content = (msg as Record<string, unknown>).content;
    if (!isObject(content)) continue;
    return content as Record<string, unknown>;
  }

  return undefined;
}

export function extractRowsFromEvalYaml(yamlText: string): readonly EvalRow[] {
  const parsed = parse(yamlText) as unknown;
  if (!isObject(parsed)) return [];

  const evalcases =
    (parsed as Record<string, unknown>).tests ?? (parsed as Record<string, unknown>).cases;
  if (!Array.isArray(evalcases)) return [];

  const rows: EvalRow[] = [];
  for (const item of evalcases) {
    if (!isObject(item)) continue;

    const id = typeof item.id === 'string' ? item.id : '';
    if (!id) continue;
    if (id.includes('not-exist')) {
      // Skip placeholder cases that should not reach the CSV artifact.
      continue;
    }

    const content = findFirstUserContentObject(item.input ?? item.input);
    if (!content) continue;

    const request = isObject(content.request) ? (content.request as Record<string, unknown>) : {};
    const row = isObject(content.row) ? (content.row as Record<string, unknown>) : {};

    rows.push({
      id,
      customer_name: typeof row.customer_name === 'string' ? row.customer_name : '',
      origin_country: typeof row.origin_country === 'string' ? row.origin_country : '',
      destination_country:
        typeof row.destination_country === 'string' ? row.destination_country : '',
      transaction_type: typeof row.transaction_type === 'string' ? row.transaction_type : '',
      amount:
        typeof row.amount === 'string' || typeof row.amount === 'number' ? String(row.amount) : '',
      currency: typeof row.currency === 'string' ? row.currency : '',
      jurisdiction: typeof request.jurisdiction === 'string' ? request.jurisdiction : '',
      effective_date: typeof request.effective_date === 'string' ? request.effective_date : '',
    });
  }

  return rows;
}

export function buildCsv(rows: readonly EvalRow[]): string {
  const headers = [
    'id',
    'customer_name',
    'origin_country',
    'destination_country',
    'transaction_type',
    'amount',
    'currency',
    'jurisdiction',
    'effective_date',
  ] as const;
  const lines: string[] = [];
  lines.push(headers.join(','));
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.customer_name,
        row.origin_country,
        row.destination_country,
        row.transaction_type,
        row.amount,
        row.currency,
        row.jurisdiction,
        row.effective_date,
      ]
        .map((v) => csvEscape(v ?? ''))
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
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
  const rows = extractRowsFromEvalYaml(yamlText);

  if (rows.length === 0) {
    throw new Error(
      'No rows extracted. Ensure tests have a user input with object content.request/content.row',
    );
  }

  const csvContent = buildCsv(rows);
  await fs.writeFile(outPath, csvContent, 'utf8');
  console.log(`Wrote CSV (${rows.length} rows): ${outPath}`);
}

// Only run main when executed directly, not when imported
if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
