// S-50 Profil, Phase 2: Push auf diesem Gerät (WF-PRO-02) und Telegram verknüpfen (WF-PRO-03)
import { useFeedback } from '../../app/feedback';
import { useData } from '../../app/useData';
import { api } from '../../data';
import { cx, LoadError } from '../../ui/bits';

type PushSupport = 'ok' | 'ios_ohne_homescreen' | 'nicht_moeglich';

/** Auf dem iPhone gibt es Push nur für Apps auf dem Home-Bildschirm (ab iOS 16.4). */
function pushSupport(): PushSupport {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return 'ios_ohne_homescreen';
  return 'serviceWorker' in navigator && 'PushManager' in window ? 'ok' : 'nicht_moeglich';
}

// Bilder zur iPhone-Anleitung (6.3): das Teilen-Symbol und „Zum Home-Bildschirm“
const iosIcon = 'size-7 flex-none rounded-md border border-[#3A3F70] p-1 text-text';
const IosShare = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={iosIcon}
  >
    <path d="M12 15V4M8 7.5L12 3.5l4 4M6 11v8h12v-8" />
  </svg>
);
const IosAdd = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={iosIcon}
  >
    <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" />
    <path d="M12 8.5v7M8.5 12h7" />
  </svg>
);

const dot = (on: boolean, waiting = false) => (on ? 'bg-gruen' : waiting ? 'bg-bernstein' : 'bg-rand-stark');

export function Reachability() {
  const { run } = useFeedback();
  const {
    data: settings,
    error,
    reload,
  } = useData('notification-settings', () => api.getNotificationSettings());
  const support = pushSupport();
  const push = settings?.push ?? false;
  const telegram = settings?.telegram ?? 'aus';
  const demo = api.demo;

  const togglePush = () => {
    if (!settings || (support !== 'ok' && !push)) return;
    void run(() => api.setPush(!push), {
      success: push ? 'Push auf diesem Gerät ist aus' : 'Push auf diesem Gerät ist an',
    });
  };

  const toggleTelegram = () => {
    if (!settings) return;
    if (telegram === 'aus') void run(() => api.startTelegramLink());
    else
      void run(() => api.unlinkTelegram(), {
        success: telegram === 'verbunden' ? 'Telegram getrennt' : 'Verknüpfung abgebrochen',
      });
  };

  const tile =
    'flex min-h-[72px] flex-col items-start gap-2 rounded-[14px] border border-linie bg-flaeche px-3.5 py-3 text-left text-text';

  // ohne Stand lässt sich nichts schalten: dann sagen, warum, statt dauerhaft „Lädt …“
  if (error && !settings) return <LoadError message={error.message} onRetry={reload} />;

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          data-wf="WF-PRO-02"
          onClick={togglePush}
          aria-pressed={push}
          aria-busy={!settings}
          aria-disabled={!settings || (support !== 'ok' && !push)}
          className={cx(tile, support !== 'ok' && !push && 'cursor-default')}
        >
          <span className="label-mono">Push · dieses Gerät</span>
          <span className="flex items-center gap-2 text-[14px] leading-[1.3] font-semibold">
            <span className={cx('size-2 flex-none rounded-full', dot(push))} />
            {/* solange der Stand lädt, wirkt ein Tipp nicht – dann auch nichts anbieten */}
            {!settings ? 'Lädt …' : push ? 'Aktiv' : support === 'ok' ? 'Aus · Einschalten' : 'Aus'}
          </span>
        </button>
        <button
          type="button"
          data-wf="WF-PRO-03"
          onClick={toggleTelegram}
          aria-pressed={telegram === 'verbunden'}
          aria-busy={!settings}
          aria-disabled={!settings}
          className={tile}
        >
          <span className="label-mono">Telegram</span>
          <span className="flex items-center gap-2 text-[14px] leading-[1.3] font-semibold">
            <span
              className={cx(
                'size-2 flex-none rounded-full',
                dot(telegram === 'verbunden', telegram === 'wartet'),
              )}
            />
            {!settings
              ? 'Lädt …'
              : telegram === 'verbunden'
                ? 'Verbunden · Trennen'
                : telegram === 'wartet'
                  ? 'Warte auf Start\u00a0…'
                  : 'Verknüpfen'}
          </span>
        </button>
      </div>

      {telegram === 'wartet' && settings?.telegram_url && (
        <div
          data-wf="WF-PRO-03"
          className="flex flex-col gap-2.5 rounded-[14px] border border-rand-stark bg-flaeche p-3.5"
        >
          <span className="text-[14px] leading-normal text-weich">
            Öffne den Myzel-Bot und tippe auf „Start“. Der Link gilt 15 Minuten und nur einmal.
          </span>
          <a
            href={settings.telegram_url}
            target="_blank"
            rel="noreferrer"
            data-wf="WF-PRO-03"
            className="flex h-11 items-center justify-center rounded-[22px] bg-blau text-[15px] font-semibold text-grund no-underline"
          >
            Telegram öffnen
          </a>
          {demo && (
            <button
              type="button"
              data-demo="telegram-start"
              onClick={() =>
                void run(() => demo.completeTelegramLink(), { success: 'Telegram ist verbunden' })
              }
              className="hit h-9 text-[13px] text-leise"
            >
              Testdaten: „Start“ im Bot antippen
            </button>
          )}
        </div>
      )}

      {/* Erklärung vor der Aktivierung (6.3); auf dem iPhone mit Anleitung */}
      {!push && (
        <div
          data-wf="WF-PRO-02"
          className="rounded-[14px] border border-[#3A3F70] bg-[#1A1830] px-3.5 py-3 text-[13px] leading-normal text-weich"
        >
          {support === 'ios_ohne_homescreen' ? (
            <>
              Auf dem iPhone kommt Push nur, wenn Myzel auf dem Home-Bildschirm liegt:
              <ol className="my-2 flex flex-col gap-1.5">
                <li className="flex items-center gap-2.5">
                  <IosShare /> 1. unten auf „Teilen“ tippen
                </li>
                <li className="flex items-center gap-2.5">
                  <IosAdd /> 2. „Zum Home-Bildschirm“ wählen
                </li>
                <li className="flex items-center gap-2.5">
                  <img src="/icon-192.png" alt="" className="size-7 flex-none rounded-md" /> 3. Myzel von dort
                  öffnen und Push hier einschalten
                </li>
              </ol>
              Sonst erreicht dich Myzel über Telegram.
            </>
          ) : support === 'nicht_moeglich' ? (
            'Dieser Browser kann keine Push-Nachrichten empfangen. Myzel erreicht dich über Telegram.'
          ) : (
            'Mit Push meldet sich Myzel auf diesem Gerät, wenn dir etwas zugewiesen wird, jemand kommentiert oder eine Frist naht. Dein Browser fragt beim Einschalten einmal nach der Erlaubnis.'
          )}
        </div>
      )}
    </>
  );
}
