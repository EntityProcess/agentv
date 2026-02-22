#!/usr/bin/env bash
# Mock CLI agent for cross-repo-sync showcase.
# Reads the prompt (passed as $1), determines the sync scenario, and makes targeted edits.
set -e

PROMPT="$1"
OUTPUT_FILE="$2"

# Portable in-place sed (GNU vs BSD)
sedi() { sed -i.bak "$@" && find . -name '*.bak' -delete; }

cd agentevals

if echo "$PROMPT" | grep -qi "eval spec v2"; then
  # Scenario 1: Add assert types and required gates
  EVAL_FILE="docs/src/content/docs/specification/evaluators.mdx"
  FORMAT_FILE="docs/src/content/docs/specification/eval-format.mdx"

  if [ -f "$EVAL_FILE" ]; then
    sedi 's/7 evaluator types/11 evaluator types/' "$EVAL_FILE" 2>/dev/null || true
    cat >> "$EVAL_FILE" <<'PATCH'

### Deterministic Assert Types

- **contains** — Checks if output contains a substring
- **regex** — Checks if output matches a regular expression pattern
- **is_json** — Checks if output is valid JSON
- **equals** — Checks if output equals an expected value exactly
PATCH
  fi

  if [ -f "$FORMAT_FILE" ]; then
    sedi 's/weight: number/weight: number\n      required: boolean/' "$FORMAT_FILE" 2>/dev/null || true
  fi

  echo "Updated evaluators and eval-format for eval spec v2 assert types and required gates" > "$OUTPUT_FILE"

elif echo "$PROMPT" | grep -qi "cases.*tests"; then
  # Scenario 2: Rename cases to tests
  find docs/src/content/docs/specification -name "*.mdx" -exec sh -c 'sed -i.bak "s/cases/tests/g" "$1" && rm -f "$1.bak"' _ {} \; 2>/dev/null || true
  echo "Renamed cases to tests across spec docs" > "$OUTPUT_FILE"

elif echo "$PROMPT" | grep -qi "eval_cases"; then
  # Scenario 3: Rename eval_cases to cases, expected_outcome to criteria
  find docs/src/content/docs/specification -name "*.mdx" -exec sh -c 'sed -i.bak "s/eval_cases/cases/g" "$1" && rm -f "$1.bak"' _ {} \; 2>/dev/null || true
  find docs/src/content/docs/specification -name "*.mdx" -exec sh -c 'sed -i.bak "s/expected_outcome/criteria/g" "$1" && rm -f "$1.bak"' _ {} \; 2>/dev/null || true
  echo "Renamed eval_cases to cases, expected_outcome to criteria/outcome" > "$OUTPUT_FILE"

else
  echo "Unknown sync scenario" > "$OUTPUT_FILE"
fi
