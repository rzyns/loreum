# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat \
  && corepack enable \
  && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter mcp... build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/apps/mcp/package.json ./apps/mcp/package.json
COPY --chown=node:node --from=build /app/apps/mcp/node_modules ./apps/mcp/node_modules
COPY --chown=node:node --from=build /app/apps/mcp/dist ./apps/mcp/dist
COPY --chown=node:node --from=build /app/packages ./packages

USER node
CMD ["node", "apps/mcp/dist/index.js"]
