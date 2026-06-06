import { getSql } from '../client.js';

export interface InsertAuditLogData {
  ownerId: string;
  action: string;
  /** Human-readable actor identifier (e.g. owner_id or 'system'). Maps to the NOT NULL `actor` column. */
  actor: string;
  /** Remote IP of the request. Maps to the nullable `ip_address` inet column. */
  ipAddress?: string | null;
  diff?: Record<string, unknown> | null;
}

/**
 * Appends one row to audit_log. Append-only by convention — no UPDATE or
 * DELETE is ever issued against this table.
 *
 * Live schema columns: id, owner_id, action, actor, serial_old, serial_new,
 *   diff, ip_address, created_at.
 * Any extra context (e.g. serial transitions) is stashed inside `diff`.
 */
export async function insertAuditLog(data: InsertAuditLogData): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO audit_log (owner_id, action, actor, ip_address, diff)
    VALUES (
      ${data.ownerId},
      ${data.action},
      ${data.actor},
      ${data.ipAddress ?? null},
      ${data.diff ? sql.json(data.diff as never) : null}
    )
  `;
}
