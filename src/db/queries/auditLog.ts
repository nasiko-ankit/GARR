import { getSql } from '../client.js';

export interface InsertAuditLogData {
  ownerId: string;
  action: string;
  actor: string;
  serialOld?: string | null;
  serialNew?: string | null;
  diff?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

/**
 * Appends one row to audit_log. Append-only by convention — no UPDATE or
 * DELETE is ever issued against this table (DB_SCHEMA.md §audit_log).
 */
export async function insertAuditLog(data: InsertAuditLogData): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO audit_log (
      owner_id, action, actor,
      serial_old, serial_new, diff, ip_address
    ) VALUES (
      ${data.ownerId}, ${data.action}, ${data.actor},
      ${data.serialOld ?? null}, ${data.serialNew ?? null},
      ${data.diff ? sql.json(data.diff as never) : null},
      ${data.ipAddress ?? null}
    )
  `;
}
