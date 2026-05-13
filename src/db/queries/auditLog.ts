import { getSql } from '../client.js';

export interface InsertAuditLogData {
  ownerId: string;
  action: string;
  actorIp: string;
  diff?: Record<string, unknown> | null;
}

/**
 * Appends one row to audit_log. Append-only by convention — no UPDATE or
 * DELETE is ever issued against this table.
 *
 * The live schema (after migration 002_poc_audit_adjustments) has columns:
 *   owner_id, action, diff, created_at, actor_ip, idempotency_key
 * Any extra context (e.g. serial transitions) is stashed inside `diff`.
 */
export async function insertAuditLog(data: InsertAuditLogData): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO audit_log (owner_id, action, actor_ip, diff)
    VALUES (
      ${data.ownerId},
      ${data.action},
      ${data.actorIp},
      ${data.diff ? sql.json(data.diff as never) : null}
    )
  `;
}
