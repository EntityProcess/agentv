#!/usr/bin/env python3
"""
Tool Efficiency Scorer - Code Judge Plugin

Evaluates agent efficiency based on execution metrics:
- Token usage relative to task complexity
- Number of tool calls (redundancy detection)
- Exploration ratio (read-only vs action tools)
- Cost efficiency

Why this is a plugin (not built-in):
- Efficiency thresholds are domain-specific
- What's "efficient" depends on the task type
- Different projects have different cost/performance tradeoffs

Usage in eval YAML:
  evaluators:
    - name: efficiency
      type: code_judge
      script: scripts/efficiency_scorer.py

Input (stdin JSON):
  - candidate_trace_summary: Tool call statistics
  - execution_metrics: Token usage, cost, duration (if available)
  - expected_outcome: Task description (for complexity estimation)

Output (stdout JSON):
  - score: 0.0-1.0 efficiency score
  - hits: Efficiency wins
  - misses: Efficiency issues
  - reasoning: Explanation
"""

import json
import sys
from typing import Any


# Configurable thresholds (customize for your domain)
THRESHOLDS = {
    # Maximum tool calls before penalty
    "max_tool_calls": 10,
    # Ideal exploration ratio (read-only tools / total)
    "target_exploration_ratio": 0.6,
    "exploration_tolerance": 0.2,
    # Token budgets
    "max_tokens_simple": 2000,
    "max_tokens_complex": 10000,
    # Cost thresholds (USD)
    "max_cost_simple": 0.01,
    "max_cost_complex": 0.10,
}

# Tools considered "exploration" (read-only)
EXPLORATION_TOOLS = {
    "read", "grep", "glob", "search", "list", "find",
    "get", "fetch", "query", "inspect", "view",
}


def estimate_task_complexity(expected_outcome: str) -> str:
    """Estimate task complexity from expected outcome description."""
    text = expected_outcome.lower()
    complex_indicators = [
        "multiple", "several", "comprehensive", "thorough",
        "analyze", "compare", "synthesize", "integrate",
    ]
    if any(indicator in text for indicator in complex_indicators):
        return "complex"
    return "simple"


def calculate_exploration_ratio(trace_summary: dict) -> float:
    """Calculate ratio of exploration tools to total tools."""
    tool_calls = trace_summary.get("toolCallsByName", {})
    total = sum(tool_calls.values())
    if total == 0:
        return 0.0

    exploration_count = sum(
        count for tool, count in tool_calls.items()
        if any(exp in tool.lower() for exp in EXPLORATION_TOOLS)
    )
    return exploration_count / total


def evaluate_efficiency(
    trace_summary: dict | None,
    execution_metrics: dict | None,
    expected_outcome: str,
) -> dict[str, Any]:
    """Evaluate agent efficiency against configurable thresholds."""
    hits = []
    misses = []
    scores = []

    complexity = estimate_task_complexity(expected_outcome)

    # 1. Tool call count evaluation
    if trace_summary:
        tool_count = trace_summary.get("eventCount", 0)
        max_calls = THRESHOLDS["max_tool_calls"]

        if tool_count <= max_calls:
            hits.append(f"Tool calls ({tool_count}) within budget ({max_calls})")
            scores.append(1.0)
        else:
            penalty = min((tool_count - max_calls) / max_calls, 1.0)
            scores.append(1.0 - penalty)
            misses.append(f"Excessive tool calls: {tool_count} (budget: {max_calls})")

        # 2. Exploration ratio evaluation
        exp_ratio = calculate_exploration_ratio(trace_summary)
        target = THRESHOLDS["target_exploration_ratio"]
        tolerance = THRESHOLDS["exploration_tolerance"]

        if abs(exp_ratio - target) <= tolerance:
            hits.append(f"Good exploration ratio: {exp_ratio:.2f}")
            scores.append(1.0)
        elif exp_ratio < target - tolerance:
            scores.append(0.7)
            misses.append(f"Low exploration ratio: {exp_ratio:.2f} (target: {target:.2f})")
        else:
            scores.append(0.7)
            misses.append(f"High exploration ratio: {exp_ratio:.2f} (target: {target:.2f})")

    # 3. Token usage evaluation
    if execution_metrics and "tokenUsage" in execution_metrics:
        tokens = execution_metrics["tokenUsage"]
        total_tokens = tokens.get("input", 0) + tokens.get("output", 0)
        max_tokens = (
            THRESHOLDS["max_tokens_complex"]
            if complexity == "complex"
            else THRESHOLDS["max_tokens_simple"]
        )

        if total_tokens <= max_tokens:
            hits.append(f"Token usage ({total_tokens}) within budget")
            scores.append(1.0)
        else:
            penalty = min((total_tokens - max_tokens) / max_tokens, 1.0)
            scores.append(1.0 - penalty * 0.5)  # Softer penalty
            misses.append(f"High token usage: {total_tokens} (budget: {max_tokens})")

    # 4. Cost evaluation
    if execution_metrics and "costUsd" in execution_metrics:
        cost = execution_metrics["costUsd"]
        max_cost = (
            THRESHOLDS["max_cost_complex"]
            if complexity == "complex"
            else THRESHOLDS["max_cost_simple"]
        )

        if cost <= max_cost:
            hits.append(f"Cost (${cost:.4f}) within budget")
            scores.append(1.0)
        else:
            scores.append(0.5)
            misses.append(f"High cost: ${cost:.4f} (budget: ${max_cost:.4f})")

    # Calculate final score
    if not scores:
        return {
            "score": 0.5,
            "hits": ["No efficiency metrics available"],
            "misses": [],
            "reasoning": "Could not evaluate efficiency - no metrics provided",
        }

    final_score = sum(scores) / len(scores)

    reasoning = (
        f"Task complexity: {complexity}. "
        f"Evaluated {len(scores)} efficiency criteria. "
        f"Score: {final_score:.2f}"
    )

    return {
        "score": round(final_score, 2),
        "hits": hits[:4],
        "misses": misses[:4],
        "reasoning": reasoning,
    }


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        trace_summary = input_data.get("candidate_trace_summary")
        execution_metrics = input_data.get("execution_metrics")
        expected_outcome = input_data.get("expected_outcome", "")

        result = evaluate_efficiency(
            trace_summary=trace_summary,
            execution_metrics=execution_metrics,
            expected_outcome=expected_outcome,
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
