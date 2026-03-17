# GitHub Copilot Plugin Compatibility Design

**Date:** 2026-03-17
**Status:** Approved

## Objective

Make the agentv plugin discoverable by both Claude Code (existing) and VS Code GitHub Copilot by adding `.github/plugin/` structure alongside the existing `.claude-plugin/` layout.

## Background

GitHub Copilot (VS Code) discovers plugins via `.github/plugin/marketplace.json` and per-plugin `.github/plugin/plugin.json` manifests. Claude Code uses `.claude-plugin/marketplace.json`. The formats are similar but live in different directories.

Reference repos:
- `github/awesome-copilot` — community plugin marketplace
- `WiseTechGlobal/cargowise-copilot` — production plugin example

## Design Decisions

1. **Dual-compatible:** Keep `.claude-plugin/` for Claude Code AND add `.github/plugin/` for VS Code Copilot.
2. **No file moves:** Skills and agents stay nested inside `plugins/agentv-dev/`. The `.github/plugin/plugin.json` references them with relative paths.
3. **No agent rename:** Agent files keep `.md` extension (no `.agent.md` rename).
4. **Hooks plugin excluded:** `agentv-claude-trace` stays Claude Code-only. VS Code Copilot hooks use a different format.

## New Files

### `.github/plugin/marketplace.json`

Root-level marketplace entry for GitHub Copilot discovery:

```json
{
  "plugins": [
    {
      "name": "agentv-dev",
      "source": "agentv-dev",
      "description": "Development skills for building and optimizing AgentV evaluations",
      "version": "1.0.0"
    }
  ]
}
```

### `plugins/agentv-dev/.github/plugin/plugin.json`

Per-plugin manifest in GitHub Copilot format:

```json
{
  "name": "agentv-dev",
  "description": "Development skills for building and optimizing AgentV evaluations",
  "version": "1.0.0",
  "author": { "name": "AgentV" },
  "repository": "https://github.com/EntityProcess/agentv",
  "license": "MIT",
  "keywords": ["eval", "testing", "agent", "benchmarks"],
  "agents": ["./agents"],
  "skills": [
    "./skills/agentv-bench",
    "./skills/agentv-eval-analyzer",
    "./skills/agentv-eval-writer",
    "./skills/agentv-onboarding",
    "./skills/agentv-trace-analyst"
  ]
}
```

## Unchanged Files

- `.claude-plugin/marketplace.json` — untouched
- All `SKILL.md` files — already compatible format
- All agent `.md` files — no rename
- `plugins/agentv-claude-trace/` — Claude Code only

## Result

The repo is discoverable by both:
- **Claude Code** via `.claude-plugin/marketplace.json`
- **VS Code GitHub Copilot** via `.github/plugin/marketplace.json`
