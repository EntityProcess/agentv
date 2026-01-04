#!/usr/bin/env bun
/**
 * Export Risk Output Validator for AgentV
 *
 * Validates that the candidate answer is valid JSON with required fields,
 * and extracts the risk classification for confusion matrix computation.
 *
 * Returns structured output that enables post-processing for metrics.
 */

const VALID_RISK_LEVELS = new Set(['High', 'Medium', 'Low']);
const REQUIRED_KEYS = ['riskLevel', 'reasoning'];

interface EvalInput {
  candidate_answer: string;
  expected_messages?: Array<{
    role: string;
    content: unknown;
  }>;
}

interface EvalResult {
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
}

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
  expectedMessages: Array<{ role: string; content: unknown }> | undefined,
): string | null {
  if (!expectedMessages) return null;

  for (const msg of expectedMessages) {
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

function validateRiskOutput(
  candidateAnswer: string,
  expectedMessages?: Array<{ role: string; content: unknown }>,
): EvalResult {
  const hits: string[] = [];
  const misses: string[] = [];

  // Parse candidate JSON
  const parsed = extractJsonFromResponse(candidateAnswer);

  if (parsed === null) {
    return {
      score: 0.0,
      hits: [],
      misses: ['Output is not valid JSON'],
      reasoning: 'Failed to parse response as JSON',
    };
  }

  // Check required keys
  const missingKeys = REQUIRED_KEYS.filter((k) => !(k in parsed));
  if (missingKeys.length > 0) {
    return {
      score: 0.0,
      hits: [],
      misses: [`Missing required keys: ${missingKeys.join(', ')}`],
      reasoning: `Response missing: ${missingKeys.join(', ')}`,
    };
  }

  hits.push('Valid JSON with required keys');

  // Validate riskLevel value
  const candidateRisk = parsed.riskLevel as string;
  if (!VALID_RISK_LEVELS.has(candidateRisk)) {
    misses.push(`Invalid riskLevel: '${candidateRisk}' (must be High/Medium/Low)`);
    return {
      score: 0.25,
      hits,
      misses,
      reasoning: `riskLevel '${candidateRisk}' is not valid`,
    };
  }

  hits.push(`riskLevel=${candidateRisk}`);

  // Compare to expected if available
  const expectedRisk = extractExpectedRiskLevel(expectedMessages);

  if (expectedRisk === null) {
    // No expected value to compare - just validate format
    return {
      score: 1.0,
      hits,
      misses,
      reasoning: `Valid response with riskLevel=${candidateRisk}`,
    };
  }

  // Classification comparison
  if (candidateRisk === expectedRisk) {
    hits.push(`Correct: AI=${candidateRisk}, Expected=${expectedRisk}`);
    return {
      score: 1.0,
      hits,
      misses,
      reasoning: `Correctly classified as ${candidateRisk}`,
    };
  }

  misses.push(`Mismatch: AI=${candidateRisk}, Expected=${expectedRisk}`);
  return {
    score: 0.0,
    hits,
    misses,
    reasoning: `Misclassified: AI=${candidateRisk}, Expected=${expectedRisk}`,
  };
}

async function main(): Promise<void> {
  let evalData: EvalInput;

  try {
    const input = await Bun.stdin.text();
    evalData = JSON.parse(input);
  } catch (e) {
    console.log(
      JSON.stringify({
        score: 0.0,
        hits: [],
        misses: [`Failed to parse evaluator input: ${e}`],
        reasoning: 'Internal error parsing eval input',
      }),
    );
    process.exit(1);
  }

  const result = validateRiskOutput(evalData.candidate_answer ?? '', evalData.expected_messages);

  console.log(JSON.stringify(result, null, 2));
}

main();
