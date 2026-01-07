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
 * Requires `judge: { max_calls: N }` in the evaluator YAML config,
 * where N >= number of retrieval context nodes to evaluate.
 */
// NOTE: In a real project, use: import { ... } from '@agentv/eval';
// This example uses a relative path for testing within the monorepo.
import {
  createJudgeProxyClientFromEnv,
  defineCodeJudge,
} from '../../../../packages/eval/src/index.js';

interface RelevanceResult {
  relevant: boolean;
  reasoning: string;
}

interface ContextualPrecisionInput {
  question: string;
  expectedOutcome?: string;
  // codeSnippets is used to pass retrieval context (repurposed for this example)
  codeSnippets?: string[];
}

export default defineCodeJudge(async (input: ContextualPrecisionInput) => {
  const { question, expectedOutcome, codeSnippets } = input;
  // Use codeSnippets field to pass retrieval context nodes
  const retrievalContext = codeSnippets ?? [];

  if (retrievalContext.length === 0) {
    return {
      score: 0,
      hits: [],
      misses: ['No retrieval context provided (use code_snippets field)'],
      reasoning: 'Contextual Precision requires retrieval context nodes in code_snippets',
    };
  }

  const judge = createJudgeProxyClientFromEnv();

  if (!judge) {
    return {
      score: 0,
      hits: [],
      misses: ['Judge proxy not available - ensure `judge` block is configured in evaluator YAML'],
      reasoning: 'Cannot evaluate without judge proxy access',
    };
  }

  // Step 1: Use batch invocation to determine relevance of each node
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
  }));

  const responses = await judge.invokeBatch(requests);

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
