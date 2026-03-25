---
name: deploy-rollback
description: >-
  This skill should be used when asked to "rollback a deployment", "revert services",
  or "undo deploy". Reads deploy-plan.md and reverses completed steps.
---

# Deploy Rollback Skill

## Purpose

Rollback a failed or unwanted deployment. Reads `{output_dir}/deploy-plan.md` and reverses each completed step in reverse dependency order.

## Process

1. Read deploy-plan.md to identify completed steps
2. For each completed step (in reverse order):
   a. Execute the rollback command
   b. Verify the service returns to its previous state
   c. Run health checks
3. Write `{output_dir}/rollback-report.md`

## Stop Conditions

Stop and report immediately if:
- A rollback command fails
- Health checks fail after rollback
- The deploy plan cannot be read
