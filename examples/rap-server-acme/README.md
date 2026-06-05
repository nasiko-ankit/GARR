# GARR — RAP Server Example

A production-ready reference implementation of a **Registry Access Point (RAP)** server.

A RAP is the HTTPS server your organisation hosts to serve signed AgentCards. GARR stores a pointer to your RAP URL. When a resolver queries `agent@yourdomain.com:global`, GARR fetches the AgentCard from your RAP and verifies its signature.

## Stack

- **Runtime** — Node.js 20
- **Framework** — Fastify 5
- **Database** — PostgreSQL 14+ (persistent agent storage)
- **Auth** — Ed25519 key pair (same key used to register with GARR)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env — fill in DATABASE_URL, SIGNING_PRIVATE_KEY, ADMIN_API_KEY, RAP_DOMAIN

# 3. Start Postgres (local dev)
docker run -d --name rap-postgres \
  -e POSTGRES_USER=rap -e POSTGRES_PASSWORD=rap -e POSTGRES_DB=rap \
  -p 5432:5432 postgres:16-alpine

# 4. Start the server (migrations run automatically on startup)
npm run dev
```

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Liveness + DB check |
| `HEAD` | `/agents.json` | None | GARR reachability probe |
| `GET` | `/agents.json` | None (public) / Bearer (all) | Full agent catalog |
| `GET` | `/agents/:slug` | None (public) / Bearer (private) | Single AgentCard |
| `POST` | `/agents` | Bearer (admin) | Register a new agent |
| `PUT` | `/agents/:slug` | Bearer (admin) | Update an agent |
| `DELETE` | `/agents/:slug` | Bearer (admin) | Remove an agent |

## Registering an Agent

```bash
curl -X POST http://localhost:3001/agents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY" \
  -d '{
    "name":           "my-agent",
    "display_name":   "My AI Agent",
    "description":    "Does something useful",
    "capabilities":   ["search.web.query"],
    "invocation_url": "https://mycompany.com/invoke/my-agent",
    "protocol":       "a2a",
    "visibility":     "public"
  }'
```

The server automatically signs the AgentCard with `SIGNING_PRIVATE_KEY` before persisting it to PostgreSQL.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SIGNING_PRIVATE_KEY` | Yes | Ed25519 private key PEM — must match the public key registered in GARR |
| `SIGNING_KEY_ID` | Yes | Key identifier (e.g. `mycompany-key-2026`) |
| `RAP_DOMAIN` | Yes | Your domain (e.g. `mycompany.com`) |
| `ADMIN_API_KEY` | Yes | Secret key for write operations (min 32 chars) |
| `PORT` | Optional | Default `3001` |
| `CORS_ORIGINS` | Optional | Comma-separated allowed origins. Default `*` |
| `RATE_LIMIT_MAX` | Optional | Requests per minute per IP. Default `120` |

## Registering with GARR

Once the RAP is running and reachable over HTTPS:

```bash
curl -X POST https://garr.example.com/api/v1/register \
  -H "Content-Type: application/json" \
  -d '{
    "owner_id":      "mycompany",
    "display_name":  "My Company",
    "domain":        "mycompany.com",
    "contact_email": "ai@mycompany.com",
    "rap_url":       "https://agents.mycompany.com",
    "algorithm":     "ed25519",
    "public_key":    "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
    "key_id":        "mycompany-key-2026",
    "ttl_seconds":   86400
  }'
```

See the [GARR production guide](../../RAP_Production_Guide.html) for the full registration flow.
