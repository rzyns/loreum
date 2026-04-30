# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat openssl \
  && corepack enable \
  && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter api db:generate
RUN pnpm --filter api... build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --chown=node:node --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --chown=node:node --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --chown=node:node --from=build /app/apps/api/dist ./apps/api/dist
# The compiled Nest output keeps relative imports to ../../generated/prisma/*,
# so place the compiled generated Prisma client where those runtime imports resolve.
COPY --chown=node:node --from=build /app/apps/api/dist/generated ./apps/api/generated
COPY --chown=node:node --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --chown=node:node --from=build /app/packages ./packages

USER node
EXPOSE 3021
CMD ["node", "apps/api/dist/src/main.js"]
