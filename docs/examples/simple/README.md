# Simple Example - AgentV Schema

This directory demonstrates AgentV's eval schema with complete, working examples.

## Directory Structure

```
simple/
├── .env.template                   # Environment configuration template
├── .gitignore                      # Git ignore rules
├── README.md                       # This file
├── evals/                          # Evaluation test cases
│   ├── example-eval.yaml           # Main schema example
│   └── snippets/                   # Code snippets for evals
│       └── python-second-largest.md
├── evaluators/                     # Evaluator components
│   ├── prompts/                    # LLM judge prompt templates
│   │   └── code-correctness-judge.md    # Semantic code evaluation
│   └── scripts/                    # Code-based evaluators
│       └── check_python_keywords.py     # Python validator script
└── prompts/                        # Shared instruction files
    ├── javascript.instructions.md  # JavaScript guidelines
    └── python.instructions.md      # Python guidelines
```

## Key Files

### Evaluation Files (`evals/`)

- **`example-eval.yaml`**: Complete schema demonstration showing:
  - Basic features: `input_messages`, `expected_messages`
  - File references and content blocks
  - Conversation threading with `conversation_id`
  - Multiple evaluators (code + LLM judge)
  - Target overrides per eval case

### Evaluator Components (`evaluators/`)

- **`scripts/`**: Code-based evaluators (Python, shell, etc.)
  - Input: JSON with eval case data via stdin
  - Output: JSON with score, passed flag, and reasoning
  - Example: `check_python_keywords.py` validates Python code quality

- **`prompts/`**: LLM judge prompt templates (Markdown)
  - Define how an LLM should evaluate outputs
  - Include scoring guidelines and output format
  - Example: `code-correctness-judge.md` for semantic code review

### Shared Instruction Files (`prompts/`)

- **`python.instructions.md`**: Python coding guidelines
- **`javascript.instructions.md`**: JavaScript coding guidelines
- These instruction files can be referenced in eval files to provide context

