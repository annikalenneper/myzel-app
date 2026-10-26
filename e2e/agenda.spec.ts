// S-10 Agenda (16.1, WF-AGE-01 bis -03) · S-11 bis S-13 · WF-AUF-01 bis -15 und Querschnitt WF-ALL-01 bis -03, -05
import { expect, test } from '@playwright/test';
import { card, login, openTask, statusChip, undoBar, createNew } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('WF-AUF-03: Schnellanlage – Pflicht nur Titel und Thema', async ({ page }) => {
  await createNew(page, 'Aufgabe');
  const sheet = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  const submit = sheet.locator('button[type=submit]');
  await expect(submit).toBeDisabled();
  await sheet.getByLabel('Titel *').fill('Nebelfluid nachbestellen');
  await expect(submit).toHaveText('Thema wählen, dann anlegen');
  await expect(submit).toBeDisabled();
  await sheet.getByRole('button', { name: 'Lager & Material' }).click();
  await sheet.getByRole('checkbox', { name: 'Ich übernehme das' }).click();
  await submit.click();

  await expect(sheet).toBeHidden();
  const created = card(page, 'Nebelfluid nachbestellen');
  await expect(created).toContainText('Neu');
  await expect(created).toContainText('MO');
});

test('WF-AUF-01: Sortierung und Filter, kombinierbar und wieder ausschaltbar', async ({ page }) => {
  const titles = page.getByRole('article').getByRole('link');
  // überfällige stehen ganz oben, erledigte sind ausgeblendet
  await expect(titles.first()).toContainText('Location für Winterrave bestätigen');
  await expect(card(page, 'Insta-Post Bautag')).toHaveCount(0);
  await expect(page.getByText(/^11 AUFGABEN OFFEN · 1 ÜBERFÄLLIG · 1 BLOCKIERT · 3 FRAGEN$/)).toBeVisible();

  await page.getByRole('button', { name: 'Alle ▾' }).click();
  await page.getByRole('group', { name: 'Grundmenge' }).getByRole('button', { name: 'Meine' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);

  await page.getByRole('button', { name: 'Meine ▾' }).click();
  await page.getByRole('group', { name: 'Grundmenge' }).getByRole('button', { name: 'Alle' }).click();
  // Filter auf ein Thema (Unterkategorien zeigt er mit – geprüft in rules.test.ts)
  await page.getByRole('button', { name: 'Thema ▾' }).click();
  await page
    .getByRole('group', { name: 'Thema' })
    .getByRole('button', { name: 'Verein', exact: true })
    .click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(card(page, 'Vereinshaftpflicht verlängern')).toBeVisible();
  await page.getByRole('button', { name: 'Verein ▾' }).click();
  await page.getByRole('group', { name: 'Thema' }).getByRole('button', { name: 'Alle Themen' }).click();

  await page.getByRole('button', { name: 'Abgeschlossene' }).click();
  await expect(card(page, 'Insta-Post Bautag')).toBeVisible();
  await expect(card(page, 'Flyer drucken lassen')).toHaveCount(0);
});

test('WF-ALL-05: leere Liste erklärt, was man tun kann', async ({ page }) => {
  await page.getByRole('button', { name: 'Veranstaltung ▾' }).click();
  await page.getByRole('group', { name: 'Veranstaltung' }).getByRole('button', { name: 'Hoffest' }).click();
  const empty = page.getByTestId('WF-ALL-05');
  await expect(empty).toContainText('Nichts gefunden');
  await empty.getByRole('button', { name: 'Filter zurücksetzen' }).click();
  await expect(card(page, 'Flyer drucken lassen')).toBeVisible();
});

test('WF-AGE-01: Agenda mit Aufgaben, offenen Fragen und „Stimmt das noch?“; Filter nach Art', async ({
  page,
}) => {
  const review = page.getByRole('link', { name: /Awareness-Team mit mindestens 4 Personen/ });
  const question = page.getByRole('link', { name: /Machen wir an Silvester eine Party/ });
  await expect(page.getByText('Stimmt das noch?', { exact: true }).first()).toBeVisible();
  await expect(review).toBeVisible();
  await expect(question).toBeVisible();
  await expect(card(page, 'Flyer drucken lassen')).toBeVisible();

  await page.getByRole('button', { name: 'Art ▾' }).click();
  await page.getByRole('group', { name: 'Art' }).getByRole('button', { name: 'Fragen' }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(question).toBeVisible();
  await expect(review).toHaveCount(0);
  await page.getByRole('button', { name: 'Fragen ▾' }).click();
  await page.getByRole('group', { name: 'Art' }).getByRole('button', { name: 'Aufgaben' }).click();
  await expect(question).toHaveCount(0);
  await expect(card(page, 'Flyer drucken lassen')).toBeVisible();
  await page.getByRole('button', { name: 'Aufgaben ▾' }).click();
  await page.getByRole('group', { name: 'Art' }).getByRole('button', { name: 'Alles' }).click();

  // die Frage öffnet sich in der Agenda, „Zurück“ führt zur Agenda
  await question.click();
  await expect(page.getByRole('heading', { name: 'Machen wir an Silvester eine Party?' })).toBeVisible();
  await page.getByRole('link', { name: 'Zurück zu Agenda' }).click();
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
});

test('WF-AGE-03: Entscheidung auf die Agenda setzen; „Stimmt noch“ nimmt sie wieder herunter', async ({
  page,
}) => {
  await page.goto('/wissen');
  await page.getByRole('link', { name: /Mate am Tresen für 2,50 €/ }).click();
  await page.getByRole('button', { name: 'Auf die Agenda setzen' }).click();
  await expect(undoBar(page)).toContainText('Auf der Agenda');
  await page.goto('/agenda');
  const review = page.getByRole('link', { name: /Mate am Tresen für 2,50 €/ });
  await review.click();
  await expect(page.getByText('Steht auf der Agenda: Stimmt das noch?')).toBeVisible();
  await page.getByRole('button', { name: 'Stimmt noch' }).click();
  await expect(undoBar(page)).toContainText('Bestätigt · von der Agenda genommen');
  await page.getByRole('link', { name: 'Zurück zu Agenda' }).click();
  await expect(review).toHaveCount(0);
});

test('WF-AGE-02: „Aufgaben und offene Fragen zu diesem Event“ filtert die Agenda', async ({ page }) => {
  await openTask(page, 'Getränke bei der Brauerei bestellen');
  await page.getByRole('button', { name: 'Aufgaben und offene Fragen zu diesem Event →' }).click();
  await expect(page.getByRole('button', { name: 'Winterrave ▾' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Brauchen wir für den Winterrave eine Garderobe/ }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Machen wir an Silvester/ })).toHaveCount(0);
  await expect(card(page, 'Vereinshaftpflicht verlängern')).toHaveCount(0);
});

test('alte Adressen führen zur Agenda (Links in schon verschickten Nachrichten)', async ({ page }) => {
  await page.goto('/aufgaben');
  await expect(page).toHaveURL(/\/agenda$/);
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
});

test('WF-AUF-06: „In Arbeit“ trägt ein und lässt sich zurücknehmen', async ({ page }) => {
  await openTask(page, 'Vereinshaftpflicht verlängern');
  await expect(statusChip(page, 'Neu')).toHaveAttribute('aria-pressed', 'true');
  await statusChip(page, 'In Arbeit').click();
  await expect(undoBar(page)).toContainText('Status: In Arbeit · du bist eingetragen');
  await expect(page.getByRole('button', { name: 'Bearbeitende entfernen: Mo' })).toBeVisible();
  // kein Übergang führt zurück zu „neu“
  await expect(statusChip(page, 'Neu')).toHaveAttribute('aria-disabled', 'true');

  await undoBar(page).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(statusChip(page, 'Neu')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Bearbeitende entfernen: Mo' })).toHaveCount(0);
});

test('WF-AUF-07 / -08: Blockieren nur mit Grund, blockierende Aufgabe per Suche, Blockade lösen', async ({
  page,
}) => {
  await openTask(page, 'Nebelmaschine reparieren');
  await statusChip(page, 'Blockiert').click();
  const sheet = page.getByRole('dialog', { name: 'Blockieren' });
  const submit = sheet.locator('button[type=submit]');
  await expect(submit).toBeDisabled();
  await sheet.getByLabel('Grund *').fill('   ');
  await expect(submit).toBeDisabled();
  await sheet.getByLabel('Grund *').fill('Ersatzteil fehlt noch');
  await sheet.getByLabel('Aufgabe suchen').fill('farben');
  await sheet.getByRole('checkbox', { name: /Farben und Siebe besorgen/ }).click();
  await submit.click();
  // erst wenn der Dialog zu ist, steht der Grund nur noch in der Detailansicht
  await expect(sheet).toHaveCount(0);

  await expect(page.getByText('BLOCKIERT – GRUND')).toBeVisible();
  await expect(page.getByText('Ersatzteil fehlt noch')).toBeVisible();
  await expect(page.getByRole('link', { name: /Wartet auf Farben und Siebe besorgen/ })).toBeVisible();
  await page.goto('/agenda');
  await expect(card(page, 'Nebelmaschine reparieren')).toContainText(
    /Wartet auf: Farben und Siebe besorgen/i,
  );

  await openTask(page, 'Nebelmaschine reparieren');
  await page.getByTestId('WF-AUF-08').filter({ hasText: 'In Arbeit' }).last().click();
  await expect(statusChip(page, 'In Arbeit')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('BLOCKIERT – GRUND')).toHaveCount(0);
});

test('WF-AUF-09: Verwerfen mit Grund und wieder öffnen', async ({ page }) => {
  await openTask(page, 'Kasse für Winterrave besorgen');
  await statusChip(page, 'Verworfen').click();
  await page.getByLabel('Grund (optional)').fill('Leihen wir uns');
  await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(page.getByText('Verworfen – Grund: Leihen wir uns.')).toBeVisible();
  await expect(statusChip(page, 'Blockiert')).toHaveAttribute('aria-disabled', 'true');
  await statusChip(page, 'Geplant').click();
  await expect(statusChip(page, 'Geplant')).toHaveAttribute('aria-pressed', 'true');
});

test('WF-AUF-04 / -05: Felder speichern beim Verlassen, Beschreibung mit lokalem Entwurf', async ({
  page,
}) => {
  await openTask(page, 'Nebelmaschine reparieren');
  await page.getByRole('button', { name: /Titel bearbeiten/ }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Nebelmaschine reparieren lassen');
  await page.getByLabel('Titel', { exact: true }).blur();
  await expect(undoBar(page)).toContainText('Gespeichert');
  await expect(
    page.getByRole('button', { name: 'Titel bearbeiten: Nebelmaschine reparieren lassen' }),
  ).toBeVisible();

  await page.getByRole('button', { name: /Priorität/ }).click();
  await page.getByRole('dialog', { name: 'Priorität' }).getByRole('button', { name: /Hoch/ }).click();
  await expect(page.getByRole('button', { name: /Priorität/ })).toContainText('Hoch');

  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await page.getByRole('textbox', { name: 'Beschreibung' }).fill('Pumpe tauschen, Schlauch prüfen');
  await page.reload();
  // der Entwurf übersteht das Neuladen
  await expect(page.getByRole('textbox', { name: 'Beschreibung' })).toHaveValue(
    'Pumpe tauschen, Schlauch prüfen',
  );
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Pumpe tauschen, Schlauch prüfen')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Beschreibung' })).toHaveCount(0);
});

test('WF-AUF-10 / -11: Personen einzeln ein- und austragen; letzte Person weg → Geplant', async ({
  page,
}) => {
  await openTask(page, 'Nebelmaschine reparieren');
  await page.getByRole('button', { name: 'Bearbeitende hinzufügen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Wer bearbeitet?' });
  await expect(sheet.getByRole('checkbox', { name: /Tarek/ })).toHaveCount(0);
  await sheet.getByRole('checkbox', { name: /Noa/ }).click();
  await expect(sheet.getByRole('checkbox', { name: /Noa/ })).toBeChecked();
  await sheet.getByRole('button', { name: 'Fertig' }).click();
  await expect(page.getByRole('button', { name: 'Bearbeitende entfernen: Noa' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Folgende entfernen: Noa' })).toBeVisible();

  await page.getByRole('button', { name: 'Bearbeitende entfernen: Noa' }).click();
  await expect(page.getByRole('button', { name: 'Bearbeitende entfernen: Noa' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Bearbeitende entfernen: Kim' }).click();
  await expect(undoBar(page)).toContainText('Kim entfernt · Status zurück auf Geplant');
  await expect(statusChip(page, 'Geplant')).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'FOLGEN', exact: true }).click();
  await expect(page.getByRole('button', { name: '✓ FOLGE ICH' })).toBeVisible();
});

test('WF-AUF-12 / -15: Kommentar senden, eigenen bearbeiten, Verlauf in Sätzen', async ({ page }) => {
  await openTask(page, 'Getränke bei der Brauerei bestellen');
  const send = page.getByRole('button', { name: 'Senden' });
  await expect(send).toBeDisabled();
  await page.getByLabel('Kommentar schreiben').fill('Brauerei liefert am Freitag');
  await send.click();
  await expect(page.getByText('Brauerei liefert am Freitag')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'KOMMENTARE · 2' })).toBeVisible();

  // nur eigene Kommentare sind bearbeitbar: beide stammen von Mo
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toHaveCount(3);
  await page.getByRole('tabpanel').getByRole('button', { name: 'Bearbeiten' }).last().click();
  await page.getByLabel('Kommentar bearbeiten').fill('Brauerei liefert am Samstag');
  await page.getByRole('tabpanel').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Brauerei liefert am Samstag')).toBeVisible();

  await page.getByRole('tab', { name: 'VERLAUF' }).click();
  await expect(page.getByText('Mo hat kommentiert.').first()).toBeVisible();
  await expect(page.getByText('Lea hat den Status von Neu auf Geplant geändert.')).toBeVisible();
  await expect(page.getByText('Lea hat Jule zugewiesen.')).toBeVisible();
  await expect(page.getByText('Lea hat die Aufgabe angelegt.')).toBeVisible();
});

test('fremde Kommentare lassen sich nicht bearbeiten', async ({ page }) => {
  await openTask(page, 'Nebelmaschine reparieren');
  await expect(page.getByText('Pumpe ist hin, Ersatzteil ist bestellt.')).toBeVisible();
  await expect(page.getByRole('tabpanel').getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
});

test('WF-AUF-14: Archivieren mit Bestätigung bei Kommentaren, Wiederherstellen', async ({ page }) => {
  await openTask(page, 'Nebelmaschine reparieren');
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await page.getByRole('button', { name: 'Archivieren', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Aufgabe archivieren' });
  await expect(sheet).toContainText('Die Aufgabe hat 2 Kommentare.');
  await sheet.getByRole('button', { name: 'Trotzdem archivieren' }).click();
  await expect(page.getByText('Archiviert – nicht mehr in den Listen.')).toBeVisible();
  const url = page.url();
  await page.goto('/agenda');
  await expect(card(page, 'Flyer drucken lassen')).toBeVisible();
  await expect(card(page, 'Nebelmaschine reparieren')).toHaveCount(0);

  await page.goto(url);
  await page.getByRole('button', { name: 'Wiederherstellen' }).click();
  await expect(page.getByText('Archiviert – nicht mehr in den Listen.')).toHaveCount(0);
  await page.goto('/agenda');
  await expect(card(page, 'Nebelmaschine reparieren')).toBeVisible();
});

test('WF-AUF-14: ohne Kommentare archiviert das Menü sofort, mit Rückgängig', async ({ page }) => {
  await openTask(page, 'Farben und Siebe besorgen');
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await page.getByRole('button', { name: 'Archivieren', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Aufgabe archivieren' })).toHaveCount(0);
  await expect(page.getByText('Archiviert – nicht mehr in den Listen.')).toBeVisible();
  await undoBar(page).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByText('Archiviert – nicht mehr in den Listen.')).toHaveCount(0);
});

test('WF-ALL-01: Versionskonflikt überschreibt nichts und zeigt die eigene Eingabe', async ({ page }) => {
  await openTask(page, 'Getränke bei der Brauerei bestellen');
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Beschreibung' }).fill('6 Fässer, Abholung Freitag 16 Uhr');
  const id = page.url().split('/').pop()!;
  await page.evaluate((taskId) => window.__myzelDemo!.simulateForeignEdit(taskId), id);
  await page.getByRole('button', { name: 'Speichern' }).click();

  const dialog = page.getByRole('alertdialog', { name: 'Inzwischen geändert' });
  await expect(dialog).toContainText('Lea hat diese Aufgabe gerade eben geändert.');
  await expect(dialog).toContainText('6 Fässer, Abholung Freitag 16 Uhr');
  await dialog.getByRole('button', { name: 'Neu laden' }).click();
  await expect(dialog).toBeHidden();
  // die fremde Änderung ist da, die eigene Eingabe steht noch im Feld und lässt sich jetzt speichern
  await expect(page.getByRole('button', { name: /Priorität/ })).toContainText('Mittel');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('6 Fässer, Abholung Freitag 16 Uhr')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Beschreibung' })).toHaveCount(0);
});

test('WF-ALL-03: Netzfehler – Meldung auf Deutsch, Text bleibt, „Nochmal“ speichert', async ({ page }) => {
  await openTask(page, 'Kasse für Winterrave besorgen');
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await page.getByRole('textbox', { name: 'Beschreibung' }).fill('Wechselgeld nicht vergessen');
  await page.evaluate(() => window.__myzelDemo!.failNextWrites(1));
  await page.getByRole('button', { name: 'Speichern' }).click();

  const bar = page.getByTestId('WF-ALL-03');
  await expect(bar).toContainText(
    'Keine Verbindung – nicht gespeichert. Dein Text bleibt auf diesem Gerät erhalten.',
  );
  await expect(page.getByRole('textbox', { name: 'Beschreibung' })).toHaveValue(
    'Wechselgeld nicht vergessen',
  );
  await bar.getByRole('button', { name: 'Nochmal' }).click();
  await expect(bar).toBeHidden();
  // nach „Nochmal“ laufen die Folgeschritte: Feld zu, Entwurf weg
  await expect(page.getByRole('textbox', { name: 'Beschreibung' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Wechselgeld nicht vergessen')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Beschreibung' })).toHaveCount(0);
});

test('WF-ALL-03: „Nochmal“ in der Schnellanlage legt genau eine Aufgabe an; Kommentar wird nicht doppelt', async ({
  page,
}) => {
  await createNew(page, 'Aufgabe');
  const sheet = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  await sheet.getByLabel('Titel *').fill('Kabeltrommel kaufen');
  await sheet.getByRole('button', { name: 'Lager & Material' }).click();
  await page.evaluate(() => window.__myzelDemo!.failNextWrites(1));
  await sheet.locator('button[type=submit]').click();
  await page.getByTestId('WF-ALL-03').getByRole('button', { name: 'Nochmal' }).click();
  await expect(sheet).toBeHidden();
  await expect(card(page, 'Kabeltrommel kaufen')).toHaveCount(1);

  await openTask(page, 'Kabeltrommel kaufen');
  await page.getByLabel('Kommentar schreiben').fill('Baumarkt hat welche');
  await page.evaluate(() => window.__myzelDemo!.failNextWrites(1));
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByTestId('WF-ALL-03')).toContainText('Dein Text bleibt auf diesem Gerät erhalten.');
  await page.getByTestId('WF-ALL-03').getByRole('button', { name: 'Nochmal' }).click();
  await expect(page.getByLabel('Kommentar schreiben')).toHaveValue('');
  await expect(page.getByRole('tab', { name: 'KOMMENTARE · 1' })).toBeVisible();
});

test('16.6: Status steht sofort da und springt bei Netzfehler zurück; „Nochmal“ speichert', async ({
  page,
}) => {
  await openTask(page, 'Kasse für Winterrave besorgen');
  const before = await page
    .getByRole('group', { name: 'Status' })
    .getByRole('button', { pressed: true })
    .textContent();
  await page.evaluate(() => window.__myzelDemo!.failNextWrites(1));
  await statusChip(page, 'Erledigt').click();
  const bar = page.getByTestId('WF-ALL-03');
  await expect(bar).toBeVisible();
  // nicht gespeichert: die Anzeige zeigt wieder den wahren Stand
  await expect(statusChip(page, 'Erledigt')).toHaveAttribute('aria-pressed', 'false');
  await expect(statusChip(page, before!.trim())).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: 'Nochmal' }).click();
  await expect(statusChip(page, 'Erledigt')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(statusChip(page, 'Erledigt')).toHaveAttribute('aria-pressed', 'true');
});

test('WF-ALL-03: Blockade-Grund bleibt bei Netzfehler als Entwurf erhalten', async ({ page }) => {
  await openTask(page, 'Kasse für Winterrave besorgen');
  await statusChip(page, 'Blockiert').click();
  const sheet = page.getByRole('dialog', { name: 'Blockieren' });
  await sheet.getByLabel('Grund *').fill('Kassenwart ist im Urlaub');
  await page.evaluate(() => window.__myzelDemo!.failNextWrites(1));
  await sheet.locator('button[type=submit]').click();
  await expect(page.getByTestId('WF-ALL-03')).toBeVisible();
  await page.getByTestId('WF-ALL-03').getByRole('button', { name: 'Meldung schließen' }).click();
  await expect(sheet.getByLabel('Grund *')).toHaveValue('Kassenwart ist im Urlaub');
  await page.reload();
  await statusChip(page, 'Blockiert').click();
  await expect(sheet.getByLabel('Grund *')).toHaveValue('Kassenwart ist im Urlaub');
  await sheet.locator('button[type=submit]').click();
  await expect(page.getByText('BLOCKIERT – GRUND')).toBeVisible();
});

test('WF-AUF-10: schnelles Tippen auf zwei Personen trägt beide ein', async ({ page }) => {
  await openTask(page, 'Vereinshaftpflicht verlängern');
  await page.getByRole('button', { name: 'Bearbeitende hinzufügen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Wer bearbeitet?' });
  await sheet.getByRole('checkbox', { name: /Noa/ }).click();
  await sheet.getByRole('checkbox', { name: /Kim/ }).click();
  await expect(sheet.getByRole('checkbox', { name: /Noa/ })).toBeChecked();
  await expect(sheet.getByRole('checkbox', { name: /Kim/ })).toBeChecked();
});

test('lange Wörter im Titel sprengen das Layout nicht', async ({ page }) => {
  await createNew(page, 'Aufgabe');
  const sheet = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  await sheet
    .getByLabel('Titel *')
    .fill('Donaudampfschifffahrtsgesellschaftskapitänsmützenabzeichenbestellung');
  await sheet.getByRole('button', { name: 'Organisatorisches' }).click();
  await sheet.locator('button[type=submit]').click();
  await expect(card(page, 'Donaudampf')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('Tippflächen der Agenda sind mindestens 44 px hoch', async ({ page }) => {
  for (const testId of ['WF-AUF-01', 'WF-AGE-01', 'WF-ALL-08']) {
    const size = await page
      .getByTestId(testId)
      .first()
      .evaluate((el) => {
        const after = getComputedStyle(el, '::after');
        const box = el.getBoundingClientRect();
        return Math.max(box.height, parseFloat(after.minHeight) || 0);
      });
    expect(size, testId).toBeGreaterThanOrEqual(44);
  }
});

test('WF-AUF-12: Doppeltipp auf „Senden“ legt nur einen Kommentar an', async ({ page }) => {
  await openTask(page, 'Vereinshaftpflicht verlängern');
  await page.getByLabel('Kommentar schreiben').fill('Angebot liegt vor');
  await page.getByRole('button', { name: 'Senden' }).dblclick();
  await expect(page.getByLabel('Kommentar schreiben')).toHaveValue('');
  await expect(page.getByRole('tab', { name: 'KOMMENTARE · 1' })).toBeVisible();
  await expect(page.getByText('Angebot liegt vor')).toHaveCount(1);
});

test('WF-ALL-02: „Rückgängig“ und sofort die nächste Aktion ergibt keinen Konflikt', async ({ page }) => {
  await openTask(page, 'Vereinshaftpflicht verlängern');
  await statusChip(page, 'Geplant').click();
  await undoBar(page).getByRole('button', { name: 'Rückgängig' }).click();
  await statusChip(page, 'Erledigt').click();
  await expect(statusChip(page, 'Erledigt')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('WF-AUF-04: Frist per Tastatur speichert erst das vollständige Datum', async ({ page }) => {
  await openTask(page, 'Nebelmaschine reparieren');
  const due = page.getByLabel('Frist', { exact: true });
  // Zwischenwert beim Tippen des Jahres: bleibt im Feld, gespeichert wird nichts
  await due.fill('0002-11-06');
  await expect(undoBar(page)).toHaveCount(0);
  await due.fill('2027-11-06');
  await expect(undoBar(page)).toContainText('Gespeichert');
  await page.reload();
  await expect(page.getByLabel('Frist', { exact: true })).toHaveValue('2027-11-06');
  await page.getByRole('tab', { name: 'VERLAUF' }).click();
  await expect(page.getByText('Mo hat die Frist auf 06.11. gesetzt.')).toHaveCount(1);
});

test('WF-AUF-03: beim Thema „Veranstaltungen“ schlägt die Anlage gleich die Veranstaltung vor', async ({
  page,
}) => {
  await createNew(page, 'Aufgabe');
  const sheet = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  await sheet.getByLabel('Titel *').fill('Garderobe organisieren');
  const suggestion = sheet.getByRole('group', { name: /Zu welcher Veranstaltung/ });
  await sheet.getByRole('button', { name: 'Lager & Material' }).click();
  await expect(suggestion).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Veranstaltungen', exact: true }).click();
  await suggestion.getByRole('button', { name: 'Winterrave' }).click();
  await sheet.locator('button[type=submit]').click();
  await expect(page.getByTestId('WF-ALL-02')).toContainText('Aufgabe angelegt · Winterrave');
});

test('WF-ALL-08: ein „+“ für alle Arten – Frage aus der Agenda, Partner aus der Partnerliste', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Neu anlegen' }).click();
  const choice = page.getByRole('group', { name: 'Was anlegen?' });
  await expect(choice.getByRole('button')).toHaveText([
    'Aufgabe',
    'Frage',
    'Entscheidung',
    'Fakt',
    'Veranstaltung',
    'Termin',
    'Dokument',
    'Partner',
  ]);
  await choice.getByRole('button', { name: 'Frage', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Neue Frage' });
  await sheet.getByLabel('Frage *').fill('Wer holt die Getränke?');
  await sheet.getByLabel('Thema *').selectOption({ label: 'Veranstaltungen' });
  await sheet.locator('button[type=submit]').click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('link', { name: /Wer holt die Getränke\?/ })).toBeVisible();

  await page.goto('/partner');
  await createNew(page, 'Partner');
  await expect(page.getByRole('dialog', { name: /Partner/ })).toBeVisible();
});
