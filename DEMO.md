# Demo

A self-contained walkthrough of the full NANDA Layer 1 → Layer 2 → Layer 3
resolution chain using 3 fictional organizations and 6 mock agents.

## Prerequisites

- GARR Postgres running (`docker compose up -d --wait`)
- Migrations applied (`npm run migrate`)
- `.env` present with `DATABASE_URL` and `SIGNING_PRIVATE_KEY`

## Steps

### Terminal 1 — start GARR in demo mode

```
GARR_DEMO_MODE=true npm run dev
```

> The server logs `DEMO MODE ACTIVE — verification disabled` on startup.
> DMARC and RAP reachability checks are skipped for all registrations.

### Terminal 2 — start mock RAP servers

```
npm run demo:rap
```

Starts 3 HTTP servers:

| Port | Org     | Agents                              |
|------|---------|-------------------------------------|
| 4001 | acme    | billing-agent (a2a), support-agent (rest)       |
| 4002 | globex  | inventory-agent (a2a), pricing-agent (mcp)      |
| 4003 | initech | hr-agent (a2a), it-helpdesk-agent (rest)        |

Each server signs all AgentCards with the org's ed25519 private key.

### Terminal 3 — seed registries, then run the demo

```
npm run demo:seed
npm run demo:run
```

`demo:seed` registers all 3 orgs via the GARR API with real ed25519 key pairs.
Private keys are written to `.keys.demo.json` (gitignored).

`demo:run` resolves 3 agent locators and prints each step of the chain.

## What the demo shows

```
Locator: billing-agent@acme.demo:global
────────────────────────────────────────────────────────────
→ Querying NANDA for acme.demo…
✓ RAP URL: http://localhost:4001
→ Fetching AgentCard billing-agent from RAP…
✓ AgentCard received
→ Verifying signature…
✓ Signature valid. Verified by: acme-agent-root-demo
→ A2A invocation_url: http://localhost:4001/invoke/billing-agent
→ Simulating A2A call…
✓ Done.
```

Full Layer 1 → Layer 2 → Layer 3 flow:

- **Layer 1** — 3 organizations registered in the GARR registry (acting as the NANDA Index)
- **Layer 2** — 6 agents served across 3 mock RAP endpoints; each AgentCard signed by the org private key
- **Layer 3** — each agent resolved via the `:global` locator; AgentCard signature verified against the registered org public key; A2A `invocation_url` returned

## Scripts

| Script | Command |
|--------|---------|
| Start GARR (demo mode) | `GARR_DEMO_MODE=true npm run dev` |
| Start mock RAPs | `npm run demo:rap` |
| Seed demo orgs | `npm run demo:seed` |
| Run resolution flow | `npm run demo:run` |

## Re-running the demo

If you want to re-seed (e.g., after resetting the database):

1. Stop the GARR server and restart it (to pick up a fresh DB state)
2. Run `npm run demo:seed` again — new key pairs are generated and written to `.keys.demo.json`
3. Restart `npm run demo:rap` so the mock servers pick up the new keys
4. Run `npm run demo:run`
