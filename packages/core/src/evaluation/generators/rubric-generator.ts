import { generateObject } from 'ai';
import { z } from 'zod';

import type { Provider } from '../providers/types.js';
import type { RubricItem } from '../types.js';

const rubricItemSchema = z.object({
  id: z.string().describe('Short identifier for this rubric (e.g., clarity, completeness)'),
  description: z.string().describe('What this rubric checks for'),
  weight: z.number().default(1.0).describe('Relative importance (default 1.0)'),
  required: z.boolean().default(true).describe('Whether this is a mandatory requirement'),
});

const rubricGenerationSchema = z.object({
  rubrics: z.array(rubricItemSchema).describe('List of evaluation rubrics'),
});

export interface GenerateRubricsOptions {
  readonly expectedOutcome: string;
  readonly question?: string;
  readonly referenceAnswer?: string;
  readonly provider: Provider;
}

/**
 * Generate rubrics from expected outcome using an LLM.
 */
export async function generateRubrics(options: GenerateRubricsOptions): Promise<readonly RubricItem[]> {
  const { expectedOutcome, question, referenceAnswer, provider } = options;

  const prompt = buildPrompt(expectedOutcome, question, referenceAnswer);

  const model = provider.asLanguageModel?.();
  if (!model) {
    throw new Error('Provider does not support language model interface');
  }

  const { object: result } = await generateObject({
    model,
    schema: rubricGenerationSchema,
    prompt,
  });

  return result.rubrics;
}

function buildPrompt(
  expectedOutcome: string,
  question?: string,
  referenceAnswer?: string,
): string {
  const parts: string[] = [
    'You are an expert at creating evaluation rubrics.',
    'Given the expected outcome (and optionally the question and reference answer),',
    'generate a list of specific, measurable rubric items to evaluate whether an answer meets the expected outcome.',
    '',
    'Each rubric should:',
    '- Be specific and testable',
    '- Have a short, descriptive ID',
    '- Include a clear description of what to check',
    '- Indicate if it is required (mandatory) or optional',
    '- Have an appropriate weight (default 1.0, use higher values for more important aspects)',
    '',
    'Generate 3-7 rubric items that comprehensively cover the expected outcome.',
    '',
    '[[ Expected Outcome ]]',
    expectedOutcome,
    '',
  ];

  if (question && question.trim().length > 0) {
    parts.push('[[ Question ]]', question, '');
  }

  if (referenceAnswer && referenceAnswer.trim().length > 0) {
    parts.push('[[ Reference Answer ]]', referenceAnswer, '');
  }

  return parts.join('\n');
}
