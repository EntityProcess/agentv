# Change: Add provider-level batching flag in targets.yaml

## Why

Teams need a declarative way to tell AgentV to batch all eval queries through a single provider session (e.g., one VS Code run with multiple `-q` arguments) instead of per-case dispatch.

## What Changes

- Add a `provider_batching: true` setting to target schemas to request provider-level batching when supported.
- Require graceful fallback to per-case dispatch if the provider does not support batching.

## Impact

- Affects: evaluation op (batch dispatch), target schema validation.
- Code: target resolution/validation, provider capability checks (e.g., VS Code).
