# Cross-Registry Demo — Step-by-Step Plan

**Branch:** `feat/cross-registry-demo` (forked off `fix/register-signature`)
**Goal:** end-to-end demo of Google Registry ↔ Walmart Registry resolution + A2A handshake, plus DMARC bugfix. Showable to manager — not production.

---

## Bugs found during investigation

### DMARC Bug #1 — no organizational-domain fallback (REAL BUG)
`verifyDmarcTxt(domain)` in [src/lib/dnsVerification.ts](src/lib/dnsVerification.ts) only queries `_dmarc.<domain>`. RFC 7489 §6.6.3 says: if the subdomain has no DMARC record, fall back to the organizational (parent) domain.

**Verified:**
- `_dmarc.anthropic.com` → returns valid record ✓
- `_dmarc.mail.google.com` → ENOTFOUND ✗ (but `_dmarc.google.com` exists)
- `_dmarc.www.anthropic.com` → ENOTFOUND ✗ (but `_dmarc.anthropic.com` exists)

Any registrant using a subdomain (e.g. `agents.example.com`) is rejected today even when the parent domain has a perfectly valid DMARC. **This is the DMARC fix.**

### DMARC Bug #2 — strict `startsWith` match (minor)
`startsWith('v=DMARC1')` rejects RFC-legal variants with leading whitespace or `v = DMARC1`. Low priority — almost no real records use this. Optional polish.

### DMARC Bug #3 — multi-record handling (minor)
RFC says if two `v=DMARC1` records exist at the same host, the lookup MUST fail. We silently pick the first. Optional polish.

### Unrelated note (not blocking DMARC, but you should know)
The `register.test.ts` test `signNonce()` at line 41 still signs `Buffer.from(nonce, 'utf8')` while production was changed in commit `dc5b432` to sign decoded raw bytes (`Buffer.from(nonce, 'hex')`). The "returns 201 on valid signature" test will fail until that line is updated. Out of scope for this demo branch — flag it for whoever owns `fix/register-signature`.

---

## What's already on this branch when you start

- Inherited from `fix/register-signature`: uncommitted `.gitignore` change + two untracked bench files (`bench.mjs`, `bench2.mjs`). Leave them alone unless they interfere.
- Working dir: `e:\GARR`. Frontend is at `e:\garr-web` (separate repo, branch later).
- Postgres: started via `docker compose up -d --wait` (host port 5433). Docker Desktop must be running on the dev machine.
- `.env` already has `DATABASE_URL` and `SIGNING_PRIVATE_KEY`.

---

## Architecture in one diagram

```
┌─ garr-web (Next.js) ─ /demo/resolve page ───────────────────────┐
│  user types locator → calls GARR /api/v1/resolve                │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌─ GARR Fastify server ────────▼──────────────────────────────────┐
│  /api/v1/resolve  ──→ nandaIndexClient ──→ /mock/nanda/lookup   │
│                                              │                  │
│                                              ▼                  │
│                                    returns IndexRecord with     │
│                                    card_url pointing to:        │
│                                              │                  │
│                                              ▼                  │
│                          /mock/registries/{google|walmart}/     │
│                                       cards/{agent}             │
│                                              │                  │
│                                              ▼                  │
│                                    AgentCard JSON               │
│                                              │                  │
│                                              ▼                  │
│             /mock/agents/{slug}/invoke  ← A2A handshake stub    │
└─────────────────────────────────────────────────────────────────┘
```

Everything stays inside this one server. No real DNS, no real NANDA, no real internet.

---

## How to use this plan in a fresh Claude session

Each STEP block below is a self-contained prompt. Paste **one step at a time** into a new Claude session. Wait for it to finish + verify before moving on. Each step ends with explicit "done when" criteria so Claude knows when to stop.

At the top of each new session, also paste this preamble:

> Working dir: `e:\GARR`. Branch: `feat/cross-registry-demo`. This is the GARR backend — read `AGENTS.md` and `DEMO_PLAN.md` first for context. Do NOT touch `e:\garr-web` unless the step explicitly says so. After completing the step, run `npm run typecheck` and report the result. Commit with a clear message at the end of each step.

---

# STEP 1 — Fix DMARC organizational-domain fallback

**Context:** `verifyDmarcTxt` in `src/lib/dnsVerification.ts` queries `_dmarc.<domain>` and fails if no record exists. RFC 7489 §6.6.3 requires falling back to the organizational (parent) domain when the subdomain has no record. Real-world impact: anyone registering `agents.example.com` is rejected even when `example.com` has a valid DMARC.

**Task:**
1. Modify `verifyDmarcTxt(domain)` to:
   - First query `_dmarc.<domain>`.
   - If that returns ENOTFOUND / NODATA, derive the organizational domain by taking the **last two labels** (e.g. `agents.foo.example.com` → `example.com`). Don't use a public-suffix-list library — keep it simple for the demo, two labels is fine. Add a comment noting this is a simplification.
   - Retry the lookup against `_dmarc.<orgDomain>`.
   - If still not found, throw the same `No DMARC TXT record found` error but mention both hostnames in the message.
   - If found at the parent, return the record (the policy text).
2. Skip fallback when the domain is already at or below two labels (e.g. `example.com` → don't recurse).
3. Add unit tests in a new file `tests/unit/dnsVerification.test.ts`. Mock `node:dns`'s `resolveTxt` using `vi.mock`. Cases:
   - direct domain has record → returns it
   - direct domain ENOTFOUND, parent has record → returns parent's
   - both ENOTFOUND → throws with message mentioning both hosts
   - direct returns non-DMARC1 records, parent has DMARC1 → returns parent's
   - two-label domain ENOTFOUND → throws without recursing
4. Do NOT touch the integration tests — they mock the whole `dnsVerification` module already.

**Done when:**
- `npm run typecheck` passes
- `npm test tests/unit/dnsVerification.test.ts` passes (all 5 cases)
- One commit: `fix(dmarc): fall back to organizational domain per RFC 7489 §6.6.3`

---

# STEP 2 — Add mock-verification env flag

**Context:** For the demo we need to register fake registries like `google-demo` / `walmart-demo` whose domains don't have real RAP endpoints or matching DMARC. We need a clearly-labeled escape hatch.

**Task:**
1. Extend `Config` in `src/config/index.ts`:
   - Add `mockVerification: boolean` field.
   - Read from env `GARR_MOCK_VERIFICATION` (default `false`). Treat `"true"` / `"1"` as true.
   - When `nodeEnv === 'production'` and `mockVerification === true`, log a loud warning at startup but allow it (we want to keep prod safe by convention, not by hard block — flexible for demos).
2. In `src/services/registration.ts → initiateRegistration`:
   - At the top, if `config.mockVerification` is true, skip both `verifyDmarcTxt` and `headRap` calls. Use a placeholder `dmarc_policy = 'v=DMARC1; p=none; (mock-verification)'`.
   - Leave all other logic untouched (still issues challenge, still requires signature on verify).
3. Update `.env.example` (add the new var with a comment).
4. Add ONE unit test in `tests/unit/config.test.ts` checking the flag parses correctly.

**Done when:**
- `npm run typecheck` passes
- `npm test` — full suite still green
- One commit: `feat(config): GARR_MOCK_VERIFICATION flag bypasses DMARC + RAP for demos`

---

# STEP 3 — Mock NANDA Index + Registry Gateway + A2A endpoints

**Context:** We need three new HTTP surfaces inside GARR itself to simulate the rest of the world:

| Path | What it does |
|---|---|
| `GET /mock/nanda/lookup?agent=<agent_id>` | Returns an IndexRecord for the seeded agents. |
| `GET /mock/registries/:slug/cards/:agent_id` | Returns an AgentCard JSON. |
| `POST /mock/agents/:slug/invoke` | A2A handshake stub: accepts caller's card, returns callee's card + `handshake_ok: true`. |

Data is read from JSON seed files (Step 4 creates them). Until Step 4 lands, return 404.

**Task:**
1. Create `src/mock/seedStore.ts` — loads `db/seed/google.json` and `db/seed/walmart.json` from disk at module load. If files are missing, log a warning and use empty maps (so the server still boots). Re-reads on each request in dev for ergonomics (small files, no perf concern). Exposes:
   - `lookupAgent(agentId)` → IndexRecord | null
   - `getCard(slug, agentId)` → AgentCard | null
   - `getAgentBySlug(slug, agentId)` → AgentCard | null (for invoke)
2. Create `src/routes/mock.ts` registering all three endpoints under a single `registerMockRoutes(fastify)

`. Each one validates input schemas (reuse `indexRecordSchema` and `agentCardSchema` from `src/types/api/resolve.ts` for response shapes). Return 404 with the standard `ApiError` shape when not found.
3. Wire `registerMockRoutes` into `src/server.ts` after `registerResolveRoute`. Gate it behind `if (config.nodeEnv !== 'production' || config.mockVerification)` so prod doesn't accidentally expose mocks unless explicitly enabled.
4. Modify `src/lib/nandaIndexClient.ts` `lookupNandaIndex`:
   - Accept an optional override base URL via new env var `NANDA_INDEX_BASE_URL` (read once into config, NOT re-read per-call). When set, build URL as `${baseUrl}/lookup?agent=...` instead of `https://${indexHost}/lookup?...`.
   - This lets the resolver hit `http://localhost:3000/mock/nanda` in dev.

**Done when:**
- Server boots with `npm run dev`
- `curl http://localhost:3000/mock/nanda/lookup?agent=ghost@nowhere` returns 404 with `ApiError`
- `npm run typecheck` passes
- One commit: `feat(mock): NANDA Index + registry gateway + A2A invoke stubs`

---

# STEP 4 — Seed Google + Walmart with 5 agents each

**Context:** Generate ed25519 keypairs per registry, sign each agent card, write seed JSON files, register both EntityOwners via the live API (using mock-verification mode).

**Task:**
1. Create `scripts/seed-demo.mjs`. Top of file: clear `console.log` banner saying "DEMO SEED — requires GARR_MOCK_VERIFICATION=true and dev server running on :3000".
2. For each of `google-demo` and `walmart-demo`:
   - `generateKeyPairSync('ed25519')` → save PEMs into `db/seed/keys/{slug}-private.pem` and `{slug}-public.pem` (gitignored).
   - Build EntityOwner payload — domain `google-demo.local` and `walmart-demo.local`, contact `admin@<domain>`, `rap_url: 'https://<domain>/agents.json'`. Use the public PEM.
   - POST `/api/v1/register`, then POST `/verify` with signed nonce (use the e2e-register.mjs pattern — sign the decoded bytes).
3. Define 5 agents per registry (10 total) with realistic-ish names:
   - **Google:** `search-bot`, `gmail-summarizer`, `calendar-scheduler`, `translate`, `maps-router`
   - **Walmart:** `inventory-lookup`, `order-status`, `price-checker`, `delivery-tracker`, `returns-bot`
4. For each agent build:
   - `agent_id = '<name>@<domain>'`
   - AgentCard with realistic `display_name`, `description`, `capabilities` (2-3 strings each), `invocation_url: http://localhost:3000/mock/agents/<slug>/invoke`, `protocol: 'a2a'`, `visibility: 'public'`, and a `signature` computed by signing canonical JSON (use `signCanonical` from `src/services/signing.ts`) with the registry's private key.
   - IndexRecord with `card_url: http://localhost:3000/mock/registries/<slug>/cards/<agent_id>`, `ttl: 3600`, and a `signature` over the canonical IndexRecord (minus `signature`).
5. Write seed JSONs to `db/seed/google.json` and `db/seed/walmart.json`. Shape:
   ```json
   {
     "slug": "google-demo",
     "owner_id": "google-demo",
     "agents": [
       { "agent_id": "search-bot@google-demo.local",
         "index_record": { ... },
         "agent_card": { ... } }
     ]
   }
   ```
6. Add `db/seed/keys/` and `.env.demo` to `.gitignore` if not already there.
7. Write `db/seed/README.md` explaining how to re-run the seed.

**Done when:**
- Run: `GARR_MOCK_VERIFICATION=true npm run dev` (one terminal), then `node scripts/seed-demo.mjs` (other terminal). Both registries register successfully (201).
- `db/seed/google.json` and `db/seed/walmart.json` exist with 5 agents each.
- `curl http://localhost:3000/api/v1/owners/google-demo` returns 200
- `curl 'http://localhost:3000/mock/nanda/lookup?agent=search-bot@google-demo.local'` returns the IndexRecord
- `curl http://localhost:3000/mock/registries/google-demo/cards/search-bot@google-demo.local` returns the AgentCard
- One commit: `feat(seed): google + walmart demo registries with 5 agents each`

---

# STEP 5 — Wire resolver to mock NANDA + add A2A invoke handler

**Context:** Step 3 added the env var hook; this step makes it actually work end-to-end and implements the A2A handshake stub properly.

**Task:**
1. In `.env` (NOT `.env.example`), confirm `NANDA_INDEX_BASE_URL=http://localhost:3000/mock/nanda` is set for local dev. Update `.env.example` with a commented-out version showing the option.
2. Implement `POST /mock/agents/:slug/invoke` properly:
   - Body shape: `{ caller_card: AgentCard, callee_agent_id: string }`
   - Validate against `agentCardSchema` for `caller_card`.
   - Look up callee via `getAgentBySlug` — 404 if not found.
   - Return `{ handshake_ok: true, callee_card: <full agent card>, echoed_caller_id: caller_card.id, at: <iso ts> }`.
3. Add integration test `tests/integration/demo-flow.test.ts` that:
   - Loads seed JSONs (skip the test with `describe.skip` if seeds aren't present — so CI without seed doesn't break).
   - Calls `GET /api/v1/resolve?locator=order-status@walmart-demo.local:global` and asserts 200 with the expected IndexRecord + AgentCard.
   - Calls `POST /mock/agents/walmart-demo/invoke` with Google's `search-bot` card as caller and asserts `handshake_ok: true`.

**Done when:**
- Server running, end-to-end resolve works:
  ```
  curl 'http://localhost:3000/api/v1/resolve?locator=order-status@walmart-demo.local:global'
  ```
  returns 200 with both `index_record` and `agent_card`.
- `npm test tests/integration/demo-flow.test.ts` passes (when seeds present).
- `npm run typecheck` passes
- One commit: `feat(resolve): wire mock NANDA + implement A2A invoke handler`

---

# STEP 6 — Frontend demo page (switches to garr-web repo)

**Context:** Manager wants to *see* the flow. One page is enough. Switching repos.

**Pre-step:** `cd e:\garr-web; git checkout main; git pull; git checkout -b demo/resolution-flow-page`. Confirm clean tree.

**Task:**
1. Add a new Next.js page at `app/demo/resolve/page.tsx` (or whatever this Next setup uses — check `AGENTS.md` in garr-web first; it warned the Next.js conventions are non-standard).
2. UI: single input for locator (pre-fill `order-status@walmart-demo.local:global`), two prefilled-example buttons ("Walmart order-status", "Google search-bot"), "Resolve" button.
3. On click, call backend `/api/v1/resolve?locator=...`. Render the response as **four visual steps**:
   - **Step 1 — Parse locator:** show `identifier / namespace / mode` extracted client-side.
   - **Step 2 — NANDA Index lookup:** show `resolved_via` + the `index_record` JSON.
   - **Step 3 — Fetch AgentCard:** show the `agent_card` JSON.
   - **Step 4 — A2A handshake:** button "Run handshake" → POST to `/mock/agents/<callee-slug>/invoke` with a hardcoded "caller card" (use Google's `search-bot` card from a static import or fetch). Show the response.
4. Each step is a card with a status badge (pending / ok / error). Use whatever UI primitives already exist in garr-web — don't add new dependencies.
5. Link from the home page / nav to `/demo/resolve`.

**Done when:**
- `npm run dev` in `e:\garr-web` boots; visit `http://localhost:3001/demo/resolve` (or whatever port).
- Resolve flow renders all 4 steps successfully for the prefilled locator.
- Visually walkable end-to-end.
- One commit on `demo/resolution-flow-page` branch in garr-web: `feat: cross-registry resolution flow demo page`

---

# STEP 7 — README + screenshot

**Context:** Final polish so the manager has something to read alongside the demo.

**Task:**
1. In `e:\GARR`, create `DEMO.md` at repo root:
   - 1-paragraph "what this demonstrates"
   - "How to run" (3 commands: docker up, npm run dev with env, seed script, open frontend)
   - "What to look at" — link to the `/demo/resolve` page
   - "Known shortcuts" — be explicit: mock verification, no real DNS, no real A2A protocol, signatures verified at registration but card signatures not chain-verified yet.
2. Take a screenshot of the demo page after running the Walmart order-status locator → save under `docs/demo-screenshot.png` (or skip if no screenshot tool).
3. Final commit: `docs: demo run instructions + scope honesty`

---

## Final checklist before showing manager

- [ ] STEP 1 merged or visible on branch — DMARC fallback bug fixed
- [ ] STEP 2-5 working — `/api/v1/resolve?locator=...@walmart-demo.local:global` returns full chain
- [ ] STEP 6 — frontend page renders
- [ ] STEP 7 — DEMO.md exists
- [ ] One commit per step, all on `feat/cross-registry-demo` (GARR) and `demo/resolution-flow-page` (garr-web)
- [ ] You can run the demo from a cold start in under 2 minutes

## What this demo does NOT prove

Be ready to say this if asked:
- We're not talking to the real NANDA Index — we mocked it locally.
- DMARC/RAP checks are bypassed for the two demo registries via a config flag.
- The "A2A handshake" is a stub that echoes data back — not a real agent-to-agent protocol implementation.
- AgentCard signatures are computed correctly but not chain-verified back to the GARR root key on resolve. That's a separate piece of work.

These are honest, fixable scope cuts — not bugs.
