# Repo-Local Python Helpers

AgentV's Python authoring surface is currently a repo-local helper example under `examples/features/sdk-python/`. It is not a promised published Python package.

Use it when the user wants Python-based custom graders or wants to emit AgentV YAML/JSONL from Python without introducing a Python-native runner.

## Rules

- Prefer canonical AgentV wire and YAML fields.
- Do not accept deprecated wire aliases like `output_text`, `input_text`, or `reference_answer`.
- Keep Python eval authoring YAML-shaped. Mirror `execution`, `tests`, `assertions`, `expected_output`, and related AgentV keys directly.
- Run evals through the AgentV CLI, not through a separate Python runtime.
- If adapting Braintrust or DeepEval patterns, write Python functions that return ordinary AgentV assertion dictionaries rather than new terms like `scores`.

## Available helpers

- `agentv_py.grader`
  - `load_grader_input()`
  - `run_code_grader(handler)`
  - `define_code_grader(handler)`
  - `TargetClient.from_env()`
- `agentv_py.evals`
  - `EvalDefinition`
  - `EvalTest`
  - `JsonlCase`
  - `write_eval_yaml()`
  - `write_jsonl()`
  - `run_agentv_eval()`

## Example

```python
from agentv_py.grader import Assertion, CodeGraderResult, define_code_grader


def evaluate(context):
    actual = context.output or ""
    expected = context.expected_output[0]["content"]
    passed = actual.strip() == expected.strip()
    return CodeGraderResult(
        score=1.0 if passed else 0.0,
        assertions=[Assertion(text="Exact match", passed=passed)],
    )


if __name__ == "__main__":
    define_code_grader(evaluate)
```

## YAML helper example

```python
from agentv_py.evals import EvalDefinition, JsonlCase, write_eval_yaml, write_jsonl


def rag_faithfulness():
    return {
        "name": "rag-faithfulness",
        "type": "llm-grader",
        "target": "grader-target",
        "prompt": "Grade whether the answer is supported by the retrieved context.",
    }


write_jsonl(
    "evals/dataset.jsonl",
    [
        JsonlCase(
            id="grounded-answer",
            input=[{"role": "user", "content": "Answer using context."}],
            expected_output=[{"role": "assistant", "content": "Answer cites context."}],
            extra={"assertions": [rag_faithfulness()]},
        )
    ],
)
write_eval_yaml("evals/dataset.eval.yaml", EvalDefinition(name="rag-suite", tests="./dataset.jsonl"))
```
