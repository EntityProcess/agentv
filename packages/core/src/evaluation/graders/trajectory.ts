import { isDeepStrictEqual } from 'node:util';

import type { Trace, TraceEvent } from '../trace.js';
import type { AssertionEntry, JsonValue, TrajectoryGraderConfig } from '../types.js';
import { negateScore, scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Grader } from './types.js';

type TrajectoryStepType = 'command' | 'message' | 'reasoning' | 'search' | 'span' | 'tool';
type TrajectoryAttributes = Readonly<Record<string, unknown>>;

interface TrajectoryStepMatcher {
  readonly name?: string;
  readonly pattern?: string;
  readonly type?: TrajectoryStepType | readonly TrajectoryStepType[];
}

interface TrajectoryStep {
  readonly aliases: readonly string[];
  readonly args?: unknown;
  readonly attributes: TrajectoryAttributes;
  readonly name: string;
  readonly spanName: string;
  readonly startTime?: string;
  readonly type: TrajectoryStepType;
}

interface TrajectoryCountValue extends TrajectoryStepMatcher {
  readonly max?: number;
  readonly min?: number;
}

interface TrajectorySequenceValue {
  readonly mode?: 'exact' | 'in_order';
  readonly steps: readonly (string | TrajectoryStepMatcher)[];
}

interface TrajectoryToolArgsMatchValue extends TrajectoryStepMatcher {
  readonly args?: unknown;
  readonly arguments?: unknown;
  readonly defaults?: Record<string, unknown>;
  readonly ignore?: string | readonly string[];
  readonly mode?: 'exact' | 'partial';
}

const COMMAND_TOOL_NAMES = new Set(['exec_command', 'local_shell', 'shell']);
const SEARCH_NAME_PATTERN = /(^|[\s._:/-])(search|find|lookup|retriev(?:e|al))($|[\s._:/-])/i;

export interface TrajectoryGraderOptions {
  readonly config: TrajectoryGraderConfig;
  readonly llmGrader?: Grader;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesPattern(value: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regexPattern}$`, 'i').test(value);
}

function normalizeStructuredValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function getFirstString(values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function commandFromInput(input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const command = input.cmd ?? input.command ?? input.commands;
  if (typeof command === 'string' && command.trim()) {
    return command.trim();
  }
  if (Array.isArray(command)) {
    const joined = command
      .map((part) => String(part).trim())
      .filter(Boolean)
      .join(command === input.commands ? '; ' : ' ');
    return joined || undefined;
  }
  return undefined;
}

function executableFromCommand(command: string): string | undefined {
  return command.trim().split(/\s+/)[0] || undefined;
}

function classifyMessageStep(event: TraceEvent): TrajectoryStepType {
  const itemType =
    event.metadata?.['codex.item.type'] ?? event.message?.metadata?.['codex.item.type'];
  if (itemType === 'reasoning') {
    return 'reasoning';
  }
  return 'message';
}

function eventToTrajectoryStep(event: TraceEvent): TrajectoryStep {
  const attributes = {
    ...(event.metadata ?? {}),
    ...(event.message?.metadata ?? {}),
    ...(event.tool?.metadata ?? {}),
  };

  if (event.type === 'tool_call' && event.tool) {
    const toolName = event.tool.name;
    const args = normalizeStructuredValue(event.tool.input);
    const command = COMMAND_TOOL_NAMES.has(toolName.toLowerCase())
      ? commandFromInput(args)
      : undefined;
    if (command) {
      const aliases = new Set([command, toolName]);
      const executable = executableFromCommand(command);
      if (executable) {
        aliases.add(executable);
      }
      return {
        aliases: [...aliases],
        ...(args === undefined ? {} : { args }),
        attributes,
        name: command,
        spanName: toolName,
        startTime: event.timestamp,
        type: 'command',
      };
    }

    return {
      aliases: [toolName],
      ...(args === undefined ? {} : { args }),
      attributes,
      name: toolName,
      spanName: toolName,
      startTime: event.timestamp,
      type: 'tool',
    };
  }

  const messageName = event.message?.name ?? event.type;
  const query = getFirstString([event.metadata?.query, event.metadata?.search_query]);
  if (query && SEARCH_NAME_PATTERN.test(messageName)) {
    return {
      aliases: [query, messageName],
      attributes,
      name: query,
      spanName: messageName,
      startTime: event.timestamp,
      type: 'search',
    };
  }

  const messageType = event.type === 'message' || event.type === 'final_response';
  const type = messageType ? classifyMessageStep(event) : 'span';
  return {
    aliases: [messageName, type],
    attributes,
    name: messageName,
    spanName: messageName,
    startTime: event.timestamp,
    type,
  };
}

function extractTrajectorySteps(trace: Trace): readonly TrajectoryStep[] {
  return [...trace.events]
    .sort((left, right) => {
      const leftTime = left.timestamp ? Date.parse(left.timestamp) : Number.NaN;
      const rightTime = right.timestamp ? Date.parse(right.timestamp) : Number.NaN;
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.ordinal - right.ordinal;
    })
    .map(eventToTrajectoryStep);
}

function normalizeMatcher(
  matcher: string | TrajectoryStepMatcher,
  defaultType?: TrajectoryStepType,
): TrajectoryStepMatcher {
  if (typeof matcher === 'string') {
    return { pattern: matcher, ...(defaultType ? { type: defaultType } : {}) };
  }
  return { ...matcher, ...(matcher.type ? {} : defaultType ? { type: defaultType } : {}) };
}

function matchesTrajectoryStep(
  step: TrajectoryStep,
  matcher: string | TrajectoryStepMatcher,
  defaultType?: TrajectoryStepType,
): boolean {
  const normalized = normalizeMatcher(matcher, defaultType);
  if (normalized.type) {
    const allowedTypes = Array.isArray(normalized.type) ? normalized.type : [normalized.type];
    if (!allowedTypes.includes(step.type)) {
      return false;
    }
  }
  const matchPattern = normalized.pattern ?? normalized.name;
  return matchPattern ? step.aliases.some((alias) => matchesPattern(alias, matchPattern)) : true;
}

function formatStep(step: TrajectoryStep): string {
  return `${step.type}:${step.name}`;
}

function formatArgs(args: unknown): string {
  if (args === undefined) {
    return '(none)';
  }
  try {
    return JSON.stringify(args) ?? String(args);
  } catch {
    return String(args);
  }
}

function formatStepList(stepLabels: readonly string[]): string {
  return stepLabels.length > 0 ? stepLabels.join(', ') : '(none)';
}

function score(pass: boolean, text: string): EvaluationScore {
  return {
    score: pass ? 1 : 0,
    verdict: scoreToVerdict(pass ? 1 : 0),
    assertions: [{ text, passed: pass }],
    expectedAspectCount: 1,
  };
}

function missingTrace(type: string): EvaluationScore {
  return score(false, `No trace data available for ${type} assertion`);
}

function requireNamedMatcher(
  matcher: TrajectoryStepMatcher,
  assertionType: string,
  index?: number,
): void {
  if (matcher.pattern || matcher.name) {
    return;
  }
  const label = index === undefined ? 'object' : `step ${index + 1}`;
  throw new Error(`${assertionType} assertion ${label} must include a name or pattern property`);
}

function resolveToolMatchers(
  value: unknown,
):
  | { readonly kind: 'list'; readonly matchers: readonly TrajectoryStepMatcher[] }
  | { readonly kind: 'count'; readonly matcher: TrajectoryCountValue } {
  if (typeof value === 'string') {
    return { kind: 'list', matchers: [normalizeMatcher(value, 'tool')] };
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return { kind: 'list', matchers: value.map((item) => normalizeMatcher(item, 'tool')) };
  }
  if (isRecord(value)) {
    const matcher = normalizeMatcher(value as TrajectoryStepMatcher, 'tool');
    return {
      kind: 'count',
      matcher: {
        ...matcher,
        ...(typeof value.min === 'number' ? { min: value.min } : {}),
        ...(typeof value.max === 'number' ? { max: value.max } : {}),
      },
    };
  }
  throw new Error(
    'trajectory:tool-used assertion must have a string, string array, or object value',
  );
}

function evaluateToolUsed(config: TrajectoryGraderConfig, trace: Trace): EvaluationScore {
  const steps = extractTrajectorySteps(trace).filter((step) => step.type === 'tool');
  const expected = resolveToolMatchers(config.value);
  const inverse = config.inverse === true;

  if (expected.kind === 'list') {
    if (expected.matchers.length === 0) {
      throw new Error('trajectory:tool-used assertion requires at least one expected tool');
    }
    const missing = expected.matchers.filter(
      (matcher) => !steps.some((step) => matchesTrajectoryStep(step, matcher)),
    );
    const matched = expected.matchers.filter((matcher) =>
      steps.some((step) => matchesTrajectoryStep(step, matcher)),
    );
    const pass = inverse ? matched.length === 0 : missing.length === 0;
    const actualTools = steps.map(formatStep);
    const expectedTools = expected.matchers.map(
      (matcher) => matcher.pattern ?? matcher.name ?? '*',
    );

    if (inverse) {
      return score(
        pass,
        pass
          ? `Forbidden tool(s) were not used: ${expectedTools.join(', ')}`
          : `Forbidden tool(s) were used: ${matched
              .map((matcher) => matcher.pattern ?? matcher.name ?? '*')
              .join(', ')}. Actual tools: ${formatStepList(actualTools)}`,
      );
    }
    return score(
      pass,
      pass
        ? `Observed required tool(s): ${expectedTools.join(', ')}. Actual tools: ${formatStepList(actualTools)}`
        : `Missing required tool(s): ${missing
            .map((matcher) => matcher.pattern ?? matcher.name ?? '*')
            .join(', ')}. Actual tools: ${formatStepList(actualTools)}`,
    );
  }

  const matcher = expected.matcher;
  const min = matcher.min ?? 1;
  const max = matcher.max;
  requireNamedMatcher(matcher, 'trajectory:tool-used');
  const matches = steps.filter((step) => matchesTrajectoryStep(step, matcher));
  const count = matches.length;
  const basePass = count >= min && (max === undefined || count <= max);
  const pass = inverse ? !basePass : basePass;
  const label = matcher.pattern ?? matcher.name ?? '*';
  if (inverse) {
    return score(
      pass,
      basePass
        ? `Tool "${label}" matched ${count} time(s), which violates the inverse assertion`
        : `Tool "${label}" did not satisfy the forbidden match condition`,
    );
  }

  let reason = `Matched tool "${label}" ${count} time(s)`;
  reason += max === undefined ? ` (expected at least ${min})` : ` (expected ${min}-${max})`;
  if (matches.length > 0) {
    reason += `. Matches: ${matches.map(formatStep).join(', ')}`;
  }
  return score(pass, reason);
}

function resolveSequenceValue(value: unknown): TrajectorySequenceValue {
  if (Array.isArray(value)) {
    return { mode: 'in_order', steps: value as readonly (string | TrajectoryStepMatcher)[] };
  }
  if (isRecord(value)) {
    return {
      mode: value.mode === 'exact' ? 'exact' : 'in_order',
      steps: Array.isArray(value.steps)
        ? (value.steps as readonly (string | TrajectoryStepMatcher)[])
        : [],
    };
  }
  throw new Error('trajectory:tool-sequence assertion must have an array or object value');
}

function evaluateToolSequence(config: TrajectoryGraderConfig, trace: Trace): EvaluationScore {
  const toolSteps = extractTrajectorySteps(trace).filter((step) => step.type === 'tool');
  const value = resolveSequenceValue(config.value);
  const expected = value.steps.map((step, index) => {
    const matcher = normalizeMatcher(step, 'tool');
    requireNamedMatcher(matcher, 'trajectory:tool-sequence', index);
    return matcher;
  });
  if (expected.length === 0) {
    throw new Error('trajectory:tool-sequence assertion requires at least one expected step');
  }

  const actualTools = toolSteps.map(formatStep);
  let basePass = false;
  let reason = '';
  if (value.mode === 'exact') {
    basePass =
      toolSteps.length === expected.length &&
      expected.every((matcher, index) => matchesTrajectoryStep(toolSteps[index], matcher));
    reason = basePass
      ? `Observed exact tool sequence: ${formatStepList(actualTools)}`
      : `Expected exact tool sequence of ${expected
          .map((matcher) => matcher.pattern ?? matcher.name ?? '*')
          .join(', ')}, but actual tools were ${formatStepList(actualTools)}`;
  } else {
    let expectedIndex = 0;
    const matchedSteps: string[] = [];
    for (const step of toolSteps) {
      if (expectedIndex >= expected.length) {
        break;
      }
      if (matchesTrajectoryStep(step, expected[expectedIndex])) {
        matchedSteps.push(formatStep(step));
        expectedIndex += 1;
      }
    }
    basePass = expectedIndex === expected.length;
    reason = basePass
      ? `Observed tool sequence in order: ${matchedSteps.join(', ')}. Actual tools: ${formatStepList(actualTools)}`
      : `Expected tool "${expected[expectedIndex]?.pattern ?? expected[expectedIndex]?.name ?? '*'}" was not observed in order. Actual tools: ${formatStepList(actualTools)}`;
  }

  const inverse = config.inverse === true;
  return score(
    inverse ? !basePass : basePass,
    inverse
      ? basePass
        ? `Forbidden tool sequence was observed. Actual tools: ${formatStepList(actualTools)}`
        : 'Forbidden tool sequence was not observed'
      : reason,
  );
}

function matchesExpectedArgsPartial(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => matchesExpectedArgsPartial(actual[index], item))
    );
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) {
      return false;
    }
    return Object.entries(expected).every(
      ([key, expectedValue]) =>
        Object.hasOwn(actual, key) && matchesExpectedArgsPartial(actual[key], expectedValue),
    );
  }
  return isDeepStrictEqual(actual, expected);
}

function stripKeys(
  value: unknown,
  shouldStrip: (key: string, value: unknown) => boolean,
): { readonly cleaned: unknown; readonly stripped: readonly string[] } {
  if (!isRecord(value)) {
    return { cleaned: value, stripped: [] };
  }
  const cleaned: Record<string, unknown> = {};
  const stripped: string[] = [];
  for (const [key, entryValue] of Object.entries(value)) {
    if (shouldStrip(key, entryValue)) {
      stripped.push(key);
      continue;
    }
    Object.defineProperty(cleaned, key, {
      value: entryValue,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return { cleaned, stripped };
}

function stripDefaults(actual: unknown, defaults: Record<string, unknown> | undefined) {
  if (!defaults) {
    return { cleaned: actual, stripped: [] };
  }
  return stripKeys(
    actual,
    (key, value) => Object.hasOwn(defaults, key) && isDeepStrictEqual(value, defaults[key]),
  );
}

function stripIgnored(value: unknown, ignore: readonly string[]) {
  return stripKeys(value, (key) =>
    ignore.some((entry) => (/[*?]/.test(entry) ? matchesPattern(key, entry) : entry === key)),
  );
}

function resolveArgsMatchValue(value: unknown) {
  if (!isRecord(value)) {
    throw new Error('trajectory:tool-args-match assertion must have an object value');
  }
  const matcher = normalizeMatcher(value as TrajectoryStepMatcher, 'tool');
  requireNamedMatcher(matcher, 'trajectory:tool-args-match');
  const expectedArgs = Object.hasOwn(value, 'args') ? value.args : value.arguments;
  if (expectedArgs === undefined) {
    throw new Error(
      'trajectory:tool-args-match assertion must include an args or arguments property',
    );
  }
  const mode = (value as TrajectoryToolArgsMatchValue).mode ?? 'partial';
  if (mode !== 'partial' && mode !== 'exact') {
    throw new Error('trajectory:tool-args-match assertion mode must be "partial" or "exact"');
  }
  const defaults = (value as TrajectoryToolArgsMatchValue).defaults;
  if (defaults !== undefined && !isRecord(defaults)) {
    throw new Error(
      'trajectory:tool-args-match assertion defaults must be an object mapping argument names to default values',
    );
  }
  const rawIgnore = (value as TrajectoryToolArgsMatchValue).ignore;
  const ignore = rawIgnore === undefined ? [] : Array.isArray(rawIgnore) ? rawIgnore : [rawIgnore];
  if (ignore.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    throw new Error(
      'trajectory:tool-args-match assertion ignore must be a non-empty string or an array of non-empty strings',
    );
  }
  return {
    matcher,
    expectedArgs,
    mode,
    defaults,
    ignore: ignore as string[],
  };
}

function argsMatch(
  actual: unknown,
  expected: unknown,
  mode: 'exact' | 'partial',
  defaults: Record<string, unknown> | undefined,
  ignore: readonly string[],
): boolean {
  const cleanedActual = stripDefaults(stripIgnored(actual, ignore).cleaned, defaults).cleaned;
  const cleanedExpected = stripIgnored(expected, ignore).cleaned;
  return mode === 'exact'
    ? isDeepStrictEqual(cleanedActual, cleanedExpected)
    : matchesExpectedArgsPartial(cleanedActual, cleanedExpected);
}

function evaluateToolArgsMatch(config: TrajectoryGraderConfig, trace: Trace): EvaluationScore {
  const toolSteps = extractTrajectorySteps(trace).filter((step) => step.type === 'tool');
  const { matcher, expectedArgs, mode, defaults, ignore } = resolveArgsMatchValue(config.value);
  const label = matcher.pattern ?? matcher.name ?? '*';
  const actualTools = toolSteps.map(formatStep);
  const matchingSteps = toolSteps.filter((step) => matchesTrajectoryStep(step, matcher));
  const stepsWithArgs = matchingSteps.filter((step) => step.args !== undefined);
  const matchedStep = stepsWithArgs.find((step) =>
    argsMatch(step.args, expectedArgs, mode, defaults, ignore),
  );
  const basePass = matchedStep !== undefined;
  const inverse = config.inverse === true;
  const pass = inverse ? !basePass : basePass;
  const observedArgs =
    stepsWithArgs.length > 0
      ? stepsWithArgs.map((step) => formatArgs(step.args)).join(', ')
      : '(none)';

  if (inverse) {
    if (basePass) {
      return score(
        pass,
        `Forbidden argument match for tool "${label}" was observed on ${formatStep(
          matchedStep,
        )}. Args: ${formatArgs(matchedStep?.args)}`,
      );
    }
    return score(
      pass,
      matchingSteps.length === 0
        ? `Forbidden argument match for tool "${label}" was not observed because no tool call matched it`
        : `Forbidden argument match for tool "${label}" was not observed. Observed args: ${observedArgs}`,
    );
  }

  if (basePass) {
    const ignoredArgs = stripIgnored(matchedStep.args, ignore).stripped;
    const ignoredDefaults = stripDefaults(
      stripIgnored(matchedStep.args, ignore).cleaned,
      defaults,
    ).stripped;
    const ignoredArgsSuffix =
      ignoredArgs.length > 0 ? `. Ignored argument(s): ${ignoredArgs.join(', ')}` : '';
    const ignoredDefaultsSuffix =
      ignoredDefaults.length > 0
        ? `. Ignored default argument(s): ${ignoredDefaults.join(', ')}`
        : '';
    return score(
      true,
      `Tool "${label}" matched expected arguments (${mode}) on ${formatStep(
        matchedStep,
      )}. Args: ${formatArgs(matchedStep.args)}${ignoredArgsSuffix}${ignoredDefaultsSuffix}`,
    );
  }

  if (matchingSteps.length === 0) {
    return score(
      false,
      `No tool call matched "${label}". Actual tools: ${formatStepList(actualTools)}`,
    );
  }
  if (stepsWithArgs.length === 0) {
    return score(
      false,
      `Tool "${label}" was observed but no arguments were captured. Actual tools: ${formatStepList(
        actualTools,
      )}`,
    );
  }
  return score(
    false,
    `No call to tool "${label}" matched expected arguments (${mode}): ${formatArgs(
      expectedArgs,
    )}. Observed args: ${observedArgs}`,
  );
}

function resolveStepCountValue(value: unknown): TrajectoryCountValue {
  if (!isRecord(value)) {
    throw new Error('trajectory:step-count assertion must have an object value');
  }
  const matcher = normalizeMatcher(value as TrajectoryStepMatcher);
  return {
    ...matcher,
    ...(typeof value.min === 'number' ? { min: value.min } : {}),
    ...(typeof value.max === 'number' ? { max: value.max } : {}),
  };
}

function evaluateStepCount(config: TrajectoryGraderConfig, trace: Trace): EvaluationScore {
  const matcher = resolveStepCountValue(config.value);
  if (matcher.min === undefined && matcher.max === undefined) {
    throw new Error('trajectory:step-count assertion must include a min or max property');
  }
  const matchingSteps = extractTrajectorySteps(trace).filter((step) =>
    matchesTrajectoryStep(step, matcher),
  );
  const count = matchingSteps.length;
  const basePass =
    (matcher.min === undefined || count >= matcher.min) &&
    (matcher.max === undefined || count <= matcher.max);
  const inverse = config.inverse === true;
  const filterParts: string[] = [];
  if (matcher.type) {
    const types = Array.isArray(matcher.type) ? matcher.type : [matcher.type];
    filterParts.push(`type=${types.join('|')}`);
  }
  const pattern = matcher.pattern ?? matcher.name;
  if (pattern) {
    filterParts.push(`pattern=${pattern}`);
  }
  let reason = `Matched ${count} trajectory step(s)`;
  if (filterParts.length > 0) {
    reason += ` for ${filterParts.join(', ')}`;
  }
  if (matcher.min !== undefined && matcher.max !== undefined) {
    reason += ` (expected ${matcher.min}-${matcher.max})`;
  } else if (matcher.min !== undefined) {
    reason += ` (expected at least ${matcher.min})`;
  } else {
    reason += ` (expected at most ${matcher.max})`;
  }
  if (matchingSteps.length > 0) {
    reason += `. Matches: ${matchingSteps.map(formatStep).join(', ')}`;
  }
  return score(
    inverse ? !basePass : basePass,
    inverse
      ? basePass
        ? 'Trajectory step count satisfied the forbidden range'
        : 'Trajectory step count did not satisfy the forbidden range'
      : reason,
  );
}

function resolveGoal(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (isRecord(value) && typeof value.goal === 'string' && value.goal.trim()) {
    return value.goal.trim();
  }
  throw new Error(
    'trajectory:goal-success assertion must have a string value or an object with a goal property',
  );
}

function summarizeTrajectoryForJudge(trace: Trace): string {
  const steps = extractTrajectorySteps(trace).map((step, index) => ({
    index: index + 1,
    type: step.type,
    name: step.name,
    ...(step.spanName === step.name ? {} : { spanName: step.spanName }),
  }));
  return JSON.stringify({ stepCount: steps.length, steps }, null, 2);
}

function buildGoalCriteria(goal: string, trajectory: string, output: string): string {
  return [
    'Determine whether the agent successfully achieved the goal using the observed trajectory and final output.',
    '',
    `Goal: ${goal}`,
    '',
    'Trajectory:',
    trajectory,
    '',
    'Final output:',
    output,
  ].join('\n');
}

export class TrajectoryGrader implements Grader {
  readonly kind: string;

  private readonly config: TrajectoryGraderConfig;
  private readonly llmGrader?: Grader;

  constructor(options: TrajectoryGraderOptions) {
    this.config = options.config;
    this.kind = options.config.type;
    this.llmGrader = options.llmGrader;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    const trace = context.trace;
    if (!trace) {
      return missingTrace(this.config.type);
    }

    switch (this.config.type) {
      case 'trajectory:tool-used':
        return evaluateToolUsed(this.config, trace);
      case 'trajectory:tool-args-match':
        return evaluateToolArgsMatch(this.config, trace);
      case 'trajectory:tool-sequence':
        return evaluateToolSequence(this.config, trace);
      case 'trajectory:step-count':
        return evaluateStepCount(this.config, trace);
      case 'trajectory:goal-success': {
        if (!this.llmGrader) {
          throw new Error('trajectory:goal-success assertion requires an LLM grader');
        }
        const goal = resolveGoal(this.config.value);
        const result = await this.llmGrader.evaluate({
          ...context,
          evalCase: {
            ...context.evalCase,
            criteria: buildGoalCriteria(
              goal,
              summarizeTrajectoryForJudge(trace),
              context.candidate,
            ),
          },
          evaluator: this.config,
        });
        if (this.config.inverse !== true) {
          return result;
        }
        const negated = negateScore(result);
        const assertion: AssertionEntry = {
          text:
            result.score >= 0.5
              ? `Agent unexpectedly achieved the goal: ${goal}`
              : `Agent did not achieve the forbidden goal: ${goal}`,
          passed: negated.score >= 0.5,
        };
        return { ...negated, assertions: [assertion] };
      }
    }
  }
}
