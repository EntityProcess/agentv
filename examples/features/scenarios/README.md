# Scenarios Example

Demonstrates Promptfoo-style `scenarios` authoring with AgentV's current
contract: top-level `prompts`, file-backed `scenarios`, `scenarios[].config`,
`scenarios[].tests`, config-owned reference answers in `vars`, and explicit
assertions.

## What This Shows

- Reusing one shared set of phrase tests across multiple language configs
- Crossing three `config` rows with two `tests` rows to produce six cases
- Loading the scenario matrix through a `file://` glob
- Keeping per-language reference answers in config vars
- Consuming config vars with explicit `equals` assertions
- Running against a deterministic local CLI target

## Expansion

The main eval defines one prompt template and points `scenarios` at a file glob:

```yaml
prompts:
  - "Translate '{{ phrase }}' to {{ language }}."
scenarios:
  - file://scenarios/*.yaml
```

The glob loads `scenarios/translation-matrix.yaml`. AgentV flattens that file
into the top-level scenario list before lowering each scenario as
`config x tests`.

The scenario file keeps the changing data in `config` rows:

```yaml
config:
  - id: spanish
    vars:
      language: Spanish
      expected_hello: hola
      expected_thank_you: gracias
  - id: french
    vars:
      language: French
      expected_hello: bonjour
      expected_thank_you: merci
```

The shared tests are written once:

```yaml
tests:
  - description: translates a greeting
    vars: { phrase: hello }
    assert:
      - type: equals
        value: "{{ expected_hello }}"
  - description: translates a courtesy phrase
    vars: { phrase: thank you }
    assert:
      - type: equals
        value: "{{ expected_thank_you }}"
```

That produces six concrete cases without duplicating the test content:

| Config row | Test row | Rendered prompt | Expected value |
| --- | --- | --- | --- |
| `spanish` | greeting | `Translate 'hello' to Spanish.` | `hola` |
| `spanish` | courtesy phrase | `Translate 'thank you' to Spanish.` | `gracias` |
| `french` | greeting | `Translate 'hello' to French.` | `bonjour` |
| `french` | courtesy phrase | `Translate 'thank you' to French.` | `merci` |
| `portuguese` | greeting | `Translate 'hello' to Portuguese.` | `ola` |
| `portuguese` | courtesy phrase | `Translate 'thank you' to Portuguese.` | `obrigado` |

The deterministic local CLI target returns the translation, and the assertion
compares it to the reference answer from the config row.

## Running

```bash
# From repository root
bun apps/cli/src/cli.ts validate examples/features/scenarios/evals/suite.yaml
bun apps/cli/src/cli.ts eval run examples/features/scenarios/evals/suite.yaml \
  --targets examples/features/scenarios/targets.yaml \
  --target translation-cli
```

## Key Files

- `evals/suite.yaml` - Main eval with a file-backed scenario matrix
- `evals/scenarios/translation-matrix.yaml` - Scenario file loaded by glob
- `targets.yaml` - Deterministic CLI target for running the example
- `scripts/translation-target.mjs` - Prompt-to-translation target script
