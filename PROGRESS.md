# Myzel – Fortschritt

Geführt vom Agenten. Quelle der Anforderungen: docs/ANFORDERUNGEN.md.

## Status

**Aktuell: Schritt C für P1 bis P5 fertig, je zwei Review-Runden ohne offene Befunde hoher oder mittlerer Schwere
(22.10.2026). Als Nächstes: Verbesserungen der Nutzerin (unten), dann Deploy (Abschluss 10.7 für P1 bis P5), danach
Phase 6.** Reihenfolge seit 22.10.2026: erst Deploy, dann Phase 6.

### Plan bis zum Deploy (22.10.2026)

1. [x] Alte Testdaten in Supabase löschen (1 Aufgabe, 1 Veranstaltung, ihre Historie, 1 Joblauf) – am 25.10.2026 auf
       Wunsch der Nutzerin vom Agenten ausgeführt, in einer Transaktion; Historienschutz danach wieder aktiv geprüft
2. [x] Verbesserungen der Nutzerin (Migration 20261023000003, ANFORDERUNGEN.md nachgezogen), je in Testdaten-Schicht, Server, Oberfläche, Tests und ANFORDERUNGEN.md:
   - [x] Blockiert: Grund nur Pflicht ohne Abhängigkeit („blockiert ⇒ Grund oder Abhängigkeit“)
   - [x] Anlegen mit Thema „Veranstaltungen“: Verknüpfung mit einer Veranstaltung direkt vorschlagen (nicht Pflicht)
   - [x] Markierung „Fürs Plenum“ setzen und entfernen ohne Historien-Eintrag (auch das Entfernen beim Statuswechsel)
   - [x] Benachrichtigungen standardmäßig aus (alle Zeilen der Matrix); auf dem Server mit der Matrix in Phase 6, bis
         dahin die festen Voreinstellungen aus 6.1 für alle, die Push oder Telegram selbst einschalten
   - [x] Bot heißt „Myzo“ (@myzo_the_bot)
   - [x] Veranstaltung: Detailbereich „Rahmen“ entfällt
   - [x] Eintritt: frei – keine Felder; Spende – „Empfehlung“ und „Verantwortung Kasse“; fester Preis – „Preis“ und
         „Verantwortung Kasse“
   - [x] Bar und Eintritt erscheinen nach dem Aufklappen doppelt – beheben
   - [x] Booking: Gage als Auswahl offen / nein / ja, Betrag nur bei „ja“
   - [x] Themen: „Verein“ ohne Unterkategorien, neues Thema „Sonstiges“ auf oberster Ebene (hebt Frage 6 auf)
   - [x] Demo-Modus bleibt nach dem Produktivgang: Knopf „Demo ansehen“ auf der Anmeldeseite, Testdaten nur im
         Browser, ohne Konto, mit Hinweisband
   - [x] Zweite Runde (24.10.2026), ANFORDERUNGEN.md 3.10, 5.8, 6.2, 8.3 und Änderungsprotokoll nachgezogen:
     - [x] Historie nur mit dem, was für andere relevant ist: selbst folgen und entfolgen ohne Eintrag (wer eine
           andere Person einträgt oder entfernt, bleibt drin); Rückgängig einer Aktion ohne Historie bleibt still
           (gilt auch für Markierungen)
     - [x] Große Bildschirme: Listenspalte wächst mit (400/440/500 px), Detail mittig bis 760 bzw. 880 px;
           Profil und Verwaltung mittig bis 720 px
     - [x] Einheitlich „Fürs Plenum markieren“ / „Fürs Plenum markiert“ (Wissen und Termine hießen „Markieren“)
     - [x] „⋯“ an der Aufgabe öffnet ein Menü mit „Archivieren“; Bestätigung nur bei Kommentaren (wie WF-AUF-14),
           sonst sofort mit Rückgängig
     - [x] Frage-Detail in Wissen: Hinweis „Im Plenum geklärt, wird das Plenum automatisch zur Quelle“ klang, als
           ginge Klären nur im Plenum – jetzt „Klären geht jederzeit hier, nicht nur im Plenum …“
     - [x] Demo: Bereich „Vorschau mit Testdaten“ im Profil restlos entfernt (Nachrichtenliste mit Telegram-Buttons,
           Netzfehler, fremde Änderung, Joblauf, Ausfall, Drive-Datei anlegen/löschen, Export, Zurücksetzen); die
           Werkzeuge bleiben nur für die Tests (window.__myzelDemo), „Zurücksetzen“ entfällt ganz. E2E telegram.spec und
           der WF-ALL-04-Test über die Nachrichtenliste entfallen; die Telegram-Logik prüfen weiter die Unit-Tests.
           Prototyp S-41: Hinweis wie in der App
     - [x] Kein Schalter „Auch eigene Statusänderungen“: eigene Statusänderungen werden nie gemeldet
           (members.notify_own_status entfällt im Datenvertrag; in der Datenbank gab es die Spalte nie)
3. [x] Netlify-Variablen setzen, Mitglieder importieren (`npm run db:import-members`), Push = Produktions-Deploy
       (25.10.2026: Migration 20261023000003 eingespielt, fehlende Variablen gesetzt – geheime nur im Kontext
       „production“; VAPID_SUBJECT in Netlify = App-Adresse, weil „mailto:“ in der .env ohne Adresse ist;
       10 Mitglieder angelegt, 1 aktualisiert). Live seit 25.10.2026 (Deploy 6adddfd1, lokal gebaut mit
       `netlify deploy --build --prod`): der Build von Netlify nach dem Push brach ab, weil der Secrets-Scan öffentliche
       Werte (VITE_MYZEL_BACKEND, VITE_SUPABASE_URL, VAPID_SUBJECT) im Repo fand – jetzt in netlify.toml unter
       SECRETS_SCAN_OMIT_KEYS. Datenbank-Tests (PGlite) und Smoke-Tests vorerst nicht in `npm run check` und der CI
       (Nutzerin, 25.10.2026: die CI brach seit dem 19.10. am Zeitlimit ab), getrennt mit `npm run test:db`
4. [ ] Nach dem Deploy: Telegram-Webhook (gesetzt 25.10.2026), cron-job.org (Nutzerin), Test-Checkliste; Abweichung von 10.7 (keine Vorschau
       mit Beispieldaten, es gibt nur ein Supabase-Projekt) von der Nutzerin freigegeben. Auf die Test-Checkliste
       gehört WF-ALL-04 (Push- bzw. Telegram-Link auf dem Handy antippen → Zielansicht öffnet sich direkt): seit dem
       Wegfall der Nachrichtenliste in der Demo prüft das kein E2E-Test mehr (24.10.2026)

### 10.0 Vorbereitung

- [x] Stack (2.1) bestätigt (11.10.2026); übrige Fragen aus 11.1 unten gesammelt
- [x] Repo-Gerüst: Vite/React/TS, Tailwind, PWA, ESLint/Prettier, Vitest, Playwright
- [ ] Supabase-Projekt (EU, angelegt) + lokale Entwicklung (PGlite, ohne Docker); Netlify-Site (angelegt);
      .env.example (angelegt 20.10.2026); Werte in .env und Netlify – zu Schritt C
- [ ] `npm run check` lauffähig (Schritt A: Lint, Typecheck, Unit, E2E – DB-Tests, check:integrity und
      YAML-Validierung kommen mit Schritt C); GitHub Actions CI angelegt, läuft, sobald das Repo auf GitHub liegt;
      kein wöchentlicher Dump (Frage 8)
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

- [x] Durchsicht durch die Nutzerin (20.10.2026); offen nur noch Frage 4 und 6

Schritt C – Daten und Server (Checkliste 10.1):

- [x] Datenmodell als Migrationen: members (inkl. short und Systemeintrag), topics (+Seed), tasks mit
      task_assignees, task_followers, task_blockers, comments; plenum_marks; events schlank; history
- [x] Server-Funktionen: Statusübergänge (4.1), Pflichtregeln, Rechte, Optimistic Locking, Historie,
      „Mitglied deaktivieren“ für Aufgaben
- [ ] Login mit Google und E-Mail-Link, Mitgliederprüfung (F-LOG-01, -02) – Google am Entwicklungsprojekt
      geprüft (21.10.2026); erste Admin-Person per `npm run db:first-admin`; offen: Mail-Link am echten Projekt
      (Flow „implicit“, damit der Link auch in einem anderen Browser aufgeht)
- [ ] Admin-Bereich Mitglieder und Themen (F-LOG-03, F-PRO-04); Profil mit Name und Abmelden (F-LOG-04)
- [ ] App-Gerüst, Aufgaben (F-AUF-01 bis -07, -09), Veranstaltungen schlank (F-VER-01 bis -03) am echten Backend
      – lokal mit `npx netlify dev` von der Nutzerin durchgeklickt (21.10.2026); Bereiche späterer Phasen melden
      „Das kommt mit einer späteren Phase“, Lesen späterer Felder liefert leere Werte
- [x] Datenschutzhinweis in der App (Region Irland, Server-Funktionen bei Netlify, Google-Login)
- [x] `npm run check:integrity`: nur lesend, auch gegen Produktion; gegen das Entwicklungsprojekt ohne Befund
- [x] `npm run test:smoke`: Playwright gegen die App im Modus „backend“, dieselbe HTTP-Schicht und Postgres
      (PGlite), nur der Supabase-Login nachgestellt; Teil von `npm run check`
- [ ] Verträge zur Auftragsverarbeitung mit Supabase und Netlify (Nutzerin, vor Schritt D)

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

- [x] Datenmodell: push_subscriptions, telegram_links, telegram_link_codes, notification_outbox, job_runs;
      members.reminder_lead_days (Migration 20261022000001, im Entwicklungsprojekt eingespielt); personenbezogene
      Tabellen ohne Lesezugriff über Supabase
- [x] Server-Logik (server/p2/notify.ts): Outbox mit dedupe_key, Nachrichten bei Zuweisung, Kommentar, Status,
      Blockade aufgehoben; Fristerinnerungen ab 9 Uhr in Köln; bis zu 3 Versuche; Rückgängig zieht Wartendes zurück;
      gleichzeitige Jobläufe verschicken nichts doppelt; Deaktivieren entfernt Abos und Verknüpfung. Die
      Benachrichtigungs-Tests der Testdaten-Schicht laufen auch gegen den Server.
- [ ] Web-Push: Abo im Browser über den Service Worker (public/push-sw.js), Versand mit VAPID (web-push), ungültige
      Abos entfernt – Test auf echten Geräten erst mit dem Deploy (in der Entwicklungsansicht gibt es keinen
      Service Worker)
- [ ] Telegram: Bot-Webhook /telegram/webhook mit Secret, Verknüpfung per /start-Code, Hinweis für unverknüpfte
      Chats, Nachrichten mit Link – offen: Bot bei @BotFather anlegen (Nutzerin), Webhook setzen nach dem Deploy
- [x] Ereignisse aus 6.2 mit Phase P2, feste Voreinstellungen (6.1)
- [ ] Job alle 15 Minuten: Function /jobs/run mit CRON_SECRET, Laufprotokoll, Statusanzeige – lokal gegen das
      Entwicklungsprojekt geprüft; offen: cron-job.org einrichten nach dem Deploy (Anleitung unten)
- [x] check:integrity (alte wartende Nachrichten, Joblauf, Kanäle Deaktivierter); Tests (Server: Versand,
      Wiederholung, 404/410, 9 Uhr Köln, Telegram-Bot; Smoke: Telegram-Code und Systemstatus)
- [ ] Phasenabschluss (10.7)

Agent-Review Phase 2 (22.10.2026, zwei Reviews): 2 hoch, 5 mittel – eingearbeitet:

- Versuche zählen erst beim Versand; ausgeschöpfte Nachrichten werden „fehlgeschlagen“ statt ewig zu warten;
  Zeitbudget je Lauf (6 s) und Zeitgrenze je Aufruf (4 s); Fehler beim Einreihen halten den Versand nicht auf.
- Outbox mengenweise (je Tabelle eine Abfrage, ein Insert) – auch bei vielen Fristerinnerungen.
- Telegram: blockierter Bot oder gelöschter Chat beendet die Verknüpfung; 429 zählt nicht als Versuch; Bot-Token
  nie in Fehlermeldungen.
- Push: an jedes Gerät höchstens einmal (Migration 20261022000002, delivered_to); nur Adressen bekannter
  Push-Dienste, Schlüssel geprüft, kein Übernehmen fremder Geräte; Antippen öffnet nur Ansichten der App.
- Systemstatus und check:integrity warnen nach dem letzten erfolgreichen Lauf; abgeschaltete Kanäle zählen nicht
  als Fehler; Aufräumen nach 30 Tagen (Nachrichten, Läufe), benutzte Telegram-Codes sofort.
- Datenschutzhinweis ergänzt: Inhalte der Nachrichten, Push-Dienste der Browser, Telegram, Löschung nach 30 Tagen
  (Entwurf zur Freigabe durch die Nutzerin).

Zweite Runde (22.10.2026): 0 hoch, 2 mittel – eingearbeitet: Liste der Push-Dienste war durch fehlende Maskierung
umgehbar (jetzt exakt, mit Test für nachgebaute Adressen); „überfällig“ kommt nur in der ersten Woche nach der Frist,
damit das Aufräumen nach 30 Tagen keine Wiederholung auslöst (Testdaten-Schicht und Server). Dazu: Push an alle
Geräte gleichzeitig, Telegram-Verknüpfung endet nur für den betroffenen Chat, Systemstatus unterscheidet „kein Lauf“
von „Läufe mit Fehler“. Ergebnis: keine Befunde hoher oder mittlerer Schwere offen.

Offen, niedrig: Fristerinnerungen reihen jeden Lauf ab 9 Uhr ein (nicht nur einmal gegen 9 Uhr – eine Zuweisung um
20 Uhr an eine in 2 Tagen fällige Aufgabe meldet sofort „noch 2 Tage“, wie in der Testdaten-Schicht); im Profil steht
nicht, mit welchem Telegram-Konto verknüpft ist; ein Chat, der mit einem fremden Code verknüpft wird, wechselt still;
wiederholtes Ein- und Austragen erzeugt je Zuweisung eine Nachricht. Region der Netlify Functions vor Schritt D auf
EU (Frankfurt) prüfen – die Datenbank liegt in Irland.

Einrichtung für die Nutzerin (nach dem Deploy):

1. Telegram: bei @BotFather mit /newbot einen Bot anlegen; Token als TELEGRAM_BOT_TOKEN, Namen ohne @ als
   TELEGRAM_BOT_USERNAME in .env und Netlify; danach `npm run telegram:webhook`.
2. cron-job.org: Job alle 15 Minuten, POST auf https://myzel-app.netlify.app/jobs/run, Header
   „Authorization: Bearer <CRON_SECRET>“.
3. In Netlify eintragen: VITE_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET,
   TELEGRAM_WEBHOOK_SECRET (Werte aus der .env).

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

- [x] Datenmodell (Migration 20261022000003, im Entwicklungsprojekt eingespielt): appointment_types mit den fünf
      Arten als Startbestand, appointments, appointment_rsvps, appointment_attendees, tasks.appointment_id und
      origin_plenum_id, decisions (Quelle Pflicht, auch als Check-Constraint), questions, documents mit
      document_links; plenum_marks für Fragen, Entscheidungen, Veranstaltungen, Termine und Dokumente
- [x] Admin-Bereich Terminarten (F-TER-06); Termine F-TER-01, -04, -05; Plenum F-PLE-01 bis -04 und F-AUF-08 mit
      genau einem Rückgängig je Plenum-Aktion; Wissen F-WIS-01, -02, F-FRA-01, -02, F-WIS-03, F-AUF-05, F-WIS-06
      (server/p3). Die Tests der Testdaten-Schicht für Termine, Plenum und Wissen laufen auch gegen den Server.
- [x] Ereignisse aus 6.2 mit Phase P3: Einladung, Erinnerung 3 Tage und 1 Stunde vorher (Joblauf), abgesagt und
      verschoben, Plenum-Zusammenfassung; Server rechnet Texte in Kölner Zeit (server/core/berlin.ts)
- [x] „Mitglied deaktivieren“ entfernt künftige Zusagen (in derselben Transaktion)
- [x] check:integrity (Markierungen aller Arten, Quelle Plenum, Kreise bei ersetzten Einträgen, verwaiste
      Dokument-Verknüpfungen, Zusagen Deaktivierter); Smoke-Tests: Zusage, Plenum-Agenda mit Einplanen und
      Rückgängig, Frage stellen
- [x] Agent-Review – Runde 1 (22.10.2026, zwei Reviews): 1 hoch, 4 mittel – eingearbeitet:
      Rückgängig von „Aufgabe dazu anlegen“ ließ die Zeile im Ergebnis stehen (jetzt immer ein Eintrag
      „rückgängig gemacht“, Test auf beiden Schichten); check:integrity zählt „created_as_replacement“ und
      „created_from_question“ als angelegt; Rückgängig sperrt das Plenum gegen ein gleichzeitiges Abschließen; das
      Plenum lässt sich nicht aus sich selbst heraus verschieben oder absagen (auch in der Testdaten-Schicht);
      ungültige IDs und Teilnahmelisten sind „gibt es nicht“ statt Serverfehler. Dazu: Rückgängig einer Zusage nur,
      solange Zusagen möglich sind; alt → neu auch für Frist, Herkunft, Zeiten und Zusagen; Archiviertes nicht
      markieren oder verknüpfen; Dokument-Links mit „HTTPS://“; Index für das Ergebnis (Migration 20261022000004).
      Runde 2 (22.10.2026): 0 hoch, 0 mittel; niedrige eingearbeitet (Meldungstext, Testdaten-Schicht gleichgezogen:
      Rückgängig einer Zusage und Archiviertes). Offen, niedrig: Smoke-Test für „Plenum abschließen“ über die
      Oberfläche (über die Server-Tests gedeckt); seltene Verklemmung zwischen Rückgängig und gleichzeitiger
      Plenum-Aktion am selben Objekt wird einmal wiederholt.
      Geklärt (22.10.2026): Alle Agenda-Aktionen verlangen einen Punkt, der noch auf der Agenda steht.
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

- [x] Datenmodell (Migration 20261022000005, im Entwicklungsprojekt eingespielt): event_details (jsonb nach
      eventDetailsSchema, eine Zeile je Veranstaltung), event_bookings, event_leads, partners, event_partners,
      setup_at, teardown_at, shift_plan_document_id, event_templates, event_template_items (archivieren statt
      löschen), template_applications; plenum_marks für Partner. Startinhalt der Vorlagen per
      `npm run db:seed-templates` aus der YAML-Datei (im Entwicklungsprojekt: 23 Vorlagenaufgaben)
- [x] Detailbereiche mit feldweiser Konfliktprüfung (F-VER-04), Partner (F-VER-05), Hauptverantwortliche,
      Schichtplan, Vorschlag „In Nachbereitung“; Vorlagen-Dialog ohne Duplikate mit Fristen nach Kölner Kalender
      (F-VER-06, -07), Vorlagen bearbeiten (server/p4). Die Tests der Testdaten-Schicht für Veranstaltungen,
      Partner und Vorlagen laufen auch gegen den Server.
- [x] „Mitglied deaktivieren“ trägt Hauptverantwortliche und Partner-Kontakt aus
- [x] check:integrity (Deaktivierte als Hauptverantwortliche/Kontakt, Vorlagenaufgaben an der richtigen
      Veranstaltung, Detailbereiche); Smoke-Test: Party mit Vorlagen-Dialog, Detailbereich pflegen
- [x] Agent-Review (22.10.2026): 0 hoch, 1 mittel – check:integrity meldete eine erlaubt umgehängte Vorlagenaufgabe
      als Fehler (jetzt Hinweis); dazu Detailbereiche auf jeder Ebene aufgefüllt, Sperrreihenfolge bei Acts und
      Vorlagen vereinheitlicht. Offen, niedrig: Partner-Liste liefert Mail und Telefon mit, beide stehen alt → neu in
      der Historie; Website ohne Adressprüfung (die Oberfläche setzt https:// davor); Beschreibung aus der Vorlage
      nicht im Eintrag „angelegt“.
      Zur Durchsicht: Hängt jemand eine Aufgabe aus einer Vorlage an eine andere Veranstaltung, gilt die
      Vorlagenaufgabe bei der ersten weiter als angelegt (wie in der Testdaten-Schicht). Soll sie dort wieder
      anlegbar werden?
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

- [x] Test mit dem echten Vereins-Drive (22.10.2026): Dienstkonto myzel-app@myzel-app.iam.gserviceaccount.com
      (Projekt myzel-app, Drive-API aktiv, nur lesend), Wurzel „MYZEL_DOCS“ freigegeben; Einlesen 332 Einträge
      (62 Ordner) in gut 2 s, Changes-API antwortet. Schlüssel in .env als eine Zeile, in Netlify vorhanden
- [ ] Datenmodell (Migration 20261023000001): drive_items, drive_sync_state (eine Zeile), events.drive_folder_id;
      Lesen für aktive Mitglieder – offen: im Entwicklungsprojekt einspielen (Nutzerin, `npx supabase db push`)
- [x] Inhaltsverzeichnis aus dem Cache, Abgleich über die Changes-API höchstens einmal pro Minute mit Sperre gegen
      doppelte Abfragen, Neuaufbau bei ungültigem Token, „Neu einlesen“ und wöchentlich im Joblauf (F-WIS-04, -08);
      Verknüpfen mit einem Eintrag je Datei (F-WIS-05, -06), „In Drive nicht mehr vorhanden“ auch für Inhalte
      gelöschter Ordner, Drive-Ordner der Veranstaltung (F-VER-03); Quelle austauschbar (server/p5/source.ts:
      Google über das Dienstkonto, nachgebautes Drive für Tests und Smoke-Server). Die Drive-Tests der
      Testdaten-Schicht laufen auch gegen den Server.
- [x] check:integrity (Neuaufbau älter als 8 Tage, verknüpfte Dateien und Ordner der Veranstaltungen nicht mehr
      im Drive – auch über gelöschte Elternordner); Smoke-Test: Drive öffnen, Datei mit Aufgabe verknüpfen
- [x] Agent-Review – Runde 1 (22.10.2026, zwei Reviews): 1 hoch, 7 mittel – eingearbeitet (Migration
      20261023000002): Google wird nie in einer offenen Transaktion gefragt (kurz beanspruchen, fragen, kurz
      schreiben; gleichzeitige Abgleiche fragen nur einmal), Gesamtbudget 7 s je Anfrage, ein fehlgeschlagener Versuch
      zählt (höchstens einmal pro Minute erneut, im Joblauf stündlich); Neuaufbau im Joblauf nach dem Versand mit dem
      Restbudget; doppelte Einträge beim Einlesen zusammengefasst; Versionsprüfung beim Verknüpfen; im Cache nur der
      Vereinsordner (ausgeschlossene Ordner sind eine Grenze) plus verschwundene Einträge, auf die etwas verweist –
      so bleibt „In Drive nicht mehr vorhanden“ auch nach „Neu einlesen“; Drive-Index je Anfrage nur einmal geladen.
      Dazu: leerer Ordnername abgelehnt, ein Dokument je Datei auch strukturell (Unique-Index nur über nicht
      archivierte), Änderungen ohne Datei-ID übersprungen, check:integrity meldet „noch nie eingelesen“, Abgleich
      meldet sich in der App nur, wenn wirklich nachgefragt wurde; Veranstaltungs-Detail gleicht nur mit Ordner ab.
      Server-Tests server/p5/drive.test.ts für Ausfall, Wurzelwechsel, Ausschlüsse, leeren Cache, Verschieben,
      Joblauf und Gleichzeitigkeit.
      Annahmen: Der Vereinsordner liegt in „Meine Ablage“ (nicht in einer geteilten Ablage) – sonst bräuchte das
      Einlesen corpora=drive. check:integrity rechnet ohne GOOGLE_DRIVE_EXCLUDED_FOLDER_IDS und prüft „Per Link“
      erfasste Dokumente ohne drive_file_id nicht (die App zeigt den Hinweis trotzdem).
      Runde 2 (22.10.2026): Befunde aus Runde 1 behoben; 0 hoch, 1 mittel – ein hereingeschobener Ordner (z. B. aus
      einem ausgeschlossenen) stand ohne Inhalt da, weil Drive nur den Ordner meldet; jetzt liest der nächste Abgleich
      neu ein (auch bei neu angelegten Ordnern, ein Neueinlesen dauert gut 2 s) – eingearbeitet mit Test; niedrige
      eingearbeitet: „Neu einlesen“ kurz nacheinander nur einmal, ohne eingerichtetes Drive klare Meldung statt
      „nicht erreichbar“, archivierte Dokumente halten ihren Drive-Eintrag. Ergebnis: keine Befunde hoher oder
      mittlerer Schwere offen.
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

| Nr. | Datum      | Frage                                                                               | Stand   | Antwort                                                                                                                                                                                              |
| --- | ---------- | ----------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 11.10.2026 | Technischer Stack (2.1) so in Ordnung?                                              | geklärt | Ja, wie in 2.1 (11.10.2026)                                                                                                                                                                          |
| 2   | 11.10.2026 | Wo liegt das Repo (GitHub-Account/Organisation)? Name der Netlify-Site oder Domain? | geklärt | Repo: github.com/annikalenneper/myzel-app (öffentlich); Netlify-Site myzel-app, https://myzel-app.netlify.app/ (19.10.2026)                                                                          |
| 3   | 11.10.2026 | Wem gehört das Supabase-Projekt? Zweite Person mit Zugang?                          | geklärt | Projekt https://wyfsorojbcijkedlnmji.supabase.co, Region eu-west-1 (Irland, EU, bestätigt); Inhaberin: die Nutzerin; zweite Person folgt später – vor dem Deploy (Schritt D) nachfragen (20.10.2026) |
| 4   | 11.10.2026 | Mitgliederliste (Name + Google-Mail) und wer Admin ist                              | geklärt | Liste lokal in mitgliederliste.md (nie im Repo), Import mit dem Deploy (22.10.2026)                                                                                                                  |
| 5   | 11.10.2026 | Veranstaltungsarten: Party, Konzert, Workshop, Soli-Event, Sonstiges?               | geklärt | Party, Workshop, Soli-Event, Sonstiges – ohne Konzert (20.10.2026)                                                                                                                                   |
| 6   | 11.10.2026 | Unterkategorien „Verein“ bestätigen (3.2)                                           | geklärt | Keine Unterkategorien, dazu „Sonstiges“ (22.10.2026)                                                                                                                                                 |
| 7   | 11.10.2026 | Uhrzeit für tägliche Fristerinnerungen ab P2 (Vorschlag 9:00 Uhr)                   | geklärt | 9:00 Uhr (20.10.2026)                                                                                                                                                                                |
| 8   | 11.10.2026 | Backup bis Phase 6: wöchentlicher Dump nötig?                                       | geklärt | Nein – durchziehen bis zur echten Nutzung; dann sichert der nächtliche Export (20.10.2026)                                                                                                           |
| 9   | 11.10.2026 | Ortsangabe des Lagers für den Bautag; übliches Format des Plenums                   | geklärt | Adresse von der Nutzerin genannt, steht bewusst nicht im öffentlichen Repo – beim Einrichten unter Terminarten als Standardort des Bautags eintragen; Plenum meist online (20.10.2026)               |
| 10  | 11.10.2026 | Braucht es einen Hell-Modus?                                                        | geklärt | Nein (20.10.2026)                                                                                                                                                                                    |

### Aus Schritt A (Widersprüche und Annahmen, nach denen gebaut wurde)

| Nr. | Datum      | Frage                                                                                                                                                       | Stand     | Gebaut nach Annahme                                                                                                                                                                                                                                                                                                                           |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | 11.10.2026 | Themen archivieren: 3.2 sagt „mit aktiven Aufgaben nicht archivierbar“, WF-ADM-05 und Prototyp sagen „benutzte Themen nur archivierbar“.                    | bestätigt | Beides zusammen: benutzte Themen sind nicht löschbar; archivieren geht erst, wenn keine aktive Aufgabe mehr dranhängt (und keine offene Unterkategorie).                                                                                                                                                                                      |
| A2  | 11.10.2026 | Veranstaltungs-Detail: Prototyp zeigt die untere Navigation, 8.3 sagt „Detailansichten ohne Navigation“.                                                    | bestätigt | Nach Dokument: ohne Navigation, mit Zurück-Pfeil.                                                                                                                                                                                                                                                                                             |
| A3  | 11.10.2026 | Abhängigkeiten: F-AUF-05 verlangt sie im Detail, 3.3 macht sie unabhängig vom Status „Blockiert“; der Prototyp zeigt sie nur im Blockieren-Dialog.          | bestätigt | Abschnitt „Hängt ab von“ im Detail (hinzufügen/entfernen jederzeit); bei „Blockiert“ stehen die Einträge im roten Kasten.                                                                                                                                                                                                                     |
| A4  | 11.10.2026 | Aufgabennummer („AUFGABE #017“) steht im Prototyp, aber nicht im Datenmodell 3.3.                                                                           | bestätigt | Feld `number` (fortlaufend) ergänzt.                                                                                                                                                                                                                                                                                                          |
| A5  | 11.10.2026 | Automatisch folgen (F-AUF-06) „abwählbar“: Wer sich austrägt und danach wieder bearbeitet oder kommentiert – folgt die Person dann erneut?                  | bestätigt | Ja, jede Bearbeitung trägt wieder ein; abwählen über „✓ Folge ich“. Als „bearbeiten“ zählen Felder, Beschreibung, Status, Abhängigkeiten und Kommentare; Zugewiesene folgen ebenfalls.                                                                                                                                                        |
| A6  | 11.10.2026 | Archivierte Aufgaben wiederfinden: WF-AUF-14 kennt „Wiederherstellen“, aber keine Liste archivierter Aufgaben.                                              | bestätigt | Wiederherstellen geht direkt nach dem Archivieren (Rückgängig, Hinweis im Detail) und über den Link der Aufgabe. Eine Archiv-Ansicht ist nicht gebaut.                                                                                                                                                                                        |
| A7  | 11.10.2026 | Veranstaltung „abgesagt“ und „abgeschlossen“ sind laut 4.2 endgültig; ohne Bestätigungsdialog (außer bei offenen Aufgaben) bleibt nur das kurze Rückgängig. | bestätigt | Wie im Dokument; Hinweis „lässt sich nicht mehr ändern“ im Detail.                                                                                                                                                                                                                                                                            |
| A8  | 11.10.2026 | Historie von Veranstaltungen: wird geschrieben (E-10), aber Prototyp und 5.8 zeigen sie nirgends an.                                                        | bestätigt | Nur gespeichert, nicht angezeigt. Veranstaltungen lassen sich in P1 auch nicht archivieren (kein Workflow).                                                                                                                                                                                                                                   |
| A9  | 11.10.2026 | Kommentar senden: der Prototyp bietet „Rückgängig“ an, das Dokument kennt kein Löschen von Kommentaren.                                                     | bestätigt | Bestätigung „Gesendet“ ohne Rückgängig; eigene Kommentare sind bearbeitbar.                                                                                                                                                                                                                                                                   |
| A10 | 11.10.2026 | Fortschritt einer Veranstaltung „x von y erledigt“: zählen verworfene Aufgaben mit?                                                                         | bestätigt | Nein; archivierte auch nicht.                                                                                                                                                                                                                                                                                                                 |
| A11 | 11.10.2026 | Wortlaut des Datenschutzhinweises (Vereinsname, Kontakt).                                                                                                   | bestätigt | Entwurf unter Profil › Datenschutz.                                                                                                                                                                                                                                                                                                           |
| A12 | 11.10.2026 | Veranstaltung anlegen: Art ist Pflicht; der Prototyp wählt „Party“ vor.                                                                                     | bestätigt | Wie Prototyp: „Party“ vorausgewählt.                                                                                                                                                                                                                                                                                                          |
| A13 | 11.10.2026 | Mitglieder: 3.1 nennt `email` als Pflicht und `reminder_lead_days`; 10.2 führt Letzteres erst in P2.                                                        | bestätigt | `reminder_lead_days` kommt mit P2. Der Systemeintrag „Myzel (automatisch)“ hat keine Mail und kein `created_by` (in Schritt C: nullable mit Check-Constraint „nur beim Systemeintrag“).                                                                                                                                                       |
| A14 | 11.10.2026 | Darf sich ein Admin selbst deaktivieren? Das Dokument verbietet nur den letzten Admin.                                                                      | bestätigt | Erlaubt, mit Hinweis im Dialog („Du wirst dabei sofort abgemeldet“).                                                                                                                                                                                                                                                                          |
| A15 | 11.10.2026 | Datum und Uhrzeit: Der Prototyp zeigt eigene Kacheln („Sa, 20.03. · 20:00“, „wählen“).                                                                      | bestätigt | Frist als Kachel mit dem Datumswähler des Geräts; Beginn/Ende der Veranstaltung als natives Datum-Zeit-Feld. Veranstaltungen außerhalb des laufenden Jahres zeigen das Jahr.                                                                                                                                                                  |
| A16 | 11.10.2026 | Kommende/vergangene Veranstaltungen: Wann wechselt eine Veranstaltung ohne Ende die Liste?                                                                  | bestätigt | Mit Ende: nach dem Ende. Ohne Ende: nach Ablauf des Tages, an dem sie beginnt.                                                                                                                                                                                                                                                                |
| A17 | 12.10.2026 | Push in der Vorschau: Ohne Server gibt es kein echtes Push-Abo.                                                                                             | bestätigt | „Push auf diesem Gerät“ legt in der Vorschau nur ein Test-Abo an und fragt den Browser noch nicht nach der Erlaubnis; das kommt mit Schritt C. Was an dich ginge, steht im Profil unter „Vorschau mit Testdaten › Nachrichten an dich“ – Antippen öffnet die Aufgabe (WF-ALL-04).                                                             |
| A18 | 12.10.2026 | Fristerinnerungen (6.2): „Frist naht“ einmal oder an jedem Tag des Vorlaufs?                                                                                | bestätigt | Einmal, am ersten Tag innerhalb des Vorlaufs (Standard 3 Tage vorher), dazu „heute fällig“ und einmal „überfällig“. Uhrzeit 9:00 (Frage 7).                                                                                                                                                                                                   |
| A19 | 12.10.2026 | Statusänderung durch Austragen der letzten Person (in Arbeit → geplant) oder durch „Rückgängig“: eigene Nachricht?                                          | bestätigt | Nein – „Statusänderung“ wird nur bei einem bewusst gesetzten Status verschickt.                                                                                                                                                                                                                                                               |
| A20 | 12.10.2026 | Benachrichtigungen: Selbstzuweisung und eigene Termine.                                                                                                     | bestätigt | Wer sich selbst einträgt oder einen Termin selbst anlegt, verschiebt oder absagt, bekommt dazu keine Nachricht (wie bei eigenen Statusänderungen).                                                                                                                                                                                            |
| A21 | 12.10.2026 | „Blockade aufgehoben“ (4.1, 6.2): auch wenn die wartende Aufgabe noch auf weitere Aufgaben wartet oder gar nicht „Blockiert“ ist?                           | bestätigt | Ja, wie im Wortlaut: Nachricht an die Bearbeitenden jeder Aufgabe, die auf die erledigte gewartet hat.                                                                                                                                                                                                                                        |
| A22 | 12.10.2026 | Termine: Der Prototyp zeigt nur kommende Termine; vergangene müssen korrigierbar bleiben (4.3).                                                             | bestätigt | Filter-Pille „Vergangene“ in der Terminliste (neueste zuerst).                                                                                                                                                                                                                                                                                |
| A23 | 12.10.2026 | Termin anlegen: Titel-Vorbelegung aus der Terminart; Thema des Termins.                                                                                     | bestätigt | Titel wird mit dem Namen der Terminart vorbelegt und ist änderbar. Das Thema kommt aus der Terminart und ist im Formular nicht einzeln wählbar.                                                                                                                                                                                               |
| A24 | 12.10.2026 | Beim Deaktivieren eines Mitglieds: Push-Abos und Telegram-Verknüpfung.                                                                                      | bestätigt | Werden mit entfernt (personenbezogen, Abschnitt 9); nach dem Reaktivieren neu einschalten.                                                                                                                                                                                                                                                    |
| A25 | 12.10.2026 | Termin-Erinnerung „3 Tage vorher“ bei Terminen, die kurzfristiger angelegt werden.                                                                          | bestätigt | Die Erinnerung geht dann beim nächsten Joblauf raus (zusätzlich zur Einladung); die „1 Stunde vorher“ kommt immer.                                                                                                                                                                                                                            |
| A26 | 12.10.2026 | Wissen: Dokumente an Veranstaltungen und Terminen (WF-WIS-06 nennt sie als Ziel, der Prototyp zeigt dort in P3 keine Dokumentliste).                        | bestätigt | Verknüpfen geht (Ziel im Dialog suchbar); angezeigt werden die Dokumente an Aufgaben und Entscheidungen sowie unter Wissen › Dokumente mit der Zahl der Verknüpfungen. Listen an Veranstaltung und Termin kommen mit dem Drive-Ausbau in P5.                                                                                                  |
| A27 | 12.10.2026 | Quelle einer Entscheidung: eine oder mehrere? Datum?                                                                                                        | bestätigt | Plenum, Dokument und Notiz lassen sich kombinieren, mindestens eine ist Pflicht. Datum ist mit heute vorbelegt. Wird eine Frage zur Entscheidung, übernimmt sie Titel und Thema der Frage; die Antwort wird der Text.                                                                                                                         |
| A28 | 12.10.2026 | Dokumenttypen und Tags (Frage 11.2 Nr. 3).                                                                                                                  | bestätigt | Typen wie in 3.9 (Protokoll, Leitlinie, Vorlage, Schichtplan, Sonstiges); Tags als freie Stichworte, mit Komma getrennt.                                                                                                                                                                                                                      |
| A29 | 12.10.2026 | Globale Suche: ab wann und wo wird gesucht?                                                                                                                 | bestätigt | Ab zwei Zeichen, in Titel und Text (bei Fragen auch in der Antwort, bei Dokumenten in den Tags); archivierte Einträge erscheinen nicht. Dokument-Treffer öffnen die Datei.                                                                                                                                                                    |
| A30 | 12.10.2026 | Adresse für „Finanzen in MeinVerein“ (F-WIS-07, konfigurierbar).                                                                                            | bestätigt | Umgebungsvariable VITE_MEINVEREIN_URL, bis dahin die Startseite von MeinVerein.                                                                                                                                                                                                                                                               |
| A31 | 18.10.2026 | F-PLE-01: „Ist ein vergangenes Plenum nicht abgeschlossen, zeigt die Ansicht nur einen Hinweis.“ Was genau?                                                 | bestätigt | Ab 12 Stunden nach dem Ende steht ein Hinweis „liegt zurück, noch nicht abgeschlossen“; Agenda und Abschließen bleiben möglich. Keine automatische Erinnerung.                                                                                                                                                                                |
| A32 | 18.10.2026 | Plenum bearbeiten oder absagen: Der Prototyp S-33 zeigt dafür nichts, WF-TER-04/-05 gelten für alle Terminarten.                                            | bestätigt | Unter „⋯“ oben rechts: Bearbeiten und Plenum absagen. Die Agenda bleibt bei einer Absage für das nächste Plenum stehen.                                                                                                                                                                                                                       |
| A33 | 18.10.2026 | Drive-Protokoll verknüpfen: Der Prototyp führt zu S-43.                                                                                                     | bestätigt | Auswahl aus den erfassten Dokumenten (Protokolle zuerst); ein neues Dokument wird vorher unter Wissen › Dokumente per Link erfasst.                                                                                                                                                                                                           |
| A34 | 18.10.2026 | Rückgängig nach einer Agenda-Aktion: Der Prototyp zeigt eine eigene Leiste in der Agenda.                                                                   | bestätigt | Die gemeinsame Leiste mit „Rückgängig“ (S-90) wie überall sonst; der Punkt steht danach wieder an alter Stelle.                                                                                                                                                                                                                               |
| A35 | 18.10.2026 | Abgeschlossenes oder abgesagtes Plenum: Agenda noch zeigen?                                                                                                 | bestätigt | Nein – die Agenda gehört dem nächsten Plenum; sichtbar sind Ergebnis und Protokoll.                                                                                                                                                                                                                                                           |
| A36 | 18.10.2026 | „Bis wann?“ im Plenum: Der Prototyp bietet „In 1 Woche“, „In 2 Wochen“, „Vor dem Event“.                                                                    | bestätigt | Die ersten beiden als Schnellwahl plus Datumskachel; „Vor dem Event“ entfällt (unklar, welcher Tag gemeint ist).                                                                                                                                                                                                                              |
| A37 | 18.10.2026 | „Aufheben“ in der Agenda: WF-PLE-14 nennt eine optionale Notiz, der Prototyp hebt sofort auf.                                                               | bestätigt | Kleines Feld mit optionaler Notiz und „Aufheben“.                                                                                                                                                                                                                                                                                             |
| A38 | 18.10.2026 | Veranstaltung „Abschließen“ in der Agenda: „Hinweis bei offenen Aufgaben“.                                                                                  | bestätigt | Die Zahl offener Aufgaben steht im Kennzeichen der Karte; „Abschließen“ fragt bei offenen Aufgaben nach, die Aufgaben bleiben bestehen.                                                                                                                                                                                                       |
| A39 | 18.10.2026 | Rahmen (3.4): „je Status + Notiz“ – welche Status?                                                                                                          | bestätigt | Offen, Erledigt, Entfällt. Die Kurzzusammenfassung nennt offene Punkte in Bernstein, sobald im Rahmen etwas eingetragen ist.                                                                                                                                                                                                                  |
| A40 | 18.10.2026 | Aufbau und Abbau: Regeln?                                                                                                                                   | bestätigt | Aufbau liegt vor (oder genau zum) Beginn, Abbau nicht vor dem Ende; beide optional, im Bearbeiten-Formular der Veranstaltung.                                                                                                                                                                                                                 |
| A41 | 18.10.2026 | „In Nachbereitung?“ ausblenden (WF-VER-07): für wen?                                                                                                        | bestätigt | Ausblenden gilt nur auf diesem Gerät; der Vorschlag kommt ab dem Tag nach dem Ende (ohne Ende: nach dem Beginn), solange der Status „bestätigt“ ist.                                                                                                                                                                                          |
| A42 | 18.10.2026 | „Steht sie lange in Nachbereitung, zeigt die Liste nur einen Hinweis“ (4.2): wie lange?                                                                     | bestätigt | Ab 30 Tagen.                                                                                                                                                                                                                                                                                                                                  |
| A43 | 18.10.2026 | Booking: Acts entfernen – archivieren oder löschen?                                                                                                         | bestätigt | Entfernen mit Rückgängig und Eintrag in der Historie der Veranstaltung; Acts sind Listeneinträge, keine Kernobjekte.                                                                                                                                                                                                                          |
| A44 | 18.10.2026 | Partner: WF-VER-10 nennt beim Anlegen eine „Art“, das Datenmodell 3.5 kennt sie nicht.                                                                      | bestätigt | Optionales Freitextfeld `kind` („Kollektiv“, „Verein“, „Firma“ …).                                                                                                                                                                                                                                                                            |
| A45 | 18.10.2026 | Partner haben keine eigene Navigation (3.5) – wie erreicht man die Liste (S-24)?                                                                            | bestätigt | Aus dem Bereich „Partner“ einer Veranstaltung („Alle Partner ›“), über die Suche und die Plenum-Agenda; in der Seitenleiste gilt „Events“ als aktiv. Partner lassen sich (noch) nicht archivieren.                                                                                                                                            |
| A46 | 18.10.2026 | Partner-Namen eindeutig?                                                                                                                                    | bestätigt | Ja, ohne Groß-/Kleinschreibung – verhindert doppelt angelegte Partner beim Verknüpfen.                                                                                                                                                                                                                                                        |
| A47 | 18.10.2026 | Vorlagen-Dialog „ohne Duplikate“: woran erkennt die App, was schon angelegt ist?                                                                            | bestätigt | Eigene Tabelle template_applications (Veranstaltung, Vorlagenaufgabe, Aufgabe). Wird die Aufgabe gelöscht bzw. das Anlegen zurückgenommen, lässt sie sich erneut anlegen; Umbenennen der Aufgabe ändert nichts.                                                                                                                               |
| A48 | 18.10.2026 | Vorlagenfristen, die beim Anlegen schon vorbei wären (kurzfristige Veranstaltung).                                                                          | bestätigt | Sie bekommen das heutige Datum.                                                                                                                                                                                                                                                                                                               |
| A49 | 18.10.2026 | Wer darf Vorlagen bearbeiten (WF-ADM-08 ohne Vorbedingung, liegt aber bei den Admin-Screens)?                                                               | bestätigt | Alle Mitglieder, erreichbar unter Profil › Veranstaltungsvorlagen. Vorlagen haben keine Historie; Entfernen einer Vorlagenaufgabe mit Rückfrage statt Rückgängig.                                                                                                                                                                             |
| A50 | 18.10.2026 | Vorlagen-Dialog: was ist vorausgewählt?                                                                                                                     | bestätigt | Alles noch nicht Angelegte; abwählen per Baustein oder einzeln.                                                                                                                                                                                                                                                                               |
| A51 | 19.10.2026 | Typ beim Verknüpfen aus Drive: Der Prototyp S-43 zeigt keinen, documents.doc_type ist Pflicht.                                                              | bestätigt | Nur für neue Einträge eine Typ-Auswahl, vorbelegt „Sonstiges“; ein schon erfasstes Dokument behält seinen Typ.                                                                                                                                                                                                                                |
| A52 | 19.10.2026 | F-WIS-05 verlangt Dateien an Veranstaltungen und Terminen; deren Detailansichten zeigten verknüpfte Dokumente bisher nicht.                                 | bestätigt | Abschnitt „Dokumente“ unten im Veranstaltungs- und im Termin-Detail (lösen, + verknüpfen über S-43). Im Plenum bleibt es beim Protokoll-Dokument.                                                                                                                                                                                             |
| A53 | 19.10.2026 | Wann gleicht die App mit Drive ab (3.13 „beim Öffnen“)?                                                                                                     | bestätigt | Beim Öffnen des Drive-Reiters, von S-43 und des Veranstaltungs-Details; der Hinweis „In Drive nicht mehr vorhanden“ erscheint nach dem nächsten Abgleich.                                                                                                                                                                                     |
| A54 | 19.10.2026 | WF-VER-14: „Ordner aus S-43“ – S-43 wählt Dateien, keine Ordner.                                                                                            | bestätigt | Eigener Dialog „Drive-Ordner wählen“ mit demselben Verzeichnis, nur Ordner; gewählt wird der gerade offene Ordner.                                                                                                                                                                                                                            |
| A55 | 19.10.2026 | Ordner als Dokument verknüpfen?                                                                                                                             | bestätigt | Nein – F-WIS-05 spricht von Dateien; Ordner hängen nur als Drive-Ordner an Veranstaltungen.                                                                                                                                                                                                                                                   |
| A56 | 19.10.2026 | Wie viel vom Ordnerinhalt zeigt das Veranstaltungs-Detail?                                                                                                  | bestätigt | Die ersten 6 Einträge, danach „Alle n Einträge ansehen“ in den Drive-Reiter. Wurzel heißt in den Testdaten „Myzel Drive“ (Frage 11.4).                                                                                                                                                                                                        |
| A57 | 19.10.2026 | Drive-Reiter und Zurück-Taste: der Prototyp wechselt Reiter ohne Adresse.                                                                                   | bestätigt | Drive hat eine eigene Adresse /wissen/drive/:ordner (Zurück geht einen Ordner zurück, „im Drive suchen“ übergibt ?q=).                                                                                                                                                                                                                        |
| A58 | 19.10.2026 | Welche Wiederholungen braucht es (F-TER-02 „verständliche Auswahl“)?                                                                                        | bestätigt | Wöchentlich, alle 2 Wochen, am 1. bis 4. oder letzten Wochentag im Monat, an einem Tag des Monats (bis 28.); gespeichert als RRULE. Die Auswahl richtet sich nach dem gewählten ersten Termin.                                                                                                                                                |
| A59 | 19.10.2026 | Wo legt man eine Serie an?                                                                                                                                  | bestätigt | Im Formular „Neuer Termin“ über „Wiederholen“, optional „Bis“. Serien haben keine Veranstaltung und enden am selben Tag.                                                                                                                                                                                                                      |
| A60 | 19.10.2026 | „Serie beenden“ (F-TER-03): was passiert mit schon angelegten Terminen?                                                                                     | bestätigt | Künftige Termine ab morgen entfallen (hat die Serie noch nicht begonnen: ab dem Tag nach ihrem ersten Termin, der stattfindet): wer schon eingeladen ist oder geantwortet hat, bekommt eine Absage, die übrigen verschwinden still (archiviert). Einzeln geänderte Termine bleiben.                                                           |
| A61 | 19.10.2026 | Geänderte Regel einer Serie: Termine, die nicht mehr passen?                                                                                                | bestätigt | Wie beim Beenden: eingeladene abgesagt, übrige still entfernt; neue Tage entstehen sofort.                                                                                                                                                                                                                                                    |
| A62 | 19.10.2026 | Einladung „ca. 2 Wochen vorher“ und Nachricht bei geänderter Zeit (3.6).                                                                                    | bestätigt | Einladung 14 Tage vorher im Joblauf. Bei geänderter Uhrzeit oder geändertem Ort bekommen nur schon Eingeladene eine Nachricht; alle anderen später die Einladung mit dem neuen Stand.                                                                                                                                                         |
| A63 | 19.10.2026 | Startbestand Bautag (Frage 11.5 Nr. 1 offen).                                                                                                               | bestätigt | Jeden 3. Samstag, 10 bis 16 Uhr im Lager, ab dem ersten Termin nach den bisher von Hand angelegten Bautagen. Plenen bleiben einzeln angelegt (Frage 11.2 Nr. 4).                                                                                                                                                                              |
| A64 | 19.10.2026 | Was macht einen Serientermin zur Ausnahme (is_exception)?                                                                                                   | bestätigt | Jede Einzeländerung oder Absage über „Nur dieser Termin“. Ausnahmen lassen spätere Serienänderungen in Ruhe.                                                                                                                                                                                                                                  |
| A65 | 19.10.2026 | Zeilen der Schalter-Matrix (F-PRO-02 „pro Ereignis“).                                                                                                       | bestätigt | Wie im Prototyp: Zuweisung, Kommentar, Statusänderung, Blockade aufgehoben, Frist (vorher, am Tag, überfällig), Termine (Einladung, Erinnerungen, Änderung), Plenum-Zusammenfassung. Eine Zeile schaltet alle ihre Ereignisse zusammen.                                                                                                       |
| A66 | 19.10.2026 | Voreinstellung der Matrix: Der Prototyp zeigt gemischte Beispielwerte.                                                                                      | bestätigt | Alles an, wie die festen Voreinstellungen bis P6 (6.1); eigene Statusänderungen aus (6.2).                                                                                                                                                                                                                                                    |
| A67 | 19.10.2026 | „Eigene Statusänderungen einschaltbar“ (6.2): wo?                                                                                                           | bestätigt | Aufgehoben am 24.10.2026: kein Schalter, eigene Statusänderungen werden nie gemeldet.                                                                                                                                                                                                                                                         |
| A68 | 19.10.2026 | „Geänderte Einstellungen greifen sofort“ (Abnahme P6).                                                                                                      | bestätigt | Abschalten nimmt auch Nachrichten zurück, die noch auf den nächsten Joblauf warten; Einschalten liefert nichts nach.                                                                                                                                                                                                                          |
| A69 | 19.10.2026 | Telegram-Buttons ohne echtes Telegram (Schritt A).                                                                                                          | bestätigt | Die Demo-Werkzeuge im Profil zeigen unter jeder Telegram-Nachricht ihre Buttons; die Antwort des Bots erscheint als Hinweisleiste. In Schritt C ruft der Webhook dieselbe Server-Logik auf.                                                                                                                                                   |
| A70 | 19.10.2026 | „Passt nicht“: Wer zugewiesen hat, „wird benachrichtigt“ – mit welcher Nachricht?                                                                           | bestätigt | Eigene Nachrichtenart „Zuweisung abgelehnt“ ohne Buttons, in der Matrix unter „Zuweisung“; nicht bei Selbsteintragung.                                                                                                                                                                                                                        |
| A71 | 19.10.2026 | „Übernehme ich“, wenn die Aufgabe nicht mehr neu oder geplant ist.                                                                                          | bestätigt | Nichts ändern, nur bestätigen („der Status bleibt“). Wer nicht mehr eingetragen ist, bekommt einen Hinweis.                                                                                                                                                                                                                                   |
| A72 | 19.10.2026 | Welche Version gilt bei einem Button-Tipp? Der Chat kennt keine.                                                                                            | bestätigt | Der aktuelle Stand; geprüft wird wie in der App. Geht die Aktion nicht (z. B. archiviert), antwortet der Bot freundlich und speichert nichts.                                                                                                                                                                                                 |
| A73 | 19.10.2026 | Was gehört in den Export (E-08)?                                                                                                                            | bestätigt | Alle fachlichen Tabellen samt Historie. Nicht: Outbox, Jobläufe, Rückgängig, Push-Abos, Telegram-Verknüpfungen und -Codes, Drive-Cache, Benachrichtigungs-Einstellungen. Mitglieder ohne E-Mail und Login-ID, Partner ohne E-Mail und Telefon (die Ansprechperson als Name bleibt); in der Historie steht bei solchen Feldern nur „geändert“. |
| A74 | 19.10.2026 | Ziel des Exports (Frage 11.5 Nr. 2 offen).                                                                                                                  | bestätigt | In Schritt A nur Aufbau, Schema und Download in den Demo-Werkzeugen; Repo und nächtlicher Lauf folgen in Schritt C.                                                                                                                                                                                                                           |

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

### Agent-Review Schritt C, Phase 1 (21.10.2026)

Zwei unabhängige Reviews (Sicherheit/Zugriff; Regeln/Nebenläufigkeit). Eingearbeitet:

- Login: nur bestätigte Mail-Adressen verknüpfen ein Mitglied, auch bei Google keine Ausnahme; lokale
  supabase/config.toml mit Mail-Bestätigung (online war sie schon an); neue Mail-Adresse löst den alten Login;
  Login-IDs gehen nicht an andere Mitglieder.
- Rechte: Migration 20261021000001_grants – anon darf nichts, authenticated nur lesen, keine Sequenzen, keine
  Funktionen per RPC, neue Tabellen ohne Rechte von selbst (im Entwicklungsprojekt eingespielt und geprüft).
- TLS zur Datenbank immer mit Prüfung gegen das öffentliche Supabase-Stammzertifikat (im Code, gültig bis 2031;
  gegen den Pooler des Entwicklungsprojekts geprüft); Smoke-Server nur auf 127.0.0.1.
- Zweite Runde: Funktionen späterer Phasen ohne EXECUTE für PUBLIC (Migration 20261021000002); Rückgängig sperrt
  die Person beim Wiedereintragen; „In Arbeit ohne Bearbeitende“ verhindert nur ein Rückgängig, das genau dahin
  zurücksetzt. Historie: bearbeiteter Kommentartext und vom Rückgängig zurückgesetzte Felder als alt → neu
  (Nutzerin, 21.10.2026). Ergebnis: keine Befunde hoher oder mittlerer Schwere offen.
- Nebenläufigkeit: Sperren für Abhängigkeiten (keine Kreise durch zwei gleichzeitige Anfragen), Markierungs-Reihenfolge,
  Mitglied beim Eintragen und als handelnde Person (gleichzeitiges Deaktivieren wartet), Thema beim Verwenden;
  Deadlocks werden wiederholt, gleichzeitig vergebene Kürzel/Mails/Namen als Konflikt gemeldet; UPDATE mit
  Versionsbedingung prüft die Zahl der getroffenen Zeilen.
- Regeln: Wiederöffnen und Wiederherstellen nur in einem aktiven Thema; Rückgängig setzt keine Markierung an
  abgeschlossene oder archivierte Aufgaben, entfernt keine fremde Markierung, stellt „In Arbeit“ nicht ohne
  Bearbeitende her und keine aktive Aufgabe in einem archivierten Thema – in Testdaten-Schicht und Server gleich.
- „Heute/überfällig“ und „In Nachbereitung?“ nach Kölner Kalender (Europe/Berlin), auch auf dem Server in UTC.
- check:integrity: Kreisprüfung endet auch bei verzweigten Abhängigkeiten.

Offen, nicht dringlich:

- Für Phase 2: alle Zeitberechnungen auf dem Server (Erinnerungen, Jobs, Texte mit Uhrzeit) ausdrücklich in
  Europe/Berlin; src/shared/format.ts rechnet in der Zeitzone des Rechners.
- Für Phase 3: Unique-Regel für plenum_marks.position (heute nur über Sperre und Rückgängig abgesichert).
- Vor Schritt D: im Produktivprojekt keine localhost-Adressen in den Redirect URLs
  und Site URL auf die Netlify-Adresse; Content-Security-Policy für das Deploy.
- Für Phase 2: Wiederholung bei Deadlocks in inTransaction nur, solange eine Aktion nichts außerhalb der Datenbank
  auslöst – Push und Telegram nur über die Outbox nach dem Commit. Testdaten-Schicht rechnet „heute“ weiter in der
  Zeitzone des Browsers (nur außerhalb deutscher Zeit ein Unterschied).

## Entscheidungsprotokoll

Nachtrag 24.10.2026 (Nutzerin): Historie nur mit dem, was für andere relevant ist (selbst folgen/entfolgen ohne
Eintrag); eigene Statusänderungen nie melden, Schalter entfällt (hebt A67 auf); einheitlich „Fürs Plenum markieren“;
„⋯“ an der Aufgabe als Menü; große Bildschirme besser nutzen. ANFORDERUNGEN.md im Auftrag der Nutzerin angepasst.

Nachtrag 22.10.2026 abends (Nutzerin): Die Regel „erst das ganze Frontend, dann Server, Deploy erst am Ende“
(Abschnitt 10, Stand 12.10.2026) ist aufgehoben: erst Deploy (Abschluss 10.7 für P1 bis P5), dann Phase 6.
Abschnitt 0.2 und 10 in docs/ANFORDERUNGEN.md im Auftrag der Nutzerin angepasst.

Nachtrag 22.10.2026 (Nutzerin): Plenum-Aktionen nur an Punkten der Agenda; eine umgehängte Vorlagenaufgabe wird bei der
bisherigen Veranstaltung wieder anlegbar; Mail und Telefon von Partnern nicht in der Historie; Datenschutzhinweis
(Benachrichtigungen) freigegeben. Alles umgesetzt in Server und Testdaten-Schicht.

| Datum      | Entscheidung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Begründung                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11.10.2026 | Stack wie 2.1, aktuelle Versionen: React 19, Vite 8, Tailwind 4, zod 4, TypeScript 6, react-router 7.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Von der Nutzerin bestätigt.                                                                                                                                             |
| 11.10.2026 | Server-Code in Schritt C mit Kysely (7.2 lässt Kysely oder Drizzle offen).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Schlank, Transaktionen direkt, Typen aus dem Schema; keine eigene Migrations-Schicht neben der Supabase CLI.                                                            |
| 11.10.2026 | Schriften (Space Grotesk, JetBrains Mono) werden über @fontsource mit der App ausgeliefert statt von Google Fonts geladen.                                                                                                                                                                                                                                                                                                                                                                                                                                    | Datenschutz (keine Abrufe bei Google) und die PWA funktioniert ohne Netz.                                                                                               |
| 11.10.2026 | Regel-Bibliothek in src/shared ohne Browser-Abhängigkeit; die Testdaten-Schicht (src/data/mock/server.ts) ist wie die späteren Server-Funktionen geschnitten: Kontext mit handelnder Person, Transaktion, Historie.                                                                                                                                                                                                                                                                                                                                           | Schritt C übernimmt Regeln und Tests, nur die Speicherung wird getauscht.                                                                                               |
| 11.10.2026 | „Rückgängig“ ist eine eigene Server-Funktion mit Token: Die Aktion merkt sich ihre Gegenschritte (Status, eingetragene Person, Markierung, Abhängigkeit), 30 Sekunden gültig, nur für die Person selbst, mit Versionsprüfung und Historien-Eintrag.                                                                                                                                                                                                                                                                                                           | Nur so lässt sich z. B. „neu → geplant“ vollständig zurücknehmen, obwohl kein regulärer Übergang zurück zu „neu“ führt (4.1, WF-ALL-02).                                |
| 11.10.2026 | `version` einer Aufgabe steigt bei Feldern, Status, Archiv und Bearbeitenden. Folgende, Kommentare, Markierung und Abhängigkeiten sind eigene Einträge und erhöhen sie nicht.                                                                                                                                                                                                                                                                                                                                                                                 | Zwei gleichzeitige Einträge sollen beide gelingen (10.1); ein Kommentar darf fremde Bearbeitungen nicht in den Konflikt schicken.                                       |
| 11.10.2026 | Ein Historien-Eintrag je Aktion; Folgewirkungen (Markierung entfernt, automatisch eingetragen, Status zurück) stehen als weitere Felder im selben Eintrag.                                                                                                                                                                                                                                                                                                                                                                                                    | Lesbarer Verlauf: ein Satz je Aktion.                                                                                                                                   |
| 11.10.2026 | Schritt A: Anmeldung über erfundene Testkonten (example.org), Daten im localStorage des Browsers, relativ zu „heute“ erzeugt. Demo-Werkzeuge im Profil (Netzfehler, fremde Änderung, Zurücksetzen) sind mit `data-demo` markiert.                                                                                                                                                                                                                                                                                                                             | Keine echten Konten und keine Datenbank in Schritt A; Konflikt und Netzfehler müssen in der Durchsicht ausprobierbar sein. Entfällt mit Schritt C.                      |
| 11.10.2026 | Desktop: Seitenleiste, Liste und Detail nebeneinander ab 1024 px; Sheets werden dort zu zentrierten Dialogen.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 8.3; der Prototyp zeigt nur mobil.                                                                                                                                      |
| 11.10.2026 | Hinweistexte nutzen „Text leise“ (#A69FB8) statt des dunkleren Grautons mancher Prototyp-Anmerkungen.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Kontrast mindestens 4.5:1 (8.2).                                                                                                                                        |
| 11.10.2026 | Git: lokales Repo auf `main`, Zeilenenden LF (.gitattributes). Kein Push, bis Frage 2 geklärt ist.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Häufige Commits (0.2) ohne Vorgriff auf den Ablageort.                                                                                                                  |
| 11.10.2026 | Aktionen einer Detailansicht laufen in einer Warteschlange nacheinander; die `version` wird erst beim Start gelesen. Nach einem Netzfehler wartet die Aktion auf „Nochmal“ oder das Schließen der Meldung.                                                                                                                                                                                                                                                                                                                                                    | Schnelle Tipps gehen nicht verloren und erzeugen keinen Konflikt mit sich selbst; Folgeschritte (Sheet schließen, Entwurf löschen) laufen genau einmal (Review-Befund). |
| 11.10.2026 | Die Testdaten-Schicht liest den Stand vor jedem Zugriff neu aus dem Browser-Speicher.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Zwei Tabs überschreiben sich nicht mehr still; der Versionskonflikt ist auch in der Vorschau echt auslösbar (Review-Befund).                                            |
| 12.10.2026 | Reihenfolge geändert: Schritt A für alle Phasen nacheinander, ohne Abnahme dazwischen; Durchsicht, Daten/Server und Deploy erst danach. docs/ANFORDERUNGEN.md (0.1, 0.2, 10, 12) entsprechend angepasst.                                                                                                                                                                                                                                                                                                                                                      | Auftrag der Nutzerin vom 12.10.2026: „erstmal Frontend abschließen, deployt wird erst, wenn alles fertig ist“.                                                          |
| 12.10.2026 | Nachrichten hängen an ihrer Aktion: „Rückgängig“ zieht noch nicht verschickte Nachrichten zurück; je Anlass wird nur einmal eingereiht, auch wenn später ein weiterer Kanal dazukommt.                                                                                                                                                                                                                                                                                                                                                                        | Kein Fehlversand und keine Nachlieferung alter Erinnerungen (Review-Befunde Phase 2).                                                                                   |
| 18.10.2026 | Feldweises Optimistic Locking für die Detailbereiche: Jede Speicherung schickt den Ausgangswert des Feldes mit (`expected`); Konflikt nur, wenn genau dieses Feld inzwischen geändert wurde. So lassen sich verschiedene Bereiche parallel pflegen, ohne still zu überschreiben.                                                                                                                                                                                                                                                                              |
| 18.10.2026 | Detailbereiche einer Veranstaltung als eine Zeile je Veranstaltung (event_details, je Bereich eine Spaltengruppe, in Schritt C jsonb mit zod-Schema); Felder werden einzeln mit Versionsprüfung an der Veranstaltung gespeichert. Acts (event_bookings) und Hauptverantwortliche (event_leads) sind eigene Tabellen, eintragsweise.                                                                                                                                                                                                                           |
| 20.10.2026 | Drive-Wurzelordner als Umgebungsvariable GOOGLE_DRIVE_ROOT_FOLDER_ID (nicht geheim), optional GOOGLE_DRIVE_EXCLUDED_FOLDER_IDS (kommagetrennt), Schlüssel in GOOGLE_SERVICE_ACCOUNT_JSON (geheim). Weicht die ID von drive_sync_state.root_folder_id ab, baut der Abgleich den Cache vollständig neu auf (Schritt C).                                                                                                                                                                                                                                         |
| 20.10.2026 | Supabase-Region eu-west-1 (Irland) statt Frankfurt, von der Nutzerin bestätigt: ebenfalls EU. Vorschlag an die Nutzerin: E-05 in docs/ANFORDERUNGEN.md auf „Region EU“ ändern.                                                                                                                                                                                                                                                                                                                                                                                |
| 20.10.2026 | Durchsicht (Schritt B): Annahmen A1 bis A74 von der Nutzerin bestätigt. Veranstaltungsart „Konzert“ entfällt (Frage 5); kein wöchentlicher Dump bis zur echten Nutzung (Frage 8); kein Hell-Modus (Frage 10).                                                                                                                                                                                                                                                                                                                                                 |
| 20.10.2026 | Lokale Entwicklung ohne Docker (Option 2, Entscheidung der Nutzerin): Migrationen, Server-Funktionen und Datenbank-Tests gegen eingebettetes Postgres (PGlite), Auth/RLS nachgebildet; was nur online geht (Login, RLS, Functions im Zusammenspiel), gegen ein Supabase-Projekt. Abweichung von 2.1 („lokal mit supabase start“). Das bestehende Projekt (wyfsorojbcijkedlnmji) ist das Entwicklungsprojekt; für den Betrieb legt die Nutzerin vor Schritt D ein eigenes Projekt an (20.10.2026).                                                             |
| 20.10.2026 | Server-Funktionen (Schritt C) mit Kysely neu geschrieben, Funktion für Funktion gegen die Datenbank (Zeilen sperren mit FOR UPDATE, alles in einer Transaktion); die reinen Regeln aus src/shared/rules teilen sie mit der Testdaten-Schicht. Gleichheit sichern die bestehenden Tests über die Schnittstelle MyzelApi, die auch gegen die echte Server-Logik (PGlite) laufen. Verworfen: Testdaten-Funktionen weiterverwenden und die ganze Datenbank je Anfrage laden. Code liegt in server/, die Netlify Functions in netlify/functions rufen ihn nur auf. |
| 12.10.2026 | Markierung „Fürs Plenum“, Rückgängig und Historie sind in der Testdaten-Schicht für alle Objektarten gemeinsam gebaut (eine Tabelle plenum_marks mit Zielspalten, 3.14).                                                                                                                                                                                                                                                                                                                                                                                      | Fragen, Entscheidungen, Veranstaltungen, Termine und Dokumente nutzen dieselben Regeln wie Aufgaben.                                                                    |

## Abnahmen

Noch keine.
