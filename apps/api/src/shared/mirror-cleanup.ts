import { Prisma } from '@prisma/client';

/**
 * Borra las copias de un reparto en las cuentas de los familiares: su movimiento, su compra en cuotas
 * (con inicial y cuotas registradas) y, en cascada, su reparto y su deuda.
 */
export async function deleteMirrorsOf(db: Prisma.TransactionClient, sourceSharedId: string) {
  const mirrors = await db.sharedExpense.findMany({ where: { mirrorOfId: sourceSharedId }, select: { id: true } });
  for (const m of mirrors) {
    await db.transaction.deleteMany({ where: { sharedId: m.id } });
    await db.installmentPlan.deleteMany({ where: { sharedId: m.id } });
    await db.sharedExpense.delete({ where: { id: m.id } });
  }
  return mirrors.length;
}
