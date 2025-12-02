#!/usr/bin/env python3
"""
JSON Format Validator for AgentV
Validates that the candidate answer is strictly valid JSON with required keys.
Auto-detects framework type from expected answer structure.
Returns score 0.0 if not valid JSON, otherwise passes to next evaluator.
"""

import json
import sys
from typing import Any


def detect_framework_keys(expected_answer: str) -> list[str]:
    """
    Detect which framework is being used based on expected answer structure.
    
    Args:
        expected_answer: The expected answer from eval data
    
    Returns:
        List of required top-level keys for the detected framework
    """
    try:
        expected = json.loads(expected_answer.strip())
    except (json.JSONDecodeError, AttributeError):
        # If we can't parse expected answer, use heuristics on the string
        if "selected_framework" in expected_answer or "rationale" in expected_answer:
            return ["rationale", "selected_framework"]
        elif "validation_point" in expected_answer or "resource_identified" in expected_answer:
            return ["analysis"]  # Encouragement framework wraps keys in "analysis"
        else:
            return ["analysis"]  # Default to listening framework (also uses "analysis")
    
    # Check expected structure to determine framework
    if isinstance(expected, dict):
        # Routing framework: has top-level rationale and selected_framework
        if "rationale" in expected and "selected_framework" in expected:
            return ["rationale", "selected_framework"]
        
        # Listening or Encouragement: both have "analysis" wrapper
        if "analysis" in expected:
            analysis = expected["analysis"]
            if isinstance(analysis, dict):
                # Listening framework: content, emotion, process
                if "level_1_content" in analysis or "content" in analysis:
                    return ["analysis"]
                # Encouragement framework: validation_point, resource_identified, reframe_angle
                elif "validation_point" in analysis:
                    return ["analysis"]
    
    # Default to analysis wrapper
    return ["analysis"]


def validate_json_format(candidate_answer: str, required_keys: list[str]) -> dict[str, Any]:
    """
    Validate that candidate_answer is valid JSON with required keys.
    
    Args:
        candidate_answer: The response to validate
        required_keys: List of required top-level keys
    
    Returns:
        dict with 'passed', 'score', and 'reasoning' keys
    """
    # Strip markdown code fence if present
    content = candidate_answer.strip()
    if content.startswith("```json"):
        content = content[7:]  # Remove ```json
    elif content.startswith("```"):
        content = content[3:]  # Remove ```
    if content.endswith("```"):
        content = content[:-3]  # Remove trailing ```
    content = content.strip()
    
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
    
    # Extract candidate answer and expected answer
    candidate_answer = eval_data.get("candidate_answer", "")
    expected_answer = eval_data.get("expected_answer", "")
    
    # Auto-detect required keys from expected answer
    required_keys = detect_framework_keys(expected_answer)
    
    # Validate
    result = validate_json_format(candidate_answer, required_keys)
    
    # Output result as JSON
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
