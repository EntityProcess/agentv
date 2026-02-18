import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { type YAMLSeq, isMap, isSeq, parseDocument } from 'yaml';

import {
  type GenerateRubricsOptions as CoreGenerateRubricsOptions,
  type JsonObject,
  type JsonValue,
  type RubricItem,
  createProvider,
  generateRubrics,
} from '@agentv/core';
import { selectTarget } from '../eval/targets.js';

interface GenerateRubricsOptions {
  readonly file: string;
  readonly target?: string;
  readonly verbose?: boolean;
}

interface RawEvalCase {
  readonly id?: string;
  readonly criteria?: string;
  readonly outcome?: string;
  readonly question?: string;
  readonly reference_answer?: string;
  readonly rubrics?: JsonValue;
  readonly input_messages?: readonly unknown[];
}

interface RawTestSuite {
  readonly cases?: readonly unknown[];
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

// Allow overriding generateRubrics for testing
async function loadRubricGenerator(): Promise<
  (options: CoreGenerateRubricsOptions) => Promise<readonly RubricItem[]>
> {
  const customGenerator = process.env.AGENTEVO_CLI_RUBRIC_GENERATOR;
  if (customGenerator) {
    const generatorPath = path.resolve(customGenerator);
    const generatorUrl = pathToFileURL(generatorPath).href;
    const module = (await import(generatorUrl)) as {
      generateRubrics: (options: CoreGenerateRubricsOptions) => Promise<readonly RubricItem[]>;
    };
    return module.generateRubrics;
  }
  return generateRubrics;
}

export async function generateRubricsCommand(options: GenerateRubricsOptions): Promise<void> {
  const { file, target: targetOverride, verbose } = options;

  console.log(`Generating rubrics for: ${file}`);

  // Read the YAML file
  const absolutePath = path.resolve(file);
  const content = await readFile(absolutePath, 'utf8');
  const doc = parseDocument(content);
  const parsed = doc.toJSON() as unknown;

  if (!isJsonObject(parsed)) {
    throw new Error(`Invalid YAML file format: ${file}`);
  }

  const suite = parsed as RawTestSuite;
  const evalcases = suite.cases;

  if (!Array.isArray(evalcases)) {
    throw new Error(`No cases found in ${file}`);
  }

  // Resolve target using the same logic as eval command
  const targetSelection = await selectTarget({
    testFilePath: absolutePath,
    repoRoot: process.cwd(),
    cwd: process.cwd(),
    cliTargetName: targetOverride,
    dryRun: false,
    dryRunDelay: 0,
    dryRunDelayMin: 0,
    dryRunDelayMax: 0,
    env: process.env,
  });

  if (verbose) {
    console.log(`Using target: ${targetSelection.targetName}`);
  }

  const provider = createProvider(targetSelection.resolvedTarget);
  const generateRubricsFunc = await loadRubricGenerator();

  let updatedCount = 0;
  let skippedCount = 0;

  // Get the cases node from the document for modification
  const evalcasesNode = doc.getIn(['cases']);
  if (!evalcasesNode || !isSeq(evalcasesNode)) {
    throw new Error('cases must be a sequence');
  }

  // Process each eval case
  for (let i = 0; i < evalcases.length; i++) {
    const rawCase = evalcases[i];
    if (!isJsonObject(rawCase)) {
      continue;
    }

    const evalCase = rawCase as RawEvalCase;
    const id = asString(evalCase.id) ?? 'unknown';
    const expectedOutcome = asString(evalCase.criteria) ?? asString(evalCase.outcome);

    // Skip if no expected outcome
    if (!expectedOutcome) {
      if (verbose) {
        console.log(`  Skipping ${id}: no criteria`);
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

    const rubrics = await generateRubricsFunc({
      criteria: expectedOutcome,
      question,
      referenceAnswer,
      provider,
    });

    // Update the eval case with rubrics in the YAML document
    const caseNode = (evalcasesNode as YAMLSeq).items[i];
    if (caseNode && isMap(caseNode)) {
      caseNode.set(
        'rubrics',
        rubrics
          .filter((r) => r.outcome !== undefined)
          .map((r) => ({
            id: r.id,
            outcome: r.outcome,
            weight: r.weight,
            required: r.required ?? true,
          })),
      );
    }

    updatedCount++;

    if (verbose) {
      console.log(`    Generated ${rubrics.length} rubric(s)`);
    }
  }

  // Write back to file
  if (updatedCount > 0) {
    const output = doc.toString();
    await writeFile(absolutePath, output, 'utf8');
    console.log(`\nUpdated ${updatedCount} eval case(s) with generated rubrics`);
    if (skippedCount > 0) {
      console.log(`Skipped ${skippedCount} eval case(s)`);
    }
  } else {
    console.log('\nNo eval cases updated (all already have rubrics or missing criteria)');
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
