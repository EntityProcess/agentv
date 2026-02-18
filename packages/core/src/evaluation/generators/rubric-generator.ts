import { generateText } from 'ai';
import { z } from 'zod';

import type { Provider } from '../providers/types.js';
import type { RubricItem } from '../types.js';

const rubricItemSchema = z.object({
  id: z.string().describe('Short identifier for this rubric (e.g., clarity, completeness)'),
  outcome: z.string().describe('Concrete expected outcome for this rubric item'),
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
export async function generateRubrics(
  options: GenerateRubricsOptions,
): Promise<readonly RubricItem[]> {
  const { expectedOutcome, question, referenceAnswer, provider } = options;

  const prompt = buildPrompt(expectedOutcome, question, referenceAnswer);

  const model = provider.asLanguageModel?.();
  if (!model) {
    throw new Error('Provider does not support language model interface');
  }

  const system = `You are an expert at creating evaluation rubrics.
You must return a valid JSON object matching this schema:
{
  "rubrics": [
    {
      "id": "string (short identifier)",
      "outcome": "string (concrete expected outcome for this rubric item)",
      "weight": number (default 1.0),
      "required": boolean (default true)
    }
  ]
}`;

  let result: z.infer<typeof rubricGenerationSchema> | undefined;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { text } = await generateText({
        model,
        system,
        prompt,
      });

      const cleaned = text.replace(/```json\n?|```/g, '').trim();
      result = rubricGenerationSchema.parse(JSON.parse(cleaned));
      break;
    } catch (e: unknown) {
      lastError = e instanceof Error ? e : new Error(String(e));
      // Continue to next attempt
    }
  }

  if (!result) {
    throw new Error(`Failed to parse generated rubrics after 3 attempts: ${lastError?.message}`);
  }

  return result.rubrics;
}

function buildPrompt(expectedOutcome: string, question?: string, referenceAnswer?: string): string {
  const parts: string[] = [
    'You are an expert at creating evaluation rubrics.',
    'Given the expected outcome (and optionally the question and reference answer),',
    'generate a list of specific, measurable rubric items to evaluate whether an answer meets the expected outcome.',
    '',
    'Each rubric should:',
    '- Be specific and testable',
    '- Have a short, descriptive ID',
    '- Include a clear expected outcome statement (what a good answer must demonstrate for this rubric)',
    '- Indicate if it is required (mandatory) or optional',
    '- Have an appropriate weight (default 1.0, use higher values for more important aspects)',
    '',
    'Generate 3-7 rubric items that comprehensively cover the expected outcome.',
    '',
    '[[ ## criteria ## ]]',
    expectedOutcome,
    '',
  ];

  if (question && question.trim().length > 0) {
    parts.push('[[ ## question ## ]]', question, '');
  }

  if (referenceAnswer && referenceAnswer.trim().length > 0) {
    parts.push('[[ ## reference_answer ## ]]', referenceAnswer, '');
  }

  return parts.join('\n');
}
