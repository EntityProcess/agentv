import type { SkillUsedGraderConfig } from '../types.js';
import type { EvaluationContext, EvaluationScore, Grader } from './types.js';

interface SkillCountValue {
  readonly max?: number;
  readonly min?: number;
  readonly name?: string;
  readonly pattern?: string;
}

interface SkillCallEntry {
  readonly name: string;
  readonly input?: unknown;
  readonly path?: string;
  readonly source?: string;
  readonly isError?: boolean;
  readonly is_error?: boolean;
}

type ResolvedSkillMatchers =
  | { readonly kind: 'list'; readonly matchers: readonly { readonly name: string }[] }
  | { readonly kind: 'count'; readonly matcher: SkillCountValue };

export class SkillUsedGrader implements Grader {
  readonly kind: 'skill-used' | 'not-skill-used';

  constructor(private readonly config: SkillUsedGraderConfig) {
    this.kind = config.type;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const inverse = this.config.type === 'not-skill-used' || this.config.negate === true;
    const skillCalls = getSkillCalls(context);
    const actualSkills = skillCalls.map(formatSkillCall);
    const expected = resolveSkillMatchers(this.config.value);

    if (expected.kind === 'list') {
      return handleListSkillAssertion({
        config: this.config,
        inverse,
        skillCalls,
        actualSkills,
        expected,
      });
    }

    return handleCountSkillAssertion({
      config: this.config,
      inverse,
      skillCalls,
      actualSkills,
      matcher: expected.matcher,
    });
  }
}

function getSkillCalls(context: EvaluationContext): SkillCallEntry[] {
  const responseMetadata = context.responseMetadata ?? {};
  const metadata = responseMetadata.metadata;
  const rawSkillCalls =
    responseMetadata.skill_calls ??
    responseMetadata.skillCalls ??
    (isRecord(metadata) ? (metadata.skillCalls ?? metadata.skill_calls) : undefined);

  if (!Array.isArray(rawSkillCalls)) {
    return [];
  }

  return rawSkillCalls.filter(
    (entry): entry is SkillCallEntry =>
      isRecord(entry) &&
      typeof entry.name === 'string' &&
      entry.name.trim().length > 0 &&
      entry.isError !== true &&
      entry.is_error !== true,
  );
}

function matchesSkill(skillCall: SkillCallEntry, matcher: { name?: string; pattern?: string }) {
  if (matcher.name && skillCall.name !== matcher.name) {
    return false;
  }

  if (matcher.pattern && !matchesPattern(skillCall.name, matcher.pattern)) {
    return false;
  }

  return true;
}

function formatSkillCall(skillCall: SkillCallEntry): string {
  const details = [skillCall.source, skillCall.path].filter(Boolean).join(', ');
  return details ? `${skillCall.name} (${details})` : skillCall.name;
}

function resolveSkillMatchers(value: unknown): ResolvedSkillMatchers {
  const normalizeText = (text: unknown) => (typeof text === 'string' ? text.trim() : undefined);
  const validateCount = (field: 'max' | 'min', count: unknown) => {
    if (!Number.isFinite(count) || !Number.isInteger(count) || (count as number) < 0) {
      throw new Error(`skill-used assertion object ${field} must be a finite non-negative integer`);
    }
  };

  if (typeof value === 'string' && value.trim()) {
    const name = value.trim();
    return {
      kind: 'list',
      matchers: [{ name }],
    };
  }

  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim())
  ) {
    return {
      kind: 'list',
      matchers: value.map((item) => ({ name: item.trim() })),
    };
  }

  if (isRecord(value)) {
    const name = normalizeText(value.name);
    const pattern = normalizeText(value.pattern);
    if (!name && !pattern) {
      throw new Error('skill-used assertion object must include a name or pattern property');
    }
    if ('min' in value) {
      validateCount('min', value.min);
    }
    if ('max' in value) {
      validateCount('max', value.max);
    }
    if (typeof value.min === 'number' && typeof value.max === 'number' && value.max < value.min) {
      throw new Error('skill-used assertion object max must be greater than or equal to min');
    }

    return {
      kind: 'count',
      matcher: {
        max: typeof value.max === 'number' ? value.max : undefined,
        min: typeof value.min === 'number' ? value.min : undefined,
        name,
        pattern,
      },
    };
  }

  throw new Error('skill-used assertion must have a string, string array, or object value');
}

function handleListSkillAssertion(params: {
  readonly config: SkillUsedGraderConfig;
  readonly inverse: boolean;
  readonly skillCalls: readonly SkillCallEntry[];
  readonly actualSkills: readonly string[];
  readonly expected: Extract<ResolvedSkillMatchers, { kind: 'list' }>;
}): EvaluationScore {
  const { config, inverse, skillCalls, actualSkills, expected } = params;
  const missing = expected.matchers.filter(
    (matcher) => !skillCalls.some((skillCall) => matchesSkill(skillCall, matcher)),
  );
  const matched = expected.matchers.filter((matcher) =>
    skillCalls.some((skillCall) => matchesSkill(skillCall, matcher)),
  );
  const pass = inverse ? matched.length === 0 : missing.length === 0;
  const expectedSkills = expected.matchers.map((matcher) => matcher.name);
  const actualSummary = actualSkills.length > 0 ? actualSkills.join(', ') : '(none)';

  let reason: string;
  if (inverse) {
    reason = pass
      ? `Forbidden skill(s) were not used: ${expectedSkills.join(', ')}`
      : `Forbidden skill(s) were used: ${matched.map((matcher) => matcher.name).join(', ')}. Actual skills: ${actualSummary}`;
  } else if (pass) {
    reason = `Observed required skill(s): ${expectedSkills.join(', ')}. Actual skills: ${actualSummary}`;
  } else {
    reason = `Missing required skill(s): ${missing.map((matcher) => matcher.name).join(', ')}. Actual skills: ${actualSummary}`;
  }

  return skillScore(config, pass, reason);
}

function handleCountSkillAssertion(params: {
  readonly config: SkillUsedGraderConfig;
  readonly inverse: boolean;
  readonly skillCalls: readonly SkillCallEntry[];
  readonly actualSkills: readonly string[];
  readonly matcher: SkillCountValue;
}): EvaluationScore {
  const { config, inverse, skillCalls, actualSkills, matcher } = params;
  const hasExplicitMin = matcher.min !== undefined;
  const hasExplicitMax = matcher.max !== undefined;
  const min = matcher.min ?? (hasExplicitMax ? 0 : 1);
  const max = matcher.max;
  const matchingSkillCalls = skillCalls.filter((skillCall) => matchesSkill(skillCall, matcher));
  const count = matchingSkillCalls.length;
  const matcherLabel = matcher.pattern || matcher.name || '*';

  if (inverse) {
    if (hasExplicitMin || (hasExplicitMax && max !== 0)) {
      throw new Error(
        'not-skill-used object assertions only support name/pattern with no count bounds, or max: 0',
      );
    }

    const pass = count === 0;
    const actualSummary = actualSkills.length > 0 ? actualSkills.join(', ') : '(none)';
    const reason = pass
      ? `Forbidden skill "${matcherLabel}" was not used. Actual skills: ${actualSummary}`
      : `Forbidden skill "${matcherLabel}" was used ${count} time(s). Matches: ${matchingSkillCalls.map(formatSkillCall).join(', ')}`;
    return skillScore(config, pass, reason);
  }

  const pass = count >= min && (max === undefined || count <= max);
  let reason = `Matched skill "${matcherLabel}" ${count} time(s)`;
  reason += max === undefined ? ` (expected at least ${min})` : ` (expected ${min}-${max})`;
  if (matchingSkillCalls.length > 0) {
    reason += `. Matches: ${matchingSkillCalls.map(formatSkillCall).join(', ')}`;
  }

  return skillScore(config, pass, reason);
}

function skillScore(config: SkillUsedGraderConfig, pass: boolean, reason: string): EvaluationScore {
  return {
    score: pass ? 1 : 0,
    verdict: pass ? 'pass' : 'fail',
    reason,
    assertions: [{ text: reason, passed: pass }],
    expectedAspectCount: 1,
    details: {
      assertion_type: config.type,
    },
  };
}

function matchesPattern(skillName: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regexPattern}$`, 'i').test(skillName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
