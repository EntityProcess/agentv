---
name: deploy-plan
description: >-
  This skill should be used when asked to "plan a deployment", "create a deploy plan",
  or "prepare release steps". Produces a deployment plan with rollback strategy.
---

# Deploy Plan Skill

## Purpose

Create a structured deployment plan from a release specification. Produces `{output_dir}/deploy-plan.md` with step-by-step instructions, dependency ordering, and rollback checkpoints.

## When to Use

- Planning a new deployment from a release spec
- Coordinating multi-service deployments with dependency ordering
- Generating rollback checkpoints for each deployment step

## Process

1. Read the release specification
2. Identify affected services and their dependencies
3. Order deployments by dependency graph (databases first, then backends, then frontends)
4. For each service, define: pre-deploy checks, deploy command, health check, rollback command
5. Write `{output_dir}/deploy-plan.md`

## Phase Handoff

After completing the plan, tell the user:

"Next step — run:
/deploy-execute {output_dir}
Or let the orchestrator continue automatically."

## Skill Resources

- `references/deployment-patterns.md` — Common deployment patterns and anti-patterns
