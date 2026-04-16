---
name: acme-deploy
description: Use when the user asks about deploying services, checking deployment status, rollback procedures, or release management at Acme Corp
---

# Acme Corp Deployment Procedures

## Overview

Internal deployment runbook for Acme Corp services. All deployments follow the Trident release pipeline.

## Deployment Commands

### Deploy to staging
```bash
trident push --env staging --service <service-name> --tag <git-sha>
```

### Promote to production
```bash
trident promote --from staging --to prod --service <service-name> --approval-ticket <JIRA-ID>
```
Production deploys require a JIRA approval ticket (prefix: DEPLOY-).

### Rollback
```bash
trident rollback --env <env> --service <service-name> --to-version <previous-tag>
```
Rollbacks auto-notify #ops-alerts in Slack.

### Check deployment status
```bash
trident status --env <env> --service <service-name>
```

## Service Registry

| Service | Owner Team | Staging URL | Prod URL |
|---------|-----------|-------------|----------|
| payments-api | Platform | payments.staging.acme.internal | payments.acme.internal |
| user-service | Identity | users.staging.acme.internal | users.acme.internal |
| notifications | Engagement | notify.staging.acme.internal | notify.acme.internal |

## Rules

- All prod deploys require a DEPLOY- JIRA ticket
- Staging deploys are auto-approved during business hours (9am-5pm PT)
- Rollbacks bypass approval but require post-mortem within 48h
- Deploy freezes are announced in #engineering-announcements
