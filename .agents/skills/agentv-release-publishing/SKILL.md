---
name: agentv-release-publishing
description: Use when changing AgentV versioning, release automation, package publishing, npm package configuration, or release docs.
---

# AgentV Release and Publishing

## Versioning

Git commit history is the changelog. Use GitHub Actions for releases; do not publish manually from a local machine.

## Standard Release Flow

1. Run the Release workflow with `channel=next` and desired bump. It creates `x.y.z-next.1`, commits, tags, and pushes.
2. Publish workflow publishes npm `next`.
3. Run Release workflow with `channel=finalize`. It strips the prerelease suffix.
4. Publish workflow publishes npm `latest`.

## Direct Stable Release

Run the Release workflow with `channel=stable` and the desired bump. Publish workflow publishes npm `latest`.

## Local Scripts

`bun scripts/release.ts` can inspect version state locally, but do not run `bun run publish` or `bun run publish:next` locally. npm publish uses OIDC trusted publishing from GitHub Actions.

## Packages

- `packages/core/` publishes `@agentv/core`.
- `apps/cli/` publishes `agentv`.
- tsup bundles workspace dependencies with `noExternal: ["@agentv/core"]`.
