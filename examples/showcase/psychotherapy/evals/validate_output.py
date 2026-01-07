#!/usr/bin/env python3
"""
JSON Format Validator for AgentV
Validates that the candidate answer is strictly valid JSON with required keys.
Auto-detects framework type from expected answer structure.
Returns score 0.0 if not valid JSON, otherwise passes to next evaluator.
"""

import json
import re
import sys
from typing import Any


def detect_framework_keys(candidate_answer: str) -> list[str]:
    """
    Detect which framework is being used based on candidate answer structure.
    
    Args:
        candidate_answer: The candidate's response to validate
    
    Returns:
        List of required top-level keys for the detected framework
    """
    try:
        candidate = json.loads(candidate_answer.strip())
    except (json.JSONDecodeError, AttributeError):
        # If we can't parse candidate answer, use heuristics on the string
        if "routing_decision" in candidate_answer:
            return ["routing_decision", "client_statement_analysis", "framework_output", "metadata"]
        elif "selected_framework" in candidate_answer or "rationale" in candidate_answer:
            return ["rationale", "selected_framework"]
        elif "validation_point" in candidate_answer or "resource_identified" in candidate_answer:
            return ["analysis"]  # Encouragement framework wraps keys in "analysis"
        else:
            return ["analysis"]  # Default to listening framework (also uses "analysis")
    
    # Check candidate structure to determine framework
    if isinstance(candidate, dict):
        # Routing framework (new schema): has routing_decision, client_statement_analysis, etc.
        if "routing_decision" in candidate:
            return ["routing_decision", "client_statement_analysis", "framework_output", "metadata"]
        
        # Routing framework (legacy): has top-level rationale and selected_framework (without routing_decision wrapper)
        if "rationale" in candidate and "selected_framework" in candidate and "routing_decision" not in candidate:
            return ["rationale", "selected_framework"]
        
        # Listening or Encouragement: both have "analysis" wrapper
        if "analysis" in candidate:
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

    # Fix trailing commas (common LLM output issue)
    content = re.sub(r',(\s*[}\]])', r'\1', content)

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
    
    # Additional validation for routing framework schema
    if "routing_decision" in required_keys:
        validation_errors = validate_routing_schema(parsed)
        if validation_errors:
            return {
                "passed": False,
                "score": 0.0,
                "reasoning": f"Routing schema validation failed: {'; '.join(validation_errors)}"
            }
    
    # All checks passed
    return {
        "passed": True,
        "score": 1.0,
        "reasoning": f"Valid JSON with all required keys: {', '.join(required_keys)}"
    }


def validate_routing_schema(parsed: dict[str, Any]) -> list[str]:
    """
    Validate the nested structure of the routing framework schema.
    
    Args:
        parsed: The parsed JSON object
    
    Returns:
        List of validation error messages (empty if valid)
    """
    errors = []
    
    # Validate routing_decision structure
    if "routing_decision" in parsed:
        routing_decision = parsed["routing_decision"]
        if not isinstance(routing_decision, dict):
            errors.append("routing_decision must be an object")
        else:
            required_routing_keys = ["selected_framework", "confidence", "rationale"]
            for key in required_routing_keys:
                if key not in routing_decision:
                    errors.append(f"routing_decision missing required key: {key}")
            
            # Validate confidence value
            if "confidence" in routing_decision:
                valid_confidence = ["high", "medium", "low"]
                if routing_decision["confidence"] not in valid_confidence:
                    errors.append(f"routing_decision.confidence must be one of {valid_confidence}")
            
            # Validate selected_framework value
            if "selected_framework" in routing_decision:
                valid_frameworks = ["three_levels_listening", "resource_focused_encouragement"]
                if routing_decision["selected_framework"] not in valid_frameworks:
                    errors.append(f"routing_decision.selected_framework must be one of {valid_frameworks}")
    
    # Validate client_statement_analysis structure
    if "client_statement_analysis" in parsed:
        analysis = parsed["client_statement_analysis"]
        if not isinstance(analysis, dict):
            errors.append("client_statement_analysis must be an object")
        else:
            required_analysis_keys = ["primary_indicators", "contraindications", "therapeutic_urgency"]
            for key in required_analysis_keys:
                if key not in analysis:
                    errors.append(f"client_statement_analysis missing required key: {key}")
            
            # Validate arrays
            if "primary_indicators" in analysis and not isinstance(analysis["primary_indicators"], list):
                errors.append("client_statement_analysis.primary_indicators must be an array")
            if "contraindications" in analysis and not isinstance(analysis["contraindications"], list):
                errors.append("client_statement_analysis.contraindications must be an array")
            
            # Validate therapeutic_urgency value
            if "therapeutic_urgency" in analysis:
                valid_urgency = ["routine", "elevated", "crisis"]
                if analysis["therapeutic_urgency"] not in valid_urgency:
                    errors.append(f"client_statement_analysis.therapeutic_urgency must be one of {valid_urgency}")
    
    # Validate framework_output (should be an object, can be empty)
    if "framework_output" in parsed:
        if not isinstance(parsed["framework_output"], dict):
            errors.append("framework_output must be an object")
    
    # Validate metadata structure
    if "metadata" in parsed:
        metadata = parsed["metadata"]
        if not isinstance(metadata, dict):
            errors.append("metadata must be an object")
        else:
            if "alternative_frameworks_considered" in metadata:
                alternatives = metadata["alternative_frameworks_considered"]
                if not isinstance(alternatives, list):
                    errors.append("metadata.alternative_frameworks_considered must be an array")
                else:
                    for i, alt in enumerate(alternatives):
                        if not isinstance(alt, dict):
                            errors.append(f"metadata.alternative_frameworks_considered[{i}] must be an object")
                        else:
                            required_alt_keys = ["framework", "score", "reason_not_selected"]
                            for key in required_alt_keys:
                                if key not in alt:
                                    errors.append(f"metadata.alternative_frameworks_considered[{i}] missing key: {key}")
                            
                            # Validate score is a number between 0 and 1
                            if "score" in alt:
                                if not isinstance(alt["score"], (int, float)):
                                    errors.append(f"metadata.alternative_frameworks_considered[{i}].score must be a number")
                                elif not (0.0 <= alt["score"] <= 1.0):
                                    errors.append(f"metadata.alternative_frameworks_considered[{i}].score must be between 0.0 and 1.0")
    
    return errors


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
    
    # Extract candidate answer - we only validate the candidate's structure
    candidate_answer = eval_data.get("candidate_answer", "")
    
    # Auto-detect required keys from candidate answer
    required_keys = detect_framework_keys(candidate_answer)
    
    # Validate
    result = validate_json_format(candidate_answer, required_keys)
    
    # Output result as JSON
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
