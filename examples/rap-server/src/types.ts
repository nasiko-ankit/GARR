/**
 * Shared database row type and wire serializer for AgentCard records.
 * Imported by both catalog.ts (read) and agents.ts (read/write).
 */

export interface AgentRow {
  slug:          string;
  displayName:   string;
  description:   string;
  version:       string;
  capabilities:  string[];
  invocationUrl: string;
  protocol:      string;
  visibility:    string;
  signedBy:      string;
  signature:     string;
  createdAt:     Date;
  updatedAt:     Date;
}

/**
 * Serializes an AgentRow from the database into the JSON wire format
 * returned by GET /agents.json and GET /agents/:slug.
 *
 * @param row    - Raw DB row (camelCase via postgres.camel transform)
 * @param domain - The RAP server's domain (from RAP_DOMAIN env var)
 */
export function toWire(row: AgentRow, domain: string): {
  id: string;
  display_name: string;
  description: string;
  version: string;
  capabilities: string[];
  invocation_url: string;
  protocol: string;
  visibility: string;
  signed_by: string;
  created_at: Date;
  updated_at: Date;
  signature: string;
} {
  return {
    id:             `${row.slug}@${domain}`,
    display_name:   row.displayName,
    description:    row.description,
    version:        row.version,
    capabilities:   row.capabilities,
    invocation_url: row.invocationUrl,
    protocol:       row.protocol,
    visibility:     row.visibility,
    signed_by:      row.signedBy,
    created_at:     row.createdAt,
    updated_at:     row.updatedAt,
    signature:      row.signature,
  };
}
