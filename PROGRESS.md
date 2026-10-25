# Myzel – Fortschritt

Geführt vom Agenten. Quelle der Anforderungen: docs/ANFORDERUNGEN.md (Abschnitt 16 „Umbau 10/2026“). Der ältere
Verlauf (P1 bis P5, live seit 25.10.2026) steht in der Git-Historie (PROGRESS.md vor Commit 3f5355c).

## Status

**Aktuell: Umbau 10/2026, Phase 2.** Ab Phase 2 arbeitet der Agent die Phasen ohne Zwischen-Feedback ab, mit
eigenem Review und Tests nach jeder Phase (Nutzerin, 25.10.2026). Phasen mit Migrationen bleiben lokal, bis die
Nutzerin den Deploy freigibt. Plan mit der Nutzerin abgestimmt am 25.10.2026. Jede Phase endet mit
`npm run check`, Durchsicht der Nutzerin und Deploy.

- [x] **Phase 0 – Ordnung und Messung:** PROGRESS.md neu, ANFORDERUNGEN.md Abschnitt 16, `Server-Timing` je Anfrage;
      Messung live je Hauptansicht (Werte unten unter _Messungen_)
- [x] **Phase 1 – Ladezeit:**
  - [x] Login lokal am Token prüfen (5119511)
  - [x] bis zu vier DB-Verbindungen, Lese-Abfragen gleichzeitig (dbb20e0); Verbindungen 5 Min. offen, nach Ruhe
        geprüft (a609982)
  - [x] Browser-Zwischenspeicher, gleiche Anfragen zusammengelegt (d595158)
  - [x] Sofort anzeigen: Status, Folgen, Personen an der Aufgabe (06115ba)
  - [x] Weniger Rundreisen: Statuswechsel, Benachrichtigungen, Rückgängig (ec83b60)
  - [x] Lese-Aktionen ab Phase 3 ohne Transaktion, parallel (8f85630)
  - [ ] Wirkung live messen (seit 20:45 keine Zugriffe im Log)
  - [ ] Sofort anzeigen für Kommentare – kommt mit den Kommentaren für alle Artefakte (Phase 4)
  - [-] Lese-Bündel je Ansicht: zurückgestellt – ohne Messung unklar, ob eine Function mit vier Verbindungen
    schneller ist als parallele Aufrufe; erst nach Messung entscheiden
  - [-] Function-Region EU: im Free-Tarif nicht möglich (Nutzerin, 25.10.2026), bleibt us-east-2
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

Live am 25.10.2026 (Deploy defc1e1), typische Werte je Anfrage aus dem Netlify-Log. Function läuft in us-east-2
(Ohio, Free-Tarif), Datenbank in eu-west-1 (Irland): **jede Abfrage kostet rund 87 ms**, und sie laufen nacheinander.

| Aktion           | Gesamt  | Login      | Aktion  | DB      | Abfragen |
| ---------------- | ------- | ---------- | ------- | ------- | -------- |
| getSession       | 430 ms  | 340 ms     | 90 ms   | 87 ms   | 1        |
| listMembers      | 520 ms  | 340 ms     | 180 ms  | 175 ms  | 2        |
| listTopics       | 590 ms  | 330 ms     | 265 ms  | 265 ms  | 3        |
| listLinkedDocs   | 680 ms  | 330 ms     | 350 ms  | 350 ms  | 4        |
| listEvents       | 780 ms  | 340 ms     | 435 ms  | 435 ms  | 5        |
| listTasks        | 950 ms  | 335 ms     | 620 ms  | 620 ms  | 7        |
| listAppointments | 1050 ms | 340 ms     | 700 ms  | 700 ms  | 8        |
| getTask          | 1230 ms | 345 ms     | 880 ms  | 875 ms  | 10       |
| setTaskStatus    | 1900 ms | 130–310 ms | 1700 ms | 1700 ms | 19–20    |

- Kaltstart: zusätzlich rund 600 ms für den Verbindungsaufbau (Aktion ≫ DB, z. B. listTopics 845 ms bei 267 ms DB).
- Login-Prüfung (`auth.getUser`) kostet je Anfrage 130–520 ms, meist rund 340 ms.
- Eine Ansicht lädt 4–6 Aktionen parallel; nach jeder Änderung laden alle offenen Ansichten neu (setTaskStatus +
  listTasks + getTask + Nachschlagedaten ≈ 3 s, bis die Oberfläche wieder ruhig ist).
- Größter Hebel: Function näher an die Datenbank (EU) – dann wenige ms je Abfrage. Danach: Login lokal prüfen.

Nach Login lokal (5119511) und vier Verbindungen (dbb20e0), live 25.10.2026 ab 20:29:

| Aktion      | vorher  | warm nachher | Bemerkung                                     |
| ----------- | ------- | ------------ | --------------------------------------------- |
| Login       | 340 ms  | 1 ms         | außer getSession (fragt weiter Supabase)      |
| listTasks   | 950 ms  | 353 ms       | 7 Abfragen gleichzeitig statt nacheinander    |
| listTopics  | 590 ms  | 176 ms       |                                               |
| listEvents  | 780 ms  | 265 ms       |                                               |
| getTask     | 1230 ms | 910 ms       | Abfragen hängen voneinander ab (nacheinander) |
| getDecision | –       | 865 ms       | 10 Abfragen nacheinander                      |

- Neu sichtbar: viele Anfragen 1,2–1,3 s bei 0,2–0,4 s DB-Zeit – Neuaufbau der Verbindungen (600–900 ms), weil
  `pg` ruhende Verbindungen nach 10 s schloss. Behoben in a609982 (5 Minuten offen, Prüfung nach Ruhe); noch zu
  messen.
- Offen in Phase 1: Detail-Lesungen (getTask, getDecision, getAppointment, getEventDetail) mit abhängigen Abfragen
  zusammenziehen; Schreibaktionen bleiben bei 10–20 Rundreisen in einer Transaktion (Region, U7).

## Offene Fragen und Annahmen

| Nr. | Datum      | Frage / Annahme                                                                                                                                                         | Stand   |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| U1  | 25.10.2026 | Markierungen außer an Entscheidungen/Fakten werden beim Umbau ohne Ersatz gelöscht (sie haben keine Historie).                                                          | Annahme |
| U2  | 25.10.2026 | Fakten brauchen keine Bestätigung, nur Entscheidungen; bestehende Entscheidungen bleiben „gültig“.                                                                      | Annahme |
| U3  | 25.10.2026 | Text von Fakten/Entscheidungen max. 300 Zeichen; längere Bestandstexte bleiben, beim Bearbeiten muss gekürzt werden.                                                    | Annahme |
| U4  | 25.10.2026 | Plenum ohne Ende: Zeitraum Beginn + 3 Stunden, längstens bis zum Abschließen.                                                                                           | Annahme |
| U5  | 25.10.2026 | Rückfrage „Gehört das zum Plenum?“ nur bei Schreibaktionen an Artefakten (nicht Profil, Benachrichtigungen, Zusagen).                                                   | Annahme |
| U6  | 25.10.2026 | Entscheidungen: Titel/Text-Korrektur im Detail erlaubt, Inhaltliches weiter über „Ersetzen“.                                                                            | Annahme |
| U7  | 25.10.2026 | Function-Region EU (Frankfurt): im Free-Tarif nicht möglich (Nutzerin, 25.10.2026); bleibt us-east-2.                                                                   | geklärt |
| U8  | 25.10.2026 | Login wird außer bei getSession lokal am Token geprüft: ein abgemeldetes Token gilt bis zu seinem Ablauf (1 h); Deaktivierte scheitern weiter an der Mitgliederprüfung. | Annahme |

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
