# Myzel – Arbeitsanleitung für den Agenten

Quelle der Anforderungen ist **docs/ANFORDERUNGEN.md**. Der Agent ändert sie nur auf Anweisung der der Nutzerin, darf aber Vorschläge machen. Stand, offene Fragen, Entscheidungen und Abnahmen stehen in **PROGRESS.md** – der Agent hält sie aktuell.

## Stack

TypeScript durchgehend · React 19 + Vite · Tailwind CSS 4 (Tokens in src/index.css) · vite-plugin-pwa ·
react-router · zod (Schemas gemeinsam für Frontend und Functions) · Vitest · Playwright (mobiler Viewport).
Ab Schritt C der Phase 1: Supabase (Postgres + Auth, EU), Netlify Functions mit Kysely, Migrationen in
supabase/migrations.

## Befehle

| Befehl                            | Zweck                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`                     | Vorschau mit Testdaten (http://localhost:5173)                                      |
| `npm run check`                   | **vor jedem Commit**: Lint, Typecheck, Unit-Tests, E2E. Rot heißt: nicht committen. |
| `npm run lint` / `npm run format` | ESLint + Prettier prüfen / Prettier anwenden                                        |
| `npm test`                        | Unit-Tests (Vitest) ohne Datenbank                                                  |
| `npm run test:db`                 | Datenbank-Tests (PGlite) und Smoke-Tests – vorerst nicht in `check` (langsam)       |
| `npm run test:e2e`                | Playwright; baut die App und startet die Vorschau selbst                            |
| `npm run build`                   | Produktions-Build nach dist/                                                        |

## Aufbau

- `src/shared/` – Datenvertrag (`schema.ts`), Regel-Bibliothek (`rules/`), Beschriftungen, Formate,
  Historien-Sätze. Ohne Browser- oder React-Abhängigkeit; wird in Schritt C von den Functions mitbenutzt.
- `src/data/api.ts` – Schnittstelle `MyzelApi`; die Oberfläche kennt nur sie.
- `src/data/mock/` – Testdaten-Schicht (Schritt A): `server.ts` wendet die Regeln an, `mockApi.ts` liefert
  Sitzung, Transaktionen, Speicherung im Browser und Demo-Werkzeuge, `seed.ts` die Testdaten.
- `src/app/` – Sitzung, Nachschlagedaten, Filter, Rückmeldungen (Rückgängig, Konflikt, Netzfehler), Gerüst.
- `src/ui/` – Bausteine im Stil D. `src/screens/` – ein Ordner je Bereich, Screens nach 5.8.
- `e2e/` – Playwright-Tests je Bereich.

## Konventionen

- UI-Sprache Deutsch; Fehlermeldungen als deutsche Sätze
- Jedes Bedienelement trägt die ID seines Workflows als `data-wf` (5.8); Playwright nutzt sie als Test-ID.
- Gebaut wird nur, was die aktuelle oder eine frühere Phase trägt (`data-phase` im Prototyp).
- Farben und Schriften nur über die Tokens in src/index.css (8.1). Markenverlauf nur für „+“, Primäraktion,
  aktiven Menüpunkt, Fortschritt. Status steht immer auch als Text da. Tippflächen ≥ 44 px (`hit`).
- Speichern nach 7.3: Status, Zuweisung, Markierung sofort mit Rückgängig; kurze Felder beim Verlassen;
  lange Texte mit Speichern/Abbrechen und lokalem Entwurf.
- Kleine Schritte, häufige Commits. Keine veralteten, doppelten oder temporären Dateien im Repo.
  Doku nur in docs/ANFORDERUNGEN.md, CLAUDE.md, PROGRESS.md, README.md.
- Geheimnisse nie ins Repo, nur als Umgebungsvariablen (.env.example ab Schritt C).
- Fragen statt raten, ohne zu blockieren: Annahmen in PROGRESS.md notieren und in der nächsten Durchsicht
  vorlegen. Keine Features erfinden oder weglassen.

## Vorgehen

OffeneFragen (Abschnitt 11) halten die Arbeit nicht auf: nach plausibler Annahme bauen, in PROGRESS.md festhalten,in der nächsten Durchsicht vorlegen.

## Deploy

Ein Push auf `main` deployt (Netlify). Nur mit Freigabe der Nutzerin, dann immer in dieser Reihenfolge:

1. Version in package.json (und die beiden Zeilen in package-lock.json) hochzählen: neue Funktion → Minor, nur
   Korrekturen → Patch.
2. Eintrag in src/shared/changelog.ts mit derselben Version und dem Datum, jede Zeile „Feat: …“ (Neues) oder
   „Fix: …“ (Korrektur, Anpassung) – kurz, aus Sicht der Nutzer*innen. Die App zeigt ihn einmal als „Was ist neu?“.
3. `npm run check` grün, bei Server-Änderungen auch `npm run test:db`.
4. Neue Migrationen zuerst einspielen (`npm run db:push`), danach pushen; Deploy abwarten, `npm run check:integrity`.
5. PROGRESS.md: Stand mit Version und Deploy.

## Integritätsregeln in Kürze

- Die Datenbank sichert nur Struktur (NOT NULL, Unique, FK RESTRICT, RLS: Lesen für aktive Mitglieder,
  direktes Schreiben gesperrt). Alle fachlichen Regeln stehen im Server-Code; App und Telegram schreiben nur
  über die Server-Funktionen.
- Handelnde Person ist immer die der Sitzung, nie eine mitgeschickte ID; automatische Vorgänge laufen als „Myzel (automatisch)“.
- Jede Änderung an Kernobjekten: `version` erhöhen, Historie in derselben Transaktion (wer, wann, was, alt → neu). Historie ist nicht änder- oder löschbar.
- Optimistic Locking: kein stilles Überschreiben. Listen (Bearbeitende, Folgende, Verknüpfungen) eintragsweise hinzufügen und entfernen, nie als Ganzes ersetzen.
- Löschen ist Archivieren (`archived_at`), wiederherstellbar. Mitglieder haben nur `active`.
- Pflichtregeln: blockiert ⇒ Grund; kein Übergang zurück zu „neu“; keine Zyklen bei Abhängigkeiten;
  Ende nach Beginn; mindestens ein aktiver Admin; Kommentare nur von der Person selbst bearbeitbar;
- Mehrschrittige Aktionen (z. B. Mitglied deaktivieren) sind eine Transaktion.
- Schemaänderungen nur über versionierte Migrationen, nie im Dashboard.
