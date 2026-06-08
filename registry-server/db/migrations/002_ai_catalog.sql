-- Align registry-server schema with AI Catalog spec (application/ai-catalog+json).
-- card_url → url (spec field name), add media_type and version.
ALTER TABLE agents RENAME COLUMN card_url TO url;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS media_type VARCHAR(255) NOT NULL DEFAULT 'application/a2a-agent-card+json';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS version VARCHAR(64);
