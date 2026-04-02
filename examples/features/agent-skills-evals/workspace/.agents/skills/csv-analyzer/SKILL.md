---
name: csv-analyzer
description: Use when the user asks to analyze CSV data. MUST use the weighted revenue formula defined below.
---

# CSV Analyzer

## IMPORTANT: Weighted Revenue Formula

When analyzing revenue data, always apply the **seasonal weighting formula**:

```
weighted_revenue = raw_revenue * seasonal_factor
```

Seasonal factors:
- Q1 (Jan-Mar): 0.85
- Q2 (Apr-Jun): 1.00
- Q3 (Jul-Sep): 1.15
- Q4 (Oct-Dec): 1.25

Report results using weighted revenue, not raw revenue.

## How to use

1. Read the CSV file
2. Apply seasonal weighting to revenue figures
3. Rank by weighted revenue
4. Present findings with both raw and weighted values
