#!/usr/bin/env bun
/**
 * Parameterized assertion judge.
 *
 * A single code judge that handles common deterministic checks
 * (contains, regex, JSON validation, etc.) driven by YAML config.
 *
 * Config fields (passed via evaluator `config` in YAML):
 *   type    – assertion kind: contains | icontains | equals | regex | starts-with | is-json
 *   value   – expected substring, pattern, or prefix (not used for is-json)
 *   negated – when true, inverts the assertion (default: false)
 */
import { defineCodeJudge } from '@agentv/eval';

type AssertionType = 'contains' | 'icontains' | 'equals' | 'regex' | 'starts-with' | 'is-json';

function runAssertion(type: AssertionType, candidate: string, value?: string): boolean {
  switch (type) {
    case 'contains':
      return value != null && candidate.includes(value);
    case 'icontains':
      return value != null && candidate.toLowerCase().includes(value.toLowerCase());
    case 'equals':
      return candidate === value;
    case 'regex':
      return value != null && new RegExp(value).test(candidate);
    case 'starts-with':
      return value != null && candidate.startsWith(value);
    case 'is-json':
      try {
        JSON.parse(candidate);
        return true;
      } catch {
        return false;
      }
  }
}

export default defineCodeJudge(({ answer, criteria, config }) => {
  const type = (config?.type as AssertionType) ?? 'contains';
  const value = config?.value as string | undefined;
  const negated = (config?.negated as boolean) ?? false;

  const rawPass = runAssertion(type, answer, value);
  const pass = negated ? !rawPass : rawPass;

  const label = negated ? `NOT ${type}` : type;
  const detail = value != null ? `${label}(${JSON.stringify(value)})` : label;

  return {
    score: pass ? 1 : 0,
    hits: pass ? [`PASS: ${detail}`] : [],
    misses: pass ? [] : [`FAIL: ${detail}`],
    reasoning: `Assertion "${detail}" against candidate — ${pass ? 'passed' : 'failed'}. Criteria: ${criteria}`,
  };
});
