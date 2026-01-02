import sys
import json
import tempfile
import os
import py_compile

def main():
    try:
        # Read input JSON from stdin
        try:
            input_data = json.load(sys.stdin)
        except json.JSONDecodeError:
            # Fallback if no input or invalid JSON
            input_data = {}
            
        candidate_answer = input_data.get("candidate_answer", "")

        # Extract code block if present (simple heuristic)
        if "```python" in candidate_answer:
            candidate_answer = candidate_answer.split("```python")[1].split("```")[0]
        elif "```" in candidate_answer:
            candidate_answer = candidate_answer.split("```")[1].split("```")[0]

        if not candidate_answer.strip():
             result = {
                "score": 0.0,
                "hits": [],
                "misses": ["No code found to evaluate"],
                "reasoning": "Candidate answer did not contain any code blocks"
            }
             print(json.dumps(result))
             return

        # Write to temp file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as tmp:
            tmp.write(candidate_answer)
            tmp_path = tmp.name

        try:
            # Check syntax
            py_compile.compile(tmp_path, doraise=True)
            
            # Success
            result = {
                "score": 1.0,
                "hits": ["Python syntax is valid"],
                "misses": [],
                "reasoning": "Code compiled successfully"
            }
        except py_compile.PyCompileError as e:
            # Syntax error
            # The string representation of PyCompileError usually contains the details
            result = {
                "score": 0.0,
                "hits": [],
                "misses": [str(e).replace(tmp_path, "script.py")],
                "reasoning": "Syntax error found"
            }
        except Exception as e:
             result = {
                "score": 0.0,
                "hits": [],
                "misses": [f"Compilation error: {str(e)}"],
                "reasoning": "Compilation failed"
            }
        finally:
            # Cleanup
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
                
        # Output JSON result
        print(json.dumps(result))

    except Exception as e:
        # System error
        result = {
            "score": 0.0,
            "hits": [],
            "misses": [f"Evaluator error: {str(e)}"],
            "reasoning": "Internal error"
        }
        print(json.dumps(result))

if __name__ == "__main__":
    main()
