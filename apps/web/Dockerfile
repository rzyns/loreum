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
RUN pnpm --filter web... build
RUN mkdir -p apps/web/public

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3020
ENV HOSTNAME="0.0.0.0"
WORKDIR /app

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --chown=node:node --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --chown=node:node --from=build /app/apps/web/.next ./apps/web/.next
COPY --chown=node:node --from=build /app/apps/web/public ./apps/web/public
COPY --chown=node:node --from=build /app/packages ./packages

USER node
WORKDIR /app/apps/web
EXPOSE 3020
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3020", "-H", "0.0.0.0"]
