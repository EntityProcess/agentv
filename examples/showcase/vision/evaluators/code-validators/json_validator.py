#!/usr/bin/env python3
"""
JSON Structure Validator
Code-based evaluator for validating structured JSON outputs from vision tasks
"""

import sys
import json
import re
from typing import Dict, Any, List
from jsonschema import validate, ValidationError, Draft7Validator


def extract_json_from_text(text: str) -> Dict[str, Any] | None:
    """Extract JSON object from text (handles markdown code blocks)"""
    # Try to find JSON in markdown code block
    json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    
    # Try to parse entire text as JSON
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    
    # Try to find first JSON object in text
    brace_match = re.search(r'\{.*\}', text, re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except json.JSONDecodeError:
            pass
    
    return None


def infer_schema_from_expected(expected_json: Dict[str, Any]) -> Dict[str, Any]:
    """Infer a basic JSON schema from expected output structure"""
    def get_type(value):
        if isinstance(value, bool):
            return "boolean"
        elif isinstance(value, int):
            return "integer"
        elif isinstance(value, float):
            return "number"
        elif isinstance(value, str):
            return "string"
        elif isinstance(value, list):
            return "array"
        elif isinstance(value, dict):
            return "object"
        return "string"
    
    schema = {
        "type": "object",
        "properties": {},
        "required": list(expected_json.keys())
    }
    
    for key, value in expected_json.items():
        value_type = get_type(value)
        schema["properties"][key] = {"type": value_type}
        
        if value_type == "array" and len(value) > 0:
            item_type = get_type(value[0])
            schema["properties"][key]["items"] = {"type": item_type}
            
            # If array contains objects, add properties
            if item_type == "object" and isinstance(value[0], dict):
                schema["properties"][key]["items"]["properties"] = {
                    k: {"type": get_type(v)} 
                    for k, v in value[0].items()
                }
    
    return schema


def validate_json_structure(
    output: str,
    expected_output: str,
    schema: Dict[str, Any] | None = None
) -> Dict[str, Any]:
    """
    Validate that output contains valid JSON matching expected structure
    
    Args:
        output: AI's response (may contain JSON)
        expected_output: Expected JSON structure as string
        schema: Optional JSON schema for validation
    
    Returns:
        Evaluation result with score, passed status, and details
    """
    
    # Extract JSON from output
    output_json = extract_json_from_text(output)
    
    if output_json is None:
        return {
            "status": "processed",
            "score": 0.0,
            "passed": False,
            "details": {
                "error": "No valid JSON found in output",
                "reasoning": "Could not extract JSON object from response"
            }
        }
    
    # Parse expected JSON
    try:
        expected_json = extract_json_from_text(expected_output)
        if expected_json is None:
            expected_json = json.loads(expected_output)
    except (json.JSONDecodeError, ValueError) as e:
        return {
            "status": "error",
            "score": 0.0,
            "passed": False,
            "details": {
                "error": f"Invalid expected JSON: {str(e)}"
            }
        }
    
    # If no schema provided, infer from expected output
    if schema is None:
        schema = infer_schema_from_expected(expected_json)
    
    # Validate against schema
    validator = Draft7Validator(schema)
    errors = list(validator.iter_errors(output_json))
    
    if errors:
        error_messages = [f"{e.path}: {e.message}" for e in errors[:3]]  # First 3 errors
        return {
            "status": "processed",
            "score": 0.5,  # Partial credit for valid JSON with wrong structure
            "passed": False,
            "details": {
                "validation_errors": error_messages,
                "json_valid": True,
                "schema_valid": False,
                "reasoning": f"Valid JSON but schema validation failed: {'; '.join(error_messages)}"
            }
        }
    
    # Calculate field match score
    expected_keys = set(expected_json.keys())
    output_keys = set(output_json.keys())
    
    matching_keys = expected_keys & output_keys
    extra_keys = output_keys - expected_keys
    missing_keys = expected_keys - output_keys
    
    field_score = len(matching_keys) / len(expected_keys) if expected_keys else 1.0
    
    # Penalize extra keys slightly
    if extra_keys:
        field_score *= 0.95
    
    # Full pass requires schema validation + most fields present
    passed = len(errors) == 0 and field_score >= 0.8
    
    return {
        "status": "processed",
        "score": round(field_score, 3),
        "passed": passed,
        "details": {
            "json_valid": True,
            "schema_valid": len(errors) == 0,
            "field_score": round(field_score, 3),
            "matching_keys": list(matching_keys),
            "missing_keys": list(missing_keys),
            "extra_keys": list(extra_keys),
            "reasoning": f"Schema valid: {len(errors) == 0}, Field coverage: {field_score:.1%}"
        }
    }


def main():
    """Main entry point for CLI usage"""
    if len(sys.argv) > 1:
        eval_data = json.loads(sys.argv[1])
    else:
        eval_data = json.load(sys.stdin)
    
    output = eval_data.get("output", "")
    expected_output = eval_data.get("expected_output", "")
    schema = eval_data.get("schema")
    
    result = validate_json_structure(output, expected_output, schema)
    
    print(json.dumps(result, indent=2))
    
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
