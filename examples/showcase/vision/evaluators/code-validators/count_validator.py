#!/usr/bin/env python3
"""
Object Count Validator
Code-based evaluator for validating object counts in vision responses
"""

import sys
import json
import re
from typing import Dict, Any, List


def extract_numbers_from_text(text: str) -> List[int]:
    """Extract all numbers from text"""
    return [int(num) for num in re.findall(r'\b\d+\b', text)]


def extract_count_for_object(text: str, object_name: str) -> int | None:
    """Extract count for a specific object from text"""
    # Look for patterns like "5 bottles", "There are 3 people", etc.
    patterns = [
        rf'(\d+)\s+{object_name}',  # "5 bottles"
        rf'{object_name}.*?(\d+)',   # "bottles: 5"
        rf'(\d+).*?{object_name}',   # "5 red bottles"
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return int(match.group(1))
    
    return None


def validate_object_count(
    output: str,
    expected_output: str,
    input_text: str = ""
) -> Dict[str, Any]:
    """
    Validate object counts in AI response
    
    Returns:
        Evaluation result with score, passed status, and details
    """
    
    # Extract expected count from expected_output or input
    expected_numbers = extract_numbers_from_text(expected_output)
    output_numbers = extract_numbers_from_text(output)
    
    # Simple validation: check if any expected numbers are in output
    matched_counts = [num for num in expected_numbers if num in output_numbers]
    
    if not expected_numbers:
        return {
            "status": "error",
            "score": 0.0,
            "passed": False,
            "details": "Could not extract expected counts from expected output"
        }
    
    # Calculate accuracy
    accuracy = len(matched_counts) / len(expected_numbers)
    passed = accuracy >= 0.8  # 80% threshold
    
    return {
        "status": "processed",
        "score": accuracy,
        "passed": passed,
        "details": {
            "expected_counts": expected_numbers,
            "found_counts": output_numbers,
            "matched_counts": matched_counts,
            "accuracy": accuracy,
            "reasoning": f"Matched {len(matched_counts)} out of {len(expected_numbers)} expected counts"
        }
    }


def main():
    """Main entry point for CLI usage"""
    # Read evaluation data from stdin or args
    if len(sys.argv) > 1:
        # Parse JSON from argument
        eval_data = json.loads(sys.argv[1])
    else:
        # Read from stdin
        eval_data = json.load(sys.stdin)
    
    # Extract fields
    output = eval_data.get("output", "")
    expected_output = eval_data.get("expected_output", "")
    input_text = eval_data.get("input", "")
    
    # Run validation
    result = validate_object_count(output, expected_output, input_text)
    
    # Output JSON result
    print(json.dumps(result, indent=2))
    
    # Return appropriate exit code
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
