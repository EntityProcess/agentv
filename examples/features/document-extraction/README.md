# Document Extraction Example (`field_accuracy`)

This folder is a small, runnable showcase of `field_accuracy` on a mock invoice extractor.

## Run

From repo root:

```bash
bun agentv eval examples/features/document-extraction/evals/dataset.yaml
```

This eval discovers the example target definition at `examples/features/document-extraction/.agentv/targets.yaml` automatically.

## Where To Look

- Dataset: `examples/features/document-extraction/evals/dataset.yaml`
- Target (mock extractor): `examples/features/document-extraction/mock_extractor.ts`
- Fixtures: `examples/features/document-extraction/fixtures/`
- Fuzzy judges (plugins): `examples/features/document-extraction/multi_field_fuzzy.ts`, `examples/features/document-extraction/fuzzy_match.ts`
