FROM node:22-alpine AS base
RUN corepack enable pnpm
ENV NEXT_TELEMETRY_DISABLED=1

# ── 1. Fetch locked dependencies ───────────────────────────────────────────
# This layer is cached as long as package.json and pnpm-lock.yaml don't change.
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
RUN pnpm fetch

# ── 2. Install dependencies and build ─────────────────────────────────────
FROM deps AS builder
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --dir apps/web db:generate
ENV NODE_ENV=production
RUN pnpm --dir apps/web build

# ── 3. Production runner ───────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Prisma CLI for running migrations.
# Installed globally via npm to avoid pnpm virtual store symlink complexity.
# NODE_PATH lets prisma.config.ts resolve its explicit dotenv import.
RUN npm install -g prisma@7.8.0 dotenv@16
ENV NODE_PATH="/usr/local/lib/node_modules"

# Standalone Next.js output (server.js + traced runtime node_modules).
# With outputFileTracingRoot set to the monorepo root, standalone mirrors the
# workspace path: server entry is at apps/web/server.js inside this directory.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./

# Static assets and public directory are NOT traced by standalone output.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# Prisma config, schema, and migrations (needed for `prisma migrate deploy`).
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/prisma.config.ts ./apps/web/prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/prisma ./apps/web/prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/web/server.js"]
