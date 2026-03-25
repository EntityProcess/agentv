# Health Check Patterns

## HTTP Health Check

```bash
curl -sf http://service:8080/health || exit 1
```

## TCP Health Check

```bash
nc -z service 8080 || exit 1
```

## Custom Script

```bash
./scripts/check-service.sh --service api --timeout 30
```
