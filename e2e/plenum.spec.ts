// Phase 3 – Plenum: S-33 (WF-PLE-03 bis -20)
import { expect, test, type Page } from '@playwright/test';
import { login, undoBar } from './helpers';

const openPlenum = async (page: Page, title = 'Plenum Oktober') => {
  await login(page);
  await page.goto('/termine');
  await page.getByRole('article').filter({ hasText: title }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
};
const item = (page: Page, title: string) => page.getByRole('article', { name: new RegExp(`^${title}`) });
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });
const agendaTitles = (page: Page) =>
  page.getByRole('article').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));

test('F-PLE-03: Agenda zeigt alle markierten Arten mit Kennzeichen; Plenum selbst ist nicht markierbar', async ({
  page,
}) => {
  await openPlenum(page);
  await expect(tab(page, /Agenda · 8/)).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Location')).toContainText('Aufgabe · In Arbeit · überfällig');
  await expect(item(page, 'Machen wir an Silvester')).toContainText('Frage · Hoch');
  await expect(item(page, 'Awareness-Team')).toContainText('Entscheidung · Gültig');
  await expect(item(page, 'Soli-Tresen')).toContainText('Veranstaltung · In Nachbereitung');
  await expect(item(page, 'Vorbesprechung')).toContainText('Termin');
  await expect(item(page, 'Hausordnung')).toContainText('Dokument · Leitlinie');
  await expect(page.getByRole('button', { name: /Fürs Plenum markieren/ })).toHaveCount(0);
  // Abschließen geht erst ab Beginn
  await expect(page.getByTestId('WF-PLE-20')).toBeDisabled();
});

test('WF-PLE-07 / -19: Einplanen mit Person und Frist, Ergebnis, Rückgängig stellt den Punkt wieder her', async ({
  page,
}) => {
  await openPlenum(page);
  const task = item(page, 'Vereinshaftpflicht');
  await task.getByRole('button', { name: 'Einplanen' }).click();
  await task.getByRole('button', { name: 'Jule' }).click();
  await task.getByRole('button', { name: 'In 2 Wochen' }).click();
  await task.getByTestId('WF-PLE-07').getByRole('button', { name: 'Einplanen' }).click();
  await expect(undoBar(page)).toContainText('Eingeplant');
  await expect(item(page, 'Vereinshaftpflicht')).toHaveCount(0);
  await expect(tab(page, /Agenda · 7/)).toBeVisible();

  await tab(page, /Ergebnis · 1/).click();
  await expect(page.getByRole('region', { name: 'Aufgaben' })).toContainText(
    /Eingeplant: Vereinshaftpflicht verlängern · Jule · bis/,
  );

  await undoBar(page).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(tab(page, /Ergebnis · 0/)).toBeVisible();
  await tab(page, /Agenda · 8/).click();
  await expect(item(page, 'Vereinshaftpflicht')).toContainText('Aufgabe · Neu');
});

test('WF-PLE-11: Frage klären als Entscheidung mit Folgeaufgabe', async ({ page }) => {
  await openPlenum(page);
  const question = item(page, 'Machen wir an Silvester');
  await question.getByRole('button', { name: 'Klären' }).click();
  const form = question.getByTestId('WF-PLE-11');
  await expect(form.getByRole('button', { name: 'Klären' })).toBeDisabled();
  await form.getByLabel('Antwort · Pflicht').fill('Ja, kleine Party im Lager.');
  await form.getByRole('button', { name: 'Als Entscheidung' }).click();
  await form.getByRole('checkbox', { name: 'Folgeaufgabe anlegen' }).click();
  await form.getByRole('button', { name: 'Klären' }).click();
  await expect(undoBar(page)).toContainText('Geklärt');
  await tab(page, /Ergebnis · 3/).click();
  await expect(page.getByRole('region', { name: 'Entscheidungen & Fakten' })).toContainText(
    'Neue Entscheidung: Machen wir an Silvester eine Party? – Ja, kleine Party im Lager.',
  );
  await expect(page.getByRole('region', { name: 'Aufgaben' })).toContainText('Neu eingeplant: Folgeaufgabe');
  await expect(page.getByRole('region', { name: 'Fragen' })).toContainText(
    'Geklärt: Machen wir an Silvester',
  );
});

test('WF-PLE-08 / -09 / -13 / -16 / -17 / -18: Aktionen unter ⋯ je Art', async ({ page }) => {
  await openPlenum(page);
  // Blockade lösen → In Arbeit
  const flyer = item(page, 'Flyer');
  await flyer.getByRole('button', { name: 'Blockade lösen' }).click();
  await flyer.getByRole('button', { name: 'In Arbeit' }).click();
  await flyer.getByTestId('WF-PLE-09').getByRole('button', { name: 'Blockade lösen' }).click();
  await expect(undoBar(page)).toContainText('Blockade gelöst');

  // Entscheidung ersetzen
  const decision = item(page, 'Awareness-Team');
  await decision.getByRole('button', { name: /Weitere Aktionen/ }).click();
  await decision.getByRole('button', { name: 'Ersetzen' }).click();
  await decision.getByLabel('Neue Fassung · Titel *').fill('Awareness-Team mit mindestens 6 Personen');
  await decision.getByTestId('WF-PLE-13').getByRole('button', { name: 'Ersetzen' }).click();
  await expect(undoBar(page)).toContainText('Ersetzt');

  // Termin verschieben braucht ein neues Datum
  const appointment = item(page, 'Vorbesprechung');
  await appointment.getByRole('button', { name: /Weitere Aktionen/ }).click();
  await appointment.getByRole('button', { name: 'Verschieben', exact: true }).click();
  await expect(
    appointment.getByTestId('WF-PLE-16').getByRole('button', { name: 'Verschieben' }),
  ).toBeDisabled();
  await appointment.getByLabel('Neues Datum *').fill('2030-11-12T18:30');
  await appointment.getByTestId('WF-PLE-16').getByRole('button', { name: 'Verschieben' }).click();
  await expect(undoBar(page)).toContainText('Verschoben');

  // Aufgabe zur Veranstaltung anlegen – die Veranstaltung bleibt auf der Agenda
  const event = item(page, 'Soli-Tresen');
  await event.getByRole('button', { name: /Weitere Aktionen/ }).click();
  await event.getByRole('button', { name: 'Aufgabe dazu anlegen' }).click();
  await event.getByLabel('Titel *').fill('Abrechnung an Sporenflug schicken');
  await event.getByTestId('WF-PLE-17').getByRole('button', { name: 'Einplanen' }).click();
  await expect(undoBar(page)).toContainText('Aufgabe eingeplant');
  await expect(item(page, 'Soli-Tresen')).toBeVisible();

  // Besprochen
  await item(page, 'Hausordnung').getByRole('button', { name: '✓ Besprochen' }).click();
  await expect(item(page, 'Hausordnung')).toHaveCount(0);

  await tab(page, /Ergebnis · 5/).click();
  await expect(page.getByRole('region', { name: 'Besprochen' })).toContainText('Hausordnung Lager');
  await expect(page.getByRole('region', { name: 'Veranstaltungen & Termine' })).toContainText(
    'Verschoben: Vorbesprechung Winterrave',
  );
});

test('WF-PLE-15: Veranstaltung mit offenen Aufgaben abschließen fragt nach', async ({ page }) => {
  await openPlenum(page);
  const event = item(page, 'Soli-Tresen');
  const open = Number((await event.textContent())?.match(/(\d+) offene Aufgabe/)?.[1] ?? 0);
  await event.getByRole('button', { name: /Weitere Aktionen/ }).click();
  await event.getByRole('button', { name: 'Aufgabe dazu anlegen' }).click();
  await event.getByLabel('Titel *').fill('Abrechnung an Sporenflug schicken');
  await event.getByTestId('WF-PLE-17').getByRole('button', { name: 'Einplanen' }).click();
  await expect(undoBar(page)).toContainText('Aufgabe eingeplant');
  await expect(event).toContainText(`${open + 1} offene Aufgabe`);

  await event.getByRole('button', { name: 'Abschließen' }).click();
  const ask = event.getByRole('form', { name: 'Abschließen' });
  await expect(ask).toContainText(/noch \d+ offene Aufgabe/);
  await expect(ask).toContainText('Trotzdem abschließen?');
  await ask.getByRole('button', { name: 'Abschließen' }).click();
  await expect(undoBar(page)).toContainText('Abgeschlossen');
  await expect(item(page, 'Soli-Tresen')).toHaveCount(0);
});

test('WF-PLE-04: Reihenfolge per Ziehgriff – mit Tastatur und mit Ziehen', async ({ page }) => {
  await openPlenum(page);
  const before = await agendaTitles(page);
  const second = before[1]!;
  await page.getByRole('button', { name: new RegExp(`^Verschieben: ${second}`) }).press('ArrowUp');
  await expect.poll(() => agendaTitles(page)).toEqual([second, before[0], ...before.slice(2)]);
  // solange gespeichert wird, ruht der Ziehgriff
  await expect(page.getByRole('status').filter({ hasText: 'Reihenfolge wird gespeichert' })).toHaveCount(0);

  // den vierten Punkt nach oben ziehen
  const fourth = before[3]!;
  await page
    .getByRole('article')
    .first()
    .evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const handle = page.getByRole('button', { name: new RegExp(`^Verschieben: ${fourth}`) });
  const top = (await page.getByRole('article').first().boundingBox())!;
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, top.y + 5, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => agendaTitles(page).then((t) => t[0])).toBe(fourth);
  await expect(page.getByRole('status').filter({ hasText: 'Reihenfolge wird gespeichert' })).toHaveCount(0);
  // gilt für alle: nach dem Neuladen bleibt die Reihenfolge
  await page.reload();
  await expect.poll(() => agendaTitles(page).then((t) => t[0])).toBe(fourth);
});

test('WF-PLE-05 / -06: Hinzufügen – Aufgabe auf die Agenda, Fakt ins Ergebnis, Vorhandenes per Suche', async ({
  page,
}) => {
  await openPlenum(page);
  await page.getByRole('button', { name: '+ Hinzufügen' }).click();
  const add = page.getByTestId('WF-PLE-05').filter({ hasText: 'Neu anlegen' });
  await add.getByRole('button', { name: 'Aufgabe', exact: true }).click();
  await add.getByLabel('Titel *').fill('Getränkepreise für Winterrave festlegen');
  await add.getByLabel('Thema *').selectOption({ label: 'Veranstaltungen' });
  await add.getByRole('button', { name: 'Anlegen' }).click();
  await expect(undoBar(page)).toContainText('Auf der Agenda');
  await expect
    .poll(() => agendaTitles(page).then((t) => t.at(-1)))
    .toBe('Getränkepreise für Winterrave festlegen');

  await add.getByRole('button', { name: 'Fakt', exact: true }).click();
  await add.getByLabel('Titel *').fill('Lagerschlüssel liegt ab sofort bei Mo');
  await add.getByLabel('Thema *').selectOption({ label: 'Lager & Material' });
  await add.getByRole('button', { name: 'Anlegen' }).click();
  await expect(undoBar(page)).toContainText('Im Ergebnis');

  await add.getByLabel('Vorhandenes suchen').fill('Bautag November');
  await add.getByRole('button', { name: 'Auf die Agenda: Bautag November' }).click();
  await expect(item(page, 'Bautag November')).toBeVisible();
  await expect(add.getByText('auf der Agenda')).toBeVisible();

  await tab(page, /Ergebnis · 1/).click();
  await expect(page.getByRole('region', { name: 'Entscheidungen & Fakten' })).toContainText(
    'Neuer Fakt: Lagerschlüssel liegt ab sofort bei Mo',
  );
});

test('WF-PLE-03: Protokoll – Person, Notizen mit Speichern/Abbrechen, Drive-Protokoll', async ({ page }) => {
  await openPlenum(page);
  await tab(page, /Protokoll/).click();
  await page.getByRole('group', { name: 'Protokoll schreibt' }).getByRole('button', { name: 'Lea' }).click();
  await expect(undoBar(page)).toContainText('Protokoll: Lea');

  await page.getByRole('button', { name: 'Notizen schreiben' }).click();
  await page.getByLabel('Protokoll-Notizen').fill('Moderation: Lea. Start 19:10.');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Moderation: Lea. Start 19:10.')).toBeVisible();

  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.getByLabel('Protokoll-Notizen').fill('verworfen');
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByText('Moderation: Lea. Start 19:10.')).toBeVisible();

  await page.getByRole('button', { name: '+ Protokoll-Dokument verknüpfen' }).click();
  await page
    .getByRole('dialog', { name: 'Protokoll verknüpfen' })
    .getByRole('button', { name: /Protokoll Plenum September/ })
    .click();
  await expect(page.getByRole('link', { name: /Protokoll Plenum September/ })).toBeVisible();
});

test('WF-PLE-20: Plenum abschließen – Teilnahme, Vorschau, Zusammenfassung an alle', async ({ page }) => {
  await login(page);
  await page.goto('/termine');
  await page.getByRole('button', { name: 'Termin anlegen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Neuer Termin' });
  await sheet.getByRole('button', { name: 'Plenum' }).click();
  await sheet.getByLabel('Titel *').fill('Plenum Sondersitzung');
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  await sheet
    .getByLabel('Beginn *')
    .fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:01`);
  await sheet.getByLabel('Link zum Call *').fill('https://meet.example.org/myzel');
  await sheet.locator('button[type=submit]').click();
  await expect(undoBar(page)).toContainText('Termin nachgetragen');
  await page
    .getByRole('article')
    .filter({ hasText: 'Plenum Sondersitzung' })
    .getByRole('link')
    .first()
    .click();

  await item(page, 'Hausordnung').getByRole('button', { name: '✓ Besprochen' }).click();
  await expect(undoBar(page)).toContainText('Besprochen');
  await page.getByRole('button', { name: 'Plenum abschließen' }).click();
  const close = page.getByRole('dialog', { name: 'Plenum abschließen?' });
  await expect(close).toContainText('Besprochen · 1: Hausordnung Lager');
  await expect(close).toContainText('7 Punkte bleiben markiert');
  await close.getByRole('button', { name: 'Lea war da' }).click();
  await close.getByRole('button', { name: 'Abschließen und verschicken' }).click();
  await expect(page.getByText(/Abgeschlossen · Zusammenfassung an \d+ Mitglieder verschickt/)).toBeVisible();
  await expect(tab(page, /Agenda/)).toHaveCount(0);
  await expect(tab(page, /Ergebnis · 1/)).toHaveAttribute('aria-selected', 'true');
});
