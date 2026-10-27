# Myzel – Fortschritt

Geführt vom Agenten. Quelle der Anforderungen: docs/ANFORDERUNGEN.md (Abschnitt 16 „Umbau 10/2026“). Der ältere
Verlauf (P1 bis P5, live seit 25.10.2026) steht in der Git-Historie (PROGRESS.md vor Commit 3f5355c).

## Status

**Aktuell: Umbau 10/2026 und Verbesserungen (Phasen 9–10) live seit 26.10.2026 – Version 0.9.0, Deploy db55b12, Integritätsprüfung ohne Befund.** Ab Phase 2 arbeitet der Agent die Phasen ohne Zwischen-Feedback ab, mit
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
- [x] **Phase 2 – Agenda als Hauptansicht** (Migration 20261026000001):
  - [x] „Aufgaben“ → „Agenda“ (`/agenda`, Details `/agenda/:id`, `/agenda/frage/:id`, `/agenda/eintrag/:id`); alte
        Adressen `/aufgaben/…` und `/wissen/fragen/…` leiten um, Telegram-Buttons verstehen beide
  - [x] Agenda zeigt „Stimmt das noch?“ (aufgesetzte Entscheidungen/Fakten), Aufgaben, offene Fragen; Filter Art
        (Alles · Aufgaben · Fragen), Grundmenge, Thema, Status, Veranstaltung, Abgeschlossene; „+ Frage“
  - [x] Wissen: Reiter Entscheidungen · Fakten · Dokumente · Drive
  - [x] Markierungen nur noch an Entscheidungen/Fakten („Auf die Agenda“, „Stimmt noch“); alle anderen samt Filter
        „Fürs Plenum“ entfernt; Plenum-Agenda und ihre Aktionen entfernt (vorgezogen aus Phase 3)
  - [x] „Aufgaben und offene Fragen zu diesem Event“ an Aufgabe, Frage und Veranstaltung
  - [x] Nebenbei: Der Server sagt in jeder Antwort, ob sich Daten geändert haben (`changed`) – die doppelten
        Aktionslisten in `remoteApi.ts` sind weg (eine fehlte schon für `setDecisionAgenda`, nur der Smoke-Test fand
        es); restliche Lese-Aktionen (Benachrichtigungen, Systemstatus, Mitglieder-Adressen, Deaktivieren) ohne
        Transaktion
- [x] **Phase 3 – Plenum** (Migration 20261026000002):
  - [x] Plenum-Detail nur noch Ergebnis und Protokoll (Agenda schon in Phase 2 entfernt)
  - [x] Laufendes Plenum: Beginn bis Ende, ohne Ende + 3 h, bis zum Abschließen. Die Sitzung kennt es samt
        Teilnahme; der Server ermittelt es in derselben Abfrage wie die handelnde Person (keine Extra-Rundreise)
  - [x] Teilnehmerliste (Zusage „ja“ oder anwesend): Änderungen zählen automatisch; alle anderen fragt die App
        einmal je Plenum „Gehört das zum Plenum?“ (WF-PLE-21; nicht im Profil, nicht bei Zusagen und Plenum-eigenen
        Aktionen); Antwort per Kopfzeile `x-myzel-plenum`, Historie bekommt `plenum_id`
  - [x] Ergebnis je Artefakt eine Zeile mit Link: Änderungen im Plenum, Quelle/Herkunft/Antwort in diesem Plenum;
        eine Frage nur einmal, ihre Ergebnisse unter „Entscheidungen & Fakten“ mit „aus der Frage …“; im Plenum
        angelegte Aufgaben haben es als Herkunft
  - [x] Frage mit mehreren Ergebnissen (`decisions.source_question_id`), bleibt offen; „Als beantwortet markieren“
        (Antwort optional mit Ergebnissen), „Wieder öffnen“ (WF-FRA-04), „Ergebnis festhalten“ (WF-FRA-05)
  - [x] Telegram als HTML: fette Überschriften, Aufzählung, Link „In Myzel öffnen“; Zusammenfassung mehrzeilig
  - [x] Anwesenheit nach dem Abschluss nur nach Rückfrage; Historie mit Kennzeichen `after_close`
  - [x] Review Phase 2 (Subagent): kein hoher Befund; M1 (Agenda hängt, wenn Fragen nicht laden), N1, N3, N4, N5,
        N6 behoben; N2 durch Phase 3 erledigt
- [x] **Phase 4 – Grundfunktionen** (Migration 20261027000001):
  - [x] Kommentare an Aufgabe, Frage, Entscheidung/Fakt, Veranstaltung, Termin, Partner (WF-ALL-07); nur eigene
        bearbeitbar, alt → neu im Verlauf; an Aufgaben wie bisher mit Folgen und Benachrichtigung
  - [x] Verlauf in allen Detailansichten (neu: Veranstaltung, Termin, Partner) mit lesbaren Sätzen, Felder alt → neu
  - [x] Bearbeiten: Frage (WF-FRA-06), Entscheidung/Fakt (WF-WIS-12, Korrektur – Inhaltliches über „Ersetzen“);
        Beschreibung beim Anlegen von Fragen; Termine haben eine Beschreibung
  - [x] Event-Bezug für Entscheidungen/Fakten; Veranstaltungs-Detail zeigt sie direkt, dazu „+ Frage“ und
        „+ Festhalten“ mit vorbelegter Veranstaltung
  - [x] Text von Entscheidungen/Fakten höchstens 300 Zeichen mit Zähler „x/300“, sichtbar auf den Karten
  - [x] Review Phase 3 (Subagent): kein hoher Befund; M1 (Index für das Ergebnis, Migration), M2 (Telegram- und
        Push-Längen, Antworten gekürzt), N1–N4, N6 behoben; N5 bleibt (Tab über 24 h ohne Änderung), N7/N8 → Fragen
- [x] **Phase 5 – Globaler „+“-Knopf**:
  - [x] ein „+“ im Gerüst (WF-ALL-08) statt je Ansicht: Aufgabe · Frage · Entscheidung · Fakt · Veranstaltung ·
        Termin · Dokument · Partner; in einer Veranstaltung (Desktop) mit ihr vorbelegt, im Termin für Aufgaben
  - [x] Review Phase 4 (Subagent): kein hoher Befund; M1 (Rückgängig trotz Kommentar an der neuen Fassung), M2
        (Reihenfolge im Ergebnis, Testdaten-Schicht), M3 (Plenum-Termin mit Beschreibung, Kommentaren, Verlauf), M4
        (Verlauf zeigt überall vorher → nachher, auch Kommentare und Aufgaben-Beschreibung), N1 (Artikel, Namen von
        Thema/Veranstaltung), N3–N6 behoben; N2 (Ersetzen bei archivierter Veranstaltung) erst relevant, wenn
        Veranstaltungen archivierbar werden; N7 → U15, N8 (Exportversion 3)
- [x] **Phase 6 – Entscheidungen im Konsens** (Migration 20261028000001):
  - [x] Neue Entscheidungen sind „offen“ mit Frist „Bestätigen bis“ (Standard 7 Tage, wählbar, höchstens 90 Tage);
        Fakten gelten sofort; bestehende bleiben gültig (U2). Auch beim Ersetzen bekommt die neue Fassung eine Frist
  - [x] Bestätigen/Widersprechen (WF-WIS-13) je Person eine Stimme, änderbar, mit Rückgängig; gültig, sobald alle
        aktiven Mitglieder bestätigt haben oder die Frist ohne Widerspruch abläuft. Widerspruch hält offen und setzt
        auf die Agenda („Zu besprechen“, „Widerspruch – noch nicht gültig“)
  - [x] Joblauf: offene Entscheidungen werden nach der Frist gültig, als „Myzel (automatisch)“, mit Historie; erst
        ohne Transaktion geprüft, je Eintrag eine Transaktion
  - [x] Detail: Kasten mit Frist, Stand „x von y bestätigt“, Namen (bestätigt, Widerspruch, noch nicht abgestimmt);
        Karten zeigen Stand und Frist; Filter Standard „Offen & gültig“; Verlauf „hat bestätigt/widersprochen“
  - [x] Export Version 4 (decision_votes), Integritätsprüfung: Hinweis bei überfälligen offenen Entscheidungen
  - [x] Review Phase 5 (Subagent): H1 (Verlauf ersetzte jedes „s“ durch ein Leerzeichen – fehlender Backslash, Test
        ergänzt), M1 („+“ übernimmt auch im Termin dessen Veranstaltung, Dokumente gehen an den Termin; in der auf eine
        Veranstaltung gefilterten Agenda deren Veranstaltung), M2 (Desktop-Test für die Vorbelegung, Partner wird wirklich
        angelegt), N1 (Schein des „+“ als Token) behoben; N2 (Entscheidung und Fakt teilen WF-WIS-01) bleibt so
- [x] **Phase 7 – Google Kalender**:
  - [x] Termin- und Plenum-Detail: „In Google Kalender eintragen ↗“ und „.ics herunterladen“ (WF-TER-11); Titel, Zeit in
        UTC, Ort bzw. Call-Link, Beschreibung mit Link zurück in Myzel; die .ics-UID ist je Termin fest, ein erneuter
        Import ersetzt den alten Eintrag. Nicht bei abgesagten Terminen und abgeschlossenen Plena
  - [x] Review Phase 6 (Subagent): kein hoher Befund; M1 (Rückgängig beim Ersetzen, wenn schon über die neue Fassung
        abgestimmt wurde), M2 (Rückgängig einer Stimme, nachdem andere sie gültig gemacht haben – jetzt Konflikt; nach
        dem Rückgängig gilt die Regel neu), M3 (offene Entscheidung als Nachfolgerin wählbar), M4 (Plenum-Ergebnis und
        Zusammenfassung: „gilt erst nach Bestätigung, bis …“), N1 (kein Widerspruch mehr nach abgelaufener Frist), N2
        (weniger Abfragen im Joblauf), N3 (Rückgängig einer Stimme mit alt → neu), N4 (Tests) behoben
- [x] **Rückmeldung 26.10.2026 nach dem Deploy: „Der Termin Plenum ist verschwunden“** – nichts gelöscht; das Plenum
      vom 25.10. stand nur unter „Vergangene“. Termine zeigen jetzt oben „Letztes Plenum“ mit Link aufs Ergebnis; das
      Ergebnis zeigt auch später Archiviertes (z. B. die verworfene Aufgabe „Spenden“), denn es hält fest, was im Plenum
      passiert ist
- [x] **Antworten F1–F3 (26.10.2026)** (Migration 20261030000001):
  - [x] F1: Profil und Verwaltung zählen nie zum Plenum (feste Liste der Aktionen, Server und Testdaten-Schicht)
  - [x] F2: Fragen im Ergebnis mit Antwort bzw. „daraus entstanden: …“; ihre Entscheidungen/Fakten stehen in der Zeile
        der Frage statt einzeln
  - [x] F3: Benachrichtigungen „Entscheidungen zum Bestätigen“ (neue Zeile in der Matrix): neu und letzter Tag der Frist
- [x] **Phase 8 – App-Report und Versions-Info** (Migration 20261029000001):
  - [x] Profil › „Rückmeldung zur App“ (WF-PRO-05): Bug oder Feature-Wunsch, je mit Leitfrage, langer Text mit
        Senden/Abbrechen und lokalem Entwurf; eigene Tabelle `app_reports` ohne Lese-Policy
  - [x] Review Phase 7 (Subagent): kein hoher Befund; M1 (.ics am Handy über „Teilen“, damit das System den Kalender
        anbietet; sonst Download), M2 (Beschreibung im Google-Link auf 1500 Zeichen gekürzt), N1 (Plenum zeigt die Knöpfe
        wie jeder Termin bis zur Absage), N3 (SEQUENCE = Version), N4 (Tests online/vor Ort/Emoji, Plenum) behoben;
        N2: abgesagte Termine werden nicht angeboten (U20)
  - [x] Verwaltung › „Rückmeldungen“ (WF-ADM-10): Liste für Admins, neueste zuerst, mit Name, Zeit und Version
  - [x] Version 0.8.0 aus package.json, dazu der Deploy (Netlify COMMIT_REF) unten im Profil; „Was ist neu?“
        (WF-PRO-06) nach einem neuen Deploy einmal, danach im Profil; Changelog in src/shared/changelog.ts
  - [x] Review Phase 8 (Subagent): kein hoher Befund; M1 (Rückmeldungen nicht im allgemeinen Export – nur Admins
        sehen sie), N3 (Profil lädt die Liste nicht nur für die Anzahl), N4 (angefangener Wunsch beim Öffnen wieder da),
        N5 (Rechte-Test für die neuen Tabellen) behoben; N1, N2 → U21

- [x] **Phase 9 – Verbesserungen (Nutzerin, 26.10.2026)** (ohne Migration; live mit 0.9.0):
  - [x] Termine: Kommend/Vergangen als Reiter unter den Filtern, wie bei Events
  - [x] Events: Karten wie bei Terminen – Monats-Überschriften, Datum ohne Monat auf der Karte
  - [x] Event-Detail: „Aufgaben und offene Fragen zu diesem Event“ gehört ins Event, nicht in die Aufgabe; aus der
        Aufgabe führt ein Link zum Event
  - [x] Event-Detail: „+ Aufgabe“ fragt: bestehende Aufgabe verknüpfen oder neue anlegen
  - [x] Event-Detail: Fakten und Entscheidungen auch dort anlegen, wo Aufgabe, Frage und „Aus Vorlage …“ stehen
  - [x] Event- und Entscheidungs-Detail: Kommentare und Verlauf in zwei Reitern wie bei Aufgaben – einheitlich auch in
        Frage, Termin, Plenum und Partner
  - [x] „In Arbeit“ trägt die Person nicht mehr automatisch ein
  - [x] Aufgabe anlegen: gleich mit Beschreibung und Zuordnung
  - [x] Zuordnung: Option „Alle“
  - [x] Aufgabenkarte: kein Überlauf bei vielen Zugeordneten
  - [x] Alle Artefakte löschen (archivieren), mit Rückfrage

- [x] **Phase 10 – Verbesserungen (Nutzerin, 26.10.2026):**
  - [x] Termine: „Zum Call“ als Knopf; Kalender-Aktionen als kleine Links ohne Rahmen
  - [x] Link zur Besprechung beim Anlegen nicht mehr Pflicht; fehlt er, Hinweis unter dem Knopf „Zum Call“
  - [x] Profil: Menü-Text „Rückmeldung zur App“ ohne Zusatz
  - [x] Entscheidungen/Fakten: Text höchstens 200 Zeichen (vorher 300)
  - [x] Agenda: Reiter Aktuell/Abgeschlossen statt Filter „Abgeschlossene“; Art-Filter entfällt
  - [x] Events: Status mit Farbpunkt wie bei Aufgaben – in der Status-Leiste des Details und auf der Karte
  - [x] Review Phase 9 (Subagent): kein hoher Befund; M1 (Rückgängig nach Löschen einer markierten Entscheidung setzt
        sie wieder auf die Agenda), M2 (Gelöschte Veranstaltungen, Termine und Partner lassen sich nicht mehr bearbeiten;
        Hinweis „Gelöscht“ im Detail; gelöschte Partner nicht mehr im Event), M3 (gelöschter Serientermin bleibt gelöscht,
        Testdaten-Schicht), M4 (Historie für „Alle“ in einer Abfrage), N1 (Agenda-Filter auf gelöschtes Event wird
        zurückgesetzt), N2–N5 behoben; offen: Rückgängig von „Alle“ löscht weiter eintragsweise (selten)

- [x] **Kleinigkeiten (Nutzerin, 26.10.2026):** kein „+“ im Profil und in der Verwaltung; Grundmenge der Agenda um
      „Nur Fragen“ erweitert – zeigt offene Fragen und „Stimmt das noch?“, keine Aufgaben, ohne Status-Filter
- [x] **Fix Benachrichtigungs-Einstellungen (Nutzerin, 27.10.2026):** Schalter-Matrix (Push/Telegram je Ereignis) und
      Vorlauf der Fristerinnerungen gab es nur in der Testdaten-Schicht – live kam „kommt mit einer späteren Phase“. Jetzt
      auf dem Server (Migration 20261031000001, Tabelle `notification_preferences`); der Versand beachtet die Schalter.
      Ohne Eintrag ist ein Schalter an – bestehende und neue Mitglieder starten mit allem an (Nutzerin, 27.10.2026;
      ersetzt „standardmäßig aus“ vom 22.10.2026). Die Tests der Matrix laufen jetzt auch gegen den Server
- [ ] **Phase 12 – Verbesserungen (Nutzerin, 27.10.2026):**
  - [x] Dokumente „Code of Conduct“, „Polizei/Ordnungsamt“, „Sicherheitskonzept Outdoor“: Art „Leitlinie“ statt „Sonstiges“
        (Daten-Migration 20261031000002 mit Verlauf; live betrifft das den Leitfaden Polizei/Ordnungsamt, das
        Sicherheitskonzept ist schon Leitlinie, ein Code of Conduct ist live noch nicht erfasst)
  - [x] Event: „Alle Aufgaben und Fragen zum Event ›“, pink wie „Zum Event“ in der Aufgabe
  - [x] Auf die Agenda setzen mit Wahl „Stimmt das noch?“ oder „Aktion erforderlich“; die Frage steht auf der Karte, die
        Überschrift heißt „Entscheidungen & Fakten“ (Migration 20261031000003; Widerspruch setzt „Aktion erforderlich“;
        „Aktion erforderlich“ nimmt man mit „Erledigt“ herunter)
  - [ ] Push/Telegram auch bei eigenen Aktionen, aus eigener Sicht: „Du hast … – n Personen werden benachrichtigt.“
  - [x] Reaktionen an Kommentaren: ❤️ 👍 👎 ❓ 😂 💀 🍀 (Migration 20261031000004, Export Version 5)
  - [x] Jeder Deploy: Version hochzählen, Changelog-Einträge „Feat: …“/„Fix: …“ (CLAUDE.md „Deploy“, Test prüft das
        Format)
- [ ] **Phase 11 – Archiv im Profil (geplant, F4; noch nicht umsetzen)**
  - [ ] Profil › „Archiv“: alles Gelöschte an einem Ort, gruppiert nach Art (Aufgaben, Veranstaltungen, Termine,
        Entscheidungen & Fakten, Fragen, Dokumente, Partner), zuletzt Gelöschtes zuerst, mit „gelöscht von … am …“
        (aus dem Verlauf, Eintrag „archived“); Suche nach Titel
  - [ ] Wiederherstellen je Eintrag (neue Workflow-ID, Vorschlag WF-PRO-07): eine Server-Aktion für alle Arten wie
        `archiveArtifact` – Versionsprüfung, `version` erhöhen, Verlauf „wiederhergestellt“, Rückgängig; Aufgaben
        nutzen das vorhandene `restoreTask`
  - [ ] Regeln beim Wiederherstellen prüfen: Dokument aus dem Drive, zu dem es inzwischen einen neuen Eintrag gibt
        (eindeutig je Drive-Datei) → Hinweis statt Fehler; Serientermin bleibt Ausnahme der Serie; Entscheidung kommt
        ohne Agenda-Markierung zurück; Aufgaben an gelöschten Veranstaltungen/Terminen bleiben verknüpft
  - [ ] Detailansichten Gelöschter verlinken aufs Archiv statt nur „Gelöscht – nur noch zum Nachlesen“
  - [ ] Testdaten-Schicht und Server gleich, Unit-Tests in beiden Schichten, E2E für Löschen → Archiv → Wiederherstellen
  - [ ] Offen zu entscheiden beim Start: Archiv für alle Mitglieder oder nur für Admins (Vorschlag: alle, denn alle
        dürfen löschen); endgültiges Löschen gibt es nicht (Löschen ist Archivieren)

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

| Nr. | Datum      | Frage / Annahme                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Stand   |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| U1  | 25.10.2026 | Markierungen außer an Entscheidungen/Fakten werden beim Umbau ohne Ersatz gelöscht (sie haben keine Historie).                                                                                                                                                                                                                                                                                                                                                                                                                                  | Annahme |
| U2  | 25.10.2026 | Fakten brauchen keine Bestätigung, nur Entscheidungen; bestehende Entscheidungen bleiben „gültig“.                                                                                                                                                                                                                                                                                                                                                                                                                                              | Annahme |
| U3  | 25.10.2026 | Text von Fakten/Entscheidungen max. 200 Zeichen (bis 26.10.2026: 300); längere Bestandstexte bleiben, beim Bearbeiten muss gekürzt werden.                                                                                                                                                                                                                                                                                                                                                                                                      | Annahme |
| U4  | 25.10.2026 | Plenum ohne Ende: Zeitraum Beginn + 3 Stunden, längstens bis zum Abschließen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Annahme |
| U5  | 25.10.2026 | Rückfrage „Gehört das zum Plenum?“ nur bei Schreibaktionen an Artefakten (nicht Profil, Benachrichtigungen, Zusagen).                                                                                                                                                                                                                                                                                                                                                                                                                           | Annahme |
| U6  | 25.10.2026 | Entscheidungen: Titel/Text-Korrektur im Detail erlaubt, Inhaltliches weiter über „Ersetzen“.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Annahme |
| U7  | 25.10.2026 | Function-Region EU (Frankfurt): im Free-Tarif nicht möglich (Nutzerin, 25.10.2026); bleibt us-east-2.                                                                                                                                                                                                                                                                                                                                                                                                                                           | geklärt |
| U8  | 25.10.2026 | Login wird außer bei getSession lokal am Token geprüft: ein abgemeldetes Token gilt bis zu seinem Ablauf (1 h); Deaktivierte scheitern weiter an der Mitgliederprüfung.                                                                                                                                                                                                                                                                                                                                                                         | Annahme |
| U9  | 26.10.2026 | Neue Workflow-IDs: WF-AGE-01 Agenda und Filter nach Art, WF-AGE-02 „Aufgaben und offene Fragen zu diesem Event“, WF-AGE-03 Entscheidung/Fakt auf die Agenda bzw. „Stimmt noch“.                                                                                                                                                                                                                                                                                                                                                                 | Annahme |
| U10 | 26.10.2026 | „Stimmt das noch?“ zeigt die Agenda nur ohne Einschränkung auf Personen, Status oder Veranstaltung (Entscheidungen haben dafür noch keine Felder). Fragen: „Meine“ = selbst gestellt; bei „Folge ich“ und Statusfilter keine Fragen.                                                                                                                                                                                                                                                                                                            | Annahme |
| U11 | 26.10.2026 | Die Plenum-Agenda samt Aktionen (Einplanen, Besprochen, Reihenfolge …) entfällt schon mit Phase 2; das Ergebnis zeigt bis Phase 3 nur, was früher über die Agenda lief.                                                                                                                                                                                                                                                                                                                                                                         | Annahme |
| U12 | 26.10.2026 | Gehört eine Änderung zum Plenum, gilt das für Artefakte (Aufgabe, Veranstaltung, Termin, Entscheidung/Fakt, Frage, Dokument, Partner), nicht für Zu- und Absagen und nicht für das Plenum selbst (Protokoll, Teilnahme, Abschließen).                                                                                                                                                                                                                                                                                                           | Annahme |
| U13 | 26.10.2026 | Die Antwort auf „Gehört das zum Plenum?“ gilt im Tab bis zum Ende des Plenums; wer „Nein“ sagt, wird in diesem Plenum nicht wieder gefragt.                                                                                                                                                                                                                                                                                                                                                                                                     | Annahme |
| U14 | 26.10.2026 | Ergebnisse einer Frage stehen bei gleichem Zeitpunkt nach Titel sortiert. Eine ersetzte Entscheidung reicht die Frage an die neue Fassung weiter.                                                                                                                                                                                                                                                                                                                                                                                               | Annahme |
| U15 | 26.10.2026 | Dokumente haben keine Detailansicht – Kommentare gibt es dort (noch) nicht; Titel/Beschreibung von Dokumenten bleiben, wie sie sind.                                                                                                                                                                                                                                                                                                                                                                                                            | Annahme |
| U16 | 26.10.2026 | Neue Workflow-IDs: WF-ALL-07 Kommentar an einem Artefakt, WF-FRA-05 Ergebnis festhalten, WF-FRA-06 Frage bearbeiten, WF-WIS-12 Entscheidung/Fakt bearbeiten, WF-PLE-21 „Gehört das zum Plenum?“.                                                                                                                                                                                                                                                                                                                                                | Annahme |
| U17 | 26.10.2026 | Mobil steht das „+“ nur in den Listen; in Detailansichten liegen unten eigene Leisten, dort gibt es die Knöpfe „+ Aufgabe“, „+ Frage“, „+ Festhalten“ der Ansicht. Partner sind jetzt auch direkt über „+“ anlegbar (vorher nur in der Partnerliste).                                                                                                                                                                                                                                                                                           | Annahme |
| F1  | 26.10.2026 | Teilnehmende markiert der Server auch bei Änderungen im Profil/Verwaltung (z. B. Deaktivieren) automatisch fürs Plenum, Außenstehende werden dort nicht gefragt. Soll das so sein, oder zählt im Profil gar nichts zum Plenum?                                                                                                                                                                                                                                                                                                                  | geklärt |
| U18 | 26.10.2026 | Neue Workflow-ID WF-WIS-13 „Entscheidung bestätigen oder widersprechen“. Abstimmen dürfen alle aktiven Mitglieder, auch wer die Entscheidung angelegt hat (keine automatische Bestätigung). Stimmen Deaktivierter zählen nicht mehr.                                                                                                                                                                                                                                                                                                            | Annahme |
| U19 | 26.10.2026 | Offene Entscheidungen lassen sich wie gültige bearbeiten, ersetzen und aufheben; so wird ein Widerspruch nach dem Gespräch aufgelöst (oder die Person nimmt ihn zurück). Bearbeiten setzt die Stimmen nicht zurück.                                                                                                                                                                                                                                                                                                                             | Annahme |
| F3  | 26.10.2026 | Sollen alle eine Benachrichtigung bekommen, wenn eine neue Entscheidung zum Bestätigen da ist (und kurz vor Fristende)? Bisher sieht man sie nur unter Wissen; ohne Stimme gilt sie nach der Frist.                                                                                                                                                                                                                                                                                                                                             | geklärt |
| U20 | 26.10.2026 | Kalender (16.5): neue Workflow-ID WF-TER-11. Termine ohne Ende stehen im Kalender mit 1 Stunde, ein Plenum mit 3 Stunden (wie U4). Die Datei wird im Browser erzeugt, ohne Abo; spätere Änderungen und Absagen kommen nicht von selbst in den Kalender. Ob ein erneuter Import den Eintrag aktualisiert, hängt vom Kalender ab. Am Handy noch auf echten Geräten abzunehmen.                                                                                                                                                                    | Annahme |
| U21 | 26.10.2026 | Rückmeldungen und Version (16.5): neue Workflow-IDs WF-PRO-05 (melden), WF-PRO-06 („Was ist neu?“), WF-ADM-10 (Liste). Rückmeldungen haben keinen Status (erledigt o. ä.) und keine Historie. Wer die App in einem Browser zum ersten Mal öffnet, sieht einmal den Eintrag der laufenden Version. „Was ist neu?“ kommt nur mit einer neuen Versionsnummer samt Changelog-Eintrag, nicht bei jedem Deploy (z. B. kleine Korrekturen), und erst nach dem automatischen Neuladen durch die neue App-Fassung. Rückmeldungen stehen nicht im Export. | Annahme |
| U22 | 26.10.2026 | Phase 9: „Alle“ trägt alle aktiven Mitglieder einzeln als Bearbeitende ein (Liste eintragsweise, ein Rückgängig); die Karte zeigt dann „ALLE“, sonst höchstens drei Köpfe und „+n“. Beim Anlegen gibt es „Alle“ und einzelne Personen neben „Ich übernehme das“.                                                                                                                                                                                                                                                                                | Annahme |
| U23 | 26.10.2026 | Phase 9: Löschen heißt Archivieren (neue Workflow-ID WF-ALL-09, Aufgaben weiter WF-AUF-14), immer mit Rückfrage; Verknüpftes bleibt. Wiederherstellen geht bei Aufgaben im Detail, bei allen anderen Arten über „Rückgängig“ direkt danach – eine Archiv-Ansicht gibt es noch nicht (F4).                                                                                                                                                                                                                                                       | Annahme |
| U24 | 26.10.2026 | Phase 9: Kommentare und Verlauf stehen in allen Detailansichten in zwei Reitern (nicht nur Event und Entscheidung), damit es überall gleich aussieht. Aus Aufgabe, Frage und Entscheidung führt „Zum Event: …“ zur Veranstaltung.                                                                                                                                                                                                                                                                                                               | Annahme |
| F4  | 26.10.2026 | Braucht es eine Archiv-Ansicht (z. B. im Profil), um gelöschte Veranstaltungen, Termine, Entscheidungen, Fragen, Dokumente und Partner später wiederherzustellen? Bisher geht das nur direkt danach über „Rückgängig“.                                                                                                                                                                                                                                                                                                                          | geklärt |
| U25 | 27.10.2026 | Reaktionen an Kommentaren: je Person und Art höchstens eine, antippen schaltet an/aus; ohne Verlauf, ohne Rückgängig und ohne Benachrichtigung. Reagieren geht auch an Kommentaren gelöschter Einträge (dort sind nur neue Kommentare gesperrt).                                                                                                                                                                                                                                                                                                | Annahme |
| F2  | 26.10.2026 | Ergebnis: Eine Frage steht einmal („Beantwortet: …“), ihre Entscheidungen/Fakten je einmal mit „(aus der Frage …)“. Passt das, oder sollen die Ergebnisse unter der Frage stehen und die Frage-Zeile entfallen?                                                                                                                                                                                                                                                                                                                                 | geklärt |

## Entscheidungsprotokoll

| Datum      | Entscheidung                                                                                                                                                                                                                         | Begründung                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 25.10.2026 | Ladezeit: erst messen, dann gezielte Fixes am Server-Weg und Browser-Cache; kein Read-Model in Postgres, kein direktes Lesen aus Supabase.                                                                                           | Nutzerin; kleinster Umbau, Testdaten-Schicht bleibt gleich. |
| 25.10.2026 | Entscheidungen im Konsens: Frist Standard 7 Tage, frei wählbar; gültig, wenn alle bestätigt haben oder die Frist ohne Widerspruch abläuft (nicht abgegebene Stimmen verfallen); Widerspruch → bleibt offen und kommt auf die Agenda. | Nutzerin.                                                   |
| 25.10.2026 | Teilnehmerliste während des Plenums = Zusage „ja“ oder als anwesend abgehakt; Zeitraum Beginn bis Ende. Anwesenheit nach Abschluss nur nach Rückfrage; Zu-/Absagen und Anwesenheitsänderungen in die Historie.                       | Nutzerin.                                                   |
| 25.10.2026 | App-Report in eigener Tabelle, Liste für Admins im Profil.                                                                                                                                                                           | Nutzerin.                                                   |
| 26.10.2026 | F1: Änderungen in Profil und Verwaltung gehören nie zum Plenum, auch nicht bei Personen auf der Teilnehmerliste.                                                                                                                     | Nutzerin.                                                   |
| 26.10.2026 | F2: Im Plenum-Ergebnis steht eine Frage mit dem, was aus ihr wurde: „Frage: … – Antwort: …“ bei einer Antwort als Notiz, „Frage: … – daraus entstanden: Entscheidung „…“, Fakt „…““ bei Ergebnissen.                                 | Nutzerin.                                                   |
| 26.10.2026 | F3: Neue Entscheidung zum Bestätigen geht als Benachrichtigung an alle anderen; am letzten Tag der Frist (ab 9 Uhr) an alle, die noch nicht abgestimmt haben.                                                                        | Nutzerin.                                                   |
| 26.10.2026 | „In Arbeit“ trägt niemanden mehr automatisch ein; Zuordnen geht nur ausdrücklich.                                                                                                                                                    | Nutzerin (Phase 9).                                         |
| 26.10.2026 | F4: Archiv-Ansicht im Profil zum Wiederherstellen gelöschter Einträge – zunächst nur als Plan (Phase 11), nicht umsetzen.                                                                                                            | Nutzerin.                                                   |

## Abnahmen

| Phase | Datum | Testergebnis | Bestätigung |
| ----- | ----- | ------------ | ----------- |
