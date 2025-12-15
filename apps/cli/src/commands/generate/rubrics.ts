import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify, parse } from 'yaml';

import {
  createProvider,
  generateRubrics,
  resolveTargetDefinition,
  type JsonObject,
  type JsonValue,
} from '@agentv/core';

interface GenerateRubricsOptions {
  readonly file: string;
  readonly target?: string;
  readonly verbose?: boolean;
}

interface RawEvalCase {
  readonly id?: string;
  readonly expected_outcome?: string;
  readonly outcome?: string;
  readonly question?: string;
  readonly reference_answer?: string;
  readonly rubrics?: JsonValue;
  readonly input_messages?: readonly unknown[];
}

interface RawTestSuite {
  readonly evalcases?: readonly unknown[];
  readonly target?: string;
  readonly execution?: {
    readonly target?: string;
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function generateRubricsCommand(options: GenerateRubricsOptions): Promise<void> {
  const { file, target: targetOverride, verbose } = options;

  console.log(`Generating rubrics for: ${file}`);

  // Read the YAML file
  const absolutePath = path.resolve(file);
  const content = await readFile(absolutePath, 'utf8');
  const parsed = parse(content) as unknown;

  if (!isJsonObject(parsed)) {
    throw new Error(`Invalid YAML file format: ${file}`);
  }

  const suite = parsed as RawTestSuite;
  const evalcases = suite.evalcases;

  if (!Array.isArray(evalcases)) {
    throw new Error(`No evalcases found in ${file}`);
  }

  // Determine target
  const targetFromSuite = asString(suite.execution?.target) ?? asString(suite.target);
  const targetName = targetOverride ?? targetFromSuite ?? 'openai:gpt-4o';

  if (verbose) {
    console.log(`Using target: ${targetName}`);
  }

  // Resolve target and create provider
  const resolvedTarget = await resolveTargetDefinition(
    { name: targetName, provider: targetName.split(':')[0] as 'azure' | 'anthropic' | 'gemini' },
    process.env,
  );
  const provider = createProvider(resolvedTarget);

  let updatedCount = 0;
  let skippedCount = 0;

  // Process each eval case
  for (const rawCase of evalcases) {
    if (!isJsonObject(rawCase)) {
      continue;
    }

    const evalCase = rawCase as RawEvalCase;
    const id = asString(evalCase.id) ?? 'unknown';
    const expectedOutcome = asString(evalCase.expected_outcome) ?? asString(evalCase.outcome);

    // Skip if no expected outcome
    if (!expectedOutcome) {
      if (verbose) {
        console.log(`  Skipping ${id}: no expected_outcome`);
      }
      skippedCount++;
      continue;
    }

    // Skip if rubrics already exist
    if (evalCase.rubrics !== undefined) {
      if (verbose) {
        console.log(`  Skipping ${id}: rubrics already defined`);
      }
      skippedCount++;
      continue;
    }

    // Generate rubrics
    console.log(`  Generating rubrics for: ${id}`);

    const question = extractQuestion(evalCase);
    const referenceAnswer = asString(evalCase.reference_answer);

    const rubrics = await generateRubrics({
      expectedOutcome,
      question,
      referenceAnswer,
      provider,
    });

    // Update the eval case with rubrics
    (rawCase as Record<string, unknown>).rubrics = rubrics.map((r: { id: string; description: string; weight: number; required: boolean }) => ({
      id: r.id,
      description: r.description,
      weight: r.weight,
      required: r.required,
    }));

    updatedCount++;

    if (verbose) {
      console.log(`    Generated ${rubrics.length} rubric(s)`);
    }
  }

  // Write back to file
  if (updatedCount > 0) {
    const output = stringify(parsed, { lineWidth: 0 });
    await writeFile(absolutePath, output, 'utf8');
    console.log(`\nUpdated ${updatedCount} eval case(s) with generated rubrics`);
    if (skippedCount > 0) {
      console.log(`Skipped ${skippedCount} eval case(s)`);
    }
  } else {
    console.log('\nNo eval cases updated (all already have rubrics or missing expected_outcome)');
  }
}

function extractQuestion(evalCase: RawEvalCase): string | undefined {
  const explicitQuestion = asString(evalCase.question);
  if (explicitQuestion) {
    return explicitQuestion;
  }

  // Try to extract from input_messages
  const inputMessages = evalCase.input_messages;
  if (!Array.isArray(inputMessages)) {
    return undefined;
  }

  for (const msg of inputMessages) {
    if (!isJsonObject(msg)) {
      continue;
    }
    if (msg.role === 'user' && typeof msg.content === 'string') {
      return msg.content;
    }
  }

  return undefined;
}
