# Contributing to AgentV

Thanks for contributing.

## The One Rule

**Understand your change.** If you can’t explain what your code does, why it belongs in AgentV, and how it affects existing behavior, don’t submit it yet.

Using AI tools is fine. Shipping code you don’t understand is not.

## Before You Build

For non-trivial features or behavior changes, open an issue first and wait for maintainer alignment.

AgentV is early-stage, so we prioritize:
- clear problem statements
- small focused PRs
- changes that keep core minimal and push niche behavior to plugins

## Development Setup

```bash
bun install
bun run build
bun run test
```

Run CLI changes from source during development:

```bash
bun apps/cli/src/cli.ts --help
```

## Before Submitting a PR

```bash
bun run verify
```

Also ensure:
- PR explains what changed and why
- tests/docs are updated when relevant
- no unrelated refactors in the same PR

## Workflow

- Branch from `main`
- Open a PR (draft is fine)
- Keep iteration scoped and reviewable

If your change affects eval behavior or output shape, include an example command and result snippet in the PR description.
