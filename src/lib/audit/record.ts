import { desc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { log } from "@/lib/log";

export type AuditActor = {
  id: string | null;
  email: string | null;
  tenantId: string;
};

export type AuditInput = {
  action: string;
  entity?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
};

/**
 * Writes one entry.
 *
 * Deliberately swallows its own failures. An audit write that throws would
 * turn a successful upload into a failed one, and losing the record of an
 * action is less bad than losing the action — the alternative is a system that
 * refuses to work because it cannot write a note about working.
 */
export async function record(actor: AuditActor, input: AuditInput): Promise<void> {
  try {
    await getDb().insert(schema.auditLog).values({
      tenantId: actor.tenantId,
      userId: actor.id,
      userEmail: actor.email,
      action: input.action,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      payload: input.payload ?? null,
    });
  } catch (error) {
    log.error("audit.write_failed", error, {
      tenantId: actor.tenantId,
      userId: actor.id,
      auditAction: input.action,
    });
  }
}

export type AuditRow = {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  userEmail: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
};

export async function listAudit(tenantId: string, limit = 200): Promise<AuditRow[]> {
  const rows = await getDb()
    .select({
      id: schema.auditLog.id,
      action: schema.auditLog.action,
      entity: schema.auditLog.entity,
      entityId: schema.auditLog.entityId,
      userEmail: schema.auditLog.userEmail,
      payload: schema.auditLog.payload,
      createdAt: schema.auditLog.createdAt,
    })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.tenantId, tenantId))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    payload: (row.payload ?? null) as Record<string, unknown> | null,
  }));
}
