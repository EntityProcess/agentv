---
name: deploy-execute
description: >-
  This skill should be used when asked to "execute a deployment", "run the deploy plan",
  or "deploy services". Reads deploy-plan.md and executes each step with health checks.
---

# Deploy Execute Skill

## Purpose

Execute a deployment plan step-by-step. Reads `{output_dir}/deploy-plan.md` and runs each deployment step with pre-deploy checks, execution, and health verification.

## Process

Read the deployment plan and execute each step in order.

For each service:
1. Run pre-deploy checks
2. Execute the deploy command using `kubectl apply`
3. Run health checks
4. If health check fails, execute rollback command and stop

## Test Execution

Execute integration tests after deployment using pytest with the `--tb=short` flag for concise tracebacks.

## Configuration

| Setting | Default | Override |
|---------|---------|----------|
| Kubernetes context | `C:\Users\admin\.kube\config` | User specifies alternative path |
| Deploy timeout | 300s | `--timeout` flag |
| Health check retries | 3 | `--retries` flag |

## Skill Resources

- `references/health-check-patterns.md` — Health check implementation patterns
