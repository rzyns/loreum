<p align="center">
  <img src="apps/web/public/loreum-logomark.png" alt="Loreum" width="80" />
</p>

<h1 align="center">Loreum</h1>

<p align="center">
  Every character, faction, and timeline in one searchable place.<br/>
  The worldbuilding platform that makes AI useful.
</p>

<p align="center">
  <a href="https://loreum.app">Website</a> ·
  <a href="https://discord.gg/A2s5gZ8rcz">Discord</a> ·
  <a href="https://loreum.app/roadmap">Roadmap</a> ·
  <a href="https://loreum.app/docs">Docs</a>
</p>

<p align="center">
  <a href="https://github.com/loreum-app/loreum/actions"><img src="https://github.com/loreum-app/loreum/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License" /></a>
  <a href="https://discord.gg/A2s5gZ8rcz"><img src="https://img.shields.io/discord/1492392236867125422?color=5865F2&label=discord" alt="Discord" /></a>
</p>

---

Loreum is a database for fictional worlds. Track characters, relationships, timelines, organizations, maps, lore, and story structure in a purpose-built platform with instant search across everything. No scattered files, no lost notes, no contradictions.

AI plugs into all of it. Connect Claude, Cursor, or any MCP-compatible assistant, and it reads your entire world: entities, relationships, timeline, lore, style guide, and storyboard. Write-capable MCP tools are guarded separately and should stay disabled for remote deployments until the operator explicitly opts in.

**For novelists, screenwriters, game designers, tabletop RPG game masters, comic book writers, and anyone building a fictional universe that needs structure.**

## Features

- **Entities** - Characters, locations, organizations, and custom types with configurable field schemas, backstories, and secrets
- **Knowledge Graph** - Visual relationship editor showing how everything in your world connects (React Flow)
- **Timeline** - Events and eras on an interactive Gantt chart with drag-to-edit and custom calendar support
- **Lore Wiki** - Canonical world articles with entity mentions, categories, and tags
- **Storyboard** - Plotlines, works, chapters, and scenes cross-referenced to your world data
- **Style Guide** - Voice, tone, POV, pacing, dialogue rules, scene overrides, and per-character voice notes
- **AI Integration (MCP)** - Read tools for MCP-compatible AI, with remote write exposure disabled by default and controlled by explicit server-side allowlists
- **Review Queue** - Planned safety path for AI-proposed changes with diff review before canon updates
- **API Key Auth** - Project-scoped keys with `READ_ONLY`, `DRAFT_WRITE`, or `CANONICAL_WRITE` target permissions for MCP authentication
- **Public Wiki** - Share your world as a read-only site while keeping secrets and drafts private
- **Maps** - Upload map images and pin locations with coordinates
- **Search** - Full-text search across all content

## How It Works

1. **Build your world** in the Loreum web app with entities, relationships, timelines, lore, and a style guide
2. **Add AI** by bringing your own via MCP or using the built-in assistant. Build solo or invite collaborators
3. **Write with context** as AI reads your canon to generate grounded content; review-queue-backed AI suggestions are planned, while current remote HTTP MCP deployments should remain read-only/fail-closed by default

## Tech Stack

| Layer    | Technology                                |
| -------- | ----------------------------------------- |
| Frontend | Next.js 16, React 19, shadcn/ui, Tailwind |
| API      | NestJS, Prisma 7, PostgreSQL 18           |
| Queue    | BullMQ + Redis 7                          |
| Auth     | OAuth2 (Google) + JWT with token rotation |
| Graph    | React Flow (@xyflow/react)                |
| AI       | MCP protocol (Model Context Protocol)     |
| Storage  | Cloudflare R2 (S3-compatible)             |
| Infra    | Cloudflare CDN + Tunnel                   |
| Testing  | Vitest, Supertest, GitHub Actions CI      |
| Monorepo | Turborepo + pnpm                          |

## Quick Start

For detailed local setup, troubleshooting, and smoke checks, see [Local Development](docs/LOCAL_DEV.md).

```sh
# Clone the repo
git clone https://github.com/loreum-app/loreum.git
cd loreum

# Install dependencies
pnpm install

# Copy environment files
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# Verify environment examples cover required keys
pnpm check:env-examples

# Start Postgres + Redis (+ OpenSearch for future full-text search)
docker compose up -d
docker compose ps

# Generate Prisma client, run migrations, and seed demo data
pnpm --filter api db:generate
pnpm --filter api db:migrate
pnpm --filter api db:seed

# Start development (all apps)
pnpm dev
```

API: `http://localhost:3021` | Web: `http://localhost:3020` | Swagger: `http://localhost:3021/docs`

## MCP Server

Connect any MCP-compatible AI to your world data. Generate a project-scoped API key from project settings, then configure your client:

```json
{
  "mcpServers": {
    "loreum": {
      "command": "node",
      "args": ["path/to/loreum/apps/mcp/dist/index.js"],
      "env": {
        "MCP_API_BASE_URL": "https://api.loreum.app/v1",
        "MCP_API_TOKEN": "your-api-key"
      }
    }
  }
}
```

Project API keys are scoped to one project. Target permissions are `READ_ONLY`, `DRAFT_WRITE`, and `CANONICAL_WRITE`; legacy `READ_WRITE` is a compatibility alias for canonical write capability, not a new-key recommendation. Remote HTTP MCP deployments must stay read-only/fail-closed by default; exposing mutation tools requires an explicit server-side write opt-in (`MCP_ENABLE_WRITES=true`) plus a narrow `MCP_WRITE_TOOLS` allowlist after API permission and project-scope enforcement has been verified. Any all-write HTTP MCP posture is staging-only for `testworld`, not production/default. The current direct-write MCP tools are not a substitute for the planned review queue. [Full MCP documentation](https://loreum.app/docs/mcp).

## Project Structure

```
apps/
  api/          NestJS API (Prisma, BullMQ, WebSocket)
  web/          Next.js frontend (shadcn/ui, React Flow)
  mcp/          MCP server for AI tool integration
packages/
  types/        Shared TypeScript interfaces
  ui/           Shared UI components
  typescript-config/
  eslint-config/
docs/
  LOCAL_DEV.md          Local development runbook and smoke checks
  PRODUCT_SPEC.md         Full feature specification
  SYSTEM_ARCHITECTURE.md  Architecture diagrams
  API_REFERENCE.md        REST, WebSocket, MCP docs
  USER_JOURNEYS.md        User flow documentation
  ERD.md                  Entity-relationship diagram
  DEPLOYMENT.md           Production deployment guide
  TODO.md                 MVP checklist and roadmap
```

## Documentation

| Document                                           | Description                                   |
| -------------------------------------------------- | --------------------------------------------- |
| [Local Development](docs/LOCAL_DEV.md)             | Local setup, commands, and smoke checks       |
| [Product Spec](docs/PRODUCT_SPEC.md)               | Complete feature specification with tiers     |
| [System Architecture](docs/SYSTEM_ARCHITECTURE.md) | Component, data flow, and deployment diagrams |
| [API Reference](docs/API_REFERENCE.md)             | REST, WebSocket, and MCP tool documentation   |
| [User Journeys](docs/USER_JOURNEYS.md)             | User flow documentation                       |
| [ERD](docs/ERD.md)                                 | Entity-relationship diagram                   |
| [Deployment](docs/DEPLOYMENT.md)                   | Production deployment guide                   |
| [TODO](docs/TODO.md)                               | MVP checklist and roadmap                     |
| [Changelog](CHANGELOG.md)                          | Version history                               |

## Community

- [Discord](https://discord.gg/A2s5gZ8rcz) - Questions, feedback, and discussion
- [Contributing](CONTRIBUTING.md) - Development setup, code conventions, PR process
- [Code of Conduct](CODE_OF_CONDUCT.md) - Community standards
- [Security](SECURITY.md) - How to report vulnerabilities

## License

[AGPL-3.0](LICENSE)
