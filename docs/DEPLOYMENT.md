# Deployment Guide

This guide documents the currently supported Docker deployment path for Loreum. It is intended for homelab/staging use first: boring, inspectable, and easy to smoke-test before putting real canon data into it.

## Current deployment shape

| Service      | Image/build source                    | Purpose                                                       |
| ------------ | ------------------------------------- | ------------------------------------------------------------- |
| `web`        | `apps/web/Dockerfile`                 | Next.js web application on port `3020`                        |
| `api`        | `apps/api/Dockerfile`                 | NestJS API on port `3021`                                     |
| `migrate`    | `apps/api/Dockerfile`                 | One-shot Prisma `migrate deploy` job                          |
| `postgres`   | `postgres:18-alpine`                  | Primary data store                                            |
| `redis`      | `redis:7-alpine`                      | BullMQ/cache backing service                                  |
| `opensearch` | `opensearchproject/opensearch:2.14.0` | Optional; behind the `search` Compose profile                 |
| `mcp`        | `apps/mcp/Dockerfile`                 | Optional HTTP MCP server on port `3022`; read-only by default |

The homelab Compose stack binds service ports to loopback by default. Put Caddy, Traefik, Nginx, Cloudflare Tunnel, or another trusted reverse proxy in front of `web`, `api`, and `mcp` if you want LAN or Internet access.

## Files

- `.dockerignore` — excludes local dependencies, build outputs, caches, VCS metadata, and `.env*` secrets from Docker build contexts.
- `apps/api/Dockerfile` — builds the API, Prisma client, migrations/runtime artifacts, and runs as the non-root `node` user.
- `apps/web/Dockerfile` — builds the Next.js app and runs `next start` as the non-root `node` user.
- `apps/mcp/Dockerfile` — builds the MCP server image and runs `node apps/mcp/dist/index.js` as the non-root `node` user.
- `docker-compose.homelab.yml` — API/web/MCP/Postgres/Redis/migration deployment stack.
- `.env.homelab.example` — safe placeholder environment template. Copy it to `.env.homelab`; never commit the filled file.

## Build images directly

From the repository root:

```sh
# If Docker credential helpers are broken in WSL, prefix builds with a temp DOCKER_CONFIG:
# tmpcfg=$(mktemp -d) && printf '{}' > "$tmpcfg/config.json" && DOCKER_CONFIG="$tmpcfg" docker build ...

docker build -f apps/api/Dockerfile -t loreum-api:local .
docker build -f apps/web/Dockerfile -t loreum-web:local .
docker build -f apps/mcp/Dockerfile -t loreum-mcp:local .
```

The web image does not need a browser-visible API build argument for homelab. Browser requests go to the same-origin `/v1/*` Next.js proxy, and the running web container forwards them to `API_INTERNAL_URL`.

## Homelab Compose deployment

1. Create a private env file:

   ```sh
   cp .env.homelab.example .env.homelab
   chmod 600 .env.homelab
   ```

2. Edit `.env.homelab`:
   - Replace all placeholder passwords/secrets.
   - Keep `API_INTERNAL_URL` pointed at the Compose-internal API service, normally `http://api:3021/v1`.
   - Set `CORS_ORIGIN` to the externally reachable web origin.
   - Set `GOOGLE_CALLBACK_URL` to the externally reachable API callback URL if Google auth is enabled.
   - Set `COOKIE_DOMAIN` only when you need a parent-domain cookie scope, e.g. `.example.internal`; otherwise leave it blank.
   - Keep the default `*_BIND_ADDR=127.0.0.1` unless a reverse proxy needs a different bind address.

3. Build and start:

   ```sh
   docker compose \
     --env-file .env.homelab \
     -f docker-compose.homelab.yml \
     up -d --build
   ```

   The stack runs the one-shot `migrate` service before starting `api`, so Prisma migrations are applied with `prisma migrate deploy`.

4. Check status:

   ```sh
   docker compose --env-file .env.homelab -f docker-compose.homelab.yml ps
   docker compose --env-file .env.homelab -f docker-compose.homelab.yml logs migrate
   ```

5. Smoke-test:

   ```sh
   curl -fsS http://127.0.0.1:${API_PORT:-3021}/v1/health
   curl -fsSI http://127.0.0.1:${WEB_PORT:-3020}/
   ```

   Expected API health shape:

   ```json
   { "status": "healthy", "checks": { "database": "ok" } }
   ```

6. Stop:

   ```sh
   docker compose --env-file .env.homelab -f docker-compose.homelab.yml down
   ```

   Only use `-v` when you intentionally want to delete local Postgres/Redis volumes.

## Optional OpenSearch profile

Current basic search is Prisma-backed and does not require OpenSearch. If/when you need the optional OpenSearch service:

```sh
docker compose \
  --env-file .env.homelab \
  -f docker-compose.homelab.yml \
  --profile search \
  up -d --build
```

## MCP deployment note

The MCP server image is buildable, but remote/network deployments must be read-only by default. Treat `MCP_HTTP_AUTH_TOKEN` as client-to-MCP transport auth only; it does not grant permission to mutate Loreum data. The MCP server's server-to-API credential (`MCP_API_TOKEN`) should be a project-scoped API key, preferably `READ_ONLY` for normal remote use.

Do not enable write-capable HTTP MCP just by setting `MCP_READ_ONLY=false`. Safe write exposure requires all of the following:

- API-side enforcement of target permissions: `READ_ONLY` allows broad project-scoped reads only; `DRAFT_WRITE` may submit drafts/proposals; `CANONICAL_WRITE` may mutate canon and approve/apply drafts; legacy `READ_WRITE` aliases `CANONICAL_WRITE`.
- API-side enforcement that project API keys cannot read or mutate other projects and cannot perform account-global/control-plane operations.
- Explicit MCP write opt-in with `MCP_ENABLE_WRITES=true`.
- A narrow `MCP_WRITE_TOOLS` allowlist; start with `create_entity` only for disposable-project smoke testing.
- For staging/dev-only testing of every implemented write tool, set `MCP_ALLOW_ALL_WRITE_TOOLS=true` and explicitly list the desired tools in `MCP_WRITE_TOOLS`. Any all-write HTTP MCP posture is staging-only for `testworld`, not a production/default configuration.
- Rollback proof that disabling write mode removes all mutation tools from discovery again.

Keep examples placeholder-only and never commit real `MCP_HTTP_AUTH_TOKEN`, `MCP_API_TOKEN`, API keys, or stack environment values.

## Reverse proxy notes

- Route the web origin to `127.0.0.1:${WEB_PORT:-3020}`.
- Route the API origin to `127.0.0.1:${API_PORT:-3021}`.
- Preserve API paths; the API routes are under `/v1`.
- If using HTTPS externally, keep `NODE_ENV=production`; cookies become `secure` in production.
- OAuth callback URLs in Google Cloud must exactly match `GOOGLE_CALLBACK_URL`.

## Backups and rollback

Before serious use:

- Snapshot or back up the `postgres_data` volume.
- Keep a copy of the image tag/commit you deployed.
- Run `docker compose ... logs migrate` after every deployment to confirm migrations succeeded.
- Test restore/rollback on a throwaway stack before trusting the deployment with canonical world data.
