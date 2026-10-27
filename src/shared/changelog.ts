// Was ist neu? (16.5) – die App zeigt nach einem neuen Deploy einmal die Einträge seit der zuletzt gesehenen Version.
// Neueste Version zuerst; die Versionsnummer steht auch in package.json. Jeder Deploy mit Änderungen für die
// Nutzer*innen bekommt eine neue Version und einen Eintrag (CLAUDE.md, „Deploy“).

export interface ChangelogEntry {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  items: string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '0.10.0',
    date: '2026-10-27',
    items: [
      'Fix: Push- und Telegram-Schalter im Profil funktionieren – alle starten mit allem an',
      'Fix: Vorlauf für Fristerinnerungen lässt sich im Profil einstellen',
      'Feat: Auf die Agenda mit Wahl „Stimmt das noch?“ oder „Aktion erforderlich“',
      'Feat: Reaktionen an Kommentaren ❤️ 👍 👎 ❓ 😂 💀 🍀',
      'Feat: Bestätigung eigener Aktionen – „Du hast … – n Personen werden benachrichtigt“',
      'Feat: Agenda-Grundmenge „Nur Fragen“',
      'Fix: Im Event heißt der Link „Alle Aufgaben und Fragen zum Event“',
      'Fix: Kein „+“ im Profil',
      'Fix: Leitfaden Polizei/Ordnungsamt ist eine Leitlinie',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-10-26',
    items: [
      'Feat: Agenda, Termine und Events mit Reitern – Aktuell/Abgeschlossen bzw. Kommend/Vergangen; Events nach Monat',
      'Feat: Aufgabe gleich mit Beschreibung und Zuordnung anlegen, auch „Alle“',
      'Fix: „In Arbeit“ trägt niemanden mehr von selbst ein',
      'Feat: Im Event bestehende Aufgabe verknüpfen oder neue anlegen, Entscheidung/Fakt direkt in der Leiste',
      'Feat: Kommentare und Verlauf in zwei Reitern in allen Detailansichten',
      'Feat: Alles lässt sich löschen (archivieren) – immer mit Rückfrage und kurz danach mit Rückgängig',
      'Fix: Link zum Call geht auch später; „Zum Call“ als Knopf',
      'Fix: Entscheidungen und Fakten höchstens 200 Zeichen',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-10-26',
    items: [
      'Feat: Agenda statt „Aufgaben“ – Aufgaben und offene Fragen an einem Ort',
      'Feat: Plenum-Ergebnis sammelt alles, was während des Plenums angelegt oder geändert wurde',
      'Feat: Ein „+“ für alles – Aufgabe, Frage, Entscheidung, Fakt, Veranstaltung, Termin, Dokument, Partner',
      'Feat: Kommentare und Verlauf an allen Einträgen, mit vorher → nachher',
      'Feat: Entscheidungen gelten erst, wenn alle bestätigen oder bis zur Frist niemand widerspricht',
      'Feat: Termine in Google Kalender eintragen oder als .ics herunterladen',
      'Feat: Rückmeldung aus der App – Bug oder Wunsch direkt im Profil melden',
    ],
  },
];

/** Format eines Eintrags: „Feat: …“ für Neues, „Fix: …“ für Korrekturen und Anpassungen */
export const CHANGELOG_ITEM = /^(Feat|Fix): \S/;

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
