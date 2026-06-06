# Database schema

Authoritative reference for the GARR Postgres schema. Generated from
[db/migrations/](db/migrations/) — when the migrations change, update
this doc in the same PR.

Spec cross-reference: §6.1 (`entity_owners`, `audit_log`).

## Tables at a glance

| Table | Role | Append-only |
|---|---|---|
| `entity_owners` | One row per registered organization | No (mutable: `status`, `serial`, signature, `expires_at`, `updated_at`) |
| `audit_log` | History of every state-changing action | Yes — convention; no `UPDATE` or `DELETE` |
| `schema_migrations` | Tracks which `db/migrations/*.sql` files have been applied | Auto-managed by [src/db/migrate.ts](src/db/migrate.ts) |

---

## `entity_owners`

The core registry table. One row = one organization in GARR.

```sql
CREATE TABLE entity_owners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        VARCHAR(64)  UNIQUE NOT NULL,
  display_name    VARCHAR(255) NOT NULL,
  domain          VARCHAR(255) UNIQUE NOT NULL,
  contact_email   VARCHAR(255) NOT NULL,
  rap_url         VARCHAR(512) NOT NULL,
  rap_fallback    VARCHAR(512),
  algorithm       VARCHAR(20)  NOT NULL,
  public_key      TEXT         NOT NULL,
  key_id          VARCHAR(128) NOT NULL,
  dmarc_policy    TEXT         NOT NULL,
  ttl_seconds     INTEGER      NOT NULL DEFAULT 86400,
  serial          VARCHAR(12)  NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'active',
  issued_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ  NOT NULL,
  signature_value TEXT         NOT NULL,
  signed_by       VARCHAR(128) NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### Columns

| Column | Type | Nullable | Default | Role |
|---|---|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Internal primary key |
| `owner_id` | `VARCHAR(64)` | No | — | External slug identifier (e.g. `"nasiko"`). Pattern: `^[a-z0-9-]+$`. **Unique** |
| `display_name` | `VARCHAR(255)` | No | — | Human-readable org name |
| `domain` | `VARCHAR(255)` | No | — | Org's primary DNS domain (the one DMARC is verified against). **Unique** — one EntityOwner per domain |
| `contact_email` | `VARCHAR(255)` | No | — | Admin contact for notifications + key rotation |
| `rap_url` | `VARCHAR(512)` | No | — | HTTPS endpoint serving the org's `agents.json`. Schema-validated to `https://` |
| `rap_fallback` | `VARCHAR(512)` | Yes | `NULL` | Optional secondary RAP — resolvers fall back here if `rap_url` is unreachable |
| `algorithm` | `VARCHAR(20)` | No | — | Signing algorithm for the org's key. Currently `ed25519` or `rsa-sha256` |
| `public_key` | `TEXT` | No | — | PEM-encoded public key. Used to verify the org's signatures on AgentCards (and to verify the registration challenge) |
| `key_id` | `VARCHAR(128)` | No | — | Opaque label identifying which key this is. Used for rotation (the org can have multiple historical keys) |
| `dmarc_policy` | `TEXT` | No | — | DMARC TXT record retrieved at registration time (`v=DMARC1; p=...`). Captured for audit; not re-read on every request |
| `ttl_seconds` | `INTEGER` | No | `86400` | How long resolvers should cache this record. Schema-bounded `3600..604800` |
| `serial` | `VARCHAR(12)` | No | — | `YYYYMMDDNN` monotonic counter. **Strictly increasing per `owner_id`** — rollback attack defense (§9.3). Format: 10 digits |
| `status` | `VARCHAR(20)` | No | `'active'` | `'active'` \| `'stale'` \| `'suspended'`. Reads filter to `active`; manifest only includes `active` |
| `issued_at` | `TIMESTAMPTZ` | No | `NOW()` | When this record was first signed by the GARR root |
| `expires_at` | `TIMESTAMPTZ` | No | — | When the signature is no longer valid (typically `issued_at + ttl_seconds`). After this, resolvers must return `503 EXPIRED` |
| `signature_value` | `TEXT` | No | — | Base64 ed25519 signature. Signs canonical JSON of all other fields **except `signature_value` itself** (§4.5) |
| `signed_by` | `VARCHAR(128)` | No | — | Identifier of the GARR root key that signed this record (matches `config.signing.keyId`) |
| `created_at` | `TIMESTAMPTZ` | No | `NOW()` | First insert. Never changes |
| `updated_at` | `TIMESTAMPTZ` | No | `NOW()` | Last mutation. Update on every `UPDATE` |

### Indexes

| Name | Columns | Purpose |
|---|---|---|
| `entity_owners_pkey` | `id` | Primary key (auto) |
| `entity_owners_owner_id_key` | `owner_id` | Uniqueness (auto from `UNIQUE`) |
| `entity_owners_domain_key` | `domain` | Uniqueness (auto from `UNIQUE`) |
| `idx_entity_owners_owner_id` | `owner_id` | Read-path lookup by slug |
| `idx_entity_owners_domain` | `domain` | Read-path lookup by domain |
| `idx_entity_owners_status` | `status` | Manifest assembly filters `WHERE status = 'active'` |

### Invariants (enforced by code, not the DB)

- **Serial monotonicity** (§9.3): on update, the new `serial` MUST be strictly greater than the previous accepted `serial` for the same `owner_id`. Lower or equal values are rejected with `502 SIGNATURE_INVALID`.
- **Canonical signing** (§4.5): `signature_value` is over the canonical JSON of every other column projected to its wire shape. Any field reordering or whitespace change breaks verification.
- **`rap_url` MUST be HTTPS**: the schema layer rejects `http://`. Self-signed certs are also rejected at request time (CLAUDE.md §9 TLS invariant).
- **`status` enum is closed**: only `'active' | 'stale' | 'suspended'`. Adding a value requires a code + spec update.

---

## `audit_log`

Append-only history. Every action that mutates `entity_owners` writes
exactly one row here.

```sql
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    VARCHAR(64)  NOT NULL,
  action      VARCHAR(32)  NOT NULL,
  actor       VARCHAR(255) NOT NULL,
  serial_old  VARCHAR(12),
  serial_new  VARCHAR(12),
  diff        JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### Columns

| Column | Type | Nullable | Role |
|---|---|---|---|
| `id` | `UUID` | No | Primary key |
| `owner_id` | `VARCHAR(64)` | No | The `owner_id` this action targeted (foreign-key-ish, but no FK constraint — the row may outlive a hard-deleted owner) |
| `action` | `VARCHAR(32)` | No | What happened. Examples: `'register'`, `'update'`, `'suspend'`, `'rotate-key'`, `'manifest-publish'` |
| `actor` | `VARCHAR(255)` | No | Who did it: `'system'`, an admin email, or a service identity |
| `serial_old` | `VARCHAR(12)` | Yes | Prior serial (NULL on first registration) |
| `serial_new` | `VARCHAR(12)` | Yes | New serial (NULL when the action doesn't bump serial — e.g. status-only changes) |
| `diff` | `JSONB` | Yes | Changed-fields delta. Free-form JSON object; convention is `{ field: { old, new } }` |
| `ip_address` | `INET` | Yes | Source IP of the calling request |
| `created_at` | `TIMESTAMPTZ` | No | When the action occurred. Defaults to `NOW()` |

### Conventions

- **Append-only by code convention.** No DB-level enforcement. Reviewers reject any PR that issues `UPDATE audit_log` or `DELETE FROM audit_log`.
- **No FK to `entity_owners`.** Audit rows survive owner deletion (compliance / forensics). If you need owner data alongside audit rows, `JOIN ON owner_id` and accept that a row may have no match.
- **No indexes yet.** Acceptable while the table is small. v2 will add `(owner_id, created_at DESC)` and `(action, created_at)` indexes for queries the dashboard will run.

---

## `schema_migrations`

Auto-managed by the migration runner ([src/db/migrate.ts](src/db/migrate.ts)).
Do not write to this table manually.

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT        PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The runner reads `db/migrations/*.sql` in lexical order, checks this
table to skip already-applied files, and runs each unapplied file inside
a transaction (rollback on partial failure). Idempotent — re-running is
safe.

---

## Adding a migration

1. Create `db/migrations/00X_<name>.sql`. Multi-statement files are fine
2. Run `npm run migrate` — applied automatically
3. Update this doc with any new tables / columns / indexes
4. **Never edit a migration after it has been applied.** Add a new one to fix issues

---

## Future tables (not yet created)

These are owned by the streams that will introduce them. Listed here so
you don't accidentally redesign them in the wrong stream.

| Table | Owner | Purpose | Status |
|---|---|---|---|
| `pending_registrations` | Stream A (registration) | In-flight registration challenges keyed by `owner_id`, with `challenge_nonce`, `challenge_expires_at`, and the unverified caller-supplied `EntityOwner` fields | Migration `002_pending_registrations.sql` to be added |

If your stream needs another table, propose the schema in your PR
description before writing the migration.
