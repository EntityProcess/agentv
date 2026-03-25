# Deployment Patterns

## Blue-Green Deployment

Run two identical environments. Route traffic to the new version after health checks pass.

## Canary Deployment

Route a small percentage of traffic to the new version. Monitor error rates before full rollout.

## Rolling Deployment

Update instances one at a time. Each instance is health-checked before proceeding to the next.
