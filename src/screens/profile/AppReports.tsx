// Rückmeldung aus der App (16.5): Bug oder Feature-Wunsch senden (WF-PRO-05), Liste für Admins (WF-ADM-10)
import { useState } from 'react';
import { BarOffset, useFeedback } from '../../app/feedback';
import { clearDraft, readDraft, writeDraft } from '../../app/drafts';
import { useLookups } from '../../app/lookups';
import { useData } from '../../app/useData';
import { APP_VERSION } from '../../app/version';
import { api } from '../../data';
import { formatHistoryTime } from '../../shared/format';
import { APP_REPORT_TEXT_MAX, type AppReportKind } from '../../shared/schema';
import { FieldError, GhostButton, LightButton, ListSkeleton, LoadError } from '../../ui/bits';
import { Sheet } from '../../ui/Sheet';
import { Segmented, TextField } from '../knowledge/KnowledgeSheets';
import { AdminTopBar } from './Members';

const REPORT_KIND_LABEL: Record<AppReportKind, string> = { bug: 'Bug', wunsch: 'Feature-Wunsch' };

/** Leitfrage je Art – damit die Meldung reicht, um etwas zu tun */
const GUIDING_QUESTION: Record<AppReportKind, string> = {
  bug: 'Was hast du gemacht, was ist passiert – und was hättest du erwartet?',
  wunsch: 'Was möchtest du tun können, und wobei würde dir das helfen?',
};

/** lokaler Entwurf des Texts (7.3) */
const draftKey = (kind: AppReportKind) => `rueckmeldung:${kind}`;

/** WF-PRO-05: Bug oder Feature-Wunsch – langer Text mit Senden/Abbrechen und lokalem Entwurf */
export function ReportSheet({ onClose }: { onClose: () => void }) {
  const { run } = useFeedback();
  // ein angefangener Wunsch ist beim Öffnen gleich wieder da
  const [kind, setKind] = useState<AppReportKind>(() =>
    !readDraft(draftKey('bug')) && readDraft(draftKey('wunsch')) ? 'wunsch' : 'bug',
  );
  const [text, setText] = useState(() => readDraft(draftKey(kind)) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const missing = !text.trim()
    ? 'Beschreib kurz, worum es geht'
    : text.trim().length > APP_REPORT_TEXT_MAX
      ? `Text auf ${APP_REPORT_TEXT_MAX} Zeichen kürzen`
      : null;

  const send = async () => {
    if (missing || sending) return;
    setSending(true);
    setError(null);
    const sent = await run(() => api.createAppReport({ kind, text, app_version: APP_VERSION }), {
      success: 'Danke! Die Rückmeldung ist angekommen.',
      ownInput: text,
      onInvalid: (e) => setError(e.message),
    });
    setSending(false);
    if (sent) {
      clearDraft(draftKey(kind));
      onClose();
    }
  };

  return (
    <Sheet title="Rückmeldung zur App" onClose={onClose} wf="WF-PRO-05" closeButton>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Segmented
          label="Art der Rückmeldung"
          wf="WF-PRO-05"
          value={kind}
          onChange={(next) => {
            setKind(next);
            setText(readDraft(draftKey(next)) ?? '');
            setError(null);
          }}
          options={[
            ['bug', REPORT_KIND_LABEL.bug],
            ['wunsch', REPORT_KIND_LABEL.wunsch],
          ]}
        />
        <span className="text-[15px] leading-normal text-weich">{GUIDING_QUESTION[kind]}</span>
        <TextField
          label="Deine Rückmeldung"
          wf="WF-PRO-05"
          value={text}
          max={APP_REPORT_TEXT_MAX}
          onChange={(value) => {
            setText(value);
            writeDraft(draftKey(kind), value);
          }}
        />
        <span className="text-[13px] leading-[1.4] text-leise">
          Admins sehen die Rückmeldung mit deinem Namen und der Version {APP_VERSION}.
        </span>
        <FieldError>{error}</FieldError>
        <LightButton type="submit" data-wf="WF-PRO-05" disabled={!!missing || sending}>
          {missing ?? 'Senden'}
        </LightButton>
        <GhostButton
          onClick={() => {
            clearDraft(draftKey(kind));
            onClose();
          }}
        >
          Abbrechen
        </GhostButton>
      </form>
    </Sheet>
  );
}

/** WF-ADM-10: alle Rückmeldungen, neueste zuerst */
export function AppReports() {
  const { data, error, reload } = useData('app-reports', () => api.listAppReports());
  const { memberById } = useLookups();
  return (
    <div className="mx-auto max-w-[560px] lg:max-w-[720px]">
      <BarOffset px={24} />
      <AdminTopBar />
      <div data-wf="WF-ADM-10" className="flex flex-col gap-4 px-5 pb-24">
        <h1 className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-1px]">Rückmeldungen</h1>
        {!data && !error && <ListSkeleton />}
        {!data && error && <LoadError message={error.message} onRetry={reload} />}
        {data?.length === 0 && (
          <span className="text-[15px] text-weich">Noch keine Rückmeldung – alles ruhig.</span>
        )}
        {data?.map((r) => (
          <article
            key={r.id}
            className="flex flex-col gap-2 rounded-2xl border border-linie bg-flaeche px-4 py-3.5"
          >
            <span className="label-mono flex flex-wrap gap-x-2">
              <span className={r.kind === 'bug' ? 'text-rot-hell' : 'text-arbeit'}>
                {REPORT_KIND_LABEL[r.kind]}
              </span>
              <span>{memberById.get(r.member_id)?.display_name ?? 'Jemand'}</span>
              <span>{formatHistoryTime(r.created_at)}</span>
              {r.app_version && <span>Version {r.app_version}</span>}
            </span>
            <span className="text-[15px] leading-normal break-words whitespace-pre-wrap">{r.text}</span>
          </article>
        ))}
      </div>
    </div>
  );
}
