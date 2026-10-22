// Die Server-Funktionen rechnen in Kölner Zeit (Europe/Berlin): Texte mit Datum und Uhrzeit („Sa, 21.11., 10 Uhr“),
// „heute“, „überfällig“. Netlify läuft in UTC – Node übernimmt eine zur Laufzeit gesetzte Zeitzone für alle
// folgenden Datumsberechnungen. Muss als Erstes geladen werden (netlify/functions, Smoke-Server).
process.env.TZ = 'Europe/Berlin';
