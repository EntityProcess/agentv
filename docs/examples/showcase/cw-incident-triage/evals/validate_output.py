#!/usr/bin/env python3
"""
JSON Format Validator for AgentV
Validates that the candidate answer is strictly valid JSON with required keys.
Returns score 0.0 if not valid JSON, otherwise passes to next evaluator.
"""

import json
import sys
from typing import Any


def validate_json_format(candidate_answer: str, required_keys: list[str]) -> dict[str, Any]:
    """
    Validate that candidate_answer is valid JSON with required keys.
    
    Args:
        candidate_answer: The response to validate
        required_keys: List of required top-level keys (e.g., ['content', 'emotion', 'process'])
    
    Returns:
        dict with 'passed', 'score', and 'reasoning' keys
    """
    # Strip markdown code fences if present
    content = candidate_answer.strip()
    if content.startswith("```"):
        lines = content.split("\n")
        # Remove first line (```json or ```)
        lines = lines[1:]
        # Remove last line if it's closing fence
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines).strip()
    
    # Try to parse as JSON
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        return {
            "passed": False,
            "score": 0.0,
            "reasoning": f"Output is not valid JSON. Parse error: {str(e)}"
        }
    
    # Check if it's a dict (object)
    if not isinstance(parsed, dict):
        return {
            "passed": False,
            "score": 0.0,
            "reasoning": f"Output is valid JSON but not an object/dict. Got: {type(parsed).__name__}"
        }
    
    # Check for required keys
    missing_keys = [key for key in required_keys if key not in parsed]
    if missing_keys:
        return {
            "passed": False,
            "score": 0.0,
            "reasoning": f"Valid JSON but missing required keys: {', '.join(missing_keys)}. Has keys: {', '.join(parsed.keys())}"
        }
    
    # All checks passed
    return {
        "passed": True,
        "score": 1.0,
        "reasoning": f"Valid JSON with all required keys: {', '.join(required_keys)}"
    }


def main():
    """Main entry point for AgentV code evaluator."""
    # AgentV passes eval data via stdin as JSON
    try:
        eval_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({
            "passed": False,
            "score": 0.0,
            "reasoning": f"Failed to parse input JSON: {str(e)}"
        }))
        sys.exit(1)
    
    # Extract candidate answer
    candidate_answer = eval_data.get("candidate_answer", "")
    
    # Required keys for CargoWise criticality rating
    required_keys = ["criticalityRating", "reasoning"]
    
    # Validate
    result = validate_json_format(candidate_answer, required_keys)
    
    # Output result as JSON
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
