#!/usr/bin/env bun
/**
 * Export Risk Output Validator for AgentV
 *
 * Validates that the candidate output is valid JSON with required fields,
 * and extracts the risk classification for confusion matrix computation.
 *
 * Returns structured output that enables post-processing for metrics.
 */
import { defineCodeGrader } from '@agentv/eval';

const VALID_RISK_LEVELS = new Set(['High', 'Medium', 'Low']);
const REQUIRED_KEYS = ['riskLevel', 'reasoning'];

function extractJsonFromResponse(content: string): Record<string, unknown> | null {
  let trimmed = content.trim();

  // Handle markdown code fences
  if (trimmed.startsWith('```')) {
    const lines = trimmed.split('\n');
    lines.shift(); // Remove opening fence
    if (lines.length > 0 && lines[lines.length - 1].trim() === '```') {
      lines.pop(); // Remove closing fence
    }
    trimmed = lines.join('\n').trim();
  }

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function extractExpectedRiskLevel(
  expectedOutput: readonly Record<string, unknown>[] | undefined,
): string | null {
  if (!expectedOutput) return null;

  for (const msg of expectedOutput) {
    if (msg.role !== 'assistant') continue;

    const content = msg.content;
    if (typeof content === 'object' && content !== null && 'riskLevel' in content) {
      return (content as { riskLevel: string }).riskLevel;
    }
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content);
        if (typeof parsed === 'object' && parsed !== null && 'riskLevel' in parsed) {
          return parsed.riskLevel;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }
  return null;
}

function getMessageText(
  messages: readonly { role: string; content?: unknown }[],
  role = 'assistant',
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === role) {
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        return msg.content
          .filter((b: { type?: string }) => b.type === 'text')
          .map((b: { text?: string }) => b.text)
          .join('\n');
      }
    }
  }
  return '';
}

export default defineCodeGrader(({ output, expectedOutput }) => {
  const outputText = getMessageText(output ?? []);
  const assertions: Array<{ text: string; passed: boolean; evidence?: string }> = [];

  // Parse candidate JSON
  const parsed = extractJsonFromResponse(outputText);

  if (parsed === null) {
    return {
      score: 0.0,
      assertions: [
        {
          text: 'Output is not valid JSON',
          passed: false,
          evidence: 'Failed to parse response as JSON',
        },
      ],
    };
  }

  // Check required keys
  const missingKeys = REQUIRED_KEYS.filter((k) => !(k in parsed));
  if (missingKeys.length > 0) {
    return {
      score: 0.0,
      assertions: [{ text: `Missing required keys: ${missingKeys.join(', ')}`, passed: false }],
    };
  }

  assertions.push({ text: 'Valid JSON with required keys', passed: true });

  // Validate riskLevel value
  const candidateRisk = parsed.riskLevel as string;
  if (!VALID_RISK_LEVELS.has(candidateRisk)) {
    assertions.push({
      text: `Invalid riskLevel: '${candidateRisk}' (must be High/Medium/Low)`,
      passed: false,
    });
    return {
      score: 0.25,
      assertions,
    };
  }

  assertions.push({ text: `riskLevel=${candidateRisk}`, passed: true });

  // Compare to expected if available
  const expectedRisk = extractExpectedRiskLevel(expectedOutput);

  if (expectedRisk === null) {
    // No expected value to compare - just validate format
    return {
      score: 1.0,
      assertions,
    };
  }

  // Classification comparison
  if (candidateRisk === expectedRisk) {
    assertions.push({
      text: `Correct: AI=${candidateRisk}, Expected=${expectedRisk}`,
      passed: true,
    });
    return {
      score: 1.0,
      assertions,
    };
  }

  assertions.push({
    text: `Mismatch: AI=${candidateRisk}, Expected=${expectedRisk}`,
    passed: false,
  });
  return {
    score: 0.0,
    assertions,
  };
});
