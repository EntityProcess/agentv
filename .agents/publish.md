# Publish and Versioning

This file expands [AGENTS.md](../AGENTS.md) for version bumps, contract gates, and npm publishing.

## Source of Truth

- Git commit history is the changelog.
- Use the GitHub Actions publish workflow in [`.github/workflows/publish.yml`](../.github/workflows/publish.yml).
- There is no separate GitHub Actions release-prep workflow anymore. The publish workflow now prepares the version and tag, creates the GitHub Release, and publishes the npm packages.
- Do not publish manually from a local machine.

## Publish Workflow Channels

The publish workflow accepts these channels:

- `next`: bump to the next prerelease such as `x.y.z-next.N`, commit, tag, create the GitHub Release, and publish to npm `next`
- `finalize`: finalize the latest or specified prerelease tag, strip the `-next.N` suffix on `main`, create the stable tag and release, and publish to npm `latest`
- `stable`: bump straight to a stable release, tag it, create the GitHub Release, and publish to npm `latest`
- `existing`: publish an existing tag or ref without creating a new version bump first

Contract gates:

- `finalize` and `stable` run the live contract eval gate before version and tag work.
- `existing` also runs the contract gate when it is publishing a stable release to `latest`.

## Local Scripts

- `bun scripts/release.ts` performs the version-bump and tagging logic that the publish workflow calls.
- It is acceptable to run that script locally for non-publishing tasks such as inspecting version state.
- Do not run `bun run publish` or `bun run publish:next` locally. npm publishing uses OIDC trusted publishing and only works in GitHub Actions.

## Published Packages

- `packages/core/` publishes as `@agentv/core`
- `packages/sdk/` publishes as `@agentv/sdk`
- `apps/cli/` publishes as `agentv`
- The CLI bundles workspace dependencies via tsup with `noExternal: ["@agentv/core"]`
- Install with `bun install -g agentv` or `npm install -g agentv`
