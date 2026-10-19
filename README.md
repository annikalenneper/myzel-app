# Myzel

Web-App des Kollektivs für Aufgaben, Veranstaltungen, Termine, offene Fragen und Entscheidungen.
Anforderungen: [docs/ANFORDERUNGEN.md](docs/ANFORDERUNGEN.md) · Stand: [PROGRESS.md](PROGRESS.md) ·
Arbeitsanleitung für den Agenten: [CLAUDE.md](CLAUDE.md).

## Lokal starten

Voraussetzung: Node.js 22 oder neuer.

```bash
npm install
npm run dev
```

Dann http://localhost:5173 öffnen (am Handy im selben WLAN: `npm run dev -- --host` und die angezeigte
Netzwerk-Adresse).

**Aktueller Stand (Phase 1, Schritt A):** Die App läuft als Vorschau mit Testdaten – ohne Datenbank und
ohne echte Konten. „Mit Google anmelden“ öffnet eine Auswahl erfundener Testkonten. Alle Änderungen liegen
nur im Browser; im Profil gibt es unter „Vorschau mit Testdaten“ einen Knopf zum Zurücksetzen sowie
Werkzeuge, um Netzfehler und Versionskonflikt auszuprobieren.

## Prüfen

```bash
npx playwright install chromium   # einmalig
npm run check                     # Lint, Typecheck, Unit-Tests, E2E-Tests
```

## Deploy

Netlify baut mit `npm run build` und veröffentlicht `dist/` (siehe netlify.toml). Supabase,
Umgebungsvariablen und Functions kommen mit Schritt C der Phase 1 dazu und werden dann hier beschrieben.
