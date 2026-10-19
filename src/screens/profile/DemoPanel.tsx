// Nur in der Vorschau mit Testdaten (Schritt A): Werkzeuge, um Konflikt, Netzfehler und die
// Erinnerungen auszuprobieren. Kein Teil des Produkts – entfällt mit der Anbindung in Schritt C.
import { Link } from 'react-router-dom';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { DemoTools } from '../../data/api';
import { formatHistoryTime } from '../../shared/format';
import { telegramButtons } from '../../shared/rules/telegram';

export function DemoPanel({ demo, notify }: { demo: DemoTools; notify: (text: string) => void }) {
  const { data: tasks } = useData('tasks', () => api.listTasks());
  const { data: messages, reload } = useData('demo-messages', () => demo.myMessages());
  const target = tasks?.find((t) => t.title.startsWith('Getränke')) ?? tasks?.[0];
  const outage = demo.outage();

  const rows: [label: string, hint: string, action: () => void][] = [
    [
      'Netzfehler beim nächsten Speichern',
      'Danach irgendetwas ändern: Die Meldung mit „Nochmal“ erscheint.',
      () => {
        demo.failNextWrites(1);
        notify('Das nächste Speichern schlägt fehl');
      },
    ],
    [
      'Fremde Änderung simulieren',
      target
        ? `Lea ändert „${target.title}“. Danach dort etwas ändern: Der Konflikt-Dialog erscheint.`
        : 'Keine Aufgabe vorhanden.',
      () => {
        if (target)
          void demo.simulateForeignEdit(target.id).then(() => notify('Fremde Änderung eingespielt'));
      },
    ],
    [
      'Joblauf jetzt ausführen',
      'Sonst alle 15 Minuten: verschickt wartende Nachrichten und ab 9 Uhr die Fristerinnerungen.',
      () => void demo.runJobNow().then(() => (reload(), notify('Joblauf ausgeführt'))),
    ],
    [
      outage ? 'Ausfall der Jobläufe beenden' : 'Ausfall der Jobläufe zeigen',
      'Ohne Lauf seit über 2 Stunden warnt der Systemstatus in der Verwaltung.',
      () =>
        void demo
          .setOutage(!outage)
          .then(() => notify(outage ? 'Jobläufe laufen wieder' : 'Seit über 2 Stunden kein Lauf')),
    ],
    [
      'Datei im Drive anlegen',
      'Jemand legt im Ordner des Winterraves eine Datei an. Sie erscheint nach dem nächsten Abgleich – spätestens nach einer Minute.',
      () => void demo.driveAddFile().then((name) => notify(`Im Drive angelegt: ${name}`)),
    ],
    [
      'Verknüpfte Datei im Drive löschen',
      'Nach dem nächsten Abgleich steht beim Dokument „In Drive nicht mehr vorhanden“.',
      () =>
        void demo
          .driveTrashLinkedFile()
          .then((name) =>
            notify(name ? `Im Drive gelöscht: ${name}` : 'Keine verknüpfte Datei mehr im Drive'),
          ),
    ],
    [
      'Nächtlichen Export herunterladen',
      'So sähe der YAML-Export für das private Repo aus – ohne E-Mails, Telefonnummern, Chat-IDs und Push-Daten.',
      () =>
        void demo.exportYaml().then((yaml) => {
          const url = URL.createObjectURL(new Blob([yaml], { type: 'text/yaml' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = 'myzel-export.yaml';
          a.click();
          URL.revokeObjectURL(url);
          notify('Export heruntergeladen');
        }),
    ],
    [
      'Testdaten zurücksetzen',
      'Stellt den Ausgangsstand wieder her.',
      () => void demo.reset().then(() => notify('Testdaten zurückgesetzt')),
    ],
  ];

  return (
    <div className="flex flex-col gap-1.5" data-demo="werkzeuge">
      <span className="label-mono px-1">Vorschau mit Testdaten</span>
      {/* ersetzt Handy und Telegram: Antippen öffnet direkt die Zielansicht (WF-ALL-04) */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-dashed border-rand-stark">
        <span className="border-b border-erhoeht px-3.5 py-2 text-[12px] leading-[1.4] text-leise">
          Nachrichten an dich – so kämen sie per Push oder Telegram an. Antippen öffnet die Aufgabe; die
          Buttons unter Telegram-Nachrichten wirken wie im Chat.
        </span>
        {(messages ?? []).map((m) => {
          // [P6] Telegram-Nachrichten tragen Buttons (6.4); Links öffnen die App, Aktionen speichern sofort
          const buttons = m.channel === 'telegram' ? telegramButtons(m.event_type) : [];
          return (
            <div key={m.id} className="flex flex-col border-b border-erhoeht last:border-b-0">
              <Link
                to={m.link}
                data-wf="WF-ALL-04"
                className="flex min-h-[58px] flex-col justify-center gap-0.5 px-3.5 py-2 text-text no-underline"
              >
                <span className="text-[14px] leading-[1.4]">{m.text}</span>
                <span className="font-mono text-[11px] text-leise uppercase">
                  {m.channel} · {formatHistoryTime(m.created_at)} · {m.status}
                </span>
              </Link>
              {buttons.length > 0 && (
                <div
                  role="group"
                  aria-label="Telegram-Buttons"
                  className="flex flex-wrap gap-1.5 px-3.5 pb-2.5"
                >
                  {buttons.map((b) =>
                    b.kind === 'link' ? (
                      <Link
                        key={b.key}
                        to={m.link}
                        className="hit flex h-9 items-center rounded-lg border border-blau/50 px-3 text-[13px] text-text no-underline"
                      >
                        {b.label} ↗
                      </Link>
                    ) : (
                      <button
                        key={b.key}
                        type="button"
                        onClick={() =>
                          void demo.telegramPress(m.id, b.key).then((reply) => (reload(), notify(reply.text)))
                        }
                        className="hit h-9 rounded-lg border border-blau/50 px-3 text-[13px] text-text"
                      >
                        {b.label}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
        {messages?.length === 0 && (
          <span className="px-3.5 py-3 text-[13px] leading-[1.4] text-leise">
            Noch keine. Schalte Push ein oder verknüpfe Telegram und lass dir von einem anderen Testkonto
            etwas zuweisen.
          </span>
        )}
      </div>
      <div className="flex flex-col overflow-hidden rounded-2xl border border-dashed border-rand-stark">
        {rows.map(([label, hint, action]) => (
          <button
            key={label}
            type="button"
            onClick={action}
            className="flex min-h-[58px] flex-col justify-center gap-0.5 border-b border-erhoeht px-3.5 py-2 text-left last:border-b-0"
          >
            <span className="text-[14px] text-text">{label}</span>
            <span className="text-[12px] leading-[1.4] text-leise">{hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
