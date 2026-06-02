# AgentV Coding Agent Skills

This directory contains repo-local skills that teach coding agents how to work with AgentV. They are shared across compatible tools through `.agents/skills`, with `.claude/skills` symlinked here for Claude compatibility.

## Skills

| Skill | Description |
| ----- | ----------- |
| [agentv-core-development](agentv-core-development/) | Core design principles, TypeScript conventions, naming, wire-format rules, docs expectations, and project structure. |
| [agentv-testing-verification](agentv-testing-verification/) | AgentV test strategy, CLI verification, grader e2e checks, browser verification, and pre-push behavior. |
| [agentv-git-workflow](agentv-git-workflow/) | AO-first session/worktree/PR lifecycle, GitHub collaboration, manual fallback worktrees, existing PR takeover, and merge cleanup. |
| [beads-execplan-issue-creator](beads-execplan-issue-creator/) | Optional when explicitly assigned: convert approved plans into dependency-aware bead epics/tasks with acceptance criteria, verification, and invariants. |
| [beads-epic-delivery-loop](beads-epic-delivery-loop/) | Optional when explicitly assigned: execute a bead epic end-to-end without spawning unmanaged agents. |
| [agentv-grader-changes](agentv-grader-changes/) | Grader type conventions, live eval verification, baseline updates, and score-range checks. |
| [agentv-release-publishing](agentv-release-publishing/) | Versioning, release workflow, and package publishing. |
