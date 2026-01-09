#!/usr/bin/env bun
/**
 * Contextual Recall Evaluator
 *
 * Implements the Contextual Recall metric for RAG systems.
 * This metric evaluates whether the retrieval context contains enough relevant
 * information to support all statements in the expected answer.
 *
 * Formula: Attributable Statements / Total Statements
 *
 * Process:
 * 1. Extract distinct statements/claims from the expected answer (expectedOutcome)
 * 2. For each statement, check if it can be attributed to the retrieval context
 * 3. Score = proportion of statements supported by retrieval
 *
 * Retrieval context is extracted from expected_messages.tool_calls output,
 * which represents the expected agent behavior (calling a retrieval tool).
 *
 * Requires `target: { max_calls: N }` in the evaluator YAML config,
 * where N >= 2 (one for statement extraction + one for attribution check).
 */
import { type Message, createTargetClient, defineCodeJudge } from '@agentv/eval';

interface StatementExtractionResult {
  statements: string[];
}

interface AttributionResult {
  attributable: boolean;
  reasoning: string;
  supporting_node?: number;
}

/**
 * Extract retrieval context from expectedMessages tool calls.
 * Looks for tool calls with an output.results array (common pattern for search tools).
 */
function extractRetrievalContext(expectedMessages: Message[]): string[] {
  const results: string[] = [];

  for (const message of expectedMessages) {
    if (!message.toolCalls) continue;

    for (const toolCall of message.toolCalls) {
      // Look for output.results array (common for search/retrieval tools)
      const output = toolCall.output as Record<string, unknown> | undefined;
      if (output && Array.isArray(output.results)) {
        for (const result of output.results) {
          if (typeof result === 'string') {
            results.push(result);
          }
        }
      }
    }
  }

  return results;
}

export default defineCodeJudge(async (input) => {
  const { question, expectedOutcome, expectedMessages } = input;

  if (!expectedOutcome) {
    return {
      score: 0,
      hits: [],
      misses: ['No expected_outcome provided'],
      reasoning:
        'Contextual Recall requires expected_outcome to extract statements from.',
    };
  }

  // Extract retrieval context from expected_messages tool_calls
  const retrievalContext = extractRetrievalContext(expectedMessages);

  if (retrievalContext.length === 0) {
    return {
      score: 0,
      hits: [],
      misses: ['No retrieval context found in expected_messages.tool_calls'],
      reasoning:
        'Contextual Recall requires retrieval context in expected_messages[].tool_calls[].output.results',
    };
  }

  const target = createTargetClient();

  if (!target) {
    return {
      score: 0,
      hits: [],
      misses: ['Target not available - ensure `target` block is configured in evaluator YAML'],
      reasoning: 'Cannot evaluate without target access',
    };
  }

  // Step 1: Extract statements from the expected outcome
  const extractionResponse = await target.invoke({
    question: `Extract all distinct factual statements or claims from the following expected answer.
Each statement should be a self-contained claim that can be independently verified.

Question: ${question}

Expected Answer:
${expectedOutcome}

Extract the statements and respond with JSON only:
{
  "statements": ["statement 1", "statement 2", ...]
}`,
    systemPrompt:
      'You are a precise statement extractor. Break down answers into distinct, verifiable claims. Output valid JSON only.',
    target: 'gemini_base',
  });

  let statements: string[] = [];
  try {
    const jsonMatch = extractionResponse.rawText?.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as StatementExtractionResult;
      statements = parsed.statements ?? [];
    }
  } catch {
    return {
      score: 0,
      hits: [],
      misses: ['Failed to extract statements from expected outcome'],
      reasoning: 'Statement extraction failed - unable to parse LLM response.',
    };
  }

  if (statements.length === 0) {
    return {
      score: 0,
      hits: [],
      misses: ['No statements extracted from expected outcome'],
      reasoning: 'Could not identify any distinct statements in the expected answer.',
    };
  }

  // Step 2: Check attribution for each statement against retrieval context
  const formattedContext = retrievalContext
    .map((node, i) => `[Node ${i + 1}]: ${node}`)
    .join('\n\n');

  const attributionRequests = statements.map((statement) => ({
    question: `Determine if the following statement can be attributed to (supported by) the retrieval context.

Statement to verify:
"${statement}"

Retrieval Context:
${formattedContext}

Can this statement be supported/attributed to information in the retrieval context?
Respond with JSON only:
{
  "attributable": true or false,
  "reasoning": "brief explanation",
  "supporting_node": <node number if attributable, or null>
}`,
    systemPrompt:
      'You are a precise attribution verifier. Determine if statements can be logically derived from or supported by the given context. A statement is attributable if the context contains information that directly supports or implies it. Output valid JSON only.',
    target: 'gemini_base',
  }));

  const attributionResponses = await target.invokeBatch(attributionRequests);

  // Step 3: Parse attribution results
  const attributionResults: Array<{
    statement: string;
    attributable: boolean;
    reasoning: string;
    supportingNode?: number;
  }> = [];

  for (let i = 0; i < attributionResponses.length; i++) {
    const rawText = attributionResponses[i].rawText ?? '';
    let result: AttributionResult = { attributable: false, reasoning: 'Failed to parse' };

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]) as AttributionResult;
      }
    } catch {
      // Keep default false
    }

    attributionResults.push({
      statement: statements[i],
      attributable: result.attributable,
      reasoning: result.reasoning,
      supportingNode: result.supporting_node,
    });
  }

  // Step 4: Calculate Contextual Recall score
  const attributableCount = attributionResults.filter((r) => r.attributable).length;
  const totalStatements = statements.length;
  const score = attributableCount / totalStatements;

  // Build detailed hits/misses
  const hits: string[] = [];
  const misses: string[] = [];

  for (const result of attributionResults) {
    const nodeInfo = result.supportingNode ? ` (Node ${result.supportingNode})` : '';
    if (result.attributable) {
      hits.push(`"${result.statement}" - ${result.reasoning}${nodeInfo}`);
    } else {
      misses.push(`"${result.statement}" - ${result.reasoning}`);
    }
  }

  const isPerfect = score === 1.0;
  const reasoning = isPerfect
    ? `Perfect recall: all ${totalStatements} statements are attributable to retrieval context.`
    : `${attributableCount}/${totalStatements} statements attributable. Some expected information is not covered by retrieval context.`;

  return {
    score,
    hits,
    misses,
    reasoning,
  };
});
