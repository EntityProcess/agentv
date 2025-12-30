# Export Risk Screening Showcase

Demonstrates evaluation of AI-powered export control risk classification with confusion matrix metrics.

## Use Case

Trade compliance teams screen shipments to identify potential dual-use goods requiring export licenses. This showcase evaluates an AI system that classifies shipments into three risk levels:

- **High**: Likely controlled, requires license or further investigation
- **Medium**: Potentially controlled, requires specification review
- **Low**: Standard commercial goods, routine processing

## Key Features

1. **Multi-class classification** (Low/Medium/High)
2. **Structured JSON output** with reasoning
3. **Code evaluator** for format validation and accuracy checking
4. **Post-processing script** for confusion matrix and precision/recall/F1 metrics

## Files

```
export-screening/
├── README.md                           # This file
├── skills/
│   └── export-risk-assessment.md       # Classification guidelines
├── evals/
│   ├── dataset.yaml                    # Eval cases with expert assessments
│   ├── validate_risk_output.py         # JSON validator + accuracy checker
│   └── compute_confusion_matrix.py     # Post-processor for metrics
└── .agentv/
    └── targets.yaml                    # (optional) target configuration
```

## Running the Evaluation

### Step 1: Run AgentV evaluation

From the repository root:

```bash
cd examples/showcase/export-screening

# Run evaluation and save results
bun agentv eval ./evals/dataset.yaml --output results.jsonl
```

### Step 2: Compute confusion matrix metrics

```bash
# Generate metrics JSON (also prints summary to stderr)
uv run ./evals/compute_confusion_matrix.py results.jsonl metrics.json
```

### Example Output

```
=== Export Risk Classification Metrics ===

Total samples: 16
Accuracy: 75.0%

Confusion Matrix (rows=actual, cols=predicted):
           |      Low   Medium     High
------------------------------------------
       Low |        3        1        0
    Medium |        2        1        1
      High |        0        1        7

Per-class Metrics:
     Class |  Precision     Recall         F1
----------------------------------------------
       Low |      60.0%    75.0%      66.7%
    Medium |      33.3%    25.0%      28.6%
      High |      87.5%    87.5%      87.5%
----------------------------------------------
   Overall |      60.3%    62.5%      60.9%
```

### JSON Output Format

```json
{
  "summary": {
    "totalSamples": 16,
    "samplesPerClass": {"Low": 4, "Medium": 4, "High": 8},
    "accuracy": 0.75
  },
  "confusionMatrix": {
    "classes": ["Low", "Medium", "High"],
    "matrix": {
      "Low": {"Low": 3, "Medium": 1, "High": 0},
      "Medium": {"Low": 2, "Medium": 1, "High": 1},
      "High": {"Low": 0, "Medium": 1, "High": 7}
    },
    "description": "matrix[actual][predicted] = count"
  },
  "metricsPerClass": {
    "Low": {"precision": 0.6, "recall": 0.75, "f1": 0.667, ...},
    "Medium": {"precision": 0.333, "recall": 0.25, "f1": 0.286, ...},
    "High": {"precision": 0.875, "recall": 0.875, "f1": 0.875, ...}
  },
  "overallMetrics": {
    "precision": 0.603,
    "recall": 0.625,
    "f1": 0.609
  }
}
```

## Evaluation Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  dataset.yaml   │────▶│  bun agentv eval │────▶│   results.jsonl    │
│ (eval cases +   │     │                  │     │  (per-case scores) │
│  expert labels) │     └──────────────────┘     └─────────┬──────────┘
└─────────────────┘                                        │
                                                           ▼
                                              ┌────────────────────────┐
                                              │ compute_confusion_     │
                                              │ matrix.py              │
                                              └───────────┬────────────┘
                                                          │
                                                          ▼
                                              ┌────────────────────────┐
                                              │     metrics.json       │
                                              │ (confusion matrix +    │
                                              │  precision/recall/F1)  │
                                              └────────────────────────┘
```

## How It Works

### 1. Eval Cases (`dataset.yaml`)

Each case contains:
- **Input**: Shipment details (origin, destination, product, HS code)
- **Expected output**: Expert risk assessment (`riskLevel: High|Medium|Low`)
- **Outcome description**: Explanation for human reviewers

### 2. Code Evaluator (`validate_risk_output.py`)

The evaluator:
1. Validates JSON format and required fields
2. Extracts AI's `riskLevel` prediction
3. Compares to expected `riskLevel` from `expected_messages`
4. Outputs structured hits/misses for post-processing:
   - Hit: `"Correct: AI=High, Expected=High"`
   - Miss: `"Mismatch: AI=Low, Expected=High"`

### 3. Post-Processor (`compute_confusion_matrix.py`)

Parses the JSONL results to:
1. Extract predicted vs actual classifications from hits/misses
2. Build confusion matrix
3. Compute per-class precision, recall, F1
4. Compute macro-averaged overall metrics

## Customization

### Adding eval cases

Add cases to `dataset.yaml` following the existing pattern:

```yaml
- id: exp-custom-001
  conversation_id: export-screening
  outcome: |
    Description of expected behavior for reviewers.
  expected_messages:
    - role: assistant
      content:
        riskLevel: High  # Expert assessment (ground truth)
  input_messages:
    - role: user
      content:
        - type: file
          value: ../skills/export-risk-assessment.md
        - type: text
          value: |
            Assess export risk for this shipment:

            Origin: XX
            Destination: YY
            Product: Description here
            HS Code: 0000
```

### Modifying risk levels

To change classification categories (e.g., add "Critical"):

1. Update `CLASSES` in both Python scripts
2. Update `VALID_RISK_LEVELS` in `validate_risk_output.py`
3. Update the skill prompt in `export-risk-assessment.md`

## Purpose

This showcase is useful for:

- **Prompt optimization**: Measure classification accuracy across prompt variations
- **Model comparison**: Compare different LLMs on the same eval set
- **Regression testing**: Ensure prompt changes don't degrade accuracy
- **Stakeholder reporting**: Generate metrics for compliance team review
