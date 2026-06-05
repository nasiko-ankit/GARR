# GARR — Global Agent Root Registry

A DNS-inspired registry of registries for AI agents. Three-layer trust architecture:

| Layer | What | Analogy |
|-------|------|---------|
| **GARR** (this repo) | Registry of organisations — stores who exists and where their agents live | DNS root zone |
| **RAP** (`examples/rap-server`) | Each org runs their own agent catalog | Authoritative name server |
| **Agent** | An actual AI agent served by the RAP | A record |

## How it works

```
1. Register a Registry  →  POST /api/v1/register  (2-step challenge-response)
   Org submits domain + public key → GARR verifies DMARC → issues nonce
   Org signs nonce with private key → GARR stores signed EntityOwner

2. Register an Agent    →  POST /agents  (on the RAP server)
   Org adds agents to their own RAP; RAP signs each card with the org key

3. Resolve an Agent     →  GET /api/v1/resolve?locator=weather@nasiko.com:global
   GARR looks up domain → fetches AgentCard from RAP → verifies ed25519 chain
   Returns: { index_record, agent_card } with both signatures verified
```

## Quick Start

### 1. GARR backend

```bash
nvm use 20
npm install
docker compose up -d --wait          # Postgres on host port 5433
cp .env.example .env                 # fill in SIGNING_PRIVATE_KEY
npm run migrate
npm run dev                          # http://localhost:3001
```

Live API docs: http://localhost:3001/docs

### 2. RAP server (run one per organisation)

```bash
cd examples/rap-server
cp .env.example .env
# Fill in: DATABASE_URL, SIGNING_PRIVATE_KEY, RAP_DOMAIN, ADMIN_API_KEY
docker run -d --name rap-postgres \
  -e POSTGRES_USER=rap -e POSTGRES_PASSWORD=rap -e POSTGRES_DB=rap \
  -p 5434:5432 postgres:16-alpine
npm install
npm run dev                          # http://localhost:3002
```

The `SIGNING_PRIVATE_KEY` in the RAP **must** be the private key whose public key you register in GARR. They must be a matched keypair — GARR verifies every AgentCard signature against the registered public key.

A second RAP instance is in `examples/rap-server-acme` (port 3003) for testing multi-org resolution.

### 3. A2A Agents

Two reference A2A agents (Python, a2a-sdk 0.3.x) are in `agents/`:

```bash
# Weather Agent — mock weather data + OpenRouter LLM (port 5010)
cd agents/weather/a2a-weather-agent
pip install click uvicorn "a2a-sdk==0.3.26" openai pydantic httpx python-dotenv
echo "OPENROUTER_API_KEY=your-key" > .env
echo "OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free" >> .env
PYTHONPATH=src python3 -m src --host 0.0.0.0 --port 5010

# Translator Agent — Google Translate + OpenRouter LLM (port 5011)
cd agents/translator/a2a-translator
pip install click uvicorn "a2a-sdk==0.3.26" openai googletrans beautifulsoup4 langdetect pydantic httpx python-dotenv
echo "OPENROUTER_API_KEY=your-key" > .env
echo "OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free" >> .env
PYTHONPATH=src python3 -m src --host 0.0.0.0 --port 5011
```

Both expose their A2A card at `/.well-known/agent.json` (A2A protocol v0.3).

### 4. Frontend

The frontend is in the `garr-web` repo. Set `NEXT_PUBLIC_GARR_API_BASE_URL=http://localhost:3001` in `.env.local`.

## API Endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | DB ping |
| POST | `/api/v1/register` | DMARC + RAP reachability check → 202 challenge nonce |
| POST | `/api/v1/register/:owner_id/verify` | Signature verify → sign with GARR root key → 201 EntityOwner |
| GET | `/api/v1/owners/:owner_id` | Fetch single registry |
| GET | `/api/v1/search?q=` | Keyword search across owner_id, domain, display_name |
| GET | `/global_agent_root.json` | Signed root manifest — all active EntityOwners |
| GET | `/api/v1/resolve?locator=` | Full agent resolution (`:global`, `:dnssrv`, `:nandaindex.org`) |

### Locator format

```
agent@domain:mode

weather@nasiko.com:global          # GARR DB lookup → RAP fetch → verify
inventory@globex.com:dnssrv        # DNS SRV lookup
billing@acme.demo:nandaindex.org   # NANDA public index
```

## Environment Variables

### GARR backend

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `SIGNING_PRIVATE_KEY` | Yes | — | Ed25519 private key PEM (quoted multiline in .env) |
| `SIGNING_KEY_ID` | No | `garr-dev-unspecified` | Key identifier |
| `PORT` | No | `3001` | HTTP port |
| `GARR_DEMO_MODE` | No | `false` | `true` skips DMARC + RAP checks (dev only) |

Generate a signing key:
```bash
openssl genpkey -algorithm Ed25519 -out signing.pem && cat signing.pem
```

### RAP server

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SIGNING_PRIVATE_KEY` | Yes | Ed25519 private key — must match public key registered in GARR |
| `SIGNING_KEY_ID` | Yes | Key identifier (e.g. `myorg-key-2026`) |
| `RAP_DOMAIN` | Yes | Your domain (e.g. `nasiko.com`) |
| `ADMIN_API_KEY` | Yes | Protects write operations — `openssl rand -hex 32` |

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start with auto-reload (tsx watch) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled production build |
| `npm run migrate` | Apply SQL migrations under `db/migrations/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |

## Stack

TypeScript · Node 20 · Fastify 5 · postgres.js · PostgreSQL 16 · ed25519
