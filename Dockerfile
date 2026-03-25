# ── Stage 1: build ────────────────────────────────────────────────────
FROM oven/bun:1.3.3 AS build
WORKDIR /app
# All workspace member package.json files needed for bun install to resolve lockfile
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/eval/package.json packages/eval/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# ── Stage 2: runtime ──────────────────────────────────────────────────
FROM oven/bun:1.3.3-slim
WORKDIR /app

# tini for proper PID 1 signal handling (graceful shutdown)
# wget for health check (curl not available in slim image)
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini wget \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system agentv && adduser --system --ingroup agentv agentv

# Install uv + Python (for Python-based providers/evaluators)
COPY --from=ghcr.io/astral-sh/uv:0.6.12 /uv /usr/local/bin/uv
RUN uv python install 3.12

# Copy only built artifacts — not the full build context
COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/eval/dist ./packages/eval/dist
COPY --from=build /app/packages/eval/package.json ./packages/eval/
COPY --from=build /app/apps/cli/dist ./apps/cli/dist
COPY --from=build /app/apps/cli/package.json ./apps/cli/
COPY --from=build /app/apps/cli/node_modules ./apps/cli/node_modules
RUN chown -R agentv:agentv /app

USER agentv
ENV PORT=3117
EXPOSE 3117
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --spider -q http://localhost:${PORT}/ || exit 1
ENTRYPOINT ["tini", "--", "bun", "apps/cli/dist/cli.js"]
CMD ["serve"]
