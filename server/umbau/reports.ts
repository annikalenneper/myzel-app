// Umbau 10/2026, Phase 8: Rückmeldung aus der App (16.5) – Bug oder Feature-Wunsch; die Liste sehen nur Admins.
// Wie die Testdaten-Schicht (src/data/mock/reports.ts).
import { appReportCreateSchema, type AppReport } from '../../src/shared/schema';
import { iso, parse, requireAdmin, type Ctx, type ReadCtx } from '../core/context';

/** WF-PRO-05: Rückmeldung senden – die Person kommt aus der Sitzung */
export async function createAppReport(ctx: Ctx, raw: unknown): Promise<{ id: string }> {
  const input = parse(appReportCreateSchema, raw);
  return ctx.trx
    .insertInto('app_reports')
    .values({
      kind: input.kind,
      text: input.text,
      app_version: input.app_version,
      member_id: ctx.actor.id,
      created_at: iso(ctx),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

/** WF-ADM-10: alle Rückmeldungen, neueste zuerst – nur für Admins */
export async function listAppReports(ctx: ReadCtx): Promise<AppReport[]> {
  requireAdmin(ctx);
  return ctx.trx.selectFrom('app_reports').selectAll().orderBy('created_at', 'desc').orderBy('id').execute();
}
