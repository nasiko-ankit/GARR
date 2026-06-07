import { getSql } from '../client.js';

export interface OrgMembership {
  id: string;
  userId: string;
  orgId: string;
  role: 'admin' | 'member';
  createdAt: Date;
}

/**
 * Inserts a new org membership.
 * Returns the inserted record.
 */
export async function insertMembership(
  userId: string,
  orgId: string,
  role: 'admin' | 'member' = 'admin',
): Promise<OrgMembership> {
  const sql = getSql();
  const rows = await sql<OrgMembership[]>`
    INSERT INTO org_memberships (user_id, org_id, role)
    VALUES (${userId}, ${orgId}, ${role})
    RETURNING *
  `;
  return rows[0]!;
}

/**
 * Returns all memberships for a user with org details joined.
 */
export async function findMembershipsByUserId(
  userId: string,
): Promise<Array<OrgMembership & { displayName: string }>> {
  const sql = getSql();
  return sql<Array<OrgMembership & { displayName: string }>>`
    SELECT m.*, o.display_name
    FROM org_memberships m
    JOIN organizations o ON o.org_id = m.org_id
    WHERE m.user_id = ${userId}
    ORDER BY m.created_at DESC
  `;
}

/**
 * Checks whether a user is a member of an org.
 * Returns the membership or null.
 */
export async function checkMembership(
  userId: string,
  orgId: string,
): Promise<OrgMembership | null> {
  const sql = getSql();
  const rows = await sql<OrgMembership[]>`
    SELECT * FROM org_memberships
    WHERE user_id = ${userId} AND org_id = ${orgId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}
