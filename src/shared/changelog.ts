// Was ist neu? (16.5) – die App zeigt nach einem neuen Deploy einmal die Einträge seit der zuletzt gesehenen Version.
// Neueste Version zuerst; die Versionsnummer steht auch in package.json.

export interface ChangelogEntry {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  items: string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '0.8.0',
    date: '2026-10-29',
    items: [
      'Agenda statt „Aufgaben“: Aufgaben und offene Fragen an einem Ort, Filter nach Art und Veranstaltung.',
      'Plenum: Das Ergebnis sammelt alles, was während des Plenums angelegt oder geändert wurde.',
      'Ein „+“ für alles – Aufgabe, Frage, Entscheidung, Fakt, Veranstaltung, Termin, Dokument, Partner.',
      'Kommentare und Verlauf an allen Einträgen, mit vorher → nachher.',
      'Entscheidungen gelten erst, wenn alle bestätigen oder bis zur Frist niemand widerspricht.',
      'Termine in Google Kalender eintragen oder als .ics herunterladen.',
      'Rückmeldung aus der App: Bug oder Wunsch direkt im Profil melden.',
    ],
  },
];

/** „0.10.0“ > „0.9.1“: Versionen Teil für Teil als Zahlen vergleichen */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Einträge, die seit der zuletzt gesehenen Version dazugekommen sind, bis zur laufenden Version. Wer die App in diesem
 * Browser noch nie geöffnet hat (seen = null), sieht den Eintrag der laufenden Version.
 */
export function unseenChanges(
  seen: string | null,
  current: string,
  log: readonly ChangelogEntry[] = CHANGELOG,
): ChangelogEntry[] {
  if (seen === current) return [];
  return log.filter(
    (e) =>
      compareVersions(e.version, current) <= 0 &&
      (seen === null ? compareVersions(e.version, current) === 0 : compareVersions(e.version, seen) > 0),
  );
}
