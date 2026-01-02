#!/usr/bin/env python3
"""
Code evaluator script: Check for required Python keywords in generated code.

This script demonstrates how to write custom validation logic for eval cases.
See ../../README.md for the complete I/O contract specification.
"""

import json
import sys
import re


def extract_code_from_markdown(text: str) -> str:
    """
    Extract code from markdown code blocks.
    Looks for ```python or ``` code blocks and returns the code content.
    """
    # Pattern to match code blocks with optional language specifier
    pattern = r'```(?:python)?\s*\n(.*?)```'
    matches = re.findall(pattern, text, re.DOTALL)
    
    if matches:
        # Return the first code block found
        return matches[0].strip()
    
    # If no code blocks found, return the original text
    # (might be plain code without markdown formatting)
    return text.strip()


def check_python_keywords(code: str) -> dict:
    """
    Check if generated Python code contains important keywords and patterns.
    
    Returns a score based on presence of:
    - Error handling (try/except, raise)
    - Docstrings
    - Type checking (isinstance)
    """
    
    score = 0.0
    hits = []
    misses = []
    
    # Check for error handling (most important for demo)
    if 'raise' in code and ('Error' in code or 'Exception' in code):
        score += 0.34
        hits.append("Raises exceptions")
    else:
        misses.append("Missing exception raising")
    
    # Check for docstrings
    if '"""' in code or "'''" in code:
        score += 0.33
        hits.append("Contains docstrings")
    else:
        misses.append("Missing docstrings")
    
    # Check for type validation
    if 'isinstance' in code:
        score += 0.33
        hits.append("Validates types with isinstance")
    else:
        misses.append("Missing type validation")
    
    # Round score to 1.0 if all checks pass
    if len(hits) == 3:
        score = 1.0
    
    reasoning = f"Passed {len(hits)}/3 checks. Score: {score:.2f}"
    
    return {
        "score": score,
        "hits": hits,
        "misses": misses,
        "reasoning": reasoning
    }


def main():
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        
        # Extract the generated output
        output = input_data.get("candidate_answer", "")
        
        # Extract code from markdown if present
        code = extract_code_from_markdown(output)
        
        # Run checks on the extracted code
        result = check_python_keywords(code)
        
        # Output result as JSON
        print(json.dumps(result, indent=2))
        
    except Exception as e:
        # Return error result
        error_result = {
            "score": 0.0,
            "hits": [],
            "misses": [f"Evaluator error: {str(e)}"],
            "reasoning": f"Evaluator error: {str(e)}"
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
