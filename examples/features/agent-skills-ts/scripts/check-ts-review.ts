#!/usr/bin/env bun
/**
 * TypeScript code quality evaluator.
 *
 * Checks whether the agent's answer correctly identifies TypeScript
 * type-safety issues in the reviewed source file.
 *
 * Run by AgentV as a code-judge via:
 *   command: ["bun", "run", "scripts/check-ts-review.ts"]
 */
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ answer }) => {
  const hits: string[] = [];
  const misses: string[] = [];
  const lower = answer.toLowerCase();

  if (lower.includes('any')) {
    hits.push("Addresses 'any' type usage");
  } else {
    misses.push("Does not mention the 'any' type problem");
  }

  if (lower.includes('const') || lower.includes('let')) {
    hits.push('Recommends const/let over var');
  } else {
    misses.push('Does not recommend replacing var with const/let');
  }

  if (lower.includes('return type') || lower.includes('explicit type') || lower.includes('interface') || lower.includes('annotation')) {
    hits.push('Recommends explicit type annotations');
  } else {
    misses.push('Does not suggest explicit type annotations');
  }

  const total = hits.length + misses.length;
  return {
    score: total === 0 ? 0 : hits.length / total,
    hits,
    misses,
  };
});
