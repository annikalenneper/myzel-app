// Version der App und „Was ist neu?“ (16.5): nach einem neuen Deploy einmal die Änderungen seit dem letzten Besuch.
// Welche Version zuletzt gesehen wurde, merkt sich der Browser – fehlt der Speicher, erscheint der Hinweis eben wieder.
import { useState } from 'react';
import { CHANGELOG, compareVersions, unseenChanges, type ChangelogEntry } from '../shared/changelog';
import { formatDayMonth } from '../shared/format';
import { LightButton } from '../ui/bits';
import { Sheet } from '../ui/Sheet';

export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.0.0';
/** Kurz-Hash des Deploys (Netlify COMMIT_REF), lokal „lokal“ */
export const APP_COMMIT: string = import.meta.env.VITE_APP_COMMIT ?? 'lokal';

const SEEN_KEY = 'myzel:version-gesehen';

function readSeen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, APP_VERSION);
  } catch {
    // ohne Speicher erscheint der Hinweis beim nächsten Start wieder – kein Schaden
  }
}

const dateText = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return `${formatDayMonth(new Date(y, m - 1, d))}${y}`;
};

/** WF-PRO-06: Liste der Änderungen je Version */
export function ChangelogSheet({
  entries,
  onClose,
}: {
  entries: readonly ChangelogEntry[];
  onClose: () => void;
}) {
  return (
    <Sheet title="Was ist neu?" onClose={onClose} wf="WF-PRO-06" closeButton>
      <div className="flex flex-col gap-4">
        {entries.map((e) => (
          <section key={e.version} className="flex flex-col gap-2" aria-label={`Version ${e.version}`}>
            <span className="label-mono">
              Version {e.version} · {dateText(e.date)}
            </span>
            <ul className="m-0 flex flex-col gap-1.5 pl-5 text-[15px] leading-normal text-weich">
              {e.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <LightButton type="button" data-wf="WF-PRO-06" onClick={onClose}>
          Alles klar
        </LightButton>
      </div>
    </Sheet>
  );
}

/** Nach einem neuen Deploy einmal: was seit dem letzten Besuch dazugekommen ist */
export function ChangelogNotice() {
  const [entries, setEntries] = useState(() => unseenChanges(readSeen(), APP_VERSION));
  if (entries.length === 0) return null;
  return (
    <ChangelogSheet
      entries={entries}
      onClose={() => {
        markSeen();
        setEntries([]);
      }}
    />
  );
}

/** Alle Einträge bis zur laufenden Version – „Was ist neu?“ im Profil */
export const allChanges = () => CHANGELOG.filter((e) => compareVersions(e.version, APP_VERSION) <= 0);
