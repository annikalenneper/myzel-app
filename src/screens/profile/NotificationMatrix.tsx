// S-50 Profil · P6: Benachrichtigungen als Schalter-Matrix und Vorlauf für Fristerinnerungen (F-PRO-02, WF-PRO-04).
// Jeder Schalter speichert sofort und wirkt sofort – auch auf Nachrichten, die noch auf den Versand warten.
import { useFeedback } from '../../app/feedback';
import { useData } from '../../app/useData';
import { api } from '../../data';
import { NOTIFICATION_GROUPS } from '../../shared/rules/notifications';
import { REMINDER_LEAD_CHOICES, type NotificationChannel } from '../../shared/schema';
import { cx } from '../../ui/bits';

const WF = 'WF-PRO-04';
const CHANNEL_LABEL: Record<NotificationChannel, string> = { push: 'Push', telegram: 'Telegram' };

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-wf={WF}
      aria-pressed={on}
      aria-label={label}
      onClick={onToggle}
      className="flex h-11 w-[58px] flex-none items-center justify-center"
    >
      <span className={cx('relative h-[30px] w-[50px] rounded-[15px]', on ? 'bg-violett' : 'bg-rand')}>
        <span
          className={cx(
            'absolute top-[3px] size-6 rounded-full bg-text transition-[left]',
            on ? 'left-[23px]' : 'left-[3px]',
          )}
        />
      </span>
    </button>
  );
}

export function NotificationMatrix() {
  const { run } = useFeedback();
  const { data: settings } = useData('notification-settings', () => api.getNotificationSettings());
  if (!settings) return null;

  const toggle = (
    key: (typeof NOTIFICATION_GROUPS)[number]['key'],
    channel: NotificationChannel,
    on: boolean,
  ) => void run(() => api.setNotificationPreference(key, channel, !on));

  return (
    <div data-wf={WF} className="flex flex-col gap-1.5">
      <div className="flex items-center px-1">
        <span className="label-mono flex-1">Benachrichtigen bei</span>
        <span className="label-mono w-[58px] text-center">Push</span>
        <span className="label-mono w-[58px] text-center">TG</span>
      </div>
      <div className="flex flex-col overflow-hidden rounded-2xl border border-linie">
        {NOTIFICATION_GROUPS.map((g) => {
          const row = settings.matrix.find((m) => m.key === g.key)!;
          return (
            <div
              key={g.key}
              className="flex min-h-[52px] items-center gap-2 border-b border-erhoeht bg-flaeche py-1 pr-1 pl-3.5"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[14px] font-medium">{g.label}</span>
                {g.hint && <span className="label-mono">{g.hint}</span>}
              </span>
              {(['push', 'telegram'] as const).map((c) => (
                <Switch
                  key={c}
                  on={row[c]}
                  label={`${g.label} per ${CHANNEL_LABEL[c]}`}
                  onToggle={() => toggle(g.key, c, row[c])}
                />
              ))}
            </div>
          );
        })}
        <div className="flex min-h-[52px] flex-wrap items-center gap-2 bg-flaeche px-3.5 py-2">
          <span id="vorlauf" className="flex-1 text-[14px] font-medium">
            Vorlauf Fristerinnerung
          </span>
          <div role="group" aria-labelledby="vorlauf" className="flex gap-1.5">
            {REMINDER_LEAD_CHOICES.map((d) => {
              const on = settings.reminder_lead_days === d;
              return (
                <button
                  key={d}
                  type="button"
                  data-wf={WF}
                  aria-pressed={on}
                  aria-label={`${d} ${d === 1 ? 'Tag' : 'Tage'} vorher`}
                  onClick={() => void run(() => api.setReminderLeadDays(d))}
                  className={cx(
                    'hit h-8 rounded-2xl border px-2.5 font-mono text-[12px]',
                    on ? 'border-geplant bg-geplant text-grund' : 'border-rand-stark text-text',
                  )}
                >
                  {d} T
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <span className="px-1 text-[12px] leading-[1.4] text-leise">
        Gilt sofort. Nachrichten kommen nur über Kanäle, die oben eingeschaltet und verbunden sind.
      </span>
    </div>
  );
}
