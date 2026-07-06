# Scenarios Example

Demonstrates Promptfoo-style `scenarios` authoring with AgentV's current contract:
top-level `prompts`, inline `scenarios`, `scenarios[].config`,
`scenarios[].tests`, reference answers in `vars`, and explicit assertions.

## What This Shows

- Crossing each scenario `config` row with each scenario `tests` row
- Mixing inline scenario objects with `file://` scenario refs
- Loading scenario files through a glob
- Keeping reference answers in `vars.expected_translation`
- Consuming reference answers with explicit `equals` assertions
- Running against a deterministic local CLI target

## Expansion

The main eval contains one inline Portuguese scenario and one file glob:

```yaml
scenarios:
  - description: Inline Portuguese scenario
    config:
      - vars:
          language: Portuguese
    tests:
      - id: inline-portuguese-hello
        vars:
          phrase: hello
          expected_translation: ola
        assert:
          - type: equals
            value: "{{ expected_translation }}"
  - file://scenarios/*.yaml
```

The glob loads `scenarios/french.yaml` and `scenarios/spanish.yaml`. AgentV
flattens those files into the top-level scenario list before lowering each
scenario as `config x tests`.

For example, the Spanish scenario has one config row and two tests:

```yaml
config:
  - vars:
      language: Spanish
tests:
  - id: spanish-hello-world
    vars:
      phrase: hello world
      expected_translation: hola mundo
```

That row renders the prompt:

```text
Translate 'hello world' to Spanish.
```

The deterministic local CLI target returns `hola mundo`, and the assertion
compares it to the reference answer from `vars.expected_translation`.

## Running

```bash
# From repository root
bun apps/cli/src/cli.ts validate examples/features/scenarios/evals/suite.yaml
bun apps/cli/src/cli.ts eval run examples/features/scenarios/evals/suite.yaml \
  --targets examples/features/scenarios/targets.yaml \
  --target translation-cli
```

## Key Files

- `evals/suite.yaml` - Main eval with inline and file-backed scenarios
- `evals/scenarios/french.yaml` - Scenario file loaded by glob
- `evals/scenarios/spanish.yaml` - Scenario file loaded by glob
- `targets.yaml` - Deterministic CLI target for running the example
- `scripts/translation-target.mjs` - Prompt-to-translation target script
