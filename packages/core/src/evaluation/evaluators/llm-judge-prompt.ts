import type { OutputMessage } from '../providers/types.js';
import { TEMPLATE_VARIABLES } from '../template-variables.js';
import type { EvalCase, LlmJudgeEvaluatorConfig, RubricItem } from '../types.js';
import type { PromptInputs } from '../yaml-parser.js';
import {
  DEFAULT_EVALUATOR_TEMPLATE,
  buildOutputSchema,
  buildRubricOutputSchema,
  buildScoreRangeOutputSchema,
  substituteVariables,
} from './llm-judge.js';

export interface LlmJudgePromptAssembly {
  systemPrompt: string;
  userPrompt: string;
  responseSchema: string;
  mode: 'freeform' | 'checklist' | 'score_range';
}

export function assembleLlmJudgePrompt(input: {
  evalCase: EvalCase;
  candidate: string;
  promptInputs: PromptInputs;
  evaluatorConfig?: LlmJudgeEvaluatorConfig;
  outputMessages?: readonly OutputMessage[];
  fileChanges?: string;
  evaluatorTemplateOverride?: string;
}): LlmJudgePromptAssembly {
  const {
    evalCase,
    candidate,
    promptInputs,
    evaluatorConfig,
    fileChanges,
    evaluatorTemplateOverride,
  } = input;

  const rubrics = evaluatorConfig?.rubrics;

  // Detect mode
  if (rubrics && rubrics.length > 0) {
    const hasScoreRanges = rubrics.some((r) => r.score_ranges && r.score_ranges.length > 0);
    if (hasScoreRanges) {
      return assembleScoreRange(evalCase, candidate, promptInputs, rubrics);
    }
    return assembleChecklist(evalCase, candidate, promptInputs, rubrics);
  }

  return assembleFreeform(
    evalCase,
    candidate,
    promptInputs,
    fileChanges,
    evaluatorTemplateOverride,
  );
}

function assembleFreeform(
  evalCase: EvalCase,
  candidate: string,
  promptInputs: PromptInputs,
  fileChanges?: string,
  evaluatorTemplateOverride?: string,
): LlmJudgePromptAssembly {
  const formattedQuestion =
    promptInputs.question && promptInputs.question.trim().length > 0
      ? promptInputs.question
      : evalCase.question;

  const variables = {
    [TEMPLATE_VARIABLES.INPUT_MESSAGES]: JSON.stringify(evalCase.input_segments, null, 2),
    [TEMPLATE_VARIABLES.EXPECTED_MESSAGES]: JSON.stringify(evalCase.expected_messages, null, 2),
    [TEMPLATE_VARIABLES.OUTPUT_MESSAGES]: JSON.stringify([], null, 2),
    [TEMPLATE_VARIABLES.CANDIDATE_ANSWER]: candidate.trim(),
    [TEMPLATE_VARIABLES.REFERENCE_ANSWER]: (evalCase.reference_answer ?? '').trim(),
    [TEMPLATE_VARIABLES.EXPECTED_OUTCOME]: evalCase.expected_outcome.trim(),
    [TEMPLATE_VARIABLES.QUESTION]: formattedQuestion.trim(),
    [TEMPLATE_VARIABLES.FILE_CHANGES]: fileChanges ?? '',
  };

  const systemPrompt = buildOutputSchema();
  const template = evaluatorTemplateOverride ?? DEFAULT_EVALUATOR_TEMPLATE;
  let userPrompt = substituteVariables(template, variables);

  // Append file_changes section to default template only when present
  if (fileChanges && !evaluatorTemplateOverride) {
    userPrompt += `\n\n[[ ## file_changes ## ]]\n${fileChanges}`;
  }

  return {
    systemPrompt,
    userPrompt,
    responseSchema: systemPrompt,
    mode: 'freeform',
  };
}

function assembleChecklist(
  evalCase: EvalCase,
  candidate: string,
  promptInputs: PromptInputs,
  rubrics: readonly RubricItem[],
): LlmJudgePromptAssembly {
  const formattedQuestion =
    promptInputs.question && promptInputs.question.trim().length > 0
      ? promptInputs.question
      : evalCase.question;

  const parts: string[] = [
    'You are an expert evaluator. Evaluate the candidate answer against each rubric item below.',
    '',
    '[[ ## question ## ]]',
    formattedQuestion,
    '',
    '[[ ## expected_outcome ## ]]',
    evalCase.expected_outcome,
    '',
  ];

  if (evalCase.reference_answer && evalCase.reference_answer.trim().length > 0) {
    parts.push('[[ ## reference_answer ## ]]', evalCase.reference_answer, '');
  }

  parts.push('[[ ## candidate_answer ## ]]', candidate, '', '[[ ## rubrics ## ]]');

  for (const rubric of rubrics) {
    const requiredLabel = rubric.required ? ' (REQUIRED)' : '';
    const weightLabel = rubric.weight !== 1.0 ? ` (weight: ${rubric.weight})` : '';
    parts.push(`- [${rubric.id}]${requiredLabel}${weightLabel}: ${rubric.expected_outcome}`);
  }

  parts.push('', 'For each rubric, determine if it is satisfied and provide brief reasoning.');

  const systemPrompt = buildRubricOutputSchema();
  const userPrompt = parts.join('\n');

  return {
    systemPrompt,
    userPrompt,
    responseSchema: systemPrompt,
    mode: 'checklist',
  };
}

function assembleScoreRange(
  evalCase: EvalCase,
  candidate: string,
  promptInputs: PromptInputs,
  rubrics: readonly RubricItem[],
): LlmJudgePromptAssembly {
  const formattedQuestion =
    promptInputs.question && promptInputs.question.trim().length > 0
      ? promptInputs.question
      : evalCase.question;

  const parts: string[] = [
    'You are an expert evaluator. Score the candidate answer on each criterion below using the provided score ranges.',
    'For each criterion, output an integer score from 0 to 10 based on which score range best matches the answer.',
    '',
    '[[ ## question ## ]]',
    formattedQuestion,
    '',
    '[[ ## expected_outcome ## ]]',
    evalCase.expected_outcome,
    '',
  ];

  if (evalCase.reference_answer && evalCase.reference_answer.trim().length > 0) {
    parts.push('[[ ## reference_answer ## ]]', evalCase.reference_answer, '');
  }

  parts.push('[[ ## candidate_answer ## ]]', candidate, '', '[[ ## scoring_criteria ## ]]');

  for (const rubric of rubrics) {
    const weightLabel = rubric.weight !== 1.0 ? ` (weight: ${rubric.weight})` : '';
    const minScoreLabel =
      rubric.required_min_score !== undefined
        ? ` [REQUIRED: min score ${rubric.required_min_score}]`
        : '';

    parts.push('', `### Criterion: ${rubric.id}${weightLabel}${minScoreLabel}`);

    if (rubric.expected_outcome) {
      parts.push(`Description: ${rubric.expected_outcome}`);
    }

    if (rubric.score_ranges && rubric.score_ranges.length > 0) {
      parts.push('Score ranges:');
      for (const range of rubric.score_ranges) {
        const [min, max] = range.score_range;
        const rangeLabel = min === max ? `${min}` : `${min}-${max}`;
        parts.push(`  - Score ${rangeLabel}: ${range.expected_outcome}`);
      }
    }
  }

  parts.push(
    '',
    'For each criterion, provide an integer score 0-10 that matches one of its defined score ranges.',
  );

  const systemPrompt = buildScoreRangeOutputSchema();
  const userPrompt = parts.join('\n');

  return {
    systemPrompt,
    userPrompt,
    responseSchema: systemPrompt,
    mode: 'score_range',
  };
}
