# Knowledge Search (KS) Evaluation Example

Demonstrates evaluation of AI-generated search summaries for a knowledge base search API.

## What This Shows

- **CLI target with filters**: Passing user-selected filters to search commands
- **Membership level access control**: Restricting content based on user tier
- **Fallback message compliance**: Exact message matching for out-of-scope queries
- **Prompt rule compliance**: Safety guardrails, tone, formatting, format router

## Use Case

This example simulates evaluating an AI search assistant that:

1. Queries a knowledge base (similar to WiseTech Academy)
2. Filters results based on user-selected criteria (e.g., product=Cargowise)
3. Restricts content based on user membership level (free/premium/enterprise)
4. Returns exact fallback messages for out-of-scope topics
5. Follows strict formatting and safety rules from a system prompt

## Running

```bash
# From repository root
bun agentv eval examples/showcase/ks-search/evals/dataset.yaml

# Run specific test case
bun agentv eval examples/showcase/ks-search/evals/dataset.yaml --eval-id fallback-out-of-scope-competitor

# Run with verbose output
bun agentv eval examples/showcase/ks-search/evals/dataset.yaml -v
```

## Key Files

- `evals/dataset.yaml` - Evaluation cases covering all test scenarios
- `.agentv/targets.yaml` - CLI target configurations with different filters/levels
- `mock_search_cli.py` - Mock CLI simulating the search API

## Test Categories

### 1. Basic Search Functionality
- Verifies markdown formatting (overview, card, further learning)

### 2. User-Selected Filters
- Tests `--filter product=Cargowise` parameter
- Validates only filtered content is returned

### 3. Membership Level Access Control
- Premium users see both free and premium content
- Free users are restricted from premium-only content

### 4. Fallback Message Compliance
- Competitor/alternative queries trigger fallback
- Personal/staff information queries are blocked
- Political/religious topics return fallback

### 5. Prompt Rule Compliance
- Dangerous goods allowlist is honored (educational content)
- Internal IDs (wta.course, etc.) are never exposed
- Professional tone without chatty/apologetic language

### 6. Format Router Classification
- Type 1: Definition queries ("what is...")
- Type 3: How-to queries ("how do I...")

## CLI Signature

The mock CLI uses a similar signature to a real search API:

```bash
uv run mock_search_cli.py \
  --prompt "{PROMPT}" \
  --limit 10 \
  --datasource wta.subjectcontent \
  --filter product=Cargowise \
  --membership-level premium \
  --output-file {OUTPUT_FILE}
```

## Extending This Example

To add new test cases:

1. Add entries to `evals/dataset.yaml`
2. Define rubrics for specific compliance checks
3. Use different targets for filter/membership combinations
4. Extend `mock_search_cli.py` to simulate more behaviors
