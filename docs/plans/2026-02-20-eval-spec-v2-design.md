# Eval Spec v2 Design

## Problem

AgentV's eval YAML spec lacks discoverability metadata, has fragmented evaluation concepts (`evaluators`, `rubrics` as separate fields), and uses inconsistent syntax across evaluator types. Comparing with industry frameworks (promptfoo, deepeval, OpenBench) and the Agent Skills standard reveals gaps in shareability and AI-native ergonomics.

## Goals

1. **Shareable eval packs** — metadata (name, version, author, tags) makes evals discoverable and portable
2. **Unified evaluation** — single `assert` field replaces `evaluators` and `rubrics`
3. **Consistent syntax** — every assert item uses `type:` (no shorthand ambiguity)
4. **Required gates** — any assert item can short-circuit the test on failure
5. **Clean data separation** — YAML is primary config, `tests` field points to external data

## Non-Goals

- Variables/template substitution (AgentV has no prompt templates; `input` is literal content)
- Scenarios/cartesian products (use external datasets or `execution.targets` for matrix testing)
- Cross-framework import/export (own clean design, document mappings in docs)
- New evaluator types (existing types cover the use cases)

## Design

### Metadata Block

New optional top-level fields for discoverability, inspired by Agent Skills' SKILL.md frontmatter.

```yaml
name: export-screening
description: Evaluates export screening agent accuracy against denied party lists
version: "1.0"
author: acme-compliance
tags: [compliance, agents, safety]
license: Apache-2.0
requires:
  agentv: ">=0.6.0"
```

When present, `name` and `description` are required (minimum for discoverability). All other metadata fields are optional. Existing eval files without metadata continue to work unchanged.

**Schema:**

```typescript
const MetaSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  description: z.string().min(1).max(1024),
  version: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  license: z.string().optional(),
  requires: z.object({
    agentv: z.string().optional(),
  }).optional(),
});
```

Metadata fields are top-level (not nested under a `meta:` key) to keep the spec flat and scannable.

### Unified `assert` Field

The current spec has three places evaluation logic lives:

- `execution.evaluators` — heavyweight evaluators (llm_judge, code_judge, composite)
- `rubrics` — shorthand that auto-creates a rubric evaluator
- (proposed) deterministic assertions (contains, regex, is_json)

All three are fundamentally the same: they take an output and produce a score 0-1. The only differences are how they compute the score and how complex they are to configure.

**Decision: unify everything under `assert`.** Rename `evaluators` to `assert`. Fold `rubrics` in as a `type: rubrics` entry. Add deterministic assertions as new types.

`assert` is the most LLM-idiomatic term — it has overwhelming training weight from Python (`assert`), Jest/JUnit (assertions), and promptfoo (`assert:` field).

#### Assert Placement

`assert` is "what conditions the output must satisfy" — it belongs at the test definition level as a sibling of `expected_output` and `criteria`, not nested inside `execution`.

`execution` keeps what's truly "how to run": `targets`, `trials`, `cache`, `skip_defaults`.

```yaml
tests:
  - id: test-1
    # Test definition (WHAT)
    input: "Screen: Huawei"
    criteria: Should deny the transaction
    expected_output: "DENIED"
    assert:
      - type: contains
        value: "DENIED"
        required: true
      - type: rubrics
        criteria:
          - id: identification
            outcome: "Correctly identifies denied entity"
            weight: 5.0

    # Execution config (HOW)
    execution:
      targets: [claude-only]
      skip_defaults: true
```

#### Consistent `type:` Syntax

Every assert item uses `type:` — no shorthand field-name-as-type patterns. One consistent syntax that matches promptfoo's pattern and eliminates ambiguity.

```yaml
assert:
  - type: contains
    value: "DENIED"

  - type: rubrics
    criteria:
      - id: identification
        outcome: "Identifies entity"
        weight: 5.0

  - type: llm_judge
    prompt: ./judges/compliance.md

  - type: code_judge
    script: ./scripts/verify.ts
```

#### Assert Types

| Type | Purpose | Score | Key Fields |
|------|---------|-------|------------|
| `contains` | Substring match | 0 or 1 | `value` |
| `regex` | Regex match | 0 or 1 | `value` |
| `is_json` | Valid JSON check | 0 or 1 | — |
| `equals` | Exact match | 0 or 1 | `value` |
| `rubrics` | LLM-graded structured criteria | 0-1 | `criteria` (array of rubric items) |
| `llm_judge` | LLM evaluation with custom prompt | 0-1 | `prompt` |
| `code_judge` | Custom script evaluation | 0-1 | `script` |
| `tool_trajectory` | Agent tool call verification | 0-1 | `mode`, `expected` |
| `field_accuracy` | Structured data extraction | 0-1 | `fields` |
| `composite` | Custom aggregation of grouped assertions | 0-1 | `assert`, `aggregator` |
| `agent_judge` | Agentic workspace audit | 0-1 | `prompt`, `max_steps` |
| `execution_metrics` | Threshold checks on metrics | 0-1 | `max_tool_calls`, `max_llm_calls`, etc. |
| `latency` | Duration threshold | 0 or 1 | `max_ms` |
| `cost` | Cost threshold | 0 or 1 | `max_usd` |
| `token_usage` | Token threshold | 0 or 1 | `max_total`, `max_input`, `max_output` |

New deterministic types (`contains`, `regex`, `is_json`, `equals`) are implemented as in-process TypeScript evaluators — effectively built-in code judges that return 0 or 1.

#### Common Fields on Any Assert Item

| Field | Default | Purpose |
|-------|---------|---------|
| `weight` | 1.0 | Relative weight in final score |
| `required` | false | `true` = gate (fail -> entire test = 0). Numeric value = custom min score threshold |
| `name` | — | Identifier for composite aggregator weights |

#### Rubrics as Self-Contained Judge

Rubric items must be grouped inside a `type: rubrics` entry. Individual rubric items are not standalone — their weights are relative to each other within the group. Multiple `type: rubrics` entries create independent rubrics judges.

```yaml
- type: rubrics
  criteria:
    - id: identification
      outcome: "Correctly identifies Huawei as a listed entity on the BIS Entity List"
      weight: 5.0
      required: true
    - id: legal-basis
      outcome: "Cites the correct regulatory authority (EAR, OFAC SDN, Entity List)"
      weight: 3.0
    - id: risk-assessment
      outcome: "Identifies semiconductor equipment as controlled technology"
      weight: 2.0
    - id: action-items
      outcome: "Recommends next steps: license application, escalation, or alternative sourcing"
      weight: 1.0
  weight: 4.0
```

The `criteria` field replaces the previous direct array under `rubrics`. This avoids confusion where `rubrics` was both a field name and contained the items.

#### Composite Evaluator

Composite groups assertions with custom aggregation. Its inner list is also named `assert` for consistency.

```yaml
- type: composite
  assert:
    - name: safety
      type: llm_judge
      prompt: ./judges/safety.md
    - name: regulatory-accuracy
      type: llm_judge
      prompt: ./judges/regulatory-accuracy.md
  aggregator:
    type: weighted_average
    weights:
      safety: 0.7
      regulatory-accuracy: 0.3
  weight: 3.0
```

### Required Gates

Any assert item can have `required: true`. If a required gate fails, the entire test scores 0 — the weighted average is skipped.

```yaml
assert:
  - type: contains
    value: "DENIED"
    required: true              # Binary: must match

  - type: tool_trajectory
    mode: in_order
    expected:
      - tool: search_entity_list
      - tool: check_regulations
    required: true              # Must score >= 0.8 (pass threshold)

  - type: code_judge
    script: ./check.ts
    required: 0.6               # Custom min score
```

Semantics:

- `required: true` — item must score >= pass threshold (0.8) for binary assertions this means score = 1
- `required: <number>` — item must score >= the specified value
- If ANY required gate fails, `final_score = 0`, `verdict = FAIL`
- Gates are checked before computing the weighted average

### Scoring Model

```
1. Check all required gates
   -> Any gate fails -> final_score = 0, verdict: FAIL

2. Weighted average of all assert scores
   -> final_score = sum(score_i * weight_i) / sum(weight_i)

3. Verdict
   -> pass >= 0.8, borderline >= 0.6, fail < 0.6
```

Two levels of weights that don't mix:

- **Inner weights** — how sub-items combine within one evaluator (rubric criteria, composite children)
- **Outer weights** — how evaluators combine into the final test score

### Inheritance

Suite-level `assert` is appended to every test's `assert`:

```yaml
# Suite level
assert:
  - type: latency
    max_ms: 10000

tests:
  - id: test-1
    assert:
      - type: contains
        value: "DENIED"
    # Effective assert: [latency, contains]

  - id: test-2
    skip_defaults: true
    assert:
      - type: contains
        value: "APPROVED"
    # Effective assert: [contains] (no latency)
```

### External Test Data

The YAML file is the primary configuration. The `tests` field can point to an external data file instead of containing inline tests.

```yaml
# String path -> external file replaces tests array
tests: ./datasets/screening-cases.jsonl

# Array -> inline tests (existing behavior)
tests:
  - id: test-1
    input: "Screen: Huawei"
    assert:
      - type: contains
        value: "DENIED"

# Array with file references -> modular (existing behavior)
tests:
  - file://cases/accuracy.yaml
  - file://cases/safety.yaml
```

This inverts the current sidecar pattern. Currently you run `agentv eval dataset.jsonl` and the YAML is the sidecar. The new recommended pattern is `agentv eval suite.yaml` with `tests: ./data.jsonl` — the YAML is primary, external data is secondary.

Supported formats: `.yaml`, `.jsonl`, `.csv`.

Path resolution: paths are relative to the eval file's directory. Absolute paths and parent traversal (`../shared/cases.yaml`) are supported.

Backward compatibility: `agentv eval dataset.jsonl` continues to work with the existing sidecar convention.

### Execution Block

`execution` remains nested for "how to run" configuration. No changes to its structure.

```yaml
execution:
  targets: [claude-agent, gpt-agent]
  trials:
    count: 3
    strategy: pass_at_k
  cache: true
```

Per-test overrides:

```yaml
tests:
  - id: test-1
    execution:
      targets: [claude-only]
      skip_defaults: true
```

## Complete Example

```yaml
name: export-screening
description: Evaluates export screening agent accuracy against denied party lists
version: "1.0"
author: acme-compliance
tags: [compliance, agents, safety]
license: Apache-2.0
requires:
  agentv: ">=0.6.0"

execution:
  targets: [claude-agent, gpt-agent]
  trials:
    count: 3
    strategy: pass_at_k
  cache: true

workspace:
  template: ./workspace-template
  setup:
    script: [bun, run, setup.ts]
    timeout_ms: 120000
  teardown:
    script: [bun, run, teardown.ts]

assert:
  - type: latency
    max_ms: 10000
  - type: cost
    max_usd: 0.10

tests:
  - id: sanctioned-entity
    input: >
      Screen this entity for export compliance: Huawei Technologies Co., Ltd.
      Transaction: sale of semiconductor manufacturing equipment.
    criteria: Should deny the transaction citing Entity List restrictions
    expected_output: >
      DENIED - Huawei is on the BIS Entity List.
      Semiconductor equipment requires a license under EAR 744.11.

    assert:
      - type: contains
        value: "DENIED"
        required: true

      - type: tool_trajectory
        mode: in_order
        expected:
          - tool: search_entity_list
            args:
              query: "Huawei"
          - tool: check_regulations
          - tool: generate_report
        required: true
        weight: 2.0

      - type: rubrics
        criteria:
          - id: identification
            outcome: "Correctly identifies Huawei as a listed entity on the BIS Entity List"
            weight: 5.0
            required: true
          - id: legal-basis
            outcome: "Cites the correct regulatory authority (EAR, OFAC SDN, Entity List) and relevant sections"
            weight: 3.0
          - id: risk-assessment
            outcome: "Identifies that semiconductor equipment is controlled technology under EAR Category 3"
            weight: 2.0
          - id: action-items
            outcome: "Recommends next steps: license application, escalation, or alternative sourcing"
            weight: 1.0
        weight: 4.0

      - type: code_judge
        script: ./scripts/verify-entity-match.ts
        weight: 2.0

      - type: composite
        assert:
          - name: safety
            type: llm_judge
            prompt: ./judges/safety.md
          - name: regulatory-accuracy
            type: llm_judge
            prompt: ./judges/regulatory-accuracy.md
        aggregator:
          type: weighted_average
          weights:
            safety: 0.7
            regulatory-accuracy: 0.3
        weight: 3.0

    metadata:
      category: denial
      jurisdiction: US

  - id: clean-entity
    input: >
      Screen this entity for export compliance: Siemens AG.
      Transaction: sale of industrial sensors to Munich facility.
    criteria: Should approve the transaction with standard diligence notes
    expected_output: "APPROVED"

    assert:
      - type: contains
        value: "APPROVED"
        required: true

      - type: rubrics
        criteria:
          - id: correct-clearance
            outcome: "Correctly determines Siemens AG is not on any restricted party list"
            weight: 5.0
            required: true
          - id: due-diligence
            outcome: "Notes relevant considerations: end-use verification, sensor classification"
            weight: 2.0
          - id: false-positive-handling
            outcome: "Does not incorrectly flag Siemens despite partial name matches with other entities"
            weight: 3.0
        weight: 4.0

    metadata:
      category: approval
      jurisdiction: EU

  - id: ambiguous-entity
    input: >
      Screen this entity: Beijing Computational Research Institute.
      Transaction: export of high-performance computing chips.
    criteria: Should flag for manual review with detailed risk analysis
    expected_output: "REVIEW REQUIRED"
    skip_defaults: true

    assert:
      - type: regex
        value: "REVIEW|ESCALAT"
        required: true

      - type: rubrics
        criteria:
          - id: ambiguity-recognition
            outcome: "Recognizes entity is not definitively listed but has risk indicators"
            weight: 4.0
          - id: risk-factors
            outcome: "Identifies specific risk factors: military end-use concern, HPC export controls, China military-civil fusion"
            weight: 3.0
          - id: escalation-path
            outcome: "Recommends appropriate escalation: enhanced due diligence, end-use certificate, license determination"
            weight: 2.0
        weight: 4.0

      - type: code_judge
        script: ./scripts/check-risk-factors.ts
        weight: 2.0

    execution:
      targets: [claude-agent]

    metadata:
      category: ambiguous
      jurisdiction: CN

## Schema Changes

### New Fields

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `name` | top-level | string | When metadata present | Eval pack name, lowercase + hyphens, max 64 chars |
| `description` | top-level | string | When metadata present | What this eval measures, max 1024 chars |
| `version` | top-level | string | No | SemVer version string |
| `author` | top-level | string | No | Author or organization |
| `tags` | top-level | string[] | No | Discovery/filtering tags |
| `license` | top-level | string | No | SPDX license identifier |
| `requires` | top-level | object | No | Compatibility constraints |
| `requires.agentv` | top-level | string | No | Minimum AgentV version |
| `assert` | top-level | array | No | Default assertions for all tests |
| `assert` | per-test | array | No | Per-test assertions (appended to defaults) |
| `skip_defaults` | per-test | boolean | No | Don't inherit suite-level assert |

### Renamed Fields

| Current | New | Notes |
|---------|-----|-------|
| `execution.evaluators` | `assert` | Promoted to test level, renamed |
| `rubrics` (test-level) | `type: rubrics` in `assert` | Folded into unified assert |
| `rubrics` items (direct array) | `criteria` field on rubrics type | Nested under `criteria` key |

### Modified Fields

| Field | Change |
|-------|--------|
| `tests` | Now accepts string path (e.g., `./data.jsonl`) in addition to array |
| `required` | Extended from rubric items to any assert item. Accepts `true` or numeric min score |
| `weight` | Now available on all assert items (previously only on evaluators) |

### New Assert Types (Built-in Deterministic)

| Type | Fields | Score |
|------|--------|-------|
| `contains` | `value: string` | 0 or 1 |
| `regex` | `value: string` | 0 or 1 |
| `is_json` | — | 0 or 1 |
| `equals` | `value: string` | 0 or 1 |

Implemented as in-process TypeScript evaluators in `packages/core/`.

### Backward Compatibility

| Current Feature | Status |
|----------------|--------|
| `execution.evaluators` | Supported as alias, maps to `assert` |
| `rubrics` (test-level field) | Supported as alias, maps to `type: rubrics` in `assert` |
| `evaluator` (sidecar field) | Unchanged |
| `agentv eval dataset.jsonl` | Unchanged, sidecar convention still works |
| `file://` references in tests | Unchanged |

All existing eval files continue to work. New features are additive — no fields are removed.

## Migration Path

1. **Phase 1: Add metadata fields** — parse and validate top-level `name`, `description`, etc. No breaking changes.
2. **Phase 2: Add `assert` field** — support `assert` alongside `execution.evaluators` and `rubrics`. All three work. Log deprecation warning for old fields.
3. **Phase 3: Add deterministic assertion types** — implement `contains`, `regex`, `is_json`, `equals` as built-in evaluators.
4. **Phase 4: Add `required` gates** — extend `required` to all assert items. Implement gate-first scoring.
5. **Phase 5: Add `tests` as string path** — support scalar string for `tests` field pointing to external data file.
6. **Phase 6: Deprecate old fields** — after sufficient adoption, deprecate `execution.evaluators` and test-level `rubrics` in docs (still supported in code).

## Future Extensions (Not In Scope)

- **Eval pack folder convention** — formalize folder structure (eval.yaml + datasets/ + judges/ + scripts/) as a packaging standard. Compatible with this design — eval.yaml is this spec.
- **Eval registry/discovery** — search and share eval packs by metadata tags. Requires metadata from this design.
- **Derived metrics** — post-evaluation composite scores from named assertion metrics.
- **Scenarios** — cartesian product of variable sets and test definitions.
