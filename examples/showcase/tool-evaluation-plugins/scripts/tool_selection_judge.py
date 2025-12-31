#!/usr/bin/env python3
"""
Tool Selection Evaluator - Code Judge Plugin

Evaluates whether the agent selected the RIGHT tools for the task.
This is a semantic evaluation that requires understanding task requirements
and matching them against available tools.

Why this is a plugin (not built-in):
- Requires domain-specific knowledge of what tools are "appropriate"
- Involves semantic judgment, not just pattern matching
- Different projects have different tool selection criteria

Usage in eval YAML:
  evaluators:
    - name: tool-selection
      type: code_judge
      script: scripts/tool_selection_judge.py

Input (stdin JSON):
  - question: The user's task/question
  - expected_outcome: Description of expected behavior
  - output_messages: Array of messages including tool calls
  - candidate_trace_summary: Summary of tool usage

Output (stdout JSON):
  - score: 0.0-1.0 (1.0 = all tools appropriate, 0.0 = all inappropriate)
  - hits: List of appropriate tool selections
  - misses: List of missing or inappropriate tools
  - reasoning: Explanation of the evaluation
"""

import json
import sys
from typing import Any


def extract_tool_calls(messages: list[dict]) -> list[dict]:
    """Extract all tool calls from output messages."""
    tool_calls = []
    for msg in messages:
        if msg.get("role") == "assistant" and msg.get("toolCalls"):
            for call in msg["toolCalls"]:
                tool_calls.append({
                    "tool": call.get("tool"),
                    "args": call.get("args", {}),
                })
    return tool_calls


def evaluate_tool_selection(
    question: str,
    expected_outcome: str,
    tool_calls: list[dict],
    trace_summary: dict | None,
) -> dict[str, Any]:
    """
    Evaluate tool selection based on task requirements.

    This is a simplified heuristic-based evaluation.
    For production use, you might:
    1. Use an LLM to judge appropriateness
    2. Define explicit tool-to-task mappings
    3. Use a decision tree based on task classification
    """
    hits = []
    misses = []

    # Extract keywords from question and expected outcome
    task_text = f"{question} {expected_outcome}".lower()

    # Define tool-to-task mappings (customize for your domain)
    tool_task_mappings = {
        "search": ["find", "search", "look", "query", "discover"],
        "fetch": ["get", "retrieve", "fetch", "download", "load"],
        "read": ["read", "open", "view", "examine", "inspect"],
        "write": ["write", "save", "create", "output", "generate"],
        "analyze": ["analyze", "process", "compute", "calculate"],
        "validate": ["check", "validate", "verify", "confirm"],
    }

    # Determine expected tools based on task keywords
    expected_tools = set()
    for tool, keywords in tool_task_mappings.items():
        if any(kw in task_text for kw in keywords):
            expected_tools.add(tool)

    # Get actual tools used
    actual_tools = set(call["tool"] for call in tool_calls)

    # Evaluate selection
    if not tool_calls:
        return {
            "score": 0.0,
            "hits": [],
            "misses": ["No tools were called"],
            "reasoning": "Agent did not use any tools. Expected at least some tool usage.",
        }

    # Check for appropriate selections
    for tool in actual_tools:
        tool_lower = tool.lower()
        is_relevant = any(
            tool_lower in expected or expected in tool_lower
            for expected in expected_tools
        )
        if is_relevant or not expected_tools:
            hits.append(f"Tool '{tool}' appears relevant to task")
        else:
            misses.append(f"Tool '{tool}' may not be needed for this task")

    # Check for missing expected tools
    for expected in expected_tools:
        if not any(expected in t.lower() for t in actual_tools):
            misses.append(f"Expected a '{expected}'-type tool but none used")

    # Calculate score
    total_checks = len(hits) + len(misses)
    score = len(hits) / total_checks if total_checks > 0 else 0.5

    reasoning = (
        f"Evaluated {len(actual_tools)} tool(s) against task requirements. "
        f"{len(hits)} appropriate, {len(misses)} issues found."
    )

    return {
        "score": round(score, 2),
        "hits": hits[:4],  # Cap at 4 per contract
        "misses": misses[:4],
        "reasoning": reasoning,
    }


def main():
    try:
        input_data = json.loads(sys.stdin.read())

        question = input_data.get("question", "")
        expected_outcome = input_data.get("expected_outcome", "")
        output_messages = input_data.get("output_messages", [])
        trace_summary = input_data.get("candidate_trace_summary")

        tool_calls = extract_tool_calls(output_messages)

        result = evaluate_tool_selection(
            question=question,
            expected_outcome=expected_outcome,
            tool_calls=tool_calls,
            trace_summary=trace_summary,
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
