#!/usr/bin/env bun
/**
 * Pairwise Tool Comparison - Code Grader Plugin
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
 *       type: code_grader
 *       script: ["bun", "run", "scripts/pairwise-tool-compare.ts"]
 */
import { type Message, defineCodeGrader } from '@agentv/eval';

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

function extractToolSummary(messages: readonly Message[] | undefined): ToolSummary {
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

  if (aScore > bScore) return { winner: 'A', aAdvantages, bAdvantages };
  if (bScore > aScore) return { winner: 'B', aAdvantages, bAdvantages };
  return { winner: 'TIE', aAdvantages, bAdvantages };
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

export default defineCodeGrader((input) => {
  const candidate = getMessageText(input.output ?? []);
  const reference = getMessageText(input.expectedOutput);

  // If no reference, we can't do pairwise comparison
  if (!reference) {
    return {
      score: 0.5,
      assertions: [
        { text: 'Candidate response provided', passed: true },
        {
          text: 'No reference for comparison',
          passed: false,
          evidence: 'Pairwise comparison requires expected output messages',
        },
      ],
    };
  }

  // Extract tool summaries
  const candidateTools = extractToolSummary(input.output ?? undefined);
  // For reference, we'd need referenceMessages (not in standard payload)
  const referenceTools: ToolSummary = { tools: [], count: 0, unique: [] };

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
    finalWinner = 'TIE';
    confidence = 'low (position bias detected)';
  }

  // Convert to score (candidate perspective)
  const score = finalWinner === 'A' ? 1.0 : finalWinner === 'B' ? 0.0 : 0.5;

  const assertions: Array<{ text: string; passed: boolean; evidence?: string }> = [
    ...pass1.aAdvantages.slice(0, 4).map((text) => ({ text, passed: true })),
    ...pass1.bAdvantages.slice(0, 4).map((text) => ({ text, passed: false })),
  ];

  // Add consistency evidence to the first assertion
  const consistencyEvidence = `Pass 1: ${pass1.winner} wins. Pass 2 (swapped): ${pass2.winner} wins (maps to ${pass2Mapped}). Consistency: ${consistent}. Final: ${finalWinner} (${confidence} confidence)`;
  if (assertions.length > 0) {
    assertions[0].evidence = consistencyEvidence;
  } else {
    assertions.push({
      text: `Final result: ${finalWinner}`,
      passed: finalWinner === 'A',
      evidence: consistencyEvidence,
    });
  }

  return {
    score,
    assertions,
  };
});
