---
title: Hard-correct next-tag-only surfaces before stable release
date: 2026-06-25
category: conventions
module: Release compatibility
problem_type: convention
component: development_workflow
severity: medium
applies_when:
  - Removing or renaming a config value, wire field, CLI flag, or public API surface
  - Deciding whether a shipped-looking surface needs backward compatibility
tags: [release-channel, compatibility, deprecation, config-schema]
---

# Hard-correct next-tag-only surfaces before stable release

## Context

AgentV briefly exposed `results.sync.push_conflict_policy: backup_and_force_push`
on the npm `next` tag while replacing force-push results sync with a no-force
merge loop. Treating that as a stable shipped surface would have kept a
misleading compatibility alias around even though the value contradicted the new
product invariant: AgentV never force-pushes result branches.

## Guidance

When checking whether a config value or public surface has shipped, distinguish
release channels:

- Stable npm releases require normal compatibility handling: preserve behavior,
  soft-deprecate, or provide an explicit migration path.
- `next`-only releases can be hard-corrected before the surface reaches stable,
  especially when preserving the surface would encode a dangerous or misleading
  contract.

For removed config values, make the correction explicit:

```yaml
results:
  sync:
    # Remove unsupported aliases and use the stable default.
    push_conflict_policy: block
```

If existing local registries or generated config may contain the removed value,
either reject it with migration guidance or drop it during a registry migration
that rewrites the supported shape on the next save.

## Why This Matters

Pre-release tags are useful for discovering wrong API names and unsafe contracts.
If every `next` exposure becomes permanent compatibility debt, the project loses
the ability to correct those mistakes before stable release. The compatibility
bar should protect stable users without forcing unsafe pre-release names into
the long-term schema.

## When to Apply

- A value, flag, or field appeared only on npm `next` or another prerelease
  channel.
- The replacement behavior is already stable and safer.
- Keeping the old surface would confuse users about current behavior or
  preserve a hazardous name.

## Examples

`backup_and_force_push` should not remain a supported
`results.sync.push_conflict_policy` value after the force-push implementation is
removed. Even though it appeared on a published `next` tarball, the stable
migration is to remove the field or set it to `block`; AgentV's actual behavior
is a no-force-push merge loop.

## Related

- docs/adr/0007-conflict-free-results-sync-without-force-push.md
