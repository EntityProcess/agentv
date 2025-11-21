## 1. Implementation

- [ ] Update target schema to accept `provider_batching` under `settings`.
- [ ] Wire provider capability detection so AgentV batches in a single provider session when supported and requested.
- [ ] Add tests covering schema acceptance and batching selection/fallback behaviour.
