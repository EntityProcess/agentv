import type { EvalAssertionConfig, EvalPreprocessor } from './eval.js';

export type GraderCommand = string | readonly string[];

export interface GraderHelperOptions {
  readonly name?: string;
  readonly weight?: number;
  readonly required?: boolean;
  readonly minScore?: number;
  readonly negate?: boolean;
}

export interface GraderCommonConfig {
  readonly name?: string;
  readonly weight?: number;
  readonly required?: boolean;
  readonly minScore?: number;
  readonly negate?: boolean;
}

export interface ContainsGraderConfig extends EvalAssertionConfig, GraderCommonConfig {
  readonly type: 'contains';
  readonly value: string;
}

export interface EqualsGraderConfig extends EvalAssertionConfig, GraderCommonConfig {
  readonly type: 'equals';
  readonly value: string;
}

export interface RegexGraderOptions extends GraderHelperOptions {
  readonly flags?: string;
}

export interface RegexGraderConfig extends EvalAssertionConfig, GraderCommonConfig {
  readonly type: 'regex';
  readonly value: string;
  readonly flags?: string;
}

export interface IsJsonGraderConfig extends EvalAssertionConfig, GraderCommonConfig {
  readonly type: 'is-json';
}

export type GraderRubricOperator = 'correctness' | 'contradiction';

export interface GraderScoreRange {
  readonly scoreRange: readonly [number, number];
  readonly outcome: string;
}

export interface GraderRubric {
  readonly id?: string;
  readonly outcome?: string;
  readonly criteria?: string;
  readonly operator?: GraderRubricOperator;
  readonly weight?: number;
  readonly required?: boolean;
  readonly minScore?: number;
  readonly scoreRanges?: readonly GraderScoreRange[];
}

export type GraderRubricCriterion = string | GraderRubric;

export interface LlmRubricGraderConfig extends EvalAssertionConfig, GraderCommonConfig {
  readonly type: 'llm-rubric';
  readonly value?: unknown;
  readonly target?: string;
}

export interface GraderPromptScriptConfig {
  readonly command: readonly string[];
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface LlmGraderOptions extends GraderHelperOptions {
  readonly prompt?: string | GraderPromptScriptConfig;
  readonly rubrics?: readonly GraderRubric[];
  readonly target?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly maxSteps?: number;
  readonly temperature?: number;
  readonly preprocessors?: readonly EvalPreprocessor[];
}

export interface LlmGraderConfig extends EvalAssertionConfig, GraderCommonConfig {
  readonly type: 'llm-grader';
  readonly prompt?: string | GraderPromptScriptConfig;
  readonly rubrics?: readonly GraderRubric[];
  readonly target?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly maxSteps?: number;
  readonly temperature?: number;
  readonly preprocessors?: readonly EvalPreprocessor[];
}

export interface CodeGraderTargetOptions {
  readonly maxCalls?: number;
}

export interface CodeGraderOptions extends GraderHelperOptions {
  readonly cwd?: string;
  readonly target?: true | CodeGraderTargetOptions;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly preprocessors?: readonly EvalPreprocessor[];
}

export interface ScriptGraderConfig extends EvalAssertionConfig, GraderCommonConfig {
  readonly type: 'script';
  readonly command: GraderCommand;
  readonly cwd?: string;
  readonly target?: true | CodeGraderTargetOptions;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly preprocessors?: readonly EvalPreprocessor[];
}

/** @deprecated Use ScriptGraderConfig with type: 'script'. */
export type CodeGraderConfig = ScriptGraderConfig;

export type GraderHelperConfig =
  | ContainsGraderConfig
  | EqualsGraderConfig
  | RegexGraderConfig
  | IsJsonGraderConfig
  | LlmRubricGraderConfig
  | LlmGraderConfig
  | ScriptGraderConfig;

function withCommon<T extends { readonly type: string }>(
  config: T,
  options: GraderHelperOptions = {},
): T & GraderCommonConfig & EvalAssertionConfig {
  return {
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...config,
    ...(options.weight !== undefined ? { weight: options.weight } : {}),
    ...(options.required !== undefined ? { required: options.required } : {}),
    ...(options.minScore !== undefined ? { minScore: options.minScore } : {}),
    ...(options.negate !== undefined ? { negate: options.negate } : {}),
  } as T & GraderCommonConfig & EvalAssertionConfig;
}

export function containsGrader(value: string, options?: GraderHelperOptions): ContainsGraderConfig {
  return withCommon({ type: 'contains', value }, options);
}

export function equalsGrader(value: string, options?: GraderHelperOptions): EqualsGraderConfig {
  return withCommon({ type: 'equals', value }, options);
}

export function exactGrader(value: string, options?: GraderHelperOptions): EqualsGraderConfig {
  return equalsGrader(value, options);
}

export function regexGrader(
  pattern: string | RegExp,
  options: RegexGraderOptions = {},
): RegexGraderConfig {
  const value = pattern instanceof RegExp ? pattern.source : pattern;
  const flags = options.flags ?? (pattern instanceof RegExp ? pattern.flags : undefined);

  return withCommon(
    {
      type: 'regex',
      value,
      ...(flags ? { flags } : {}),
    },
    options,
  );
}

export function isJsonGrader(options?: GraderHelperOptions): IsJsonGraderConfig {
  return withCommon({ type: 'is-json' }, options);
}

export function jsonGrader(options?: GraderHelperOptions): IsJsonGraderConfig {
  return isJsonGrader(options);
}

export function llmRubricGrader(
  valueOrCriteria: string | readonly GraderRubricCriterion[] | Readonly<Record<string, unknown>>,
  options: GraderHelperOptions & { readonly target?: string } = {},
): LlmRubricGraderConfig {
  return withCommon(
    {
      type: 'llm-rubric',
      value: valueOrCriteria,
      ...(options.target !== undefined ? { target: options.target } : {}),
    },
    options,
  );
}

export function llmGrader(options: LlmGraderOptions = {}): LlmGraderConfig {
  return withCommon(
    {
      type: 'llm-grader',
      ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
      ...(options.rubrics !== undefined ? { rubrics: options.rubrics } : {}),
      ...(options.target !== undefined ? { target: options.target } : {}),
      ...(options.config !== undefined ? { config: options.config } : {}),
      ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.preprocessors !== undefined ? { preprocessors: options.preprocessors } : {}),
    },
    options,
  );
}

export function codeGrader(
  command: GraderCommand,
  options: CodeGraderOptions = {},
): ScriptGraderConfig {
  return scriptGrader(command, options);
}

export function scriptGrader(
  command: GraderCommand,
  options: CodeGraderOptions = {},
): ScriptGraderConfig {
  return withCommon(
    {
      type: 'script',
      command,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.target !== undefined ? { target: options.target } : {}),
      ...(options.config !== undefined ? { config: options.config } : {}),
      ...(options.preprocessors !== undefined ? { preprocessors: options.preprocessors } : {}),
    },
    options,
  );
}

export const graders = Object.freeze({
  contains: containsGrader,
  equals: equalsGrader,
  exact: exactGrader,
  regex: regexGrader,
  isJson: isJsonGrader,
  json: jsonGrader,
  llmRubric: llmRubricGrader,
  llmGrader,
  codeGrader,
  script: scriptGrader,
  scriptGrader,
});

export type GraderCatalog = typeof graders;
