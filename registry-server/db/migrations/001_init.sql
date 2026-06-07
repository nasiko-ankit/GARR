-- Registry Server v1 schema: agent records with card_url links to A2A cards

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename  VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agents (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     VARCHAR(64)  UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description  TEXT,
  card_url     VARCHAR(512) NOT NULL,
  tags         TEXT[]       NOT NULL DEFAULT '{}',
  ttl_seconds  INTEGER      NOT NULL DEFAULT 3600,
  status       VARCHAR(20)  NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_id_format CHECK (agent_id ~ '^[a-z0-9][a-z0-9-]*$'),
  CONSTRAINT status_values    CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS idx_agents_status     ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at);
