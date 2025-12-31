#!/usr/bin/env python3
"""
Pairwise Tool Comparison - Code Judge Plugin

Compares tool usage quality between two agent responses with
position bias mitigation (runs comparison twice with swapped order).

Why this is a plugin (not built-in):
- Pairwise comparison is a specialized evaluation pattern
- Requires reference response (not always available)
- Position bias mitigation adds complexity
- Not all evaluations need comparative assessment

Usage in eval YAML:
  evaluators:
    - name: pairwise-compare
      type: code_judge
      script: scripts/pairwise_tool_compare.py

Input (stdin JSON):
  - candidate_answer: Agent's response (Response A)
  - reference_answer: Reference/baseline response (Response B)
  - output_messages: Tool calls from candidate
  - expected_outcome: Task description

Output (stdout JSON):
  - score: 0.0-1.0 (1.0 = candidate wins, 0.5 = tie, 0.0 = reference wins)
  - hits: Candidate advantages
  - misses: Reference advantages
  - reasoning: Comparison explanation with bias check result
"""

import json
import sys
from typing import Any


def extract_tool_summary(messages: list[dict] | None) -> dict:
    """Extract tool usage summary from messages."""
    if not messages:
        return {"tools": [], "count": 0}

    tools = []
    for msg in messages:
        if msg.get("role") == "assistant" and msg.get("toolCalls"):
            for call in msg["toolCalls"]:
                tools.append(call.get("tool", "unknown"))

    return {
        "tools": tools,
        "count": len(tools),
        "unique": list(set(tools)),
    }


def compare_responses(
    response_a: str,
    response_b: str,
    tools_a: dict,
    tools_b: dict,
    task: str,
) -> dict[str, Any]:
    """
    Compare two responses for tool usage quality.
    Returns winner and reasoning.
    """
    a_advantages = []
    b_advantages = []

    # 1. Compare tool count efficiency
    if tools_a["count"] < tools_b["count"] and tools_a["count"] > 0:
        a_advantages.append(f"More efficient: {tools_a['count']} vs {tools_b['count']} tools")
    elif tools_b["count"] < tools_a["count"] and tools_b["count"] > 0:
        b_advantages.append(f"More efficient: {tools_b['count']} vs {tools_a['count']} tools")

    # 2. Compare tool diversity
    if len(tools_a["unique"]) > len(tools_b["unique"]):
        a_advantages.append(f"More diverse tools: {len(tools_a['unique'])} types")
    elif len(tools_b["unique"]) > len(tools_a["unique"]):
        b_advantages.append(f"More diverse tools: {len(tools_b['unique'])} types")

    # 3. Compare response length (proxy for completeness)
    len_a, len_b = len(response_a), len(response_b)
    if len_a > len_b * 1.2:
        a_advantages.append("More comprehensive response")
    elif len_b > len_a * 1.2:
        b_advantages.append("More comprehensive response")

    # 4. Check for no tools (penalty)
    if tools_a["count"] == 0 and tools_b["count"] > 0:
        b_advantages.append("Response B used tools; A did not")
    elif tools_b["count"] == 0 and tools_a["count"] > 0:
        a_advantages.append("Response A used tools; B did not")

    # Determine winner
    a_score = len(a_advantages)
    b_score = len(b_advantages)

    if a_score > b_score:
        return {"winner": "A", "a_advantages": a_advantages, "b_advantages": b_advantages}
    elif b_score > a_score:
        return {"winner": "B", "a_advantages": a_advantages, "b_advantages": b_advantages}
    else:
        return {"winner": "TIE", "a_advantages": a_advantages, "b_advantages": b_advantages}


def pairwise_with_bias_mitigation(
    candidate: str,
    reference: str,
    candidate_tools: dict,
    reference_tools: dict,
    task: str,
) -> dict[str, Any]:
    """
    Run pairwise comparison twice with position swap to mitigate bias.
    """
    # Pass 1: Candidate as A, Reference as B
    pass1 = compare_responses(
        candidate, reference, candidate_tools, reference_tools, task
    )

    # Pass 2: Reference as A, Candidate as B (swapped)
    pass2 = compare_responses(
        reference, candidate, reference_tools, candidate_tools, task
    )

    # Map pass2 result back (if A wins in pass2, that means Reference won)
    pass2_mapped = {
        "A": "B",  # A in pass2 = Reference = B in pass1 terms
        "B": "A",  # B in pass2 = Candidate = A in pass1 terms
        "TIE": "TIE",
    }.get(pass2["winner"], "TIE")

    # Check consistency
    consistent = pass1["winner"] == pass2_mapped

    if consistent:
        final_winner = pass1["winner"]
        confidence = "high"
    else:
        # Inconsistent results indicate position bias - return TIE
        final_winner = "TIE"
        confidence = "low (position bias detected)"

    # Convert to score (candidate perspective)
    if final_winner == "A":  # Candidate wins
        score = 1.0
    elif final_winner == "B":  # Reference wins
        score = 0.0
    else:  # TIE
        score = 0.5

    hits = pass1["a_advantages"][:4]  # Candidate advantages
    misses = pass1["b_advantages"][:4]  # Reference advantages

    reasoning = (
        f"Pass 1: {pass1['winner']} wins. "
        f"Pass 2 (swapped): {pass2['winner']} wins (maps to {pass2_mapped}). "
        f"Consistency: {consistent}. "
        f"Final: {final_winner} ({confidence} confidence)"
    )

    return {
        "score": score,
        "hits": hits,
        "misses": misses,
        "reasoning": reasoning,
    }


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        candidate = input_data.get("candidate_answer", "")
        reference = input_data.get("reference_answer", "")
        output_messages = input_data.get("output_messages", [])
        task = input_data.get("expected_outcome", "")

        # If no reference, we can't do pairwise comparison
        if not reference:
            print(json.dumps({
                "score": 0.5,
                "hits": ["Candidate response provided"],
                "misses": ["No reference for comparison"],
                "reasoning": "Pairwise comparison requires reference_answer field",
            }, indent=2))
            return

        # Extract tool summaries
        candidate_tools = extract_tool_summary(output_messages)

        # For reference, we'd need reference_output_messages
        # In practice, this would come from a baseline run
        reference_messages = input_data.get("reference_output_messages", [])
        reference_tools = extract_tool_summary(reference_messages)

        result = pairwise_with_bias_mitigation(
            candidate=candidate,
            reference=reference,
            candidate_tools=candidate_tools,
            reference_tools=reference_tools,
            task=task,
        )

        print(json.dumps(result, indent=2))

    except Exception as e:
        error_result = {
            "score": 0.0,
            "hits": [],
            "misses": [f"Evaluator error: {str(e)}"],
            "reasoning": f"Evaluation failed: {str(e)}",
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
