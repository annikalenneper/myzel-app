// S-54 Verwaltung: Systemstatus · P2 · nur Admins (WF-ADM-07)
import { BarOffset } from '../../app/feedback';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { SystemStatus as Status } from '../../data/api';
import { formatTime } from '../../shared/format';
import { isJobOverdue } from '../../shared/rules/notifications';
import type { JobRun } from '../../shared/schema';
import { cx, ListSkeleton, LoadError } from '../../ui/bits';
import { AdminTopBar } from './Members';

/** „6 Minuten“, „2 Std. 15 Min.“ */
export function formatSince(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`;
  return `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
}

const seconds = (run: JobRun) =>
  run.finished_at
    ? `${((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1).replace('.', ',')} S`
    : 'LÄUFT';

function runMeta(run: JobRun): string {
  const parts = [seconds(run)];
  if (run.sent_push) parts.push(`PUSH ${run.sent_push}`);
  if (run.sent_telegram) parts.push(`TELEGRAM ${run.sent_telegram}`);
  if (run.error) parts.push(run.error.toUpperCase());
  return parts.join(' · ');
}

export function SystemStatus() {
  const { data: status, error, reload } = useData('system-status', () => api.getSystemStatus());
  return (
    <div className="mx-auto max-w-[560px] lg:max-w-[720px]">
      <BarOffset px={24} />
      <AdminTopBar />
      <div data-wf="WF-ADM-07" className="flex flex-col gap-4 px-5 pb-24">
        <h1 className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-1px]">Systemstatus</h1>
        {!status && !error && <ListSkeleton />}
        {!status && error && <LoadError message={error.message} onRetry={reload} />}
        {status && <Loaded status={status} />}
      </div>
    </div>
  );
}

function Loaded({ status }: { status: Status }) {
  const now = new Date();
  const overdue = isJobOverdue(status.last_run_at, now);
  // die Warnung richtet sich nach dem letzten erfolgreichen Lauf; kommen Läufe mit Fehler, liegt es nicht am Auftrag
  const failing = status.runs[0]?.result === 'fehler';
  const stats: [label: string, value: string, warn: boolean][] = [
    ['Wartet in der Outbox', String(status.outbox_waiting), overdue && status.outbox_waiting > 0],
    ['Fehlgeschlagen 24 h', String(status.failed_24h), false],
    ['Push-Abos', String(status.push_subscriptions), false],
    ['Telegram verknüpft', `${status.telegram_linked} / ${status.active_members}`, false],
  ];

  return (
    <>
      <div
        role="status"
        className={cx(
          'flex flex-col gap-2 rounded-2xl border p-4',
          overdue ? 'border-rot-rand bg-rot-flaeche' : 'border-linie bg-flaeche',
        )}
      >
        <span
          className={cx('flex items-center gap-2 font-mono text-[12px]', overdue ? 'text-rot' : 'text-gruen')}
        >
          <span className={cx('size-2.5 rounded-full', overdue ? 'bg-rot' : 'bg-gruen')} />
          {overdue ? 'WARNUNG' : 'LÄUFT'}
        </span>
        <span className="text-[20px] leading-[1.25] font-bold">
          {!status.last_run_at
            ? 'Noch kein Lauf'
            : overdue
              ? `Seit ${formatSince(status.last_run_at, now)} kein ${failing ? 'erfolgreicher ' : ''}Lauf`
              : `Letzter Lauf vor ${formatSince(status.last_run_at, now)}`}
        </span>
        <span className="text-[14px] leading-normal text-weich">
          {overdue && failing
            ? 'Die Läufe kommen an, melden aber Fehler – Details stehen unten bei den letzten Läufen.'
            : overdue
              ? 'Erinnerungen werden gerade nicht verschickt. Bei cron-job.org prüfen, ob der Auftrag aktiv ist und der Schlüssel stimmt.'
              : 'Erinnerungen und Nachrichten gehen raus. Die Läufe halten außerdem die Datenbank wach.'}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="label-mono">Letzte Läufe · alle 15 Min über cron-job.org</span>
        <div className="flex flex-col overflow-hidden rounded-2xl border border-linie">
          {status.runs.map((run) => (
            <div
              key={run.id}
              className="flex min-h-[54px] items-center gap-3 border-b border-erhoeht bg-flaeche px-3.5 py-2 last:border-b-0"
            >
              <span
                className={cx(
                  'size-2 flex-none rounded-full',
                  run.result === 'fehler' ? 'bg-rot' : run.retries ? 'bg-bernstein' : 'bg-gruen',
                )}
              />
              <span className="w-12 flex-none font-mono text-[13px]">
                {formatTime(new Date(run.started_at))}
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-[14px]">
                  {run.result === 'fehler' ? 'Fehlgeschlagen' : run.summary}
                </span>
                <span className="font-mono text-[11px] text-leise">{runMeta(run)}</span>
              </span>
            </div>
          ))}
          {status.runs.length === 0 && (
            <div data-wf="WF-ALL-05" className="bg-flaeche p-4 text-[14px] text-leise">
              Noch keine Läufe protokolliert.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {stats.map(([label, value, warn]) => (
          <div
            key={label}
            className="flex flex-col gap-1.5 rounded-[14px] border border-linie bg-flaeche px-3.5 py-3"
          >
            <span className="label-mono">{label}</span>
            <span
              className={cx('text-[22px] leading-[1.2] font-bold', warn ? 'text-bernstein' : 'text-text')}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
      <span className="text-[13px] leading-[1.45] text-leise">
        Fällt ein Lauf aus, holt der nächste nach – nichts geht verloren, nichts kommt doppelt. Bei Fehlern
        schickt cron-job.org zusätzlich eine Mail.
      </span>
    </>
  );
}
