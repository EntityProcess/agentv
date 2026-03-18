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
 * Retrieval context is extracted from expected_output.tool_calls output,
 * which represents the expected agent behavior (calling a retrieval tool).
 *
 * Requires `target: { max_calls: N }` in the evaluator YAML config,
 * where N >= number of retrieval context nodes to evaluate.
 */
import { createTargetClient, defineCodeGrader } from '@agentv/eval';
import { extractRetrievalContext } from './utils.js';

interface RelevanceResult {
  relevant: boolean;
  reasoning: string;
}

export default defineCodeGrader(async (input) => {
  const { inputText, criteria, expectedOutput } = input;

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
            'Contextual Precision requires retrieval context in expected_output[].tool_calls[].output.results',
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

  // Step 1: Use batch invocation to determine relevance of each node
  // Demonstrates target override - uses gemini-llm regardless of default target
  const requests = retrievalContext.map((node, index) => ({
    question: `Determine if this retrieved context node is relevant to answering the question.

Question: ${inputText}
${criteria ? `Expected Answer: ${criteria}` : ''}

Retrieved Node (Rank ${index + 1}):
${node}

Is this node relevant to answering the question? Respond with JSON only:
{
  "relevant": true or false,
  "reasoning": "brief explanation"
}`,
    systemPrompt:
      'You are a precise relevance evaluator for RAG systems. Determine if a retrieved node contains information useful for answering the given question. Output valid JSON only.',
    target: 'gemini-llm', // Override: use gemini-llm for relevance checks
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
      assertions: [
        {
          text: 'No relevant nodes found in retrieval context',
          passed: false,
          evidence: `Evaluated ${retrievalContext.length} nodes, none were relevant to the question.`,
        },
      ],
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

  // Build detailed assertions
  const assertions: Array<{ text: string; passed: boolean; evidence?: string }> = [];

  for (const node of nodeResults) {
    if (node.relevant) {
      assertions.push({
        text: `Node ${node.rank}: relevant`,
        passed: true,
        evidence: node.reasoning,
      });
    } else {
      assertions.push({
        text: `Node ${node.rank}: irrelevant`,
        passed: false,
        evidence: node.reasoning,
      });
    }
  }

  return {
    score,
    assertions,
  };
});
