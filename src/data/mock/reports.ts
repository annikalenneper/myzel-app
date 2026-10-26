// Testdaten-Schicht, Umbau Phase 8: Rückmeldung aus der App (16.5) – Bug oder Feature-Wunsch, Liste nur für Admins
import { appReportCreateSchema, type AppReport } from '../../shared/schema';
import { parse, requireAdmin, type Ctx } from './server';

/** WF-PRO-05: Rückmeldung senden – die Person kommt aus der Sitzung */
export function createAppReport(ctx: Ctx, raw: unknown): { id: string } {
  const input = parse(appReportCreateSchema, raw);
  const report: AppReport = {
    id: crypto.randomUUID(),
    kind: input.kind,
    text: input.text,
    app_version: input.app_version,
    member_id: ctx.actor.id,
    created_at: ctx.now.toISOString(),
  };
  ctx.db.app_reports.push(report);
  return { id: report.id };
}

/** WF-ADM-10: alle Rückmeldungen, neueste zuerst – nur für Admins */
export function listAppReports(ctx: Ctx): AppReport[] {
  requireAdmin(ctx);
  return [...ctx.db.app_reports].sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
  );
}
