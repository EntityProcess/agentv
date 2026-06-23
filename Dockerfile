# ── Stage 1: build ────────────────────────────────────────────────────
FROM oven/bun:1.3.3 AS build
WORKDIR /app
# All workspace member package.json files needed for bun install to resolve lockfile
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY apps/cli/package.json apps/cli/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# Prune packages only needed by apps/web and devDeps to shrink runtime image
RUN rm -rf node_modules/.bun/workerd* \
    node_modules/.bun/@cloudflare* \
    node_modules/.bun/wrangler* \
    node_modules/.bun/miniflare* \
    node_modules/.bun/@github+copilot* \
    node_modules/.bun/@openai+codex* \
    node_modules/.bun/@pagefind* \
    node_modules/.bun/typescript* \
    node_modules/.bun/@biomejs* \
    node_modules/.bun/@esbuild* \
    node_modules/.bun/@img+sharp* \
    node_modules/.bun/@shikijs* \
    node_modules/.bun/tsup* \
    node_modules/.bun/@astrojs* \
    node_modules/.bun/astro* \
    node_modules/.bun/starlight* \
    node_modules/.bun/@starlight* \
    node_modules/.bun/vite* \
    node_modules/.bun/rollup* \
    node_modules/.bun/sharp*

# ── Stage 2: runtime ─────────────────────────────────────────────────
FROM oven/bun:1.3.3-slim
WORKDIR /app

# tini for proper PID 1 signal handling (graceful shutdown)
# git for remote project/result sync; wget for health check (curl not available in slim image)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git tini wget \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system agentv && adduser --system --ingroup agentv agentv

# Install uv + Python to a shared location (not user-specific)
COPY --from=ghcr.io/astral-sh/uv:0.6.12 /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR=/opt/python
RUN uv python install 3.12 && ln -s /opt/python/cpython-3.12.9-linux-*-gnu /opt/python/current
ENV PATH="/opt/python/current/bin:${PATH}"

# Copy pruned node_modules and built artifacts
COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=build /app/packages/sdk/package.json ./packages/sdk/
COPY --from=build /app/apps/cli/dist ./apps/cli/dist
COPY --from=build /app/apps/cli/package.json ./apps/cli/
COPY --from=build /app/apps/cli/node_modules ./apps/cli/node_modules
COPY --from=build /app/apps/dashboard/dist ./apps/dashboard/dist

USER agentv
ENV PORT=3117
EXPOSE 3117
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --spider -q http://localhost:${PORT}/ || exit 1
ENTRYPOINT ["tini", "--", "bun", "apps/cli/dist/cli.js"]
CMD ["serve"]
