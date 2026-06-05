-- 001_init.sql — RAP server schema

CREATE TABLE agents (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           VARCHAR(64)  UNIQUE NOT NULL,
  display_name   VARCHAR(255) NOT NULL,
  description    TEXT         NOT NULL DEFAULT '',
  version        VARCHAR(32)  NOT NULL DEFAULT '1.0.0',
  capabilities   TEXT[]       NOT NULL DEFAULT '{}',
  invocation_url VARCHAR(2048) NOT NULL,
  protocol       VARCHAR(32)  NOT NULL,
  visibility     VARCHAR(16)  NOT NULL DEFAULT 'public',
  signed_by      VARCHAR(200) NOT NULL,
  signature      TEXT         NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT slug_format       CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$'),
  CONSTRAINT protocol_values   CHECK (protocol    IN ('a2a','mcp','rest','https')),
  CONSTRAINT visibility_values CHECK (visibility  IN ('public','private'))
);

CREATE INDEX idx_agents_visibility ON agents(visibility);
CREATE INDEX idx_agents_created_at ON agents(created_at);

CREATE TABLE agent_audit (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_slug  VARCHAR(64)  NOT NULL,
  action      VARCHAR(16)  NOT NULL,
  actor       VARCHAR(255),
  diff        JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- updated_at is managed by the application (set explicitly in every UPDATE statement)
-- so that the value signed into the AgentCard matches what is stored in the DB.
