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
├── optimizers/                     # Optimizer configurations
│   ├── ace-code-generation.yaml    # ACE optimization config
│   └── playbooks/                  # ACE learned knowledge (generated)
│       └── code-generation.json    # Structured optimization insights
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

### Optimizer Configurations (`optimizers/`)

- **`ace-code-generation.yaml`**: ACE optimization config that references eval files
  - Demonstrates separation between evals (what to test) and optimization (how to improve)
  - Shows ACE-specific settings: playbook path, epochs, reflection rounds
  
- **`playbooks/`**: ACE-generated playbooks (structured learning artifacts)
  - Contains learned optimization insights organized into sections
  - **Important**: Entire playbook is sent in LLM context (no RAG/retrieval)
  - Token-limited by model context window (~5-10k tokens practical limit)
  - Requires periodic consolidation to manage growth
  - Example: `code-generation.json` shows realistic playbook structure

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

## Next Steps

1. **Try running the examples**: Use `agentv eval evals/coding/example-eval.yaml`
2. **Modify eval cases**: Experiment with your own test scenarios
3. **Explore advanced examples**: See [../advanced/](../advanced/) for production patterns
4. **Create your own evals**: Use these as templates for your domain

## Related Documentation

- [Advanced Examples](../advanced/README.md) - Production-ready scenarios and optimization
- [AgentV Schema V2](../../features/schema-v2.md) - Full schema reference
- [Local CLI Provider Guide](../../features/local-cli-provider.md) - Custom CLI integration
