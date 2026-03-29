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
 * 1. Extract distinct statements/claims from the criteria (criteria SDK field)
 * 2. For each statement, check if it can be attributed to the retrieval context
 * 3. Score = proportion of statements supported by retrieval
 *
 * Retrieval context is extracted from expected_output.tool_calls output,
 * which represents the expected agent behavior (calling a retrieval tool).
 *
 * Requires `target: { max_calls: N }` in the evaluator YAML config,
 * where N >= 2 (one for statement extraction + one for attribution check).
 */
import { createTargetClient, defineCodeGrader } from '@agentv/eval';
import { extractRetrievalContext } from './utils.js';

interface StatementExtractionResult {
  statements: string[];
}

interface AttributionResult {
  attributable: boolean;
  reasoning: string;
  supporting_node?: number;
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

export default defineCodeGrader(async (input) => {
  const { input: inputMessages, criteria, expectedOutput } = input;
  const inputText = getMessageText(inputMessages, 'user');

  if (!criteria) {
    return {
      score: 0,
      assertions: [
        {
          text: 'No criteria provided',
          passed: false,
          evidence: 'Contextual Recall requires criteria to extract statements from.',
        },
      ],
    };
  }

  // Extract retrieval context from expected_output tool_calls
  const retrievalContext = extractRetrievalContext(expectedOutput);

  if (retrievalContext.length === 0) {
    return {
      score: 0,
      assertions: [
        {
          text: 'No retrieval context found in expected_output.tool_calls',
          passed: false,
          evidence:
            'Contextual Recall requires retrieval context in expected_output[].tool_calls[].output.results',
        },
      ],
    };
  }

  const target = createTargetClient();

  if (!target) {
    return {
      score: 0,
      assertions: [
        {
          text: 'Target not available - ensure `target` block is configured in evaluator YAML',
          passed: false,
        },
      ],
    };
  }

  // Step 1: Extract statements from the criteria
  const extractionResponse = await target.invoke({
    question: `Extract all distinct factual statements or claims from the following expected answer.
Each statement should be a self-contained claim that can be independently verified.

Question: ${inputText}

Expected Answer:
${criteria}

Extract the statements and respond with JSON only:
{
  "statements": ["statement 1", "statement 2", ...]
}`,
    systemPrompt:
      'You are a precise statement extractor. Break down answers into distinct, verifiable claims. Output valid JSON only.',
    target: 'gemini-llm',
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
      assertions: [
        {
          text: 'Failed to extract statements from criteria',
          passed: false,
          evidence: 'Statement extraction failed - unable to parse LLM response.',
        },
      ],
    };
  }

  if (statements.length === 0) {
    return {
      score: 0,
      assertions: [{ text: 'No statements extracted from criteria', passed: false }],
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
    target: 'gemini-llm',
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

  // Build detailed assertions
  const assertions: Array<{ text: string; passed: boolean; evidence?: string }> = [];

  for (const result of attributionResults) {
    const nodeInfo = result.supportingNode ? ` (Node ${result.supportingNode})` : '';
    if (result.attributable) {
      assertions.push({
        text: `"${result.statement}" attributable${nodeInfo}`,
        passed: true,
        evidence: result.reasoning,
      });
    } else {
      assertions.push({
        text: `"${result.statement}" not attributable`,
        passed: false,
        evidence: result.reasoning,
      });
    }
  }

  return {
    score,
    assertions,
  };
});
