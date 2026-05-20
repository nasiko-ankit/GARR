# Demo seed

This directory holds the cross-registry demo data:

| Path | What it is | Committed? |
|---|---|---|
| `google.json` | Signed AgentCards + IndexRecords for the Google demo registry | ❌ (gitignored) |
| `walmart.json` | Signed AgentCards + IndexRecords for the Walmart demo registry | ❌ (gitignored) |
| `keys/<slug>-private.pem` | ed25519 private key used to sign the cards above | ❌ (gitignored) |
| `keys/<slug>-public.pem` | matching public key, also registered in `entity_owners` | ❌ (gitignored) |

Nothing in this directory is committed — the JSON files bake in your local
server URL (`http://localhost:3000`) and your dev DB's keys, so they're
per-environment. Run the seed once after starting the server.

## How to regenerate

```powershell
# Terminal 1 — start GARR with mock verification enabled
$env:GARR_MOCK_VERIFICATION = "true"
npm run dev
```

```powershell
# Terminal 2 — run the seed
node scripts/seed-demo.mjs
```

The script is idempotent on re-run:

- If `keys/<slug>-private.pem` already exists, it is reused (so the signatures
  in `*.json` keep matching the public key already stored in `entity_owners`).
- If `POST /api/v1/register` returns 409 (registry already exists), that is
  treated as success — only the `*.json` is regenerated.

If you want a clean re-seed (new keys, new EntityOwner row), do this first:

```sql
DELETE FROM audit_log            WHERE owner_id IN ('google-demo', 'walmart-demo');
DELETE FROM entity_owners        WHERE owner_id IN ('google-demo', 'walmart-demo');
DELETE FROM pending_registrations WHERE owner_id IN ('google-demo', 'walmart-demo');
```

…then remove `db/seed/keys/` and run the seed script again.

## Verify

```bash
curl http://localhost:3000/api/v1/owners/google-demo
curl 'http://localhost:3000/mock/nanda/lookup?agent=search-bot@google-demo.local'
curl 'http://localhost:3000/mock/registries/google-demo/cards/search-bot@google-demo.local'
```

## Honest scope

- The mock NANDA and registry-gateway endpoints serve whatever is in these
  JSON files. They do **not** verify the signatures. Signatures are computed
  correctly (canonical-JSON + ed25519) so a future verifying client would
  succeed, but the demo path itself is "fetch and display".
- These domains (`google-demo.local`, `walmart-demo.local`) do not resolve in
  real DNS. The mock-verification flag is what lets them pass registration.