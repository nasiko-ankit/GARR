# Nanda Index — Live Demo Setup

A self-contained demo of the **Nanda Index** (a "DNS for AI agent registries") running entirely on your local machine. It covers three actions in sequence:

1. **Register a Registry** into the Nanda Index
2. **Register an Agent** into that registry
3. **A2A Card Exchange** between two agents in different registries

The reference scenario from product is `search-agent@google.demo` ↔ `products-agent@meta.demo` — two agents in two different organisations exchange their signed AgentCards via the Nanda Index.

---
 

## 4 · Configure environment files

### 4a. Backend (`GARR/.env`)

The repo ships an `.env.example`. Copy it:

```powershell
cd nanda-demo\GARR
copy .env.example .env
```

Open `.env` and confirm these values (defaults should work as-is):

```
NODE_ENV=development
PORT=3000

# Postgres — matches docker-compose.yml
DATABASE_URL=postgres://garr:garr@localhost:5433/garr

# Demo signing — generate once via: openssl genpkey -algorithm Ed25519 -out dev-signing.pem
GARR_ROOT_PRIVATE_KEY_PEM_PATH=./dev-signing.pem
GARR_ROOT_KEY_ID=garr-dev-2026

# Resolver / index behaviour
GARR_DEMO_MODE=true
```

If `dev-signing.pem` does not exist in the repo root, generate it once:

```powershell
openssl genpkey -algorithm Ed25519 -out dev-signing.pem
openssl pkey -in dev-signing.pem -pubout -out dev-signing.pub.pem
```

If `openssl` isn't on your PATH, Git for Windows ships it under `C:\Program Files\Git\usr\bin\openssl.exe`.

### 4b. Frontend (`garr-web/.env.local`)

```powershell
cd nanda-demo\garr-web
copy .env.example .env.local  # if present, otherwise create new
```

The file should contain exactly:

```
NEXT_PUBLIC_GARR_API_BASE_URL=http://localhost:3000
```

---

## 5 · Start Postgres + apply migrations

From `nanda-demo\GARR`:

```powershell
docker compose up -d
# wait ~5 seconds for the container to be ready
docker ps   # should show "garr-postgres" healthy on 0.0.0.0:5433->5432

npm run migrate
# should print:
#   applied 001_init.sql
#   applied 002_pending_registrations.sql
#   migrations done
```

> **If the database already existed from a prior run and migrations look out of date**, nuke the volume:
> ```powershell
> docker compose down -v
> docker compose up -d
> npm run migrate
> ```

---

## 6 · Run the three demo processes

You need **three long-running terminals plus one one-shot terminal**. Open them in this order:

### Terminal 1 — Backend (Nanda Index server)

```powershell
cd nanda-demo\GARR
$env:GARR_DEMO_MODE = "true"
npm run dev
```

Wait until you see:
```
Server listening at http://127.0.0.1:3000
DEMO MODE ACTIVE — verification disabled
```
Leave this terminal open.

### Terminal 2 — Seed the demo (one-shot)

```powershell
cd nanda-demo\GARR
$env:GARR_DEMO_MODE = "true"
npx tsx --env-file=.env scripts/seed-demo.ts
```

> If `npm run demo:seed` complains about `'GARR_DEMO_MODE' is not recognized` on Windows, the `npx tsx ...` command above is the equivalent. (`cross-env` was added to `package.json` for a permanent fix — run `npm install` after pulling if you see this.)

Expected output:
```
GARR Demo Seed
Target: http://localhost:3000
  generated key pair for google
  generated key pair for meta
✓ Keys written to .keys.demo.json
→ Registering google (google.demo)…
✓ google registered successfully
→ Registering meta (meta.demo)…
✓ meta registered successfully
✓ All demo orgs registered.
```

This terminal can now be closed or reused.

### Terminal 3 — Mock Registry Access Points (RAPs)

```powershell
cd nanda-demo\GARR
npm run demo:rap
```

Expected:
```
Mock RAP servers starting…
  [google] RAP running on http://localhost:4001 (1 agents: search-agent)
  [meta]   RAP running on http://localhost:4002 (1 agents: products-agent)

All mock RAPs running. Press Ctrl+C to stop.
```
Leave this terminal open.

### Terminal 4 — Frontend

```powershell
cd nanda-demo\garr-web
$env:PORT = "3001"
npm run dev
```

Wait until:
```
- Local:        http://localhost:3001
- Ready in 2.2s
```

> The `$env:PORT = "3001"` is important — the **backend owns port 3000**. If you forget it, Next.js will take 3000 and the frontend will silently call itself for API requests, producing 404s for every page.

Leave this terminal open.

---

## 7 · Run the demo in the browser

Open **http://localhost:3001/demo**.

You should see:
- A yellow **"DEMO MODE ACTIVE"** banner at the top
- A green **"Pre-flight OK · Backend is seeded and reachable"** badge
- Three step cards: **Register a Registry**, **Register an Agent**, **A2A Card Exchange**

### Step A — A2A Card Exchange (the headline narrative)

1. Click **"Open A2A Card Exchange"**.
2. Inputs are pre-filled: `search-agent@google.demo:global` ↔ `products-agent@meta.demo:global`.
3. Click **"Run A2A exchange"**.

Expected result:
- Both columns turn green.
- Each shows six narration lines, all ticked (Querying Nanda → RAP URL → Fetching AgentCard → AgentCard received → Verifying signature → Signature valid, verified by `google-agent-root-demo` / `meta-agent-root-demo`).
- Each column renders the **IndexRecord** JSON (what the Nanda Index returned) and the **AgentCard** JSON (what the registry signed).
- At the bottom: a big green **"Exchange complete · search-agent@google.demo ⇄ products-agent@meta.demo"** card. Both `invocation_url` values are shown.

### Step B — Register an Agent

1. Click **"Open Register Agent"** (or go through the dashboard).
2. The registry dropdown should list **`Google — google.demo (http://localhost:4001)`** and **`Meta — meta.demo (http://localhost:4002)`**.
3. Pick **Google** and fill in:
   - Agent name: `analytics-agent`
   - Display name: `Analytics Agent`
   - Description: `Aggregates product usage analytics.`
   - Protocol: `a2a`
   - Capabilities: `analytics.query, analytics.report`
   - (leave Invocation URL blank — it defaults)
4. Click **"Register agent (RAP will sign)"**.

Expected:
- A green panel: **"Agent registered and signed"** with `agent_id: google/analytics-agent` and `signed_by: google-agent-root-demo`.
- Below it, the full signed AgentCard JSON.
- A deep-link: **"Try it on A2A Card Exchange"** — click it.
- The A2A Card Exchange page opens with Agent A pre-filled to your new locator (`analytics-agent@google.demo:global`) and auto-resolves successfully.

### Step C — Register a Registry

1. Click **"Open Register Registry"**.
2. Fill in any new org. Example:
   - Owner ID: `acme`
   - Display Name: `Acme Corp`
   - Domain: `acme.demo`
   - Contact Email: `registrar@acme.demo`
   - RAP URL: `http://localhost:4003` (no RAP needs to be running there — demo mode skips reachability)
   - Key ID: `acme-root`
   - TTL: `86400`
3. Click **"Generate keypair"** — the public key fills in automatically.
4. Click **"Submit registration"**. The page moves to step 2 of 2 (the challenge nonce).
5. Click **"Sign automatically"**. The signature appears.
6. Click **"Verify & complete"**.

Expected:
- Green **"Registration complete"** panel with the signed serial number and expiry.

You can confirm via curl in any terminal:
```powershell
curl http://localhost:3000/api/v1/owners/acme
```

---

## 8 · Quick health probes

Useful for confirming the system is wired correctly:

```powershell
curl http://localhost:3000/health                         # {"status":"ok","db":"ok"}
curl http://localhost:3000/api/v1/owners/google           # google EntityOwner JSON
curl http://localhost:3000/api/v1/owners/meta             # meta EntityOwner JSON
curl http://localhost:3000/global_agent_root.json         # signed manifest with both
curl http://localhost:4001/agents.json                    # google catalog
curl http://localhost:4002/agents.json                    # meta catalog
curl "http://localhost:3000/api/v1/resolve?locator=search-agent@google.demo:global"
```

---
 