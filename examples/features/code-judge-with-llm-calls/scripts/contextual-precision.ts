#!/usr/bin/env bun
/**
 * Contextual Precision Evaluator
 *
 * Implements the Contextual Precision metric for RAG systems.
 * This metric evaluates whether relevant retrieval nodes are ranked higher
 * than irrelevant ones, rewarding retrievers that surface relevant content first.
 *
 * Formula: (1/R) * Σ(Precision@k * r_k) for k=1 to n
 * where R = total relevant nodes, r_k = binary relevance at position k
 *
 * Retrieval context is extracted from expected_messages.tool_calls output,
 * which represents the expected agent behavior (calling a retrieval tool).
 *
 * Requires `target: { max_calls: N }` in the evaluator YAML config,
 * where N >= number of retrieval context nodes to evaluate.
 */
import { type Message, createTargetClient, defineCodeJudge } from '@agentv/eval';

interface RelevanceResult {
  relevant: boolean;
  reasoning: string;
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

  // Extract retrieval context from expected_messages tool_calls
  const retrievalContext = extractRetrievalContext(expectedMessages);

  if (retrievalContext.length === 0) {
    return {
      score: 0,
      hits: [],
      misses: ['No retrieval context found in expected_messages.tool_calls'],
      reasoning:
        'Contextual Precision requires retrieval context in expected_messages[].tool_calls[].output.results',
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

  // Step 1: Use batch invocation to determine relevance of each node
  // Demonstrates target override - uses gemini_base regardless of default target
  const requests = retrievalContext.map((node, index) => ({
    question: `Determine if this retrieved context node is relevant to answering the question.

Question: ${question}
${expectedOutcome ? `Expected Answer: ${expectedOutcome}` : ''}

Retrieved Node (Rank ${index + 1}):
${node}

Is this node relevant to answering the question? Respond with JSON only:
{
  "relevant": true or false,
  "reasoning": "brief explanation"
}`,
    systemPrompt:
      'You are a precise relevance evaluator for RAG systems. Determine if a retrieved node contains information useful for answering the given question. Output valid JSON only.',
    target: 'gemini_base', // Override: use gemini_base for relevance checks
  }));

  const responses = await target.invokeBatch(requests);

  // Step 2: Parse relevance scores for each node
  const relevanceScores: boolean[] = [];
  const nodeResults: Array<{ rank: number; relevant: boolean; reasoning: string }> = [];

  for (let i = 0; i < responses.length; i++) {
    const rawText = responses[i].rawText ?? '';
    let result: RelevanceResult = { relevant: false, reasoning: 'Failed to parse' };

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]) as RelevanceResult;
      }
    } catch {
      // Keep default false
    }

    relevanceScores.push(result.relevant);
    nodeResults.push({
      rank: i + 1,
      relevant: result.relevant,
      reasoning: result.reasoning,
    });
  }

  // Step 3: Calculate Contextual Precision score
  const totalRelevant = relevanceScores.filter(Boolean).length;

  if (totalRelevant === 0) {
    return {
      score: 0,
      hits: [],
      misses: ['No relevant nodes found in retrieval context'],
      reasoning: `Evaluated ${retrievalContext.length} nodes, none were relevant to the question.`,
    };
  }

  // Weighted precision: sum of (precision@k) for each relevant position
  let weightedPrecisionSum = 0;
  let relevantFoundSoFar = 0;

  for (let k = 0; k < relevanceScores.length; k++) {
    if (relevanceScores[k]) {
      relevantFoundSoFar++;
      const precisionAtK = relevantFoundSoFar / (k + 1);
      weightedPrecisionSum += precisionAtK;
    }
  }

  const score = weightedPrecisionSum / totalRelevant;

  // Build detailed hits/misses
  const hits: string[] = [];
  const misses: string[] = [];

  for (const node of nodeResults) {
    if (node.relevant) {
      hits.push(`Node ${node.rank}: relevant - ${node.reasoning}`);
    } else {
      misses.push(`Node ${node.rank}: irrelevant - ${node.reasoning}`);
    }
  }

  // Perfect score = 1.0 means all relevant nodes are ranked before irrelevant ones
  const isPerfect = score === 1.0;
  const reasoning = isPerfect
    ? `Perfect precision: all ${totalRelevant} relevant nodes ranked optimally.`
    : `${totalRelevant}/${retrievalContext.length} nodes relevant. Score penalized because relevant nodes are not all ranked first.`;

  return {
    score,
    hits,
    misses,
    reasoning,
  };
});
