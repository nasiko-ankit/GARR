

**Agent Resolution Flow**

Locator → NANDA Index → AgentCard → Handshake

Architecture & Engineering Specification

| Version | 1.0 — Draft |
| :---- | :---- |
| **Date** | May 2026 |
| **Authors** | Nanda Initiative Working Group |
| **Governance** | Foundation for Agentic Networks, 501(c)(3) |
| **Contact** | registrar@nanda.org |
| **Classification** | Engineering Internal |

# **1. Purpose and Scope**

This document specifies the **Agent Resolution Flow**: how a calling agent turns a locator string into a verified AgentCard belonging to a different organization, and exchanges cards with that target agent.

The resolver is stateless. It owns no agent data. It dispatches lookups against the NANDA Index or DNS SRV, fetches the AgentCard from the target registry's RAP, and returns the result.

The resolver does **not** create or modify agents (that is Agent Registration). The resolver does **not** maintain the GARR root manifest.

# **2. System Overview**

## **2.1 One-line description**

The resolver is the second hop in any cross-organization agent call: caller → resolver → callee's registry → callee's invocation URL.

## **2.2 What the resolver is and is not**

| The resolver IS | The resolver IS NOT |
| :---- | :---- |
| Stateless HTTP dispatch | A registry of its own |
| The integration point between NANDA Index, RAP, and the caller | The NANDA Index itself |
| Where mode dispatch happens (`:global` / `:dnssrv` / `:nandaindex.org`) | Where AgentCards are stored |
| Where the trust chain is verifiable | The agent runtime |

## **2.3 Trust chain at resolve time**

```
GARR root key
   └── signs → EntityOwner record (in global_agent_root.json)
         └── EntityOwner key signs → IndexRecord (from NANDA Index)
         └── EntityOwner key signs → AgentCard (from RAP)
                  └── consumed by → caller (verifies and invokes)
```

The resolver returns all three records. The caller verifies the chain before invoking.

# **3. Core Terminology**

| Term | Definition |
| :---- | :---- |
| Locator | `<identifier>@<namespace>:<mode>` — the resolver's input |
| ParsedLocator | `{ identifier, namespace, mode, agentId }` — output of `parseLocator` |
| IndexRecord | Signed pointer returned by NANDA. `{ agent_id, agent_name, card_url, ttl, signature }` |
| AgentCard | Signed card returned by RAP. Full agent description. |
| ResolveResponse | What `GET /api/v1/resolve` returns. Carries both IndexRecord and AgentCard. |
| Resolution mode | One of `global`, `dnssrv`, `nandaindex.org` |
| resolved_via | Identifier of the actual upstream used (e.g. `nandaindex.org`, `dns-srv:agents.walmart.com`) |
| agentId | `identifier@namespace` — the lookup key, mode stripped |

# **4. The Agent Locator**

## **4.1 Grammar**

```
locator     = identifier "@" namespace ":" mode
identifier  = (any) ;  everything before the last @
namespace   = (any) ;  everything between the last @ and the last :
mode        = "global" | "dnssrv" | "nandaindex.org"
```

Parsing rules (`src/lib/locatorParser.ts`):

1. The **last** `:` separates `mode` from the rest.
2. The **last** `@` within the rest separates `identifier` from `namespace`.
3. All three parts MUST be non-empty.
4. `mode` MUST be one of the three enumerated values.

## **4.2 Examples**

| Locator | identifier | namespace | mode |
| :---- | :---- | :---- | :---- |
| `order-status@walmart.com:global` | order-status | walmart.com | global |
| `scheduler@google.com:nandaindex.org` | scheduler | google.com | nandaindex.org |
| `helper@agents.acme.io:dnssrv` | helper | agents.acme.io | dnssrv |

## **4.3 Locator validation errors**

All return HTTP 400 with `error: "invalid_locator"`.

| Condition | Detail message |
| :---- | :---- |
| Missing `:` | `missing mode suffix (expected :global, :dnssrv, or :nandaindex.org)` |
| Unknown mode | `unknown mode ":<x>" — must be one of :global, :dnssrv, :nandaindex.org` |
| Missing `@` | `missing @ separator between identifier and namespace` |
| Empty identifier | `identifier is empty` |
| Empty namespace | `namespace is empty` |

# **5. Resolution Pipeline**

## **5.1 Step-by-step**

| Step | Component | Action | On failure |
| :---- | :---- | :---- | :---- |
| 1 | `parseLocator` | Parse the locator string into ParsedLocator. | 400 invalid_locator |
| 2 | `resolveAgent` | Dispatch by mode (§5.2). Returns IndexRecord + `resolved_via`. | per mode (§5.2) |
| 3 | `fetchAgentCard` | HTTPS GET on `index_record.card_url`. Validate shape. | 502 card_malformed / 503 unreachable / 404 not_found |
| 4 | Resolver | Assemble ResolveResponse. | — |
| 5 | Caller | Verify trust chain (§9) before invoking. | discard on any signature failure |

## **5.2 Mode dispatch**

```
:global
   → lookupNandaIndex(agentId, "nandaindex.org")
        ok                          → return IndexRecord, resolved_via = "nandaindex.org"
        not_found                   → 404 not_found
        bad_request                 → 400 bad_request
        unreachable | rate_limited  → fall back to :dnssrv
                                         dnssrv ok    → return, resolved_via = "dns-srv:<namespace>"
                                         dnssrv fails → 503 unreachable

:nandaindex.org
   → lookupNandaIndex(agentId, "nandaindex.org")
        any error returned as-is — NO fallback

:dnssrv
   → lookupViaDnsSrv(agentId, namespace)
        any error returned as-is — NO fallback
```

Only `:global` falls back. The other two are explicit declarations of intent; the caller must change the locator to retry differently.

# **6. NANDA Index Protocol**

`src/lib/nandaIndexClient.ts`.

## **6.1 Request**

```
GET https://<index-host>/lookup?agent=<url-encoded agent_id>
Accept: application/json
```

Default `<index-host>` is `nandaindex.org`. The resolver may be configured with the `NANDA_INDEX_BASE_URL` environment variable to override the entire prefix. When set, the request becomes:

```
GET <NANDA_INDEX_BASE_URL>/lookup?agent=<url-encoded agent_id>
```

The override is read once at module load (cached). It is what the demo uses to point at the local mock NANDA mounted on the same server.

## **6.2 Response — 200**

The body MUST be a JSON object matching the IndexRecord schema (§11.2). The client performs a minimal shape check:

| Field | Type | Required |
| :---- | :---- | :---- |
| agent_id | string, non-empty | yes |
| agent_name | string, non-empty | yes |
| card_url | string, `https://` URL | yes |
| ttl | integer ≥ 1 | yes |
| signature | string, non-empty (base64) | yes |

Any missing or wrong-typed field is treated as `unreachable` (upstream malformed).

## **6.3 Response — error mapping**

| Upstream HTTP | Client code | Resolver returns |
| :---- | :---- | :---- |
| 404 | not_found | 404 |
| 400 | bad_request | 400 |
| 429 | rate_limited | 429 (or fall back in `:global`) |
| 503 / other 5xx | unreachable | 503 (or fall back in `:global`) |
| network error / non-JSON / malformed body | unreachable | 503 (or fall back in `:global`) |

# **7. DNS SRV Protocol**

`src/lib/dnsSrvResolver.ts`.

## **7.1 Lookup**

```
_agentindex._tcp.<namespace>     (DNS SRV)
```

## **7.2 Sort order (RFC 2782)**

1. Ascending `priority`.
2. Within the same `priority`, descending `weight`.

## **7.3 Host derivation**

For each sorted SRV record:

- If `port == 443` → host = `<name>`
- Else → host = `<name>:<port>`

The resolver then calls `lookupNandaIndex(agentId, <derived host>)` against each target in priority order. **First successful target wins.**

## **7.4 Error mapping**

| Condition | Resolver code | HTTP |
| :---- | :---- | :---- |
| No SRV record / empty result | no_srv_record | 404 |
| First reachable target returns not_found | not_found | 404 (definitive — does NOT try further targets) |
| All targets unreachable | unreachable | 503 |
| All targets rate-limited | rate_limited | 429 |
| Conforming NANDA at a target returns bad_request | bad_request | 400 |

The "definitive not_found" rule: if any reachable target says the agent does not exist, the resolver trusts that answer. It does not shop other targets for a different answer.

# **8. AgentCard Fetch**

`src/lib/agentCardFetcher.ts`.

## **8.1 Request**

```
GET <card_url, fragment stripped>
Accept: application/json
```

`card_url` may carry a `#fragment` — it is a caller-side hint and is stripped before the HTTP request.

## **8.2 Validation**

Body must satisfy the AgentCard required-field shape (§11.3):

| Field | Type |
| :---- | :---- |
| id | string |
| display_name | string |
| description | string |
| capabilities | array of strings |
| invocation_url | string |
| protocol | string |
| visibility | `"public"` \| `"private"` |
| signature | string |

Any missing required field → `card_malformed` (502).

## **8.3 TLS expectations**

- **Production:** HTTPS only; TLS certificate MUST match `EntityOwner.domain`. Self-signed rejected.
- **Demo:** HTTP allowed (mock cards are served from `http://localhost:3000`).

## **8.4 Error mapping**

| Condition | Code | HTTP |
| :---- | :---- | :---- |
| 404 | not_found | 404 |
| Network error / non-2xx | unreachable | 503 |
| Non-JSON body | malformed | 502 |
| Missing required field | malformed | 502 |

# **9. Trust Chain Verification**

After the resolver returns ResolveResponse, the caller MUST verify, in order:

1. **EntityOwner record** — fetched separately from `GET /global_agent_root.json` on the GARR root. Verify its `signature_value` against the GARR root public key.
2. **IndexRecord** — verify `index_record.signature` against `EntityOwner.public_key` using canonical-JSON (with the `signature` field stripped before serialization).
3. **AgentCard** — verify `agent_card.signature` against the same `EntityOwner.public_key`, same canonical-JSON rules.

Any failure → discard the response. Do not cache. Do not invoke.

The resolver in v1 does NOT perform these verifications itself (caller-side responsibility); see §13 for the v2 plan.

# **10. A2A Invoke Protocol (handshake)**

The handshake is what one resolved agent does to begin a session with another. The current implementation is a stub — the schema below is the contract regardless of whether the responder is a real agent or the demo's mock.

`src/routes/mock.ts` — `POST /mock/agents/:slug/invoke`.

## **10.1 Request**

```
POST <invocation_url>
Content-Type: application/json
```

```json
{
  "caller_card":     { ... full AgentCard of the calling agent ... },
  "callee_agent_id": "<agent_id of the agent being called>"
}
```

`caller_card` is validated against the AgentCard schema with the `invocation_url`'s `^https://` pattern relaxed (demo cards live on `http://localhost`). Production keeps the strict schema.

## **10.2 Response — 200**

```json
{
  "handshake_ok":     true,
  "callee_card":      { ... full AgentCard of the callee ... },
  "echoed_caller_id": "<caller_card.id>",
  "at":               "<ISO 8601 timestamp>"
}
```

Echoing `caller_card.id` lets the caller confirm the request reached the right agent.

## **10.3 Errors**

| Condition | HTTP | error |
| :---- | :---- | :---- |
| Body missing/malformed | 400 | FST_ERR_VALIDATION |
| `callee_agent_id` not found in `:slug` registry | 404 | not_found |

# **11. Schemas**

## **11.1 ResolveResponse**

```json
{
  "locator":         "order-status@walmart.com:global",
  "resolution_mode": "global",
  "resolved_via":    "nandaindex.org",
  "index_record":    { ... IndexRecord ... },
  "agent_card":      { ... AgentCard ... }
}
```

| Field | Type | Description |
| :---- | :---- | :---- |
| locator | string | The original input locator |
| resolution_mode | `"global"` \| `"dnssrv"` \| `"nandaindex.org"` | Mode taken from the locator |
| resolved_via | string | Identifier of the actual upstream used |
| index_record | IndexRecord | §11.2 |
| agent_card | AgentCard | §11.3 |

## **11.2 IndexRecord**

```json
{
  "agent_id":   "order-status@walmart.com",
  "agent_name": "Order Status",
  "card_url":   "https://agents.walmart.com/.well-known/agent-registry/agents/order-status@walmart.com",
  "ttl":        3600,
  "signature":  "<base64 ed25519 over canonical JSON minus signature>"
}
```

| Field | Type | Notes |
| :---- | :---- | :---- |
| agent_id | string | `identifier@namespace` |
| agent_name | string | Human-readable label |
| card_url | string | `https://` URL to AgentCard; may include `#fragment` |
| ttl | integer (seconds) | ≥ 1; MUST NOT exceed `EntityOwner.ttl_seconds` |
| signature | string (base64) | Signed by EntityOwner private key |

## **11.3 AgentCard**

```json
{
  "id":             "order-status@walmart.com",
  "display_name":   "Order Status",
  "description":    "Reports current status and timeline for an order.",
  "capabilities":   ["orders.read", "orders.track"],
  "invocation_url": "https://agents.walmart.com/order-status/invoke",
  "protocol":       "a2a",
  "visibility":     "public",
  "signature":      "<base64 ed25519 over canonical JSON minus signature>"
}
```

| Field | Type | Notes |
| :---- | :---- | :---- |
| id | string | `identifier@namespace` |
| display_name | string | 1–200 chars |
| description | string | 1–1000 chars |
| capabilities | array of strings | 1–16 entries |
| invocation_url | string | `https://` in production; `http://` permitted in the demo |
| protocol | string | `a2a` \| `mcp` \| `https` |
| visibility | enum | `public` \| `private` |
| signature | string (base64) | Signed by EntityOwner private key |

`additionalProperties: true` — orgs may include extra fields, but only the eight required fields are part of the canonical signing payload.

## **11.4 HandshakeRequest**

```json
{
  "caller_card":     { ... AgentCard ... },
  "callee_agent_id": "order-status@walmart.com"
}
```

## **11.5 HandshakeResponse**

```json
{
  "handshake_ok":     true,
  "callee_card":      { ... AgentCard ... },
  "echoed_caller_id": "search-bot@google.com",
  "at":               "2026-05-28T09:37:17.366Z"
}
```

# **12. API Contract**

| Endpoint | Method | Description |
| :---- | :---- | :---- |
| GET /api/v1/resolve?locator=&lt;…&gt; | GET | Full resolution chain. Returns ResolveResponse. |
| POST /mock/agents/:slug/invoke | POST | A2A handshake stub (demo). Body = HandshakeRequest. Response = HandshakeResponse. |

## **12.1 Resolver error codes (`/api/v1/resolve`)**

| Code | HTTP | When |
| :---- | :---- | :---- |
| invalid_locator | 400 | `parseLocator` failed |
| bad_request | 400 | NANDA upstream rejected the query |
| not_found | 404 | Agent not in NANDA / NANDA reachable but missing |
| no_srv_record | 404 | `:dnssrv` mode but the SRV name does not resolve |
| rate_limited | 429 | NANDA rate-limited the resolver (and `:global` could not fall back) |
| card_malformed | 502 | RAP returned a card that fails shape validation |
| unreachable | 503 | NANDA / RAP unreachable or upstream 5xx (and `:global` fallback also failed) |

All error responses use the standard ApiError shape:

```json
{ "error": "<code>", "detail": "<human-readable description>" }
```

# **13. v1 Demo Scope vs v2 Production Scope**

| Concern | v1 demo (today) | v2 production target |
| :---- | :---- | :---- |
| NANDA Index | Local mock at `/mock/nanda/lookup` via `NANDA_INDEX_BASE_URL` | Real `nandaindex.org` or registered SRV target |
| AgentCard URL scheme | `http://localhost:3000` allowed | `https://` only; TLS must match EntityOwner.domain |
| DNS SRV mode | Returns `no_srv_record` (no DNS infra for `*.local`) | Real DNS SRV lookups |
| Trust-chain verification | Caller's responsibility — resolver does not verify | Resolver may verify on caller's behalf (opt-out via query flag) |
| Response caching | None | Cache-Control + Redis layer respecting `IndexRecord.ttl` |
| A2A invoke handler | Echo stub — accepts caller card, returns callee card + `handshake_ok: true` | Real A2A protocol (out of scope for this spec) |
| Rate limiting | None | Per-IP and per-API-key at the resolver edge |

# **14. What we built — repo reference**

Files implementing the resolution flow in the GARR demo repo:

| File | Purpose |
| :---- | :---- |
| `src/lib/locatorParser.ts` | `parseLocator` → ParsedLocator |
| `src/services/resolution.ts` | `resolveAgent` — mode dispatch + `:global` fallback |
| `src/lib/nandaIndexClient.ts` | `lookupNandaIndex` + `NANDA_INDEX_BASE_URL` override |
| `src/lib/dnsSrvResolver.ts` | `lookupViaDnsSrv` (RFC 2782 sort) |
| `src/lib/agentCardFetcher.ts` | `fetchAgentCard` with shape validation |
| `src/routes/resolve.ts` | `GET /api/v1/resolve` handler + error mapping |
| `src/routes/mock.ts` | `/mock/nanda/lookup`, `/mock/registries/.../cards/...`, `/mock/agents/:slug/invoke` |
| `src/types/api/resolve.ts` | TypeScript + JSON-schema definitions for every shape in §11 |

## **14.1 Live verification**

Verified end-to-end against the running demo (see verification report). All cases reproduced with `curl`:

- `:global` happy path returns 200 with full `index_record` + `agent_card`.
- `:nandaindex.org` happy path returns 200 with `resolution_mode: "nandaindex.org"`.
- `:dnssrv` correctly returns 404 `no_srv_record` (no DNS infra for `*.local`).
- Bad locator → 400 `invalid_locator`.
- Unknown agent → 404 `not_found`.
- A2A handshake — Google → Walmart and Walmart → Google both return `handshake_ok: true` with echoed caller id and ISO timestamp.
- Unknown callee → 404 `not_found`.
- Malformed `caller_card` → 400 `FST_ERR_VALIDATION`.

Cross-registry signature scope verified: Google's public key cannot validate a Walmart card (and vice versa), proving the signing boundary is intact.

# **15. Open Decisions**

| # | Question | Recommendation |
| :---- | :---- | :---- |
| 1 | Should the resolver verify the trust chain on the caller's behalf? | Yes in v2 — short-circuits the most common implementation mistake. Caller may opt out via `?verify=false`. |
| 2 | Resolver-side caching | Redis keyed on `agent_id`, TTL = min(IndexRecord.ttl, EntityOwner.ttl_seconds). Not in v1. |
| 3 | DNS SRV target shopping after `not_found` | Trust the first reachable target — do NOT shop further targets. |
| 4 | `#fragment` handling on `card_url` | Strip before HTTP fetch; fragment is a caller-side hint. |
| 5 | A2A protocol details | Out of scope here — covered by a future dedicated A2A protocol spec. |
| 6 | `:global` fallback policy | Fall back on `unreachable` / `rate_limited`. Do NOT fall back on `not_found` or `bad_request` (definitive answers). |

**END OF DOCUMENT**

Agent Resolution Flow Specification v1.0 — Nanda Initiative · May 2026
