# Myzel – Fortschritt

Geführt vom Agenten. Quelle der Anforderungen: docs/ANFORDERUNGEN.md (Abschnitt 16 „Umbau 10/2026“). Der ältere
Verlauf (P1 bis P5, live seit 25.10.2026) steht in der Git-Historie (PROGRESS.md vor Commit 3f5355c).

## Status

**Aktuell: Umbau 10/2026, Phase 0.** Plan mit der Nutzerin abgestimmt am 25.10.2026. Jede Phase endet mit
`npm run check`, Durchsicht der Nutzerin und Deploy.

- [ ] **Phase 0 – Ordnung und Messung:** PROGRESS.md neu, ANFORDERUNGEN.md Abschnitt 16, `Server-Timing` je Anfrage;
      Messung live je Hauptansicht (Werte unten unter _Messungen_)
- [ ] **Phase 1 – Ladezeit:** Login lokal prüfen (JWT/JWKS), Function-Region EU prüfen, teure Lese-Aktionen
      zusammenziehen, Lese-Bündel je Ansicht, Browser-Cache mit gezieltem Neuladen
- [ ] **Phase 2 – Agenda als Hauptansicht:** „Aufgaben“ → „Agenda“ mit Aufgaben und offenen Fragen; Wissen mit Reitern
      Entscheidungen · Fakten · Dokumente · Drive; Markierungen nur noch für Entscheidungen/Fakten („Stimmt das noch?“);
      Link „Aufgaben und offene Fragen zu diesem Event“
- [ ] **Phase 3 – Plenum:** Detail nur noch Ergebnis und Protokoll; Zuordnung von Änderungen zum laufenden Plenum
      (Rückfrage für Personen ohne Zusage); Ergebnis je Artefakt eine Zeile; Frage mit mehreren Ergebnissen, „wieder
      öffnen“; Telegram-Zusammenfassung formatiert; Anwesenheit nach Abschluss nur nach Rückfrage, mit Historie
- [ ] **Phase 4 – Grundfunktionen:** Titel und Beschreibung überall bearbeitbar (Historie alt → neu), Kommentare und
      Historie für alle Artefakte, Event-Bezug für alle, Fakten/Entscheidungen mit Text auf der Karte (max. 300 Zeichen)
- [ ] **Phase 5 – Globaler „+“-Knopf:** jede Art aus jeder Ansicht anlegen, mit Vorbelegung aus dem Kontext
- [ ] **Phase 6 – Entscheidungen im Konsens:** Frist (Standard 7 Tage, wählbar), Bestätigen/Widersprechen, Joblauf
- [ ] **Phase 7 – Google Kalender:** Link „In Google Kalender eintragen“ und .ics-Download je Termin
- [ ] **Phase 8 – App-Report und Versions-Info:** Bug/Feature-Wunsch melden, Admin-Liste; Version, Changelog,
      Hinweis auf neue Version

## Messungen

| Datum | Ansicht / Aktion | Gesamt | Login | Aktor | Aktion | Abfragen | Bemerkung |
| ----- | ---------------- | ------ | ----- | ----- | ------ | -------- | --------- |

## Offene Fragen und Annahmen

| Nr. | Datum      | Frage / Annahme                                                                                                       | Stand   |
| --- | ---------- | --------------------------------------------------------------------------------------------------------------------- | ------- |
| U1  | 25.10.2026 | Markierungen außer an Entscheidungen/Fakten werden beim Umbau ohne Ersatz gelöscht (sie haben keine Historie).        | Annahme |
| U2  | 25.10.2026 | Fakten brauchen keine Bestätigung, nur Entscheidungen; bestehende Entscheidungen bleiben „gültig“.                    | Annahme |
| U3  | 25.10.2026 | Text von Fakten/Entscheidungen max. 300 Zeichen; längere Bestandstexte bleiben, beim Bearbeiten muss gekürzt werden.  | Annahme |
| U4  | 25.10.2026 | Plenum ohne Ende: Zeitraum Beginn + 3 Stunden, längstens bis zum Abschließen.                                         | Annahme |
| U5  | 25.10.2026 | Rückfrage „Gehört das zum Plenum?“ nur bei Schreibaktionen an Artefakten (nicht Profil, Benachrichtigungen, Zusagen). | Annahme |
| U6  | 25.10.2026 | Entscheidungen: Titel/Text-Korrektur im Detail erlaubt, Inhaltliches weiter über „Ersetzen“.                          | Annahme |

## Entscheidungsprotokoll

| Datum      | Entscheidung                                                                                                                                                                                                                         | Begründung                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 25.10.2026 | Ladezeit: erst messen, dann gezielte Fixes am Server-Weg und Browser-Cache; kein Read-Model in Postgres, kein direktes Lesen aus Supabase.                                                                                           | Nutzerin; kleinster Umbau, Testdaten-Schicht bleibt gleich. |
| 25.10.2026 | Entscheidungen im Konsens: Frist Standard 7 Tage, frei wählbar; gültig, wenn alle bestätigt haben oder die Frist ohne Widerspruch abläuft (nicht abgegebene Stimmen verfallen); Widerspruch → bleibt offen und kommt auf die Agenda. | Nutzerin.                                                   |
| 25.10.2026 | Teilnehmerliste während des Plenums = Zusage „ja“ oder als anwesend abgehakt; Zeitraum Beginn bis Ende. Anwesenheit nach Abschluss nur nach Rückfrage; Zu-/Absagen und Anwesenheitsänderungen in die Historie.                       | Nutzerin.                                                   |
| 25.10.2026 | App-Report in eigener Tabelle, Liste für Admins im Profil.                                                                                                                                                                           | Nutzerin.                                                   |

## Abnahmen

| Phase | Datum | Testergebnis | Bestätigung |
| ----- | ----- | ------------ | ----------- |
