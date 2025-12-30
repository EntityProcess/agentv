#!/usr/bin/env python3
"""
Export Risk Output Validator for AgentV

Validates that the candidate answer is valid JSON with required fields,
and extracts the risk classification for confusion matrix computation.

Returns structured output that enables post-processing for metrics.
"""

import json
import sys
from typing import Any


VALID_RISK_LEVELS = {"High", "Medium", "Low"}
REQUIRED_KEYS = ["riskLevel", "reasoning"]


def extract_json_from_response(content: str) -> dict[str, Any] | None:
    """Extract JSON from response, handling markdown code fences."""
    content = content.strip()

    # Handle markdown code fences
    if content.startswith("```"):
        lines = content.split("\n")
        lines = lines[1:]  # Remove opening fence
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]  # Remove closing fence
        content = "\n".join(lines).strip()

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return None


def extract_expected_risk_level(expected_messages: list[dict]) -> str | None:
    """Extract expected risk level from expected_messages."""
    if not expected_messages:
        return None

    for msg in expected_messages:
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content")
        if isinstance(content, dict) and "riskLevel" in content:
            return content["riskLevel"]
        if isinstance(content, str):
            try:
                parsed = json.loads(content)
                if isinstance(parsed, dict) and "riskLevel" in parsed:
                    return parsed["riskLevel"]
            except json.JSONDecodeError:
                pass
    return None


def validate_risk_output(
    candidate_answer: str,
    expected_messages: list[dict] | None = None
) -> dict[str, Any]:
    """
    Validate risk assessment output and compare to expected.

    Returns structured result for AgentV evaluation.
    """
    hits: list[str] = []
    misses: list[str] = []

    # Parse candidate JSON
    parsed = extract_json_from_response(candidate_answer)

    if parsed is None:
        return {
            "score": 0.0,
            "hits": [],
            "misses": ["Output is not valid JSON"],
            "reasoning": "Failed to parse response as JSON"
        }

    if not isinstance(parsed, dict):
        return {
            "score": 0.0,
            "hits": [],
            "misses": [f"Output is {type(parsed).__name__}, expected object"],
            "reasoning": "Response must be a JSON object"
        }

    # Check required keys
    missing_keys = [k for k in REQUIRED_KEYS if k not in parsed]
    if missing_keys:
        return {
            "score": 0.0,
            "hits": [],
            "misses": [f"Missing required keys: {', '.join(missing_keys)}"],
            "reasoning": f"Response missing: {', '.join(missing_keys)}"
        }

    hits.append("Valid JSON with required keys")

    # Validate riskLevel value
    candidate_risk = parsed.get("riskLevel")
    if candidate_risk not in VALID_RISK_LEVELS:
        misses.append(f"Invalid riskLevel: '{candidate_risk}' (must be High/Medium/Low)")
        return {
            "score": 0.25,
            "hits": hits,
            "misses": misses,
            "reasoning": f"riskLevel '{candidate_risk}' is not valid"
        }

    hits.append(f"riskLevel={candidate_risk}")

    # Compare to expected if available
    expected_risk = None
    if expected_messages:
        expected_risk = extract_expected_risk_level(expected_messages)

    if expected_risk is None:
        # No expected value to compare - just validate format
        return {
            "score": 1.0,
            "hits": hits,
            "misses": misses,
            "reasoning": f"Valid response with riskLevel={candidate_risk}"
        }

    # Classification comparison
    if candidate_risk == expected_risk:
        hits.append(f"Correct: AI={candidate_risk}, Expected={expected_risk}")
        score = 1.0
        reasoning = f"Correctly classified as {candidate_risk}"
    else:
        misses.append(f"Mismatch: AI={candidate_risk}, Expected={expected_risk}")
        score = 0.0
        reasoning = f"Misclassified: AI={candidate_risk}, Expected={expected_risk}"

    return {
        "score": score,
        "hits": hits,
        "misses": misses,
        "reasoning": reasoning
    }


def main():
    """Main entry point for AgentV code evaluator."""
    try:
        eval_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({
            "score": 0.0,
            "hits": [],
            "misses": [f"Failed to parse evaluator input: {e}"],
            "reasoning": "Internal error parsing eval input"
        }))
        sys.exit(1)

    candidate_answer = eval_data.get("candidate_answer", "")
    expected_messages = eval_data.get("expected_messages")

    result = validate_risk_output(candidate_answer, expected_messages)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
