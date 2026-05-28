

**Agent Registration**

A Registry's Agent Catalog

Architecture & Engineering Specification

| Version | 1.0 — Draft |
| :---- | :---- |
| **Date** | May 2026 |
| **Authors** | Nanda Initiative Working Group |
| **Governance** | Foundation for Agentic Networks, 501(c)(3) |
| **Contact** | registrar@nanda.org |
| **Classification** | Engineering Internal |

# **1. Purpose and Scope**

This document is the definitive engineering specification for **Agent Registration**: how an organization that has joined GARR populates and maintains its own catalog of AI agents. It is the single source of truth for the registry service team. Every architectural decision, data contract, API endpoint, signing rule, and operational procedure for the per-registry write/read paths is defined here. Teams should build directly from this document.

GARR is the root of trust. Each registered organization — an EntityOwner in GARR terminology — is responsible for publishing its own list of agents under its own domain via its RAP (Registry Access Point). Agent Registration covers the full lifecycle of those per-registry agent records: schema, write API, signing under the EntityOwner key, the agents.json catalog served at the RAP, lifecycle operations (create / update / suspend / revoke), and the NANDA Index hand-off that makes the agent resolvable by external callers.

Agent Registration does **not** sign EntityOwners — that is the GARR root manifest's responsibility. Agent Registration does **not** resolve cross-registry locators — that is the Agent Resolution Flow.

# **2. System Overview**

## **2.1 The one-line description**

An agent catalog is each organization's authoritative list of its AI agents. It is the equivalent of a DNS authoritative name server returning the records under that zone.

## **2.2 What an agent catalog is and is not**

| An agent catalog IS | An agent catalog IS NOT |
| :---- | :---- |
| Per-registry catalog of AgentCards | The GARR root manifest |
| Hosted by the registry owner (on the owner's infra) | Hosted by GARR |
| Signed under the EntityOwner's key | Signed under the GARR root key |
| Where a new agent gets its IndexRecord | The NANDA Index itself (the resolver consumes those IndexRecords) |
| Where capability metadata lives | Where the agent's runtime lives (the agent runs on the owner's infra) |
| Mutable by the registry owner | Mutable by GARR root operators |

## **2.3 DNS analogy**

| DNS concept | Agent Registration equivalent |
| :---- | :---- |
| Authoritative name server for a zone | RAP for a registry |
| A / AAAA / TXT record | AgentCard |
| Glue record / NS pointer | IndexRecord (published to NANDA, points at card_url) |
| DNSSEC RRSIG | AgentCard.signature, signed by EntityOwner |
| Zone file refresh / serial bump | Per-agent serial monotonicity |
| Registrar adding an A record | POST /api/v1/registries/:slug/agents |

## **2.4 Trust chain context**

```
GARR root key (HSM)
   └── signs → EntityOwner record (in global_agent_root.json)
         └── EntityOwner key signs → IndexRecord (NANDA Index pointer)
         └── EntityOwner key signs → AgentCard (RAP catalog entry)
               └── consumed by → Resolver (Agent Resolution Flow)
```

Every byte a caller verifies traces back through this chain to the GARR root key. Agent Registration is where the second link in the chain — the EntityOwner-signed link — is forged. Compromise of the EntityOwner key allows an attacker to mint AgentCards under that registry but **not** to forge a different EntityOwner; that boundary is held by the GARR root manifest.

# **3. Core Terminology**

Glossary aligned with the GARR root specification; only terms specific to Agent Registration are repeated here.

| Term | Definition |
| :---- | :---- |
| AgentCard | Signed JSON record describing one AI agent — capabilities, invocation URL, protocol, visibility, signature. |
| IndexRecord | Signed pointer published to the NANDA Index. Contains agent_id, agent_name, card_url, ttl, signature. |
| RAP | Registry Access Point. The HTTPS endpoint the registry owner serves its agent catalog from. |
| Agent slug | Lowercase short name unique within one registry (e.g. `order-status`). Used as the local part of agent_id. |
| agent_id | Globally unique identifier — `slug@registry_domain` (e.g. `order-status@walmart.com`). |
| Capability | A string identifying one thing an agent can do (e.g. `orders.read`). Caller-side opaque. |
| Visibility | `public` — listed in agents.json and resolvable by anyone. `private` — requires bearer token. |
| Registry owner | Person or role who controls the EntityOwner private key and is authorized to write to the catalog. |
| Catalog | Either the `agents.json` document served by RAP, or the union of all agent records the registry owns. |
| Per-agent serial | Monotonic 10-digit YYYYMMDDNN per agent_id, bumped on every successful write. |

# **4. Detailed System Architecture**

Agent Registration has two completely separated data paths sharing only the storage layer, mirroring the GARR root's design.

## **4.1 Write pipeline — per-agent**

Sequential and synchronous. Each stage must pass before the next begins. No partial success state.

| Stage | Component | Responsibility | Failure response |
| :---- | :---- | :---- | :---- |
| 1 | Input validator | Schema check on AgentDraft (name pattern, lengths, capability bounds), duplicate-id check within this registry. | 400 / 409 |
| 2 | Owner authorization | Verify caller holds the EntityOwner's private key via HTTP Signature over the request (§10.1). | 401 |
| 3 | Capability normalizer | Lowercase, strip duplicates, sort. Optional lookup against the canonical capability registry (§6.4). | 422 |
| 4 | Card builder | Construct canonical AgentCard server-side with stable field order. The `id` field is derived (`slug@domain`); never accepted from input. | — |
| 5 | Per-agent signer | Sign canonical JSON of AgentCard (minus signature) using EntityOwner key. Build IndexRecord. Sign IndexRecord (minus signature). | 500 — retry safe via Idempotency-Key |
| 6 | Storage writer | Atomic upsert into `agents` table. Invalidate Redis catalog cache. Append `agent_audit_log` entry. | 500 — transactional rollback |
| 7 | Index publisher | Async POST of the IndexRecord to NANDA. Marked `index_pending` until acknowledged; never blocks the 201. | Background retry. Alert on persistent failure. |

## **4.2 Read pipeline — RAP serving**

Cache-first. Never re-signs; never recomputes the canonical JSON at read time.

| Stage | Component | Responsibility | On failure |
| :---- | :---- | :---- | :---- |
| 1 | Auth middleware | Bearer-token validation for private agents. Per-IP and per-API-key rate limiting. | 401 / 429 |
| 2 | Cache (Redis) | O(1) lookup by `agent_id` for a single card; full catalog key for `/agents.json`. | Miss → DB |
| 3 | Database | Indexed lookup on `(owner_id, agent_slug)`. | NOT_FOUND → 404 |
| 4 | Response builder | Returns AgentCard JSON. `agents.json` aggregates the visible (public) subset only. | 500 |

# **5. Scalable Design**

The traffic profile here is asymmetric in the opposite direction of the GARR root's: writes are rare (a registry typically holds dozens to thousands of agents, with very low update frequency), while reads are dominated by resolvers fetching cards on every uncached agent-to-agent call.

## **5.1 Scalability targets**

| Dimension | Target | Mechanism |
| :---- | :---- | :---- |
| Catalog reads | Bounded by external resolver TTL | CDN at the RAP edge (`stale-while-revalidate`) |
| Per-card reads | ~1 per uncached resolver session | Redis + CDN |
| Writes | < 100 / day / registry | Single writer per registry, idempotent upsert |
| Read latency | < 50 ms p99 at the RAP | Anycast CDN, in-region Redis |
| Write latency | < 2 s p99 | Ed25519 signing is sub-millisecond; storage is one row |
| Per-registry size | Up to 10,000 agents in v1; cap rises with pagination | Indexed lookup, no full scans |
| Data durability | 11 nines | Sync DB commit + PITR + object-store backup of agents.json |

# **6. Agent Registration Flow**

The primary trust boundary for the agent catalog. Domain ownership is implicit — the GARR root manifest already proved it when the registry was first registered. Per-agent ownership is verified at every write using key continuity from the EntityOwner.

## **6.1 Full backend pipeline — step by step**

| # | Actor | Step | Failure response |
| :---- | :---- | :---- | :---- |
| 1 | Registry owner | Authenticates session at the registry's admin UI (registry-owned login, out of scope here). Holds the EntityOwner private key. | — |
| 2 | Registry owner | Open `/agents/new` in the registry admin UI. Form loads empty. | — |
| 3 | Registry owner | Fill required fields (§6.2). Client renders a draft canonical-JSON preview of the AgentCard. | Inline per-field validation |
| 4 | Registry owner | Submit. The UI computes an HTTP Signature over the request (signed with the EntityOwner private key, §10.1) and POSTs to `/api/v1/registries/:slug/agents` with `Idempotency-Key` header. | Form locks, spinner shown. |
| 5 | Registry service | Schema validation: name pattern, lengths, capability bounds, no duplicate `agent_id` in this registry. | 400 / 409 |
| 6 | Registry service | HTTP Signature verification against the EntityOwner's current public key (fetched from GARR's `global_agent_root.json` and cached locally). Reject if the key is in the rotated-out grace window for signing. | 401 — invalid signature |
| 7 | Registry service | Normalize capabilities. Build the AgentCard server-side with a stable, canonical field order. | — |
| 8 | Registry service | Compute canonical JSON of the AgentCard (sorted keys, no whitespace, UTF-8, minus the `signature` field). Sign with the EntityOwner private key (ed25519). | 500 — retry safe via Idempotency-Key |
| 9 | Registry service | Build the IndexRecord (`agent_id`, `agent_name`, `card_url`, `ttl`, `signature`). Sign canonical JSON minus signature with the same key. | 500 |
| 10 | Registry service | Atomic INSERT into `agents` table. Invalidate Redis catalog keys. Append `agent_audit_log` entry with actor, IP, diff. | 500 — transactional rollback |
| 11 | Registry service | Async: POST the IndexRecord to NANDA Index. On failure, retry with exponential backoff. Until acknowledged, the agent row carries `index_status = 'pending'`. | Background — does not block the 201 |
| 12 | Registry owner | `201 Created` returned with `{ agent_id, index_record, agent_card }`. UI shows confirmation, the signed JSON, and a "test resolve" deep-link to the resolver UI. | — |

## **6.2 Required fields — AgentDraft**

The body shape submitted by the registry-owner UI to `POST /api/v1/registries/:slug/agents`.

| Field | Required | Validation rule | Source |
| :---- | :---- | :---- | :---- |
| name | Yes | Lowercase alphanumeric + hyphens. /^[a-z0-9-]+$/. 1–64 chars. Unique within this registry. | UI |
| display_name | Yes | Free text. 1–200 chars. UTF-8. | UI |
| description | Yes | Free text. 1–1000 chars. | UI |
| capabilities | Yes | Array of strings. 1–16 entries. Each 1–128 chars. Each must match the capability identifier rule (§6.4). | UI |
| invocation_url | Yes | HTTPS URL of the agent's runtime endpoint. Same TLS rules as RAP — no self-signed certs in production. | UI |
| protocol | Yes | One of `a2a`, `mcp`, `https`. Defaults to `a2a`. | UI |
| visibility | Yes | `public` or `private`. Defaults to `public`. | UI |
| ttl | Optional | Integer seconds. 60..86400 (1 minute to 24 hours). Default 3600 (1 hour). Per-IndexRecord. | UI |

**Server-injected — never accepted from input:**

| Field | Source |
| :---- | :---- |
| id | Derived as `<name>@<registry_domain>` |
| card_url | Derived as `<RAP base>/agents/<id>` |
| signature (AgentCard) | Computed by signer |
| signature (IndexRecord) | Computed by signer |
| serial | YYYYMMDDNN — server-assigned, strictly monotonic per agent_id |
| issued_at / expires_at | Server clock + ttl |
| signed_by_key_id | EntityOwner's current key_id |

## **6.3 Validation rules — exhaustive**

| Field | Rule | Rationale |
| :---- | :---- | :---- |
| name | unique within owner_id | Prevents agent_id collision |
| name | not in reserved list (`admin`, `root`, `index`, `manifest`, `_*`) | Avoids URL conflict with admin routes |
| display_name | no leading/trailing whitespace | Display correctness |
| description | UTF-8 normalized NFC | Stable canonicalization |
| capabilities | sorted, deduplicated by server before signing | Stable canonical bytes |
| invocation_url | must use HTTPS in production | TLS invariant |
| invocation_url | host must resolve via public DNS | Prevents internal-only invocation URLs in public agents |
| protocol | enum-checked | Future-proofing |
| visibility | enum-checked | Read-path branching |
| ttl | <= EntityOwner.ttl_seconds | Subordinate to owner's policy |

## **6.4 Capability identifier rules**

| Rule | Rationale |
| :---- | :---- |
| Lowercase, dots-and-hyphens — `/^[a-z0-9][a-z0-9.-]*$/` | Stable canonicalization |
| Namespaced verbs: `domain.verb` (e.g. `orders.read`, `calendar.write`) | Matches existing patterns; readable to LLM-side callers |
| Wildcards (`orders.*`) NOT honored — must be enumerated explicitly | Avoids ambiguity at discovery time |
| 1–16 capabilities per agent | Forces single-purpose agents; simpler reasoning at call sites |
| Optional: validate against a published capability registry | Required for high-assurance use cases — see §15 Open Decisions |

## **6.5 UI feedback states**

Every form path must surface one of these states. Never show a blank screen.

| State | When | What the UI shows |
| :---- | :---- | :---- |
| Loading | Between submit and response | Spinner, form locked, fields preserved |
| Validation error | 400 from server | Banner with the offending field highlighted, exact server detail string |
| Auth failure | 401 | Banner: "Signature did not verify. Check that you are signing with the current EntityOwner key." |
| Conflict | 409 | Inline on the `name` field: "An agent named X already exists in this registry." |
| Server error | 500 | Banner with retry button; Idempotency-Key preserved so retry is safe |
| Success | 201 | Confirmation card with the signed AgentCard + IndexRecord JSON, link to resolver |

# **7. Agent Catalog Read Flow (RAP)**

How an external caller (typically a resolver running the Agent Resolution Flow) fetches an agent's card from a registry.

## **7.1 The two read endpoints**

| Endpoint | Returns |
| :---- | :---- |
| GET /agents.json (canonical RAP path) | The full catalog — JSON array of every public AgentCard for this registry |
| GET /agents/:agent_id | A single AgentCard. Public agents — no auth. Private agents — bearer token required. |

## **7.2 Step-by-step (resolver perspective)**

| Step | Action | Failure |
| :---- | :---- | :---- |
| 1 | Resolver has received `card_url` from a NANDA IndexRecord. `card_url` points at `/agents/<id>` on the registry's RAP host. | — |
| 2 | HTTPS GET. TLS cert MUST match the EntityOwner's declared `domain`. Self-signed rejected. | RAP_UNREACHABLE 503 |
| 3 | Parse JSON. Validate against the AgentCard schema (§9.1). | CARD_MALFORMED 502 |
| 4 | Verify `card.signature` against `EntityOwner.public_key` using canonical JSON (minus `signature`). | SIGNATURE_INVALID 502 |
| 5 | If private — include the bearer token in the request. | UNAUTHORIZED 401 if missing/invalid |
| 6 | Return AgentCard to the caller for invocation. | — |

## **7.3 Caching behavior**

Resolvers **should** respect `Cache-Control: max-age` from the registry but **must not** cache longer than `IndexRecord.ttl` or `EntityOwner.ttl_seconds`, whichever is smaller. Stale-while-revalidate is permitted within `max-age + ttl`.

The registry **should** serve `/agents.json` with `Cache-Control: max-age=3600, stale-while-revalidate=3600` by default. Per-agent endpoints follow the agent's `ttl`.

# **8. Data Layer**

## **8.1 Postgres schema**

Production design. Each registry shares the table; partitioning by `owner_id` is recommended at >100 registries.

```sql
CREATE TABLE agents (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         VARCHAR(64)  NOT NULL REFERENCES entity_owners(owner_id),
  agent_slug       VARCHAR(64)  NOT NULL,                              -- the "name" portion
  agent_id         VARCHAR(255) NOT NULL,                              -- slug@domain, computed
  display_name     VARCHAR(200) NOT NULL,
  description      TEXT         NOT NULL,
  capabilities     JSONB        NOT NULL,                              -- array of strings, sorted+deduped
  invocation_url   VARCHAR(512) NOT NULL,
  protocol         VARCHAR(16)  NOT NULL DEFAULT 'a2a',
  visibility       VARCHAR(16)  NOT NULL DEFAULT 'public',
  ttl_seconds      INTEGER      NOT NULL DEFAULT 3600,
  signature_value  TEXT         NOT NULL,                              -- base64 ed25519 over canonical AgentCard
  index_signature  TEXT         NOT NULL,                              -- base64 ed25519 over canonical IndexRecord
  signed_by_key_id VARCHAR(128) NOT NULL,                              -- EntityOwner key_id at signing time
  serial           VARCHAR(12)  NOT NULL,                              -- YYYYMMDDNN, monotonic per agent_id
  status           VARCHAR(20)  NOT NULL DEFAULT 'active',             -- active | suspended | revoked
  index_status     VARCHAR(20)  NOT NULL DEFAULT 'pending',            -- pending | published | failed
  issued_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ  NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, agent_slug)
);

CREATE INDEX idx_agents_owner_id     ON agents(owner_id);
CREATE INDEX idx_agents_agent_id     ON agents(agent_id);
CREATE INDEX idx_agents_status       ON agents(status);
CREATE INDEX idx_agents_index_status ON agents(index_status);
CREATE INDEX idx_agents_capabilities ON agents USING GIN (capabilities);
```

Append-only audit log:

```sql
CREATE TABLE agent_audit_log (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     VARCHAR(255) NOT NULL,
  owner_id     VARCHAR(64)  NOT NULL,
  action       VARCHAR(32)  NOT NULL,        -- create | update | suspend | revoke | resign
  actor        VARCHAR(255) NOT NULL,        -- key_id of the signer
  serial_old   VARCHAR(12),
  serial_new   VARCHAR(12),
  diff         JSONB,
  ip_address   INET,
  idempotency_key VARCHAR(128),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_audit_owner ON agent_audit_log(owner_id, created_at DESC);
```

## **8.2 Redis key design**

```
agent:{owner_id}:{agent_slug}        --> full AgentCard JSON          TTL: 1h
agent:by_id:{agent_id}               --> { owner_id, slug }            TTL: 1h
registry:{owner_id}:agents_json      --> the assembled /agents.json    TTL: 1h
registry:{owner_id}:agent_count      --> integer                       TTL: 1h
```

**Invalidation rule:** on every write, synchronously DELETE the four keys above (the third and fourth are catalog-level; the first two are agent-level) before returning 201.

## **8.3 Bloom filter (optional, v2)**

Same pattern as the GARR root: per-instance in-memory bit array keyed on `agent_id`. Definite-NO short-circuits a 404 before Redis or DB is touched. Recommended at >100k agents per RAP cluster.

## **8.4 Object-store backup of `agents.json`**

Versioned bucket (90-day retention). Every regeneration of `/agents.json` is written atomically to object storage **before** CDN invalidation. Recovery from a corrupted CDN cache is a one-command restore.

# **9. API Contracts**

## **9.1 AgentCard — full JSON schema**

```json
{
  "id":              "order-status@walmart.com",
  "display_name":    "Order Status",
  "description":     "Reports current status and timeline for an order.",
  "capabilities":    ["orders.read", "orders.track"],
  "invocation_url":  "https://agents.walmart.com/order-status/invoke",
  "protocol":        "a2a",
  "visibility":      "public",
  "signature":       "<base64 ed25519 over canonical JSON minus signature>"
}
```

`additionalProperties` is **true** at the schema level (orgs may include extra fields), but the canonical signing payload is computed **only over the eight required fields above**. Extra fields are returned as-is to callers but ignored by signature verification.

## **9.2 IndexRecord — full JSON schema**

```json
{
  "agent_id":   "order-status@walmart.com",
  "agent_name": "Order Status",
  "card_url":   "https://agents.walmart.com/.well-known/agent-registry/agents/order-status@walmart.com",
  "ttl":        3600,
  "signature":  "<base64 ed25519 over canonical JSON minus signature>"
}
```

## **9.3 AgentDraft — request body for POST**

```json
{
  "name":           "order-status",
  "display_name":   "Order Status",
  "description":    "Reports current status and timeline for an order.",
  "capabilities":   ["orders.read", "orders.track"],
  "invocation_url": "https://agents.walmart.com/order-status/invoke",
  "protocol":       "a2a",
  "visibility":     "public",
  "ttl":            3600
}
```

## **9.4 API endpoints — registry side**

| Endpoint | Method | Description | Cache | Auth |
| :---- | :---- | :---- | :---- | :---- |
| POST /api/v1/registries/:slug/agents | POST | Create a new agent. Body = AgentDraft (§9.3). Returns 201 with `{ agent_id, index_record, agent_card }`. `Idempotency-Key` header required. | No cache | EntityOwner HTTP Signature |
| PUT /api/v1/registries/:slug/agents/:agent_id | PUT | Replace an existing agent. New serial issued. Re-signs card + index record. | Invalidate | EntityOwner HTTP Signature |
| PATCH /api/v1/registries/:slug/agents/:agent_id | PATCH | Patch specific fields (capabilities, visibility, ttl). Server still re-signs. | Invalidate | EntityOwner HTTP Signature |
| POST /api/v1/registries/:slug/agents/:agent_id/suspend | POST | status → suspended. Still returned by GETs with badge. | Invalidate | EntityOwner HTTP Signature |
| POST /api/v1/registries/:slug/agents/:agent_id/revoke | POST | status → revoked. Removed from /agents.json. NANDA IndexRecord retracted async. | Invalidate | EntityOwner HTTP Signature |
| GET /api/v1/registries/:slug/agents | GET | List agents for this registry. ?status= and ?capability= filters. | Redis catalog key | None for public, bearer for private |
| GET /api/v1/registries/:slug/agents/:agent_id | GET | Fetch one agent. | Redis agent key | Bearer for private |
| GET /agents.json (canonical RAP path) | GET | Full public catalog for this registry. | CDN edge + Redis | None |

## **9.5 Error codes — exhaustive**

| Code | HTTP | Meaning |
| :---- | :---- | :---- |
| invalid_body | 400 | Schema validation failed. `detail` names the field and rule. |
| unauthorized | 401 | Missing or invalid HTTP Signature. |
| forbidden | 403 | Caller is not the registry's EntityOwner (key_id mismatch). |
| agent_not_found | 404 | No such agent_id under this owner_id. |
| registry_not_found | 404 | No such registry slug. |
| agent_id_conflict | 409 | An agent with this `name` already exists in this registry. |
| signature_invalid | 422 | Per-request HTTP Signature failed verification. |
| capability_unknown | 422 | (Optional, v2) A capability is not in the canonical registry. |
| idempotency_conflict | 422 | Same Idempotency-Key seen with a different body. |
| upstream_index_failed | 502 | NANDA Index POST failed. Async — does **not** affect the 201. Logged. |
| persist_failed | 500 | DB write failed. Retry with the same Idempotency-Key is safe. |

## **9.6 Idempotency**

Every write endpoint requires an `Idempotency-Key` header (UUIDv4 recommended). The server caches the (key, owner_id) → response pair for 24 hours.

- Repeat with **same key + same body** → returns the cached response.
- Repeat with **same key + different body** → 422 `idempotency_conflict`.
- New key → new operation.

## **9.7 Rate limits (defaults — overridable per registry)**

| Endpoint family | Limit |
| :---- | :---- |
| Writes (POST/PUT/PATCH/suspend/revoke) | 60 / minute / EntityOwner key |
| Reads (GET /agents…) | 600 / minute / IP |
| /agents.json | 60 / minute / IP (CDN absorbs the rest) |

# **10. Security Architecture**

## **10.1 HTTP Signature on every write**

Every write to the agent catalog must carry an HTTP Signature header signed by the EntityOwner's private key. The signature covers the request line, the SHA-256 body digest, and a creation timestamp.

```
Authorization: Signature keyId="walmart-key-1", algorithm="ed25519",
  signature="<base64>",
  headers="(request-target) host date digest",
  created=1738176000
```

The server verifies, in order:

1. `keyId` matches a `key_id` in the EntityOwner record fetched from GARR's `global_agent_root.json`.
2. The signing key is the **current** active key (not yet rotated out, but the previous key remains usable for `verify` during the 30-day rotation overlap).
3. The signature verifies against `(request-target) host date digest` headers concatenated per RFC 9421.
4. The `created` timestamp is within ±300 seconds of server time (replay window).

A failure at any step is `unauthorized` 401.

## **10.2 Per-record signing**

Both AgentCard and IndexRecord are signed with the EntityOwner private key, **not** the GARR root key. The signing procedure for each is:

1. Strip the `signature` field from the record.
2. Canonicalize per the GARR root specification (canonical-JSON rules): keys sorted lexicographically (recursively), no whitespace, UTF-8, arrays preserve insertion order, numbers formatted by ECMA-262 `Number.prototype.toString`.
3. Sign the resulting UTF-8 byte string with the EntityOwner private key (ed25519: algorithm parameter null; rsa-sha256: algorithm parameter `sha256`).
4. Base64-encode the signature and attach as `signature`.

The canonical bytes are the **only** thing signed. Whitespace, key order, and `additionalProperties` are not part of the signing payload.

## **10.3 Trust chain at read time (resolver's responsibility)**

A resolver consuming an AgentCard MUST verify, in order:

1. The GARR root signature on the EntityOwner record (from `global_agent_root.json`).
2. The EntityOwner signature on the IndexRecord (from NANDA Index).
3. The EntityOwner signature on the AgentCard (from the RAP).

A failure at any step is `SIGNATURE_INVALID` 502. The resolver MUST NOT cache or serve the card.

## **10.4 Threat model**

| Threat | Mitigation |
| :---- | :---- |
| Attacker registers a malicious agent under a real registry | HTTP Signature against the EntityOwner key — requires possession of the org's private key. |
| Stale signed card served after revocation | TTL bound + revocation removes the card from `/agents.json`; `IndexRecord` retracted via NANDA. Resolvers re-check on every TTL expiry. |
| Key rotation invalidates existing cards silently | 30-day overlap: old key is still valid for verify; registry re-signs all active cards under the new key during the window via a background worker (§12). |
| Catalog poisoning at the CDN | Signatures are verifiable independently of where the bytes came from. A poisoned card fails canonical verification. |
| Private agent enumeration | RAP MUST NOT return private agents in `/agents.json`. Per-id GETs without bearer return 404 (not 401) to avoid confirming existence. |
| Replay of a registration request | `Idempotency-Key` + signature `created` timestamp (±300s) + idempotency_conflict on key+body mismatch. |
| Capability false advertisement | No automatic enforcement in v1. Capability registry (v2) flags non-canonical capabilities. Trust-but-display. |
| Forged `invocation_url` (pointing at attacker infra) | EntityOwner-signed; same trust assumption as the rest of the card. Caller can defend further via mTLS to the invocation_url. |
| Mass-registration DoS by a compromised key | Per-EntityOwner-key write rate limit (60/min). Anomaly detection flags spikes. |

## **10.5 Key rotation impact**

When an EntityOwner rotates its key (a GARR root operation):

- All AgentCards signed by the old key remain verifiable until the old key's `expires_at`.
- A background re-signing worker (§12) re-signs every active card with the new key during the overlap window. Each re-sign bumps the per-agent serial.
- After the overlap, the old key is removed from `entity_owners.public_key`. Cards still bearing the old key's `signed_by_key_id` are treated as `signature_invalid` by resolvers — but the re-signer must have already replaced them.

The registry MUST monitor `agents WHERE signed_by_key_id = <old_key_id> AND status = 'active'` during rotation and alert if any remain in the last 24 hours of the overlap window.

# **11. Lifecycle**

| Action | Status transition | Serial | NANDA effect | In /agents.json |
| :---- | :---- | :---- | :---- | :---- |
| Create | (new) → active | NN=00 | IndexRecord posted | Yes |
| Update | active → active | bumped | IndexRecord re-posted with new card_url metadata if it changed | Yes |
| Suspend | active → suspended | bumped | IndexRecord remains until TTL; flagged | Yes, with `status: "suspended"` |
| Resume | suspended → active | bumped | IndexRecord re-posted | Yes |
| Revoke | active|suspended → revoked | bumped | IndexRecord retracted (DELETE to NANDA) | No |
| Hard delete | row dropped | — | IndexRecord retracted; tombstone in NANDA cache for TTL window | No |
| Re-sign (key rotation) | unchanged | bumped | IndexRecord re-posted with new signature | Yes |

# **12. Background Jobs**

| Job | Schedule | What it does | On failure |
| :---- | :---- | :---- | :---- |
| NANDA Index pusher | Event-bus driven + retry queue | POST new/updated IndexRecords to the NANDA Index. DELETE on revoke. | Retry with exponential backoff. Mark `index_status = 'failed'` after 6 attempts. Alert. |
| agents.json publisher | On any write + nightly | Regenerate the full catalog blob from active+suspended (public). Sign optionally. Push to CDN. Invalidate Redis catalog key. | Retry 3x. Alert if all fail. |
| Re-signing worker | Triggered by EntityOwner key rotation | Iterate `agents WHERE signed_by_key_id = <old>` and re-sign each with the new key. Bump serial. | Per-agent retry. Alert on stragglers within the overlap window. |
| Stale check | Daily | HTTP HEAD each agent's `invocation_url`. Mark `status = 'stale'` if unreachable for 24h. Notify owner. | Notify; do not auto-revoke. |
| Audit log shipper | Hourly | Ship `agent_audit_log` entries to long-term retention (object store). | Dead-letter queue. |
| Index reconciliation | Daily | Diff `agents WHERE index_status = 'pending'` against NANDA. Retry missing posts. | Alert on persistent drift > 100 records. |

# **13. What to Build — Team Checklist**

## **13.1 Backend team (registry service)**

| # | Deliverable | Notes |
| :---- | :---- | :---- |
| 1 | POST /agents endpoint | HTTP Signature auth, Idempotency-Key, full §6.1 pipeline |
| 2 | PUT / PATCH / suspend / revoke endpoints | Reuse signer, bump serial each time |
| 3 | GET /agents and /agents/:id read endpoints | Redis-first, bearer auth for private |
| 4 | /agents.json publisher | CDN-friendly, Cache-Control aligned with ttl |
| 5 | Per-record signer | Reuse the canonical-JSON module already used by GARR root signing |
| 6 | NANDA Index pusher worker | Background, retryable, marks index_status |
| 7 | Postgres schema + migrations | §8.1 |
| 8 | Redis cache + invalidation | §8.2 |
| 9 | Audit log table + shipper | §8.1 + §12 |
| 10 | Key-rotation re-sign worker | §10.5 |
| 11 | Bearer-token auth for private cards | Registry-defined token store, scoped per agent |

## **13.2 Frontend team (registry admin UI)**

| # | Deliverable | Notes |
| :---- | :---- | :---- |
| 1 | /agents list page | Filter by status, capability, search by id, paginate |
| 2 | /agents/new form | Per §6.2; show canonical-JSON preview before submit |
| 3 | /agents/:id detail + edit | Render signed JSON, edit fields, re-sign on save |
| 4 | Suspend / revoke confirmation modals | Irreversible action requires typed confirmation for revoke |
| 5 | Audit-log drawer per agent | Last N entries, with diff viewer |
| 6 | Key-rotation prompt | Triggered when the EntityOwner key changes in the GARR root — surfaces a "re-sign all" button |
| 7 | Empty + error states | Every state per §6.5 |

## **13.3 Infrastructure / DevOps team**

| # | Deliverable | Notes |
| :---- | :---- | :---- |
| 1 | RAP CDN | Cache `/agents.json` + `/agents/:id` at the edge with `stale-while-revalidate` |
| 2 | TLS certificate matching registry domain | Same root as EntityOwner.domain — required for resolver trust |
| 3 | Rate limiting at the edge | Per-IP and per-API-key |
| 4 | Postgres replication for the `agents` table | Read replica per region |
| 5 | mTLS internal for signer ↔ DB | Zero-trust posture |
| 6 | Worker fleet for NANDA pusher + re-signer | Horizontally scalable, queue-backed |
| 7 | Object-store backup of `/agents.json` | Versioned, 90-day retention |
| 8 | Observability | Metrics: write latency p99, signer error rate, NANDA push lag, stale-check failures |

# **14. v1 Demo Scope vs v2 Production Scope**

The current demo implementation (in `e:\GARR`, branch `feat/agent-registration`) covers only a subset of this spec. This table makes the gap explicit so the working group can prioritise.

| Concern | v1 demo (today) | v2 production target |
| :---- | :---- | :---- |
| Auth on write endpoint | None — any caller can POST | HTTP Signature with EntityOwner key (§10.1) |
| Storage | JSON files in `db/seed/*.json` | Postgres `agents` table per §8.1 |
| Mutation operations | Create only | Update, patch, suspend, revoke, hard-delete |
| /agents.json RAP endpoint | Not implemented (cards served per-id only) | Required canonical RAP endpoint |
| Idempotency | None | `Idempotency-Key` header required on writes |
| Audit log | None | `agent_audit_log` table + shipper |
| NANDA Index push | Bundled (same server hosts the mock NANDA) | Real NANDA, async queue + retry |
| Capability validation | Format only | Optional registry lookup |
| Private agents (bearer) | Not implemented | Bearer + per-token rate limit |
| Re-sign on key rotation | Not applicable | Background worker per §10.5 |
| Multi-region | Single instance | CDN + Redis Cluster + multi-region Postgres |
| Per-record TTL | Hardcoded to 3600 | Configurable per agent, bounded by EntityOwner.ttl_seconds |
| Rate limits | None | Per §9.7 |

The demo proves: the schemas, the signing pipeline (canonical JSON + ed25519), the read path (per-id card fetch), and the integration with the GARR root manifest and the Agent Resolution Flow. Everything else in this spec is design intent the implementation team will build out.

## **14.1 Demo verification evidence**

Verified live on the demo branch with `curl` and signature verification (see verification report):

- 12 agents (6 per registry across Google + Walmart) all cryptographically verify against their respective `db/seed/keys/<slug>-public.pem`.
- Cross-registry signature attempts fail (Google's public key cannot validate Walmart's cards) — proving signing scope is intact.
- Newly registered agents flow correctly into the resolver: `POST .../agents` → `GET /mock/nanda/lookup` → `GET /api/v1/resolve` returns the full chain.
- 51/51 unit + integration tests passing.

# **15. Open Decisions for Working Group**

| # | Decision | Options | Recommendation |
| :---- | :---- | :---- | :---- |
| 1 | Capability registry | Free-form vs. centrally curated | Curated namespace (`commerce.*`, `messaging.*`, …) maintained by the foundation; free-form allowed but flagged at resolve time. |
| 2 | Maximum agents per registry | Hard cap vs. tier-based | 1,000 per registry in v1; tier-based above. Forces curation. |
| 3 | `invocation_url` scheme | https-only vs. allow `a2a://` etc. | `https://` only in v1; revisit when A2A defines its own scheme officially. |
| 4 | `additionalProperties` on AgentCard | Allow (current) vs. reject | Allow but exclude from canonical signing payload. Future-proof; orgs can layer metadata. |
| 5 | Suspend vs. revoke semantics | Both vs. just revoke | Both — suspend is reversible, revoke is permanent. |
| 6 | Per-agent rate limiting | At RAP edge vs. at invocation_url | At `invocation_url` — registry owner's responsibility. RAP only protects the catalog. |
| 7 | IndexRecord TTL ceiling | Independent vs. bounded by EntityOwner | Must not exceed `EntityOwner.ttl_seconds`. |
| 8 | Agent versioning | Single record per slug vs. semver tagging | Single record in v1; `agent@v2.walmart.com` as a separate slug for breaking changes. |
| 9 | Cross-registry agent aliases | Permitted vs. forbidden | Forbidden in v1 — each agent_id has exactly one home registry. |

**END OF DOCUMENT**

Agent Registration Specification v1.0 — Nanda Initiative · May 2026
