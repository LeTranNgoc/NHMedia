# syntax=docker/dockerfile:1
#
# Backend runtime image for Fly.io / generic container hosts.
#
# Notes:
# - Build context MUST be the monorepo ROOT (not `backend/`). Fly.io
#   reads `dockerfile = "backend/Dockerfile"` from fly.toml and the
#   `[build] dockerfile_target_workdir = "."` keeps the root as cwd.
# - `tsx` is in prod deps so the runtime can load TypeScript directly.
#   This avoids the dual-build dance for the shared workspace package
#   whose package.json `main` points at `src/index.ts`. Trade-off: ~100ms
#   slower cold start vs `node dist/*.js`, negligible for a long-running
#   server.

FROM node:20-alpine AS runtime
WORKDIR /app

# Build deps required by mongodb optional bson native bits + pnpm CLI
RUN apk add --no-cache python3 make g++ \
    && corepack enable \
    && corepack prepare pnpm@10.33.2 --activate

# Copy workspace manifests + lockfile first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/

# Install production deps only — devDeps (vitest, mongo-memory-server) excluded
RUN pnpm install --frozen-lockfile --prod

# Copy workspace sources. tsx loads .ts at runtime so no compile step.
COPY tsconfig.base.json ./
COPY shared/ ./shared/
COPY backend/ ./backend/

# Strip the test/build artifacts that leaked through (defense in depth — .dockerignore is the primary filter)
RUN rm -rf backend/dist backend/coverage backend/__tests__ shared/dist

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Run from /app so the workspace symlinks resolve correctly
WORKDIR /app/backend
CMD ["pnpm", "exec", "tsx", "src/main.ts"]
