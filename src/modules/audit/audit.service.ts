import type { Prisma } from '../../generated/prisma/client';

/** Append-only audit trail for privileged mutations (docs/launch-checklist.md). */
export type AuditService = ReturnType<typeof createAuditService>;

export function createAuditService() {
  /**
   * Write inside the same transaction as the change it describes.
   * `details` must never contain a key, secret or ABA token (hard rule 6).
   */
  function record(
    tx: Prisma.TransactionClient,
    entry: { actorId: number; action: string; targetType: string; targetId: number; details?: Prisma.InputJsonObject },
  ) {
    return tx.audit_logs.create({
      data: {
        actor_account_id: entry.actorId,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        details: entry.details,
      },
    });
  }

  return { record };
}
