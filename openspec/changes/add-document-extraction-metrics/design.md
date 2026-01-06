## Context

AgentV already supports:

- Deterministic field-level scoring via the built-in `field_accuracy` evaluator
- Custom domain evaluators via `code_judge` scripts (TypeScript via `@agentv/eval`)
- JSONL outputs that are consumed downstream for comparisons and reporting

For document extraction evaluation, users need *dataset-level* views (per attribute), and robust *line-item* correctness that is not sensitive to array order.

## Goals

- Enable document extraction evaluation to produce per-attribute TP/TN/FP/FN breakdowns and derived precision/recall/F1 across the dataset.
- Improve line-item evaluation by matching expected items to parsed items before scoring.
- Keep AgentV core minimal and generic; ship domain-specific logic as example `code_judge` scripts.

## Non-Goals

- No new built-in “document extraction” evaluator.
- No UI/dashboard work.
- No optimal assignment solver (Hungarian) in the first iteration.

## Decision 1: Minimal Core Change = preserve `code_judge` structured details

### Problem

`code_judge` outputs are currently limited to `score`, `hits`, `misses`, `reasoning`. Domain evaluators need to output structured, machine-readable metrics (counts, per-field breakdowns, alignments) so that:

- Reports can aggregate across a dataset without re-implementing judge logic
- Debugging can link back to exactly which fields/items drove FP/FN

### Decision

Extend the code judge result contract to allow an optional `details` JSON object, and persist that object into `evaluator_results[*].details` and JSONL output.

### Rationale

- Generic: any domain evaluator can benefit from structured details.
- Backward compatible: existing judges that only output the standard fields continue to work.
- Keeps “aggregation/reporting” out of core: AgentV just transports data.

### Shape

Proposed addition (wire and output):

- `details`: arbitrary JSON object (bounded in examples)

## Decision 2: Header-field confusion metrics via `code_judge`

### Classification rules (per attribute)

Let `expected` be the ground-truth value and `parsed` be the candidate value at the same field path.
Define `isEmpty(x)` as: `x === null || x === undefined || (typeof x === 'string' && x.trim() === '')`.

- **TP**: `expected` equals `parsed` AND `expected` is non-empty
- **TN**: `expected` equals `parsed` AND `expected` is empty
- **FP+FN**: `expected` not equal `parsed` AND both are non-empty
- **FP**: `expected` is empty AND `parsed` is non-empty
- **FN**: `expected` is non-empty AND `parsed` is empty

### Derived metrics

For each attribute across the dataset:

- $Precision = TP / (TP + FP)$ (undefined when denominator is 0)
- $Recall = TP / (TP + FN)$ (undefined when denominator is 0)
- $F1 = 2PR / (P + R)$ (undefined when $P+R=0$)

### Output

The judge emits:

- `score`: macro-F1 across configured attributes (simple default)
- `details`:
  - per-field `{ tp, tn, fp, fn, precision?, recall?, f1? }`
  - optional examples of mismatches (bounded)

## Decision 3: Line-item matching before scoring via `code_judge`

### Problem

Index-based comparisons (`line_items[0]`, `line_items[1]`, …) are brittle when:

- parsed items are reordered
- duplicates exist
- some expected items are missing or merged

### Minimal matching strategy (v1)

Use deterministic greedy matching:

1. Define an item key/similarity based on configured match fields (e.g. `description`, `hs_code`).
2. Compute pairwise similarity scores between expected items and parsed items.
3. Repeatedly take the best remaining match above a threshold and remove the matched items.
4. Unmatched expected items count toward FN; unmatched parsed items count toward FP.

### Scoring

After matching, compute per-attribute TP/TN/FP/FN across matched pairs + unmatched penalties, then derive precision/recall/F1 per attribute across the dataset.

### Output

The judge emits:

- `details.alignment`: list of matched index pairs with similarity scores (bounded)
- `details.metrics`: per-field confusion counts and derived metrics

## Risks / Trade-offs

- Greedy matching can be suboptimal vs Hungarian; acceptable for a first iteration and keeps dependencies minimal.
- Details payload size can grow; examples must bound `details` (limit mismatches and alignment rows).

## Open Questions

- Should equality for non-string types (numbers/dates) use existing `field_accuracy` match rules, or remain simple deep-equality in the judge?
- What is the default `score` for these judges (macro-F1 vs micro-F1 vs weighted)?
