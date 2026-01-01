#!/usr/bin/env bun
/**
 * Pairwise Tool Comparison - Code Judge Plugin
 *
 * Compares tool usage quality between two agent responses with
 * position bias mitigation (runs comparison twice with swapped order).
 *
 * Why this is a plugin (not built-in):
 * - Pairwise comparison is a specialized evaluation pattern
 * - Requires reference response (not always available)
 * - Position bias mitigation adds complexity
 * - Not all evaluations need comparative assessment
 *
 * Usage in eval YAML:
 *   evaluators:
 *     - name: pairwise-compare
 *       type: code_judge
 *       script: bun run scripts/pairwise-tool-compare.ts
 *
 * Input (stdin JSON):
 *   - candidateAnswer: Agent's response (Response A)
 *   - referenceAnswer: Reference/baseline response (Response B)
 *   - outputMessages: Tool calls from candidate
 *   - expectedOutcome: Task description
 *
 * Output (stdout JSON):
 *   - score: 0.0-1.0 (1.0 = candidate wins, 0.5 = tie, 0.0 = reference wins)
 *   - hits: Candidate advantages
 *   - misses: Reference advantages
 *   - reasoning: Comparison explanation with bias check result
 */

interface OutputMessage {
  role: string;
  toolCalls?: Array<{ tool: string; args?: Record<string, unknown> }>;
}

interface EvalInput {
  candidateAnswer?: string;
  referenceAnswer?: string;
  outputMessages?: OutputMessage[];
  referenceOutputMessages?: OutputMessage[];
  expectedOutcome?: string;
}

interface EvalOutput {
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
}

interface ToolSummary {
  tools: string[];
  count: number;
  unique: string[];
}

interface CompareResult {
  winner: 'A' | 'B' | 'TIE';
  aAdvantages: string[];
  bAdvantages: string[];
}

function extractToolSummary(messages: OutputMessage[] | undefined): ToolSummary {
  if (!messages) {
    return { tools: [], count: 0, unique: [] };
  }

  const tools: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const call of msg.toolCalls) {
        tools.push(call.tool ?? 'unknown');
      }
    }
  }

  return {
    tools,
    count: tools.length,
    unique: [...new Set(tools)],
  };
}

function compareResponses(
  responseA: string,
  responseB: string,
  toolsA: ToolSummary,
  toolsB: ToolSummary,
): CompareResult {
  const aAdvantages: string[] = [];
  const bAdvantages: string[] = [];

  // 1. Compare tool count efficiency
  if (toolsA.count < toolsB.count && toolsA.count > 0) {
    aAdvantages.push(`More efficient: ${toolsA.count} vs ${toolsB.count} tools`);
  } else if (toolsB.count < toolsA.count && toolsB.count > 0) {
    bAdvantages.push(`More efficient: ${toolsB.count} vs ${toolsA.count} tools`);
  }

  // 2. Compare tool diversity
  if (toolsA.unique.length > toolsB.unique.length) {
    aAdvantages.push(`More diverse tools: ${toolsA.unique.length} types`);
  } else if (toolsB.unique.length > toolsA.unique.length) {
    bAdvantages.push(`More diverse tools: ${toolsB.unique.length} types`);
  }

  // 3. Compare response length (proxy for completeness)
  const lenA = responseA.length;
  const lenB = responseB.length;
  if (lenA > lenB * 1.2) {
    aAdvantages.push('More comprehensive response');
  } else if (lenB > lenA * 1.2) {
    bAdvantages.push('More comprehensive response');
  }

  // 4. Check for no tools (penalty)
  if (toolsA.count === 0 && toolsB.count > 0) {
    bAdvantages.push('Response B used tools; A did not');
  } else if (toolsB.count === 0 && toolsA.count > 0) {
    aAdvantages.push('Response A used tools; B did not');
  }

  // Determine winner
  const aScore = aAdvantages.length;
  const bScore = bAdvantages.length;

  if (aScore > bScore) {
    return { winner: 'A', aAdvantages, bAdvantages };
  } else if (bScore > aScore) {
    return { winner: 'B', aAdvantages, bAdvantages };
  } else {
    return { winner: 'TIE', aAdvantages, bAdvantages };
  }
}

function pairwiseWithBiasMitigation(
  candidate: string,
  reference: string,
  candidateTools: ToolSummary,
  referenceTools: ToolSummary,
): EvalOutput {
  // Pass 1: Candidate as A, Reference as B
  const pass1 = compareResponses(candidate, reference, candidateTools, referenceTools);

  // Pass 2: Reference as A, Candidate as B (swapped)
  const pass2 = compareResponses(reference, candidate, referenceTools, candidateTools);

  // Map pass2 result back (if A wins in pass2, that means Reference won)
  const pass2Mapped: 'A' | 'B' | 'TIE' =
    pass2.winner === 'A' ? 'B' : pass2.winner === 'B' ? 'A' : 'TIE';

  // Check consistency
  const consistent = pass1.winner === pass2Mapped;

  let finalWinner: 'A' | 'B' | 'TIE';
  let confidence: string;

  if (consistent) {
    finalWinner = pass1.winner;
    confidence = 'high';
  } else {
    // Inconsistent results indicate position bias - return TIE
    finalWinner = 'TIE';
    confidence = 'low (position bias detected)';
  }

  // Convert to score (candidate perspective)
  let score: number;
  if (finalWinner === 'A') {
    // Candidate wins
    score = 1.0;
  } else if (finalWinner === 'B') {
    // Reference wins
    score = 0.0;
  } else {
    // TIE
    score = 0.5;
  }

  const hits = pass1.aAdvantages.slice(0, 4); // Candidate advantages
  const misses = pass1.bAdvantages.slice(0, 4); // Reference advantages

  const reasoning =
    `Pass 1: ${pass1.winner} wins. ` +
    `Pass 2 (swapped): ${pass2.winner} wins (maps to ${pass2Mapped}). ` +
    `Consistency: ${consistent}. ` +
    `Final: ${finalWinner} (${confidence} confidence)`;

  return { score, hits, misses, reasoning };
}

async function main(): Promise<void> {
  try {
    const stdin = await Bun.stdin.text();
    const inputData = JSON.parse(stdin) as EvalInput;

    const candidate = inputData.candidateAnswer ?? '';
    const reference = inputData.referenceAnswer ?? '';
    const outputMessages = inputData.outputMessages ?? [];

    // If no reference, we can't do pairwise comparison
    if (!reference) {
      console.log(
        JSON.stringify(
          {
            score: 0.5,
            hits: ['Candidate response provided'],
            misses: ['No reference for comparison'],
            reasoning: 'Pairwise comparison requires referenceAnswer field',
          },
          null,
          2,
        ),
      );
      return;
    }

    // Extract tool summaries
    const candidateTools = extractToolSummary(outputMessages);

    // For reference, we'd need referenceOutputMessages
    // In practice, this would come from a baseline run
    const referenceMessages = inputData.referenceOutputMessages ?? [];
    const referenceTools = extractToolSummary(referenceMessages);

    const result = pairwiseWithBiasMitigation(candidate, reference, candidateTools, referenceTools);

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const errorResult: EvalOutput = {
      score: 0,
      hits: [],
      misses: [`Evaluator error: ${error instanceof Error ? error.message : String(error)}`],
      reasoning: `Evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}

main();
