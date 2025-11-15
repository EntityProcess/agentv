#!/usr/bin/env python3
"""
Code evaluator script: Check for required Python keywords in generated code.

This script is referenced in example-v2.test.yaml as a code-based evaluator.
It demonstrates how to write custom validation logic for eval cases.

Expected input (JSON via stdin):
{
  "input_messages": [...],
  "output": "generated code string",
  "expected_messages": [...]
}

Expected output (JSON to stdout):
{
  "score": 0.0 to 1.0,
  "passed": true/false,
  "reasoning": "explanation of the score"
}
"""

import json
import sys
import re


def check_python_keywords(code: str) -> dict:
    """
    Check if generated Python code contains important keywords and patterns.
    
    Returns a score based on presence of:
    - Type hints (typing imports, annotations)
    - Error handling (try/except, raise)
    - Docstrings
    - Type checking (isinstance)
    """
    
    score = 0.0
    reasons = []
    
    # Check for type hints
    if re.search(r'from typing import|import typing', code):
        score += 0.25
        reasons.append("✓ Uses typing module")
    else:
        reasons.append("✗ Missing typing imports")
    
    # Check for error handling
    if 'raise' in code and ('Error' in code or 'Exception' in code):
        score += 0.25
        reasons.append("✓ Raises exceptions")
    else:
        reasons.append("✗ Missing exception raising")
    
    # Check for docstrings
    if '"""' in code or "'''" in code:
        score += 0.25
        reasons.append("✓ Contains docstrings")
    else:
        reasons.append("✗ Missing docstrings")
    
    # Check for type validation
    if 'isinstance' in code:
        score += 0.25
        reasons.append("✓ Validates types with isinstance")
    else:
        reasons.append("✗ Missing type validation")
    
    return {
        "score": score,
        "passed": score >= 0.75,  # Require at least 3 out of 4 checks
        "reasoning": "\n".join(reasons)
    }


def main():
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        
        # Extract the generated code from output
        output = input_data.get("output", "")
        
        # Run checks
        result = check_python_keywords(output)
        
        # Output result as JSON
        print(json.dumps(result, indent=2))
        
    except Exception as e:
        # Return error result
        error_result = {
            "score": 0.0,
            "passed": False,
            "reasoning": f"Evaluator error: {str(e)}"
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
