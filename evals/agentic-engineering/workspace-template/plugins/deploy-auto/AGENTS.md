# Deploy Auto Plugin

## Rule: Deployment Workflow

TRIGGER: Working on a deployment or release
ACTION: Follow the deploy pipeline. Use `/deploy-pipeline`.

## Rule: Multi-Service Coordination

TRIGGER: Deployment spans multiple services
ACTION: Deploy in dependency order — databases first, backends second, frontends last.
