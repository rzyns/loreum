# Local Development

This runbook boots Loreum locally and gives copyable checks for the API and web app.

## Prerequisites

- Node.js 20+ recommended (`package.json` allows Node 18+, but contributor docs use 20+)
- pnpm 9 (`packageManager` is `pnpm@9.0.0`)
- Docker with Docker Compose
- Local infrastructure from `docker compose`: PostgreSQL, Redis, and OpenSearch

PostgreSQL and Redis are required for the API. OpenSearch is included in Compose for infrastructure/future full-text search work, but Phase 1 search is Prisma-backed and does not require OpenSearch for basic search implementation.

## 1. Install dependencies

```sh
pnpm install
```

## 2. Copy environment files

```sh
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

The example values are intended for local development. If you change Compose ports or credentials in `.env`, keep `apps/api/.env` in sync, especially `DATABASE_URL` and `REDIS_URL`.

You can verify the example files cover the expected keys with:

```sh
pnpm check:env-examples
```

Expected output includes:

```text
Env example coverage check passed.
```

## 3. Start local infrastructure

```sh
docker compose up -d
```

Check container status:

```sh
docker compose ps
```

Expected result: `loreum-postgres`, `loreum-redis`, and `loreum-opensearch` containers are running. PostgreSQL and Redis should become healthy before database setup and API checks. OpenSearch may take longer to become healthy and is not required for the Prisma-backed Phase 1 search path.

## 4. Prepare the database

Generate the Prisma client:

```sh
pnpm --filter api db:generate
```

Apply migrations in normal local development:

```sh
pnpm --filter api db:migrate
```

Use `db:push` only when you intentionally want to sync the schema without creating/applying a migration, such as a short-lived local prototype or recovering a throwaway development database:

```sh
pnpm --filter api db:push
```

Seed demo data:

```sh
pnpm --filter api db:seed
```

Avoid destructive commands such as `db:reset` unless you are prepared to wipe the local database.

## 5. Start the apps

```sh
pnpm dev
```

Default local URLs:

- Web: `http://localhost:3020`
- API: `http://localhost:3021`
- Swagger/OpenAPI docs: `http://localhost:3021/docs`

## 6. Smoke checks

In another terminal, check the API health endpoint:

```sh
curl http://localhost:3021/v1/health
```

Expected healthy response when the API can reach the database:

```json
{ "status": "healthy", "checks": { "database": "ok" } }
```

Check the web app response headers:

```sh
curl -I http://localhost:3020
```

Expected result: an HTTP success response such as `HTTP/1.1 200 OK` or `HTTP/1.1 307 Temporary Redirect`, depending on the route and Next.js dev behavior. You can also open `http://localhost:3020` in a browser.

The web app can render while the API is unhealthy. If the page loads but data-backed flows fail, check the API health response and the `pnpm dev` terminal for API errors first.

## Full copyable bootstrap

```sh
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm check:env-examples
docker compose up -d
docker compose ps
pnpm --filter api db:generate
pnpm --filter api db:migrate
pnpm --filter api db:seed
pnpm dev
```

With `pnpm dev` running, verify from a second terminal:

```sh
curl http://localhost:3021/v1/health
curl -I http://localhost:3020
```
