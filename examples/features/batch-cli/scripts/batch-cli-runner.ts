import fs from 'node:fs/promises';
import path from 'node:path';

import { buildCsv, extractRowsFromEvalYaml } from './build-csv-from-eval.ts';

// Batch CLI runner that processes CSV files for AML screening and outputs JSONL with output_messages for trace extraction.

function getFlag(args: readonly string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function parseCsvLine(line: string): string[] {
  // Minimal RFC4180-ish parser for this demo (supports quoted cells).
  const out: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === ',') {
      out.push(current);
      current = '';
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--healthcheck')) {
    console.log('batch-cli-runner: healthy');
    return;
  }

  const evalPathRaw = getFlag(args, '--eval-input');
  const csvPathRaw = getFlag(args, '--csv-input');
  const outPathRaw = getFlag(args, '--output');
  if (!csvPathRaw || !outPathRaw) {
    throw new Error(
      'Usage: bun run batch-cli-runner.ts --csv-input <AmlScreeningInput.csv> --output <out.jsonl> [--eval-input <eval.yaml>]',
    );
  }

  const csvPath = path.resolve(csvPathRaw);
  const outPath = path.resolve(outPathRaw);

  if (evalPathRaw) {
    const evalPath = path.resolve(evalPathRaw);
    const yamlText = await fs.readFile(evalPath, 'utf8');
    const rows = extractRowsFromEvalYaml(yamlText);
    if (rows.length === 0) {
      throw new Error(`No rows extracted from eval file: ${evalPathRaw}`);
    }
    await fs.writeFile(csvPath, buildCsv(rows), 'utf8');
  }

  const csvText = await fs.readFile(csvPath, 'utf8');
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error(`CSV has no data rows: ${csvPath}`);
  }

  const header = parseCsvLine(lines[0]);
  const idx = (name: string): number => header.indexOf(name);

  const idIndex = idx('id');
  const originCountryIndex = idx('origin_country');
  const destinationCountryIndex = idx('destination_country');
  const amountIndex = idx('amount');
  const currencyIndex = idx('currency');

  if (idIndex === -1) {
    throw new Error("CSV missing required header column 'id'");
  }

  type OutputRecord = {
    id: string;
    text: string;
    output_messages: Array<{
      role: string;
      tool_calls?: Array<{
        tool: string;
        input?: unknown;
        output?: unknown;
      }>;
      content?: unknown;
    }>;
  };

  const records: OutputRecord[] = [];

  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const id = cols[idIndex] ?? '';
    if (!id) continue;

    const originCountry = originCountryIndex !== -1 ? (cols[originCountryIndex] ?? '') : '';
    const destinationCountry =
      destinationCountryIndex !== -1 ? (cols[destinationCountryIndex] ?? '') : '';
    const amountRaw = amountIndex !== -1 ? (cols[amountIndex] ?? '') : '';
    const currency = currencyIndex !== -1 ? (cols[currencyIndex] ?? '') : '';

    const amount = Number.parseFloat(amountRaw);

    // Deterministic demo rule (synthetic):
    // - REVIEW if origin/destination is in a high-risk list OR amount >= 10,000.
    // - otherwise CLEAR.
    const highRiskCountries = new Set(['IR', 'KP']);
    const isHighRiskCountry =
      highRiskCountries.has(originCountry) || highRiskCountries.has(destinationCountry);
    const isHighValue = Number.isFinite(amount) && amount >= 10_000;
    const decision = isHighRiskCountry || isHighValue ? 'REVIEW' : 'CLEAR';

    const reasons: string[] = [];
    if (isHighRiskCountry) reasons.push('high_risk_country');
    if (isHighValue) reasons.push('high_value_amount');

    const payload = {
      id,
      decision,
      rule: 'aml_screening_synthetic',
      reasons,
      amount: Number.isFinite(amount) ? amount : amountRaw,
      currency,
    };

    // Build output_messages with tool_calls for trace extraction
    // This demonstrates the new output_messages format that AgentV can extract traces from
    records.push({
      id,
      text: JSON.stringify(payload),
      output_messages: [
        {
          role: 'assistant',
          tool_calls: [
            {
              tool: 'aml_screening',
              input: {
                origin_country: originCountry,
                destination_country: destinationCountry,
                amount: Number.isFinite(amount) ? amount : amountRaw,
                currency,
              },
              output: {
                decision,
                reasons,
              },
            },
          ],
        },
        {
          role: 'assistant',
          content: payload,
        },
      ],
    });
  }

  const jsonl = `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
  await fs.writeFile(outPath, jsonl, 'utf8');

  // Also write a stable artifact in the working directory for convenience.
  const stablePath = path.resolve(process.cwd(), 'agentv-evalresult.jsonl');
  await fs.writeFile(stablePath, jsonl, 'utf8');
}

main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
