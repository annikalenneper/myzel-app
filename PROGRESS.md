# Myzel – Fortschritt

Geführt vom Agenten. Quelle der Anforderungen: docs/ANFORDERUNGEN.md.

## Status

**Aktuell: Schritt A (Oberfläche mit Testdaten) für alle Phasen P1 bis P6 fertig und geprüft (Phase 1 am
12.10.2026, Phase 2 bis 4 am 18.10.2026, Phase 5 und 6 am 19.10.2026). Als Nächstes Schritt B: Durchsicht durch
die Nutzerin mit den offenen Fragen und Annahmen unten.**
Reihenfolge seit 12.10.2026: erst das ganze Frontend (Schritt A für P1 bis P6), dann
Durchsicht (B), Daten und Server (C), Deploy am Ende (D).

### 10.0 Vorbereitung

- [x] Stack (2.1) bestätigt (11.10.2026); übrige Fragen aus 11.1 unten gesammelt
- [x] Repo-Gerüst: Vite/React/TS, Tailwind, PWA, ESLint/Prettier, Vitest, Playwright
- [ ] Supabase-Projekt (EU) + lokale Entwicklung; Netlify-Site; Umgebungsvariablen; .env.example – zu Schritt C
- [ ] `npm run check` lauffähig (Schritt A: Lint, Typecheck, Unit, E2E – DB-Tests, check:integrity und
      YAML-Validierung kommen mit Schritt C); GitHub Actions CI angelegt, läuft, sobald das Repo auf GitHub liegt;
      wöchentlicher Dump offen (Frage 8)
- [x] docs/ANFORDERUNGEN.md, CLAUDE.md, PROGRESS.md, README.md

### 10.1 Phase 1 – Aufgaben

Schritt A – Oberfläche mit Testdaten:

- [x] Datenvertrag (zod-Schemas, Typen) und Regel-Bibliothek: members, topics, tasks mit Bearbeitenden,
      Folgenden, Abhängigkeiten, Kommentaren; plenum_marks (nur Aufgaben); events schlank; history
- [x] Testdaten-Schicht hinter der API-Schnittstelle: Statusübergänge, Pflichtregeln, Rechte, Optimistic
      Locking, Historie, Rückgängig, „Mitglied deaktivieren“
- [x] App-Gerüst im Stil D: Navigation (Aufgaben, Events, Profil), Layout mobil/desktop, „+“, Leer- und
      Fehlerzustände (S-90)
- [x] Login S-01, Kein Zugriff S-02 (WF-LOG-01 bis -03) – mit Testkonten statt Google
- [x] Aufgaben S-10 bis S-13: F-AUF-01 bis -07 und -09 (WF-AUF-01 bis -12, -14, -15)
- [x] Veranstaltungen schlank S-20 bis S-22: F-VER-01 bis -03 (WF-VER-01 bis -05)
- [x] Profil S-50, Mitglieder S-51, Themen S-52 (WF-PRO-01, WF-ADM-01 bis -05)
- [x] Datenschutzhinweis in der App (Entwurf)
- [x] Unit-Tests und Playwright-Tests der Abläufe (mobiler Viewport)
- [x] Agent-Review je Screen-Block ohne Befunde hoher oder mittlerer Schwere (11./12.10.2026: fünf Runden
      durch unabhängige Agenten; alle Befunde hoher und mittlerer Schwere eingearbeitet, letzte Runde: 0 offen)

Schritt B:

- [ ] Durchsicht durch die Nutzerin; Fragen aus 11.1 und aus Schritt A klären

Schritt C – Daten und Server (Checkliste 10.1):

- [ ] Datenmodell als Migrationen: members (inkl. short und Systemeintrag), topics (+Seed), tasks mit
      task_assignees, task_followers, task_blockers, comments; plenum_marks; events schlank; history
- [ ] Server-Funktionen: Statusübergänge (4.1), Pflichtregeln, Rechte, Optimistic Locking, Historie,
      „Mitglied deaktivieren“ für Aufgaben
- [ ] Login mit Google und E-Mail-Link, Mitgliederprüfung (F-LOG-01, -02)
- [ ] Admin-Bereich Mitglieder und Themen (F-LOG-03, F-PRO-04); Profil mit Name und Abmelden (F-LOG-04)
- [ ] App-Gerüst, Aufgaben (F-AUF-01 bis -07, -09), Veranstaltungen schlank (F-VER-01 bis -03) am echten Backend
- [ ] Datenschutzhinweis in der App; check:integrity; E2E-Smoke-Tests

Schritt D:

- [ ] Phasenabschluss (10.7)

### 10.2 Phase 2 – Erinnerungen

Schritt A – Oberfläche mit Testdaten:

- [x] Datenvertrag (push_subscriptions, telegram_links, telegram_link_codes, notification_outbox, job_runs,
      members.reminder_lead_days) und Benachrichtigungsregeln (Empfänger, Texte, dedupe_key, Fristerinnerungen)
- [x] Testdaten-Schicht: Outbox ohne Doppelversand, Joblauf (idempotent, holt nach), Push-Abo je Gerät,
      Telegram-Einmal-Code (15 Minuten, einmal verwendbar)
- [x] Profil S-50: Push auf diesem Gerät mit Erklärung und iPhone-Anleitung (WF-PRO-02), Telegram verknüpfen
      und trennen (WF-PRO-03); Abmelden entfernt das Push-Abo des Geräts (WF-LOG-03)
- [x] Systemstatus S-54 mit Warnung nach 2 Stunden ohne Lauf (WF-ADM-07); Direktlinks der Nachrichten (WF-ALL-04)
- [x] Unit-Tests und Playwright-Tests
- [x] Agent-Review ohne Befunde hoher oder mittlerer Schwere (Runde 1 am 12.10.2026: 3 mittel –
      eingearbeitet; Runde 2 am 18.10.2026: 1 mittel – Joblauf wartet jetzt das Rückgängig-Fenster ab –
      eingearbeitet, dazu 2 niedrige; Runde 3 am 18.10.2026: 1 mittel – Erinnerungen des Joblaufs gingen
      einen Lauf zu spät raus; jetzt wartet nur, was noch rücknehmbar ist – eingearbeitet; Nachprüfung am 18.10.2026: 0 hoch, 0 mittel)

Schritt C – Daten und Server (Checkliste 10.2):

- [ ] Datenmodell: push_subscriptions, telegram_links, telegram_link_codes, notification_outbox, job_runs;
      members.reminder_lead_days
- [ ] Web-Push: Aktivierung im Profil, iOS-Hinweis, Versand, Aufräumen ungültiger Abos (6.3)
- [ ] Telegram: Bot, Verknüpfung per Einmal-Code im Profil (F-PRO-03), Nachrichten ohne Buttons
- [ ] Ereignisse aus 6.2 mit Phase P2, feste Voreinstellungen (6.1)
- [ ] Job alle 15 Minuten über cron-job.org, Laufprotokoll, Statusanzeige im Admin-Bereich (E-07)
- [ ] check:integrity (Outbox, Joblauf); Tests
- [ ] Phasenabschluss (10.7)

### 10.3 Phase 3 – Plenum-Zyklus

Schritt A – Oberfläche mit Testdaten:

- [x] Datenvertrag der ganzen Phase (Terminarten, Termine, Zu-/Absagen, Teilnahme, Entscheidungen, Fragen,
      Dokumente, Verknüpfungen; plenum_marks mit allen Zielspalten)
- [x] Block Termine: S-30 Liste, S-31 Anlegen/Bearbeiten, S-32 Detail (WF-TER-01 bis -08, WF-PLE-01),
      S-53 Terminarten (WF-ADM-06), Termin im Aufgaben-Detail, Deaktivieren entfernt künftige Antworten,
      Termin-Einladung/-Änderung/-Erinnerung in der Outbox; Unit- und Playwright-Tests
- [x] Block Wissen: S-40 Übersicht, S-41 Frage, S-42 Entscheidung/Fakt, S-43 Dokument verknüpfen, S-44 globale Suche
      (WF-WIS-01 bis -07, -11, WF-FRA-01 bis -03), Dokumente an Aufgaben (WF-AUF-13), Markierung an
      Veranstaltungen (WF-VER-06); Unit- und Playwright-Tests
- [x] Block Plenum: S-33 (WF-PLE-03 bis -20) – Agenda aus allen Markierungen mit Ziehgriff (auch per
      Pfeiltasten), Aktionen je Art mit einem Rückgängig für die ganze Aktion, „+ Hinzufügen“ und Suche,
      Ergebnis, Protokoll (Person, Notizen mit Entwurf, Drive-Protokoll), Abschließen mit Teilnahme und
      Zusammenfassung; Plenum-Termine öffnen S-33; nachgetragene Termine laden niemanden ein; Unit- und
      Playwright-Tests (18.10.2026)
- [x] Agent-Review je Block ohne Befunde hoher oder mittlerer Schwere (Runde 1 am 18.10.2026: Plenum 5 mittel,
      Termine/Wissen 2 mittel, keine hohen – alle eingearbeitet; Nachprüfung am 18.10.2026: 0 hoch, 0 mittel)

Schritt C – Daten und Server (Checkliste 10.3):

- [ ] Datenmodell: appointment_types (+Seed), appointments, appointment_rsvps, appointment_attendees,
      tasks.appointment_id und origin_plenum_id, decisions, questions, documents mit task_documents und
      weiteren Verknüpfungen; plenum_marks für Fragen, Entscheidungen, Veranstaltungen, Termine, Dokumente
- [ ] Admin-Bereich Terminarten (F-TER-06); Navigation um Termine und Wissen erweitern
- [ ] Termine: F-TER-01, -04, -05
- [ ] Plenum: F-PLE-01 bis -04 und F-AUF-08, inkl. Nachtragen alter Plenen
- [ ] Wissen: F-WIS-01, -02, F-FRA-01, -02, F-WIS-03, F-AUF-05 (Dokumente), F-WIS-07, F-WIS-06
- [ ] Ereignisse aus 6.2 mit Phase P3
- [ ] „Mitglied deaktivieren“ um künftige Zusagen erweitern
- [ ] check:integrity; Tests
- [ ] Phasenabschluss (10.7)

### 10.4 Phase 4 – Veranstaltungen

Schritt A – Oberfläche mit Testdaten:

- [x] Block Veranstaltungs-Detail: Aufbau/Abbau, Hauptverantwortliche, Detailbereiche mit Kurzzusammenfassung
      (F-VER-04, WF-VER-08), Booking, Schichtplan (WF-VER-11), „In Nachbereitung?“ (WF-VER-07), lange
      Nachbereitung in der Liste, Deaktivieren trägt Hauptverantwortliche aus
  - [x] Datenvertrag, Testdaten-Schicht, Testdaten (Winterrave) und Unit-Tests (18.10.2026)
  - [x] Oberfläche und Playwright-Tests (18.10.2026); Dokumentauswahl für Protokoll und Schichtplan gemeinsam
- [x] Block Partner: S-24 Liste und Detail (WF-VER-10, -13), Verknüpfen mit Rolle oder neu anlegen,
      Markierung und Agenda-Aktionen für Partner, Partner in der globalen Suche, Partner-Kontakt beim
      Deaktivieren; Unit- und Playwright-Tests (18.10.2026)
- [x] Block Vorlagen: S-23 Vorlagen-Dialog nach dem Anlegen und erneut aus dem Detail (WF-VER-12),
      S-55 Vorlagen bearbeiten (WF-ADM-08), Startinhalt als YAML (src/shared/seed/event-templates.yaml) mit
      JSON-Schema aus zod (npm run schema:templates, Unit-Test prüft Aktualität); Unit- und Playwright-Tests
      (18.10.2026)
- [x] Agent-Review je Block ohne Befunde hoher oder mittlerer Schwere (Runde 1 am 18.10.2026: Detail/Partner
      2 hoch, 3 mittel; Vorlagen 3 mittel; zwei Nachprüfungen mit 2 bzw. 1 mittel aus dem feldweisen Locking –
      alles eingearbeitet; Schlussprüfung am 18.10.2026: 0 hoch, 0 mittel)

Schritt C – Daten und Server (Checkliste 10.4):

- [ ] Datenmodell: Detailbereiche, event_bookings, partners, event_partners, event_leads, setup_at,
      teardown_at, shift_plan_document_id, event_templates, event_template_items (+YAML-Seed mit Schema),
      plenum_marks für Partner
- [ ] Detailbereiche (F-VER-04), Partner (F-VER-05), Hauptverantwortliche, Schichtplan, Nachbereitung (4.2)
- [ ] Vorlagen mit Häkchen-Dialog (F-VER-06, -07)
- [ ] „Mitglied deaktivieren“ um Hauptverantwortliche und Partner-Kontakt erweitern
- [ ] check:integrity; Tests
- [ ] Phasenabschluss (10.7)

### 10.5 Phase 5 – Wissen & Drive

Schritt A – Oberfläche mit Testdaten:

- [x] Datenvertrag (drive_items, drive_sync_state, events.drive_folder_id, Eingabe für WF-WIS-09) und
      Abgleich-Regeln (src/shared/rules/drive.ts); Testdaten-Schicht mit simuliertem Vereins-Drive hinter einer
      Changes-API: Anzeige sofort aus dem Cache, Abgleich höchstens einmal pro Minute, Neuaufbau bei ungültigem
      Token, „Neu einlesen“ und wöchentlich im Joblauf (19.10.2026)
- [x] S-40 Reiter Drive (WF-WIS-08, -10): Ordner, Pfad, Icons, Änderungsdatum, Suche über Dateinamen,
      „Zuletzt“, verknüpft-Kennzeichen, „abgeglichen vor …“; Adresse /wissen/drive/:ordner
- [x] S-43 „Aus Drive“ (WF-WIS-09) und Verknüpfen-Knopf je Datei; Dokument-Eintrag entsteht beim ersten
      Verknüpfen; „Dokumente“ jetzt auch an Veranstaltung und Termin (F-WIS-05)
- [x] Drive-Ordner der Veranstaltung (WF-VER-14) mit Inhalt; „im Drive suchen“ aus der globalen Suche
      (WF-WIS-11); Hinweis „In Drive nicht mehr vorhanden“; Demo-Werkzeuge für neue und gelöschte Dateien
- [x] Unit-Tests (src/data/mock/drive.test.ts) und Playwright-Tests (e2e/drive.spec.ts)
- [x] Agent-Review ohne Befunde hoher oder mittlerer Schwere (Runde 1 am 19.10.2026: 0 hoch, 2 mittel – Drive-Link
      „Per Link“ ergab einen zweiten Eintrag zur selben Datei; Inhalt gelöschter Ordner blieb sichtbar –, 3 niedrig;
      alle eingearbeitet; Nachprüfung 1 am 19.10.2026: 1 mittel – Drive-Link, den der Cache noch
      nicht kannte, ergab später doch zwei Einträge –, 3 niedrig; alle eingearbeitet; Nachprüfung 2 am 19.10.2026: 1 mittel – „Im Web
      veröffentlichen“-Links (…/d/e/…) galten alle als dieselbe Datei –, 3 niedrig; alle eingearbeitet; Nachprüfung 3 am 19.10.2026: 0 hoch, 0 mittel, 2 niedrig –
      Ladefehler der Erreichbarkeit eingearbeitet, der zweite steht unten bei den offenen niedrigen Befunden)

Schritt C – Daten und Server (Checkliste 10.5):

- [ ] Test mit dem echten Vereins-Drive; Dienstkonto einrichten (Zugriff aus HerrRINGOO übernehmen)
- [ ] Datenmodell: drive_items, drive_sync_state, events.drive_folder_id
- [ ] Inhaltsverzeichnis mit Cache und Abgleich (F-WIS-04, -08), Verknüpfen (F-WIS-05), Drive-Ordner in
      der Veranstaltung (F-VER-03), „im Drive suchen“ (F-WIS-06)
- [ ] check:integrity (Abgleich-Alter, fehlende verknüpfte Dateien); Tests
- [ ] Phasenabschluss (10.7)

### 10.6 Phase 6 – Komfort

Schritt A – Oberfläche mit Testdaten:

- [x] Block Serien (19.10.2026): Datenvertrag appointment_series und appointments.series_date, Regel-Bibliothek
      (src/shared/rules/series.ts: Teilmenge von RRULE, verständliche Auswahl zum gewählten Tag), Erzeugung im
      Joblauf 3 Monate im Voraus als „Myzel (automatisch)“, je Serie und Tag einmal, Einladung ca. 2 Wochen vorher;
      „Wiederholen“ beim Anlegen (WF-TER-09), Serie im Termin-Detail bearbeiten und beenden, „Nur dieser Termin /
      Ganze Serie“ beim Bearbeiten (WF-TER-10); Startbestand Bautag; Unit- und Playwright-Tests
- [x] Block Telegram-Buttons (19.10.2026, 6.4): Buttons je Nachricht (src/shared/rules/telegram.ts), Server-Logik
      über dieselben Funktionen wie die App, idempotent, mit Bestätigung, freundlicher Hinweis ohne halbe
      Speicherung; „Passt nicht“ benachrichtigt, wer zugewiesen hat; in Schritt A unter den Telegram-Nachrichten
      der Demo-Werkzeuge; Unit- und Playwright-Tests
- [x] Block Benachrichtigungs-Matrix und Vorlauf (19.10.2026, F-PRO-02, WF-PRO-04): notification_preferences
      (ohne Eintrag „an“), members.notify_own_status; Schalter je Zeile und Kanal im Profil, eigene
      Statusänderungen, Vorlauf 1/3/7 Tage; Abschalten nimmt wartende Nachrichten zurück; Unit- und Playwright-Tests
- [x] Block nächtlicher YAML-Export (19.10.2026, E-08): Aufbau in src/shared/export.ts ohne Kontaktdaten (auch nicht
      in der Historie), JSON-Schema src/shared/export.schema.json (npm run schema:export, Unit-Test prüft Aktualität),
      Download in den Demo-Werkzeugen; das Schreiben ins private Repo folgt in Schritt C
- [x] Agent-Review je Block ohne Befunde hoher oder mittlerer Schwere (Runde 1 am 19.10.2026: 2 hoch – von der Serie
      entfernte Tage kamen nie wieder; Kontakt von Location und Act im Export –, 3 mittel – Markierung blieb bei
      Serienabsage; „alle 2 Wochen“ kippte beim Wechsel; Zusagen vor der Einladung erfuhren nichts von neuer Uhrzeit –,
      8 niedrig; alle bis auf einen niedrigen eingearbeitet; Nachprüfung 1 am 19.10.2026: 0 hoch, 2 mittel – neuer
      Takt nicht nach dem im Formular gezeigten Termin; Absagen auch an nie Eingeladene –, 4 niedrig; alle bis auf einen
      eingearbeitet; Nachprüfung 2 am 19.10.2026: 0 hoch, 0 mittel, 3 niedrig – eingearbeitet)

Schritt C – Daten und Server (Checkliste 10.6):

- [ ] Serien inkl. Bautag (F-TER-02, -03), Erzeugung im Joblauf
- [ ] Telegram-Buttons gemäß 6.4
- [ ] Benachrichtigungs-Matrix und Vorlauf im Profil (F-PRO-02)
- [ ] Nächtlicher YAML-Export (E-08) ohne Kontaktdaten; ersetzt den wöchentlichen Dump
- [ ] check:integrity; Tests
- [ ] Phasenabschluss (10.7)

## Offene Fragen

Zur Durchsicht (Schritt B); geklärt sein müssen sie vor Schritt C.

### Aus 11.1

| Nr. | Datum      | Frage                                                                               | Stand   | Antwort                                                                                                                     |
| --- | ---------- | ----------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | 11.10.2026 | Technischer Stack (2.1) so in Ordnung?                                              | geklärt | Ja, wie in 2.1 (11.10.2026)                                                                                                 |
| 2   | 11.10.2026 | Wo liegt das Repo (GitHub-Account/Organisation)? Name der Netlify-Site oder Domain? | geklärt | Repo: github.com/annikalenneper/myzel-app (öffentlich); Netlify-Site myzel-app, https://myzel-app.netlify.app/ (19.10.2026) |
| 3   | 11.10.2026 | Wem gehört das Supabase-Projekt? Zweite Person mit Zugang?                          | teils   | Projekt https://wyfsorojbcijkedlnmji.supabase.co (20.10.2026); Region (EU/Frankfurt?), Inhaberin und zweite Person offen    |
| 4   | 11.10.2026 | Mitgliederliste (Name + Google-Mail) und wer Admin ist                              | offen   |                                                                                                                             |
| 5   | 11.10.2026 | Veranstaltungsarten: Party, Konzert, Workshop, Soli-Event, Sonstiges?               | offen   |                                                                                                                             |
| 6   | 11.10.2026 | Unterkategorien „Verein“ bestätigen (3.2)                                           | offen   |                                                                                                                             |
| 7   | 11.10.2026 | Uhrzeit für tägliche Fristerinnerungen ab P2 (Vorschlag 9:00 Uhr)                   | offen   |                                                                                                                             |
| 8   | 11.10.2026 | Backup bis Phase 6: wöchentlicher Dump nötig?                                       | offen   |                                                                                                                             |
| 9   | 11.10.2026 | Ortsangabe des Lagers für den Bautag; übliches Format des Plenums                   | offen   |                                                                                                                             |
| 10  | 11.10.2026 | Braucht es einen Hell-Modus?                                                        | offen   |                                                                                                                             |

### Aus Schritt A (Widersprüche und Annahmen, nach denen gebaut wurde)

| Nr. | Datum      | Frage                                                                                                                                                       | Stand | Gebaut nach Annahme                                                                                                                                                                                                                                                                                                                           |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | 11.10.2026 | Themen archivieren: 3.2 sagt „mit aktiven Aufgaben nicht archivierbar“, WF-ADM-05 und Prototyp sagen „benutzte Themen nur archivierbar“.                    | offen | Beides zusammen: benutzte Themen sind nicht löschbar; archivieren geht erst, wenn keine aktive Aufgabe mehr dranhängt (und keine offene Unterkategorie).                                                                                                                                                                                      |
| A2  | 11.10.2026 | Veranstaltungs-Detail: Prototyp zeigt die untere Navigation, 8.3 sagt „Detailansichten ohne Navigation“.                                                    | offen | Nach Dokument: ohne Navigation, mit Zurück-Pfeil.                                                                                                                                                                                                                                                                                             |
| A3  | 11.10.2026 | Abhängigkeiten: F-AUF-05 verlangt sie im Detail, 3.3 macht sie unabhängig vom Status „Blockiert“; der Prototyp zeigt sie nur im Blockieren-Dialog.          | offen | Abschnitt „Hängt ab von“ im Detail (hinzufügen/entfernen jederzeit); bei „Blockiert“ stehen die Einträge im roten Kasten.                                                                                                                                                                                                                     |
| A4  | 11.10.2026 | Aufgabennummer („AUFGABE #017“) steht im Prototyp, aber nicht im Datenmodell 3.3.                                                                           | offen | Feld `number` (fortlaufend) ergänzt.                                                                                                                                                                                                                                                                                                          |
| A5  | 11.10.2026 | Automatisch folgen (F-AUF-06) „abwählbar“: Wer sich austrägt und danach wieder bearbeitet oder kommentiert – folgt die Person dann erneut?                  | offen | Ja, jede Bearbeitung trägt wieder ein; abwählen über „✓ Folge ich“. Als „bearbeiten“ zählen Felder, Beschreibung, Status, Abhängigkeiten und Kommentare; Zugewiesene folgen ebenfalls.                                                                                                                                                        |
| A6  | 11.10.2026 | Archivierte Aufgaben wiederfinden: WF-AUF-14 kennt „Wiederherstellen“, aber keine Liste archivierter Aufgaben.                                              | offen | Wiederherstellen geht direkt nach dem Archivieren (Rückgängig, Hinweis im Detail) und über den Link der Aufgabe. Eine Archiv-Ansicht ist nicht gebaut.                                                                                                                                                                                        |
| A7  | 11.10.2026 | Veranstaltung „abgesagt“ und „abgeschlossen“ sind laut 4.2 endgültig; ohne Bestätigungsdialog (außer bei offenen Aufgaben) bleibt nur das kurze Rückgängig. | offen | Wie im Dokument; Hinweis „lässt sich nicht mehr ändern“ im Detail.                                                                                                                                                                                                                                                                            |
| A8  | 11.10.2026 | Historie von Veranstaltungen: wird geschrieben (E-10), aber Prototyp und 5.8 zeigen sie nirgends an.                                                        | offen | Nur gespeichert, nicht angezeigt. Veranstaltungen lassen sich in P1 auch nicht archivieren (kein Workflow).                                                                                                                                                                                                                                   |
| A9  | 11.10.2026 | Kommentar senden: der Prototyp bietet „Rückgängig“ an, das Dokument kennt kein Löschen von Kommentaren.                                                     | offen | Bestätigung „Gesendet“ ohne Rückgängig; eigene Kommentare sind bearbeitbar.                                                                                                                                                                                                                                                                   |
| A10 | 11.10.2026 | Fortschritt einer Veranstaltung „x von y erledigt“: zählen verworfene Aufgaben mit?                                                                         | offen | Nein; archivierte auch nicht.                                                                                                                                                                                                                                                                                                                 |
| A11 | 11.10.2026 | Wortlaut des Datenschutzhinweises (Vereinsname, Kontakt).                                                                                                   | offen | Entwurf unter Profil › Datenschutz.                                                                                                                                                                                                                                                                                                           |
| A12 | 11.10.2026 | Veranstaltung anlegen: Art ist Pflicht; der Prototyp wählt „Party“ vor.                                                                                     | offen | Wie Prototyp: „Party“ vorausgewählt.                                                                                                                                                                                                                                                                                                          |
| A13 | 11.10.2026 | Mitglieder: 3.1 nennt `email` als Pflicht und `reminder_lead_days`; 10.2 führt Letzteres erst in P2.                                                        | offen | `reminder_lead_days` kommt mit P2. Der Systemeintrag „Myzel (automatisch)“ hat keine Mail und kein `created_by` (in Schritt C: nullable mit Check-Constraint „nur beim Systemeintrag“).                                                                                                                                                       |
| A14 | 11.10.2026 | Darf sich ein Admin selbst deaktivieren? Das Dokument verbietet nur den letzten Admin.                                                                      | offen | Erlaubt, mit Hinweis im Dialog („Du wirst dabei sofort abgemeldet“).                                                                                                                                                                                                                                                                          |
| A15 | 11.10.2026 | Datum und Uhrzeit: Der Prototyp zeigt eigene Kacheln („Sa, 20.03. · 20:00“, „wählen“).                                                                      | offen | Frist als Kachel mit dem Datumswähler des Geräts; Beginn/Ende der Veranstaltung als natives Datum-Zeit-Feld. Veranstaltungen außerhalb des laufenden Jahres zeigen das Jahr.                                                                                                                                                                  |
| A16 | 11.10.2026 | Kommende/vergangene Veranstaltungen: Wann wechselt eine Veranstaltung ohne Ende die Liste?                                                                  | offen | Mit Ende: nach dem Ende. Ohne Ende: nach Ablauf des Tages, an dem sie beginnt.                                                                                                                                                                                                                                                                |
| A17 | 12.10.2026 | Push in der Vorschau: Ohne Server gibt es kein echtes Push-Abo.                                                                                             | offen | „Push auf diesem Gerät“ legt in der Vorschau nur ein Test-Abo an und fragt den Browser noch nicht nach der Erlaubnis; das kommt mit Schritt C. Was an dich ginge, steht im Profil unter „Vorschau mit Testdaten › Nachrichten an dich“ – Antippen öffnet die Aufgabe (WF-ALL-04).                                                             |
| A18 | 12.10.2026 | Fristerinnerungen (6.2): „Frist naht“ einmal oder an jedem Tag des Vorlaufs?                                                                                | offen | Einmal, am ersten Tag innerhalb des Vorlaufs (Standard 3 Tage vorher), dazu „heute fällig“ und einmal „überfällig“. Uhrzeit 9:00 (Frage 7).                                                                                                                                                                                                   |
| A19 | 12.10.2026 | Statusänderung durch Austragen der letzten Person (in Arbeit → geplant) oder durch „Rückgängig“: eigene Nachricht?                                          | offen | Nein – „Statusänderung“ wird nur bei einem bewusst gesetzten Status verschickt.                                                                                                                                                                                                                                                               |
| A20 | 12.10.2026 | Benachrichtigungen: Selbstzuweisung und eigene Termine.                                                                                                     | offen | Wer sich selbst einträgt oder einen Termin selbst anlegt, verschiebt oder absagt, bekommt dazu keine Nachricht (wie bei eigenen Statusänderungen).                                                                                                                                                                                            |
| A21 | 12.10.2026 | „Blockade aufgehoben“ (4.1, 6.2): auch wenn die wartende Aufgabe noch auf weitere Aufgaben wartet oder gar nicht „Blockiert“ ist?                           | offen | Ja, wie im Wortlaut: Nachricht an die Bearbeitenden jeder Aufgabe, die auf die erledigte gewartet hat.                                                                                                                                                                                                                                        |
| A22 | 12.10.2026 | Termine: Der Prototyp zeigt nur kommende Termine; vergangene müssen korrigierbar bleiben (4.3).                                                             | offen | Filter-Pille „Vergangene“ in der Terminliste (neueste zuerst).                                                                                                                                                                                                                                                                                |
| A23 | 12.10.2026 | Termin anlegen: Titel-Vorbelegung aus der Terminart; Thema des Termins.                                                                                     | offen | Titel wird mit dem Namen der Terminart vorbelegt und ist änderbar. Das Thema kommt aus der Terminart und ist im Formular nicht einzeln wählbar.                                                                                                                                                                                               |
| A24 | 12.10.2026 | Beim Deaktivieren eines Mitglieds: Push-Abos und Telegram-Verknüpfung.                                                                                      | offen | Werden mit entfernt (personenbezogen, Abschnitt 9); nach dem Reaktivieren neu einschalten.                                                                                                                                                                                                                                                    |
| A25 | 12.10.2026 | Termin-Erinnerung „3 Tage vorher“ bei Terminen, die kurzfristiger angelegt werden.                                                                          | offen | Die Erinnerung geht dann beim nächsten Joblauf raus (zusätzlich zur Einladung); die „1 Stunde vorher“ kommt immer.                                                                                                                                                                                                                            |
| A26 | 12.10.2026 | Wissen: Dokumente an Veranstaltungen und Terminen (WF-WIS-06 nennt sie als Ziel, der Prototyp zeigt dort in P3 keine Dokumentliste).                        | offen | Verknüpfen geht (Ziel im Dialog suchbar); angezeigt werden die Dokumente an Aufgaben und Entscheidungen sowie unter Wissen › Dokumente mit der Zahl der Verknüpfungen. Listen an Veranstaltung und Termin kommen mit dem Drive-Ausbau in P5.                                                                                                  |
| A27 | 12.10.2026 | Quelle einer Entscheidung: eine oder mehrere? Datum?                                                                                                        | offen | Plenum, Dokument und Notiz lassen sich kombinieren, mindestens eine ist Pflicht. Datum ist mit heute vorbelegt. Wird eine Frage zur Entscheidung, übernimmt sie Titel und Thema der Frage; die Antwort wird der Text.                                                                                                                         |
| A28 | 12.10.2026 | Dokumenttypen und Tags (Frage 11.2 Nr. 3).                                                                                                                  | offen | Typen wie in 3.9 (Protokoll, Leitlinie, Vorlage, Schichtplan, Sonstiges); Tags als freie Stichworte, mit Komma getrennt.                                                                                                                                                                                                                      |
| A29 | 12.10.2026 | Globale Suche: ab wann und wo wird gesucht?                                                                                                                 | offen | Ab zwei Zeichen, in Titel und Text (bei Fragen auch in der Antwort, bei Dokumenten in den Tags); archivierte Einträge erscheinen nicht. Dokument-Treffer öffnen die Datei.                                                                                                                                                                    |
| A30 | 12.10.2026 | Adresse für „Finanzen in MeinVerein“ (F-WIS-07, konfigurierbar).                                                                                            | offen | Umgebungsvariable VITE_MEINVEREIN_URL, bis dahin die Startseite von MeinVerein.                                                                                                                                                                                                                                                               |
| A31 | 18.10.2026 | F-PLE-01: „Ist ein vergangenes Plenum nicht abgeschlossen, zeigt die Ansicht nur einen Hinweis.“ Was genau?                                                 | offen | Ab 12 Stunden nach dem Ende steht ein Hinweis „liegt zurück, noch nicht abgeschlossen“; Agenda und Abschließen bleiben möglich. Keine automatische Erinnerung.                                                                                                                                                                                |
| A32 | 18.10.2026 | Plenum bearbeiten oder absagen: Der Prototyp S-33 zeigt dafür nichts, WF-TER-04/-05 gelten für alle Terminarten.                                            | offen | Unter „⋯“ oben rechts: Bearbeiten und Plenum absagen. Die Agenda bleibt bei einer Absage für das nächste Plenum stehen.                                                                                                                                                                                                                       |
| A33 | 18.10.2026 | Drive-Protokoll verknüpfen: Der Prototyp führt zu S-43.                                                                                                     | offen | Auswahl aus den erfassten Dokumenten (Protokolle zuerst); ein neues Dokument wird vorher unter Wissen › Dokumente per Link erfasst.                                                                                                                                                                                                           |
| A34 | 18.10.2026 | Rückgängig nach einer Agenda-Aktion: Der Prototyp zeigt eine eigene Leiste in der Agenda.                                                                   | offen | Die gemeinsame Leiste mit „Rückgängig“ (S-90) wie überall sonst; der Punkt steht danach wieder an alter Stelle.                                                                                                                                                                                                                               |
| A35 | 18.10.2026 | Abgeschlossenes oder abgesagtes Plenum: Agenda noch zeigen?                                                                                                 | offen | Nein – die Agenda gehört dem nächsten Plenum; sichtbar sind Ergebnis und Protokoll.                                                                                                                                                                                                                                                           |
| A36 | 18.10.2026 | „Bis wann?“ im Plenum: Der Prototyp bietet „In 1 Woche“, „In 2 Wochen“, „Vor dem Event“.                                                                    | offen | Die ersten beiden als Schnellwahl plus Datumskachel; „Vor dem Event“ entfällt (unklar, welcher Tag gemeint ist).                                                                                                                                                                                                                              |
| A37 | 18.10.2026 | „Aufheben“ in der Agenda: WF-PLE-14 nennt eine optionale Notiz, der Prototyp hebt sofort auf.                                                               | offen | Kleines Feld mit optionaler Notiz und „Aufheben“.                                                                                                                                                                                                                                                                                             |
| A38 | 18.10.2026 | Veranstaltung „Abschließen“ in der Agenda: „Hinweis bei offenen Aufgaben“.                                                                                  | offen | Die Zahl offener Aufgaben steht im Kennzeichen der Karte; „Abschließen“ fragt bei offenen Aufgaben nach, die Aufgaben bleiben bestehen.                                                                                                                                                                                                       |
| A39 | 18.10.2026 | Rahmen (3.4): „je Status + Notiz“ – welche Status?                                                                                                          | offen | Offen, Erledigt, Entfällt. Die Kurzzusammenfassung nennt offene Punkte in Bernstein, sobald im Rahmen etwas eingetragen ist.                                                                                                                                                                                                                  |
| A40 | 18.10.2026 | Aufbau und Abbau: Regeln?                                                                                                                                   | offen | Aufbau liegt vor (oder genau zum) Beginn, Abbau nicht vor dem Ende; beide optional, im Bearbeiten-Formular der Veranstaltung.                                                                                                                                                                                                                 |
| A41 | 18.10.2026 | „In Nachbereitung?“ ausblenden (WF-VER-07): für wen?                                                                                                        | offen | Ausblenden gilt nur auf diesem Gerät; der Vorschlag kommt ab dem Tag nach dem Ende (ohne Ende: nach dem Beginn), solange der Status „bestätigt“ ist.                                                                                                                                                                                          |
| A42 | 18.10.2026 | „Steht sie lange in Nachbereitung, zeigt die Liste nur einen Hinweis“ (4.2): wie lange?                                                                     | offen | Ab 30 Tagen.                                                                                                                                                                                                                                                                                                                                  |
| A43 | 18.10.2026 | Booking: Acts entfernen – archivieren oder löschen?                                                                                                         | offen | Entfernen mit Rückgängig und Eintrag in der Historie der Veranstaltung; Acts sind Listeneinträge, keine Kernobjekte.                                                                                                                                                                                                                          |
| A44 | 18.10.2026 | Partner: WF-VER-10 nennt beim Anlegen eine „Art“, das Datenmodell 3.5 kennt sie nicht.                                                                      | offen | Optionales Freitextfeld `kind` („Kollektiv“, „Verein“, „Firma“ …).                                                                                                                                                                                                                                                                            |
| A45 | 18.10.2026 | Partner haben keine eigene Navigation (3.5) – wie erreicht man die Liste (S-24)?                                                                            | offen | Aus dem Bereich „Partner“ einer Veranstaltung („Alle Partner ›“), über die Suche und die Plenum-Agenda; in der Seitenleiste gilt „Events“ als aktiv. Partner lassen sich (noch) nicht archivieren.                                                                                                                                            |
| A46 | 18.10.2026 | Partner-Namen eindeutig?                                                                                                                                    | offen | Ja, ohne Groß-/Kleinschreibung – verhindert doppelt angelegte Partner beim Verknüpfen.                                                                                                                                                                                                                                                        |
| A47 | 18.10.2026 | Vorlagen-Dialog „ohne Duplikate“: woran erkennt die App, was schon angelegt ist?                                                                            | offen | Eigene Tabelle template_applications (Veranstaltung, Vorlagenaufgabe, Aufgabe). Wird die Aufgabe gelöscht bzw. das Anlegen zurückgenommen, lässt sie sich erneut anlegen; Umbenennen der Aufgabe ändert nichts.                                                                                                                               |
| A48 | 18.10.2026 | Vorlagenfristen, die beim Anlegen schon vorbei wären (kurzfristige Veranstaltung).                                                                          | offen | Sie bekommen das heutige Datum.                                                                                                                                                                                                                                                                                                               |
| A49 | 18.10.2026 | Wer darf Vorlagen bearbeiten (WF-ADM-08 ohne Vorbedingung, liegt aber bei den Admin-Screens)?                                                               | offen | Alle Mitglieder, erreichbar unter Profil › Veranstaltungsvorlagen. Vorlagen haben keine Historie; Entfernen einer Vorlagenaufgabe mit Rückfrage statt Rückgängig.                                                                                                                                                                             |
| A50 | 18.10.2026 | Vorlagen-Dialog: was ist vorausgewählt?                                                                                                                     | offen | Alles noch nicht Angelegte; abwählen per Baustein oder einzeln.                                                                                                                                                                                                                                                                               |
| A51 | 19.10.2026 | Typ beim Verknüpfen aus Drive: Der Prototyp S-43 zeigt keinen, documents.doc_type ist Pflicht.                                                              | offen | Nur für neue Einträge eine Typ-Auswahl, vorbelegt „Sonstiges“; ein schon erfasstes Dokument behält seinen Typ.                                                                                                                                                                                                                                |
| A52 | 19.10.2026 | F-WIS-05 verlangt Dateien an Veranstaltungen und Terminen; deren Detailansichten zeigten verknüpfte Dokumente bisher nicht.                                 | offen | Abschnitt „Dokumente“ unten im Veranstaltungs- und im Termin-Detail (lösen, + verknüpfen über S-43). Im Plenum bleibt es beim Protokoll-Dokument.                                                                                                                                                                                             |
| A53 | 19.10.2026 | Wann gleicht die App mit Drive ab (3.13 „beim Öffnen“)?                                                                                                     | offen | Beim Öffnen des Drive-Reiters, von S-43 und des Veranstaltungs-Details; der Hinweis „In Drive nicht mehr vorhanden“ erscheint nach dem nächsten Abgleich.                                                                                                                                                                                     |
| A54 | 19.10.2026 | WF-VER-14: „Ordner aus S-43“ – S-43 wählt Dateien, keine Ordner.                                                                                            | offen | Eigener Dialog „Drive-Ordner wählen“ mit demselben Verzeichnis, nur Ordner; gewählt wird der gerade offene Ordner.                                                                                                                                                                                                                            |
| A55 | 19.10.2026 | Ordner als Dokument verknüpfen?                                                                                                                             | offen | Nein – F-WIS-05 spricht von Dateien; Ordner hängen nur als Drive-Ordner an Veranstaltungen.                                                                                                                                                                                                                                                   |
| A56 | 19.10.2026 | Wie viel vom Ordnerinhalt zeigt das Veranstaltungs-Detail?                                                                                                  | offen | Die ersten 6 Einträge, danach „Alle n Einträge ansehen“ in den Drive-Reiter. Wurzel heißt in den Testdaten „Myzel Drive“ (Frage 11.4).                                                                                                                                                                                                        |
| A57 | 19.10.2026 | Drive-Reiter und Zurück-Taste: der Prototyp wechselt Reiter ohne Adresse.                                                                                   | offen | Drive hat eine eigene Adresse /wissen/drive/:ordner (Zurück geht einen Ordner zurück, „im Drive suchen“ übergibt ?q=).                                                                                                                                                                                                                        |
| A58 | 19.10.2026 | Welche Wiederholungen braucht es (F-TER-02 „verständliche Auswahl“)?                                                                                        | offen | Wöchentlich, alle 2 Wochen, am 1. bis 4. oder letzten Wochentag im Monat, an einem Tag des Monats (bis 28.); gespeichert als RRULE. Die Auswahl richtet sich nach dem gewählten ersten Termin.                                                                                                                                                |
| A59 | 19.10.2026 | Wo legt man eine Serie an?                                                                                                                                  | offen | Im Formular „Neuer Termin“ über „Wiederholen“, optional „Bis“. Serien haben keine Veranstaltung und enden am selben Tag.                                                                                                                                                                                                                      |
| A60 | 19.10.2026 | „Serie beenden“ (F-TER-03): was passiert mit schon angelegten Terminen?                                                                                     | offen | Künftige Termine ab morgen entfallen (hat die Serie noch nicht begonnen: ab dem Tag nach ihrem ersten Termin, der stattfindet): wer schon eingeladen ist oder geantwortet hat, bekommt eine Absage, die übrigen verschwinden still (archiviert). Einzeln geänderte Termine bleiben.                                                           |
| A61 | 19.10.2026 | Geänderte Regel einer Serie: Termine, die nicht mehr passen?                                                                                                | offen | Wie beim Beenden: eingeladene abgesagt, übrige still entfernt; neue Tage entstehen sofort.                                                                                                                                                                                                                                                    |
| A62 | 19.10.2026 | Einladung „ca. 2 Wochen vorher“ und Nachricht bei geänderter Zeit (3.6).                                                                                    | offen | Einladung 14 Tage vorher im Joblauf. Bei geänderter Uhrzeit oder geändertem Ort bekommen nur schon Eingeladene eine Nachricht; alle anderen später die Einladung mit dem neuen Stand.                                                                                                                                                         |
| A63 | 19.10.2026 | Startbestand Bautag (Frage 11.5 Nr. 1 offen).                                                                                                               | offen | Jeden 3. Samstag, 10 bis 16 Uhr im Lager, ab dem ersten Termin nach den bisher von Hand angelegten Bautagen. Plenen bleiben einzeln angelegt (Frage 11.2 Nr. 4).                                                                                                                                                                              |
| A64 | 19.10.2026 | Was macht einen Serientermin zur Ausnahme (is_exception)?                                                                                                   | offen | Jede Einzeländerung oder Absage über „Nur dieser Termin“. Ausnahmen lassen spätere Serienänderungen in Ruhe.                                                                                                                                                                                                                                  |
| A65 | 19.10.2026 | Zeilen der Schalter-Matrix (F-PRO-02 „pro Ereignis“).                                                                                                       | offen | Wie im Prototyp: Zuweisung, Kommentar, Statusänderung, Blockade aufgehoben, Frist (vorher, am Tag, überfällig), Termine (Einladung, Erinnerungen, Änderung), Plenum-Zusammenfassung. Eine Zeile schaltet alle ihre Ereignisse zusammen.                                                                                                       |
| A66 | 19.10.2026 | Voreinstellung der Matrix: Der Prototyp zeigt gemischte Beispielwerte.                                                                                      | offen | Alles an, wie die festen Voreinstellungen bis P6 (6.1); eigene Statusänderungen aus (6.2).                                                                                                                                                                                                                                                    |
| A67 | 19.10.2026 | „Eigene Statusänderungen einschaltbar“ (6.2): wo?                                                                                                           | offen | Eigener Schalter unter der Matrix, gilt für beide Kanäle (members.notify_own_status).                                                                                                                                                                                                                                                         |
| A68 | 19.10.2026 | „Geänderte Einstellungen greifen sofort“ (Abnahme P6).                                                                                                      | offen | Abschalten nimmt auch Nachrichten zurück, die noch auf den nächsten Joblauf warten; Einschalten liefert nichts nach.                                                                                                                                                                                                                          |
| A69 | 19.10.2026 | Telegram-Buttons ohne echtes Telegram (Schritt A).                                                                                                          | offen | Die Demo-Werkzeuge im Profil zeigen unter jeder Telegram-Nachricht ihre Buttons; die Antwort des Bots erscheint als Hinweisleiste. In Schritt C ruft der Webhook dieselbe Server-Logik auf.                                                                                                                                                   |
| A70 | 19.10.2026 | „Passt nicht“: Wer zugewiesen hat, „wird benachrichtigt“ – mit welcher Nachricht?                                                                           | offen | Eigene Nachrichtenart „Zuweisung abgelehnt“ ohne Buttons, in der Matrix unter „Zuweisung“; nicht bei Selbsteintragung.                                                                                                                                                                                                                        |
| A71 | 19.10.2026 | „Übernehme ich“, wenn die Aufgabe nicht mehr neu oder geplant ist.                                                                                          | offen | Nichts ändern, nur bestätigen („der Status bleibt“). Wer nicht mehr eingetragen ist, bekommt einen Hinweis.                                                                                                                                                                                                                                   |
| A72 | 19.10.2026 | Welche Version gilt bei einem Button-Tipp? Der Chat kennt keine.                                                                                            | offen | Der aktuelle Stand; geprüft wird wie in der App. Geht die Aktion nicht (z. B. archiviert), antwortet der Bot freundlich und speichert nichts.                                                                                                                                                                                                 |
| A73 | 19.10.2026 | Was gehört in den Export (E-08)?                                                                                                                            | offen | Alle fachlichen Tabellen samt Historie. Nicht: Outbox, Jobläufe, Rückgängig, Push-Abos, Telegram-Verknüpfungen und -Codes, Drive-Cache, Benachrichtigungs-Einstellungen. Mitglieder ohne E-Mail und Login-ID, Partner ohne E-Mail und Telefon (die Ansprechperson als Name bleibt); in der Historie steht bei solchen Feldern nur „geändert“. |
| A74 | 19.10.2026 | Ziel des Exports (Frage 11.5 Nr. 2 offen).                                                                                                                  | offen | In Schritt A nur Aufbau, Schema und Download in den Demo-Werkzeugen; Repo und nächtlicher Lauf folgen in Schritt C.                                                                                                                                                                                                                           |

### Offene niedrige Befunde aus den Reviews (18.10.2026)

Nicht dringlich; vor Schritt C sichten.

- Phase 4: Vorlagenfristen rechnen in der Zeitzone des Geräts – in Schritt C (Server in UTC) fest mit
  Europe/Berlin rechnen; Vorlagenaufgaben werden endgültig entfernt, mit FK auf template_applications in
  Schritt C besser archivieren; die Aufgabenbeschreibung (WF-AUF-05) speichert wie früher die Nachbereitung
  gegen die Version beim Speichern – auf feldweises Locking umstellen; Partner nicht archivierbar.
- Phase 5: Ein „Per Link“ erfasstes Dokument ohne drive_file_id behält den Hinweis „In Drive nicht mehr vorhanden“
  nur, solange seine Datei noch im Cache steht; ein Neuaufbau ohne endgültig gelöschte Dateien nimmt ihn weg. In
  Schritt C beim Abgleich drive_file_id nachtragen, sobald die Datei im Cache auftaucht (mit Historie, als „Myzel
  (automatisch)“).
- Phase 6: „Auch eigene Statusänderungen“ ausschalten zieht schon wartende eigene Status-Nachrichten nicht zurück (die
  Outbox merkt sich nicht, dass eine Nachricht „eigen“ war); wer einen Kanal innerhalb von 14 Tagen vor einem
  Serientermin wieder einschaltet, bekommt dessen Einladung nachgeliefert (A68). In Schritt C eine Markierung
  „unterdrückt“ je Anlass bzw. „eigen“ in der Outbox. Telegram-Buttons prüfen nur, ob die Person verknüpft ist; der
  Webhook in Schritt C muss die chat_id des Callbacks gegen telegram_links.chat_id prüfen (alter Chat nach
  Neuverknüpfung).
- Wackelige Tests WF-PRO-02 und WF-AUF-07/-08 (18. und 19.10.2026) – Ursachen gefunden und behoben (19.10.2026):
  Die Push- und Telegram-Kacheln boten „Einschalten“ schon an, solange der Stand noch lud, und schluckten den Tipp
  (jetzt „Lädt …“); der Blockieren-Test prüfte den Grund, bevor der Dialog zu war. Hinweis für lokale Läufe: Bleibt
  ein alter Testlauf oder Dev-Server hängen, nutzt Playwright dessen Vorschau auf Port 4173 mit (reuseExistingServer)
  – dann laufen die Tests gegen einen alten Build und doppelt so langsam.

- Erster Kanal: Wer weder Push noch Telegram hat, bekommt beim Einschalten alle angefallenen Erinnerungen
  auf einmal (Phase 2; Frage zu A-Annahmen „keine Nachlieferung“).
- Fristerinnerungen gehen bei jedem Lauf ab 9 Uhr bis Mitternacht raus statt einmal gegen 9 Uhr; fällt der
  Job einen ganzen Tag aus, fehlt „Frist heute“ (Phase 2).
- iPad-Erkennung für die iPhone-Anleitung; Ziel eines Nachrichten-Links geht beim Anmelden verloren;
  abgelaufener Telegram-Code bleibt im Profil sichtbar; feste Farben in Reachability.tsx und bits.tsx.
- Rückgängig einer im Plenum mit angelegten Aufgabe prüft nicht, ob jemand sie inzwischen geändert hat;
  Herkunft (origin_plenum_id) steht nicht als „alt → neu“ in der Historie; wiederhergestellte Markierung
  kann eine Position doppelt belegen; Suche bietet „+ Agenda“ auch für nicht markierbare Treffer an.
- Wissen/Termine: Undo von „Hat stattgefunden“ setzt die Teilnahme als Ganzes zurück; Historie nennt bei
  Quelle Plenum „im Plenum angelegt“; Hinweis zu Benachrichtigungen beim Verschieben zählt die handelnde
  Person mit; key einer Terminart aus Umlauten; künftige Plenen als Quelle wählbar.

## Entscheidungsprotokoll

| Datum      | Entscheidung                                                                                                                                                                                                                                                                                                                        | Begründung                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11.10.2026 | Stack wie 2.1, aktuelle Versionen: React 19, Vite 8, Tailwind 4, zod 4, TypeScript 6, react-router 7.                                                                                                                                                                                                                               | Von der Nutzerin bestätigt.                                                                                                                                             |
| 11.10.2026 | Server-Code in Schritt C mit Kysely (7.2 lässt Kysely oder Drizzle offen).                                                                                                                                                                                                                                                          | Schlank, Transaktionen direkt, Typen aus dem Schema; keine eigene Migrations-Schicht neben der Supabase CLI.                                                            |
| 11.10.2026 | Schriften (Space Grotesk, JetBrains Mono) werden über @fontsource mit der App ausgeliefert statt von Google Fonts geladen.                                                                                                                                                                                                          | Datenschutz (keine Abrufe bei Google) und die PWA funktioniert ohne Netz.                                                                                               |
| 11.10.2026 | Regel-Bibliothek in src/shared ohne Browser-Abhängigkeit; die Testdaten-Schicht (src/data/mock/server.ts) ist wie die späteren Server-Funktionen geschnitten: Kontext mit handelnder Person, Transaktion, Historie.                                                                                                                 | Schritt C übernimmt Regeln und Tests, nur die Speicherung wird getauscht.                                                                                               |
| 11.10.2026 | „Rückgängig“ ist eine eigene Server-Funktion mit Token: Die Aktion merkt sich ihre Gegenschritte (Status, eingetragene Person, Markierung, Abhängigkeit), 30 Sekunden gültig, nur für die Person selbst, mit Versionsprüfung und Historien-Eintrag.                                                                                 | Nur so lässt sich z. B. „neu → geplant“ vollständig zurücknehmen, obwohl kein regulärer Übergang zurück zu „neu“ führt (4.1, WF-ALL-02).                                |
| 11.10.2026 | `version` einer Aufgabe steigt bei Feldern, Status, Archiv und Bearbeitenden. Folgende, Kommentare, Markierung und Abhängigkeiten sind eigene Einträge und erhöhen sie nicht.                                                                                                                                                       | Zwei gleichzeitige Einträge sollen beide gelingen (10.1); ein Kommentar darf fremde Bearbeitungen nicht in den Konflikt schicken.                                       |
| 11.10.2026 | Ein Historien-Eintrag je Aktion; Folgewirkungen (Markierung entfernt, automatisch eingetragen, Status zurück) stehen als weitere Felder im selben Eintrag.                                                                                                                                                                          | Lesbarer Verlauf: ein Satz je Aktion.                                                                                                                                   |
| 11.10.2026 | Schritt A: Anmeldung über erfundene Testkonten (example.org), Daten im localStorage des Browsers, relativ zu „heute“ erzeugt. Demo-Werkzeuge im Profil (Netzfehler, fremde Änderung, Zurücksetzen) sind mit `data-demo` markiert.                                                                                                   | Keine echten Konten und keine Datenbank in Schritt A; Konflikt und Netzfehler müssen in der Durchsicht ausprobierbar sein. Entfällt mit Schritt C.                      |
| 11.10.2026 | Desktop: Seitenleiste, Liste und Detail nebeneinander ab 1024 px; Sheets werden dort zu zentrierten Dialogen.                                                                                                                                                                                                                       | 8.3; der Prototyp zeigt nur mobil.                                                                                                                                      |
| 11.10.2026 | Hinweistexte nutzen „Text leise“ (#A69FB8) statt des dunkleren Grautons mancher Prototyp-Anmerkungen.                                                                                                                                                                                                                               | Kontrast mindestens 4.5:1 (8.2).                                                                                                                                        |
| 11.10.2026 | Git: lokales Repo auf `main`, Zeilenenden LF (.gitattributes). Kein Push, bis Frage 2 geklärt ist.                                                                                                                                                                                                                                  | Häufige Commits (0.2) ohne Vorgriff auf den Ablageort.                                                                                                                  |
| 11.10.2026 | Aktionen einer Detailansicht laufen in einer Warteschlange nacheinander; die `version` wird erst beim Start gelesen. Nach einem Netzfehler wartet die Aktion auf „Nochmal“ oder das Schließen der Meldung.                                                                                                                          | Schnelle Tipps gehen nicht verloren und erzeugen keinen Konflikt mit sich selbst; Folgeschritte (Sheet schließen, Entwurf löschen) laufen genau einmal (Review-Befund). |
| 11.10.2026 | Die Testdaten-Schicht liest den Stand vor jedem Zugriff neu aus dem Browser-Speicher.                                                                                                                                                                                                                                               | Zwei Tabs überschreiben sich nicht mehr still; der Versionskonflikt ist auch in der Vorschau echt auslösbar (Review-Befund).                                            |
| 12.10.2026 | Reihenfolge geändert: Schritt A für alle Phasen nacheinander, ohne Abnahme dazwischen; Durchsicht, Daten/Server und Deploy erst danach. docs/ANFORDERUNGEN.md (0.1, 0.2, 10, 12) entsprechend angepasst.                                                                                                                            | Auftrag der Nutzerin vom 12.10.2026: „erstmal Frontend abschließen, deployt wird erst, wenn alles fertig ist“.                                                          |
| 12.10.2026 | Nachrichten hängen an ihrer Aktion: „Rückgängig“ zieht noch nicht verschickte Nachrichten zurück; je Anlass wird nur einmal eingereiht, auch wenn später ein weiterer Kanal dazukommt.                                                                                                                                              | Kein Fehlversand und keine Nachlieferung alter Erinnerungen (Review-Befunde Phase 2).                                                                                   |
| 18.10.2026 | Feldweises Optimistic Locking für die Detailbereiche: Jede Speicherung schickt den Ausgangswert des Feldes mit (`expected`); Konflikt nur, wenn genau dieses Feld inzwischen geändert wurde. So lassen sich verschiedene Bereiche parallel pflegen, ohne still zu überschreiben.                                                    |
| 18.10.2026 | Detailbereiche einer Veranstaltung als eine Zeile je Veranstaltung (event_details, je Bereich eine Spaltengruppe, in Schritt C jsonb mit zod-Schema); Felder werden einzeln mit Versionsprüfung an der Veranstaltung gespeichert. Acts (event_bookings) und Hauptverantwortliche (event_leads) sind eigene Tabellen, eintragsweise. |
| 20.10.2026 | Drive-Wurzelordner als Umgebungsvariable GOOGLE_DRIVE_ROOT_FOLDER_ID (nicht geheim), optional GOOGLE_DRIVE_EXCLUDED_FOLDER_IDS (kommagetrennt), Schlüssel in GOOGLE_SERVICE_ACCOUNT_JSON (geheim). Weicht die ID von drive_sync_state.root_folder_id ab, baut der Abgleich den Cache vollständig neu auf (Schritt C).               |
| 12.10.2026 | Markierung „Fürs Plenum“, Rückgängig und Historie sind in der Testdaten-Schicht für alle Objektarten gemeinsam gebaut (eine Tabelle plenum_marks mit Zielspalten, 3.14).                                                                                                                                                            | Fragen, Entscheidungen, Veranstaltungen, Termine und Dokumente nutzen dieselben Regeln wie Aufgaben.                                                                    |

## Abnahmen

Noch keine.
