# GARR — Global Agent Root Registry

A DNS-inspired registry of registries for AI agents. Build ICANN, not Google.

See `GARR_Architecture_Spec_v1.1.docx` for the authoritative design.

## Quickstart

```bash
nvm use                              # Node 20
npm install
docker compose up -d --wait          # Postgres on host port 5433
cp .env.example .env                 # then set SIGNING_PRIVATE_KEY
npm run migrate                      # apply schema
npm run dev                          # http://localhost:3000
```

Live API docs: <http://localhost:3000/docs>
OpenAPI JSON (for codegen): <http://localhost:3000/docs/json>

## Endpoint status

Schemas are locked — request/response shapes will not change without a
versioned bump. `✗` endpoints respond with `501 Not Implemented` and the
`ApiError` shape; teammates can integrate against them today.

| Method | Path                                      | Status | Notes                              |
|--------|-------------------------------------------|--------|------------------------------------|
| GET    | `/health`                                 | ✓      | DB ping; used by orchestrators     |
| POST   | `/api/v1/register`                        | ✗      | 501; verification + signing TBD    |
| POST   | `/api/v1/register/:owner_id/verify`       | ✗      | 501; challenge response TBD        |
| GET    | `/api/v1/owners/:owner_id`                | ✗      | 501; read path TBD                 |
| GET    | `/global_agent_root.json`                 | ✗      | 501; manifest publisher TBD        |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Boot Fastify with auto-reload (tsx watch) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest — unit + integration |
| `npm run migrate` | Apply SQL migrations under `db/migrations/` |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run the compiled production build |

## Stack

TypeScript · Node 20 · Fastify 5 · postgres.js · Postgres 16
