import type { Message } from '../providers/types.js';
import { TEMPLATE_VARIABLES } from '../template-variables.js';
import type { EvalTest, LlmGraderConfig, RubricItem } from '../types.js';
import type { PromptInputs } from '../yaml-parser.js';
import {
  DEFAULT_GRADER_TEMPLATE,
  buildOutputSchema,
  buildRubricOutputSchema,
  buildScoreRangeOutputSchema,
  substituteVariables,
} from './llm-grader.js';

export interface LlmGraderPromptAssembly {
  systemPrompt: string;
  userPrompt: string;
  responseSchema: string;
  mode: 'freeform' | 'checklist' | 'score_range';
}

export function assembleLlmGraderPrompt(input: {
  evalCase: EvalTest;
  candidate: string;
  promptInputs: PromptInputs;
  evaluatorConfig?: LlmGraderConfig;
  output?: readonly Message[];
  fileChanges?: string;
  toolCalls?: string;
  graderTemplateOverride?: string;
}): LlmGraderPromptAssembly {
  const {
    evalCase,
    candidate,
    promptInputs,
    evaluatorConfig,
    fileChanges,
    toolCalls,
    graderTemplateOverride,
  } = input;

  const rubrics = evaluatorConfig?.rubrics;

  // Detect mode
  if (rubrics && rubrics.length > 0) {
    const hasScoreRanges = rubrics.some((r) => r.score_ranges && r.score_ranges.length > 0);
    if (hasScoreRanges) {
      return assembleScoreRange(evalCase, candidate, promptInputs, rubrics, fileChanges, toolCalls);
    }
    return assembleChecklist(evalCase, candidate, promptInputs, rubrics, fileChanges, toolCalls);
  }

  return assembleFreeform(
    evalCase,
    candidate,
    promptInputs,
    fileChanges,
    toolCalls,
    graderTemplateOverride,
  );
}

function assembleFreeform(
  evalCase: EvalTest,
  candidate: string,
  promptInputs: PromptInputs,
  fileChanges?: string,
  toolCalls?: string,
  graderTemplateOverride?: string,
): LlmGraderPromptAssembly {
  const formattedQuestion =
    promptInputs.question && promptInputs.question.trim().length > 0
      ? promptInputs.question
      : evalCase.question;

  const variables = {
    [TEMPLATE_VARIABLES.INPUT]: formattedQuestion.trim(),
    [TEMPLATE_VARIABLES.OUTPUT]: candidate.trim(),
    [TEMPLATE_VARIABLES.EXPECTED_OUTPUT]: (evalCase.reference_answer ?? '').trim(),
    [TEMPLATE_VARIABLES.CRITERIA]: evalCase.criteria.trim(),
    [TEMPLATE_VARIABLES.FILE_CHANGES]: fileChanges ?? '',
    [TEMPLATE_VARIABLES.TOOL_CALLS]: toolCalls ?? '',
    // Deprecated aliases
    [TEMPLATE_VARIABLES.INPUT_TEXT]: formattedQuestion.trim(),
    [TEMPLATE_VARIABLES.OUTPUT_TEXT]: candidate.trim(),
    [TEMPLATE_VARIABLES.EXPECTED_OUTPUT_TEXT]: (evalCase.reference_answer ?? '').trim(),
  };

  const systemPrompt = buildOutputSchema();
  const template = graderTemplateOverride ?? DEFAULT_GRADER_TEMPLATE;
  let userPrompt = substituteVariables(template, variables);

  // Append file_changes and tool_calls sections to default template only when present
  if (fileChanges && !graderTemplateOverride) {
    userPrompt += `\n\n[[ ## file_changes ## ]]\n${fileChanges}`;
  }
  if (toolCalls && !graderTemplateOverride) {
    userPrompt += `\n\n[[ ## tool_calls ## ]]\n${toolCalls}`;
  }

  return {
    systemPrompt,
    userPrompt,
    responseSchema: systemPrompt,
    mode: 'freeform',
  };
}

function assembleChecklist(
  evalCase: EvalTest,
  candidate: string,
  promptInputs: PromptInputs,
  rubrics: readonly RubricItem[],
  fileChanges?: string,
  toolCalls?: string,
): LlmGraderPromptAssembly {
  const formattedQuestion =
    promptInputs.question && promptInputs.question.trim().length > 0
      ? promptInputs.question
      : evalCase.question;

  const parts: string[] = [
    'You are an expert grader. Evaluate the candidate answer against each rubric item below.',
    '',
    '[[ ## question ## ]]',
    formattedQuestion,
    '',
    '[[ ## criteria ## ]]',
    evalCase.criteria,
    '',
  ];

  if (evalCase.reference_answer && evalCase.reference_answer.trim().length > 0) {
    parts.push('[[ ## reference_answer ## ]]', evalCase.reference_answer, '');
  }

  parts.push('[[ ## answer ## ]]', candidate, '');

  if (fileChanges) {
    parts.push('[[ ## file_changes ## ]]', fileChanges, '');
  }

  if (toolCalls) {
    parts.push('[[ ## tool_calls ## ]]', toolCalls, '');
  }

  parts.push('[[ ## rubrics ## ]]');

  for (const rubric of rubrics) {
    const requiredLabel = rubric.required ? ' (REQUIRED)' : '';
    const weightLabel = rubric.weight !== 1.0 ? ` (weight: ${rubric.weight})` : '';
    parts.push(`- [${rubric.id}]${requiredLabel}${weightLabel}: ${rubric.outcome}`);
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
  evalCase: EvalTest,
  candidate: string,
  promptInputs: PromptInputs,
  rubrics: readonly RubricItem[],
  fileChanges?: string,
  toolCalls?: string,
): LlmGraderPromptAssembly {
  const formattedQuestion =
    promptInputs.question && promptInputs.question.trim().length > 0
      ? promptInputs.question
      : evalCase.question;

  const parts: string[] = [
    'You are an expert grader. Score the candidate answer on each criterion below using the provided score ranges.',
    'For each criterion, output an integer score from 0 to 10 based on which score range best matches the answer.',
    '',
    '[[ ## question ## ]]',
    formattedQuestion,
    '',
    '[[ ## criteria ## ]]',
    evalCase.criteria,
    '',
  ];

  if (evalCase.reference_answer && evalCase.reference_answer.trim().length > 0) {
    parts.push('[[ ## reference_answer ## ]]', evalCase.reference_answer, '');
  }

  parts.push('[[ ## answer ## ]]', candidate, '');

  if (fileChanges) {
    parts.push('[[ ## file_changes ## ]]', fileChanges, '');
  }

  if (toolCalls) {
    parts.push('[[ ## tool_calls ## ]]', toolCalls, '');
  }

  parts.push('[[ ## scoring_criteria ## ]]');

  for (const rubric of rubrics) {
    const weightLabel = rubric.weight !== 1.0 ? ` (weight: ${rubric.weight})` : '';
    const minScoreLabel =
      rubric.required_min_score !== undefined
        ? ` [REQUIRED: min score ${rubric.required_min_score}]`
        : '';

    parts.push('', `### Criterion: ${rubric.id}${weightLabel}${minScoreLabel}`);

    if (rubric.outcome) {
      parts.push(`Description: ${rubric.outcome}`);
    }

    if (rubric.score_ranges && rubric.score_ranges.length > 0) {
      parts.push('Score ranges:');
      for (const range of rubric.score_ranges) {
        const [min, max] = range.score_range;
        const rangeLabel = min === max ? `${min}` : `${min}-${max}`;
        parts.push(`  - Score ${rangeLabel}: ${range.outcome}`);
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
