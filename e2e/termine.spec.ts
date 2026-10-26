// Phase 3 – Termine: S-30 bis S-32 (WF-TER-01 bis -08), S-53 (WF-ADM-06)
import { expect, test, type Page } from './fixtures';
import { login, undoBar, createNew } from './helpers';

const open = async (page: Page) => {
  await login(page);
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .last()
    .getByRole('link', { name: 'Termine' })
    .click();
  await expect(page.getByRole('heading', { name: 'Termine' })).toBeVisible();
};
const card = (page: Page, title: string) => page.getByRole('article').filter({ hasText: title });
/** Serientermine (Bautag ab Dezember) – wie viele im Horizont liegen, hängt vom heutigen Datum ab */
const seriesCards = (page: Page) => page.getByRole('article').filter({ hasText: '· Serie' });
const openAnswers = (page: Page, base: number) =>
  seriesCards(page)
    .count()
    .then((n) => page.getByText(`${base + n} OHNE DEINE ANTWORT`));
const localInput = (daysFromNow: number, time: string) => {
  // nach Kalendertagen, nicht 24-Stunden-Schritten – sonst verrutscht der Tag bei der Zeitumstellung
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${time}`;
};

test('WF-TER-01: nach Monat gruppiert, Filter nach Terminart, Vergangene', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('article').first()).toContainText('Plenum Oktober');
  const inSeries = await seriesCards(page).count();
  expect(inSeries).toBeGreaterThan(0);
  await expect(await openAnswers(page, 3)).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(5 + inSeries);

  await page.getByRole('button', { name: 'Bautag', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2 + inSeries);
  await page.getByRole('button', { name: 'Betriebsausflug' }).click();
  await expect(page.getByTestId('WF-ALL-05')).toContainText('Keine Termine dieser Art geplant.');
  await page.getByRole('button', { name: 'Alle', exact: true }).click();

  await page.getByRole('button', { name: 'Vergangene' }).click();
  await expect(page.getByRole('article')).toHaveCount(5);
  await expect(page.getByRole('article').first()).toContainText('Bautag September');
});

test('WF-TER-03: Zu- und Absage auf der Karte, zweiter Tipp nimmt zurück, Rückgängig', async ({ page }) => {
  await open(page);
  const bautag = card(page, 'Bautag Oktober');
  await expect(bautag).toContainText('4 ✓');
  await bautag.getByRole('button', { name: 'Komme', exact: true }).click();
  await expect(bautag).toContainText('5 ✓');
  await expect(undoBar(page)).toContainText('Zugesagt: Bautag Oktober');
  await expect(await openAnswers(page, 2)).toBeVisible();
  await undoBar(page).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(bautag).toContainText('4 ✓');

  await bautag.getByRole('button', { name: 'Komme nicht' }).click();
  await expect(bautag.getByRole('button', { name: 'Komme nicht' })).toHaveAttribute('aria-pressed', 'true');
  await bautag.getByRole('button', { name: 'Komme nicht' }).click();
  await expect(bautag.getByRole('button', { name: 'Komme nicht' })).toHaveAttribute('aria-pressed', 'false');
});

test('WF-TER-02: Terminart belegt vor; Ort bzw. Link sind je nach Format Pflicht', async ({ page }) => {
  await open(page);
  await createNew(page, 'Termin');
  const sheet = page.getByRole('dialog', { name: 'Neuer Termin' });
  const submit = sheet.locator('button[type=submit]');
  await expect(submit).toHaveText('Terminart wählen, dann anlegen');

  await sheet.getByRole('button', { name: 'Bautag' }).click();
  await expect(sheet.getByLabel('Titel *')).toHaveValue('Bautag');
  await expect(sheet.getByLabel('Ort *')).toHaveValue('Lager');
  await expect(sheet).toContainText(/Vorbelegt: Thema Lager & Material/i);
  await sheet.getByLabel('Titel *').fill('Bautag Dezember');
  await sheet.getByLabel('Beginn *').fill(localInput(60, '10:00'));
  await sheet.getByRole('button', { name: 'Hybrid' }).click();
  await expect(submit).toHaveText('Link zum Call angeben, dann anlegen');
  await sheet.getByLabel('Link zum Call *').fill('kein-link');
  await submit.click();
  await expect(sheet.getByRole('alert')).toHaveText('Der Link muss mit https:// beginnen.');
  await sheet.getByRole('button', { name: 'Vor Ort' }).click();
  await submit.click();

  await expect(sheet).toBeHidden();
  const created = card(page, 'Bautag Dezember');
  await expect(created).toContainText(/10:00 · Vor Ort · Lager/i);
  await expect(created).toContainText('0 ✓');
});

test('WF-PLE-01: Plenum anlegen mit Hinweis zum Ergebnis', async ({ page }) => {
  await open(page);
  await createNew(page, 'Termin');
  const sheet = page.getByRole('dialog', { name: 'Neuer Termin' });
  await sheet.getByRole('button', { name: 'Plenum' }).click();
  await expect(sheet.getByTestId('WF-PLE-01')).toContainText('Ins Ergebnis kommt alles');
  await expect(sheet.getByLabel('Ort *')).toHaveCount(0);
});

test('WF-TER-04 / -05 / -07: Detail – verschieben, Aufgabe, absagen', async ({ page }) => {
  await open(page);
  await card(page, 'Bautag Oktober').getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Bautag Oktober' })).toBeVisible();
  await expect(page.getByText(/Kommen · 4/i)).toBeVisible();
  await expect(page.getByText(/Offen · 6/i)).toBeVisible();
  await expect(page.getByText('Aufgaben zum Termin · 2')).toBeVisible();
  // „Hat stattgefunden“ geht erst nach Beginn
  await expect(page.getByRole('button', { name: 'Hat stattgefunden' })).toBeDisabled();

  await page.getByRole('button', { name: '+ Aufgabe zum Termin' }).click();
  const task = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  await expect(task).toContainText(/Termin: Bautag Oktober/i);
  await task.getByLabel('Titel *').fill('Kaffee und Snacks mitbringen');
  await task.getByRole('button', { name: 'Lager & Material' }).click();
  await task.locator('button[type=submit]').click();
  await expect(page.getByText('Aufgaben zum Termin · 3')).toBeVisible();

  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  const edit = page.getByRole('dialog', { name: 'Termin bearbeiten' });
  await edit.getByLabel('Beginn *').fill(localInput(13, '10:00'));
  await edit.getByLabel('Ende').fill(localInput(13, '16:00'));
  await expect(edit).toContainText('4 Zusagen und 6 ohne Antwort bekommen eine Nachricht.');
  await edit.getByRole('button', { name: 'Speichern' }).click();
  await expect(undoBar(page)).toContainText('Geändert – Benachrichtigung geht raus');

  await page.getByRole('button', { name: 'Absagen', exact: true }).click();
  const ask = page.getByRole('alertdialog', { name: 'Termin absagen' });
  await ask.getByRole('button', { name: 'Absagen und benachrichtigen' }).click();
  await expect(
    page.getByText('Abgesagt. Alle mit Zusage und ohne Antwort wurden benachrichtigt.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
});

test('WF-TER-06: vergangener Termin – Teilnahme aus den Zusagen vorbefüllt, Korrektur möglich', async ({
  page,
}) => {
  await open(page);
  await createNew(page, 'Termin');
  const sheet = page.getByRole('dialog', { name: 'Neuer Termin' });
  await sheet.getByRole('button', { name: 'Sonstiges' }).click();
  await sheet.getByLabel('Titel *').fill('Lagerbegehung');
  await sheet.getByLabel('Beginn *').fill(localInput(-1, '18:00'));
  await sheet.getByLabel('Ort *').fill('Lager');
  await sheet.locator('button[type=submit]').click();
  await page.getByRole('button', { name: 'Vergangene' }).click();
  await card(page, 'Lagerbegehung').getByRole('link').click();

  const attendance = page.getByRole('group', { name: 'Teilnahme' });
  await attendance.getByRole('button', { name: 'Mo war da', exact: true }).click();
  await attendance.getByRole('button', { name: 'Lea war da' }).click();
  await page.getByRole('button', { name: 'Hat stattgefunden · 2 da' }).click();
  await expect(page.getByText('Hat stattgefunden · 2 waren da. Korrekturen bleiben möglich.')).toBeVisible();
  await attendance.getByRole('button', { name: 'Lea war da' }).click();
  await expect(page.getByText('Hat stattgefunden · 1 waren da.')).toBeVisible();
});

test('WF-AUF-04: Termin im Aufgaben-Detail zuordnen', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: /Nebelmaschine reparieren/ }).click();
  await page.getByRole('button', { name: /^Termin/ }).click();
  await page
    .getByRole('dialog', { name: 'Termin' })
    .getByRole('button', { name: /Bautag November/ })
    .click();
  await expect(page.getByRole('button', { name: /^Termin/ })).toContainText('Bautag November');
});

test('WF-ADM-06: Terminarten anlegen, bearbeiten, löschen; belegte nur archivierbar', async ({ page }) => {
  await login(page);
  await page.goto('/profil/terminarten');
  await expect(page.getByRole('button', { name: /Plenum/ }).first()).toContainText('PLENUM-FUNKTIONEN');
  await page.getByRole('button', { name: '+ Terminart' }).click();
  const sheet = page.getByRole('dialog', { name: 'Neue Terminart' });
  await sheet.getByLabel('Name *').fill('Putztag');
  await sheet.getByLabel('Ort').fill('Lager');
  await sheet.getByRole('button', { name: 'Farbe Blau' }).click();
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('button', { name: /Putztag/ })).toContainText(/Unbenutzt/i);

  await page.getByRole('button', { name: /Putztag/ }).click();
  const edit = page.getByRole('dialog', { name: 'Terminart bearbeiten' });
  await expect(edit.getByRole('checkbox', { name: /Plenum-Funktionen/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(edit).toContainText('Noch nirgends benutzt.');
  await edit.getByRole('button', { name: 'Löschen' }).click();
  await expect(edit).toContainText('Lässt sich nicht rückgängig machen.');
  await edit.getByRole('button', { name: 'Wirklich endgültig löschen?' }).click();
  await expect(page.getByRole('button', { name: /Putztag/ })).toHaveCount(0);

  await page.getByRole('button', { name: /Bautag/ }).click();
  await expect(edit).toContainText('Mit Terminen belegt – deshalb nur archivierbar.');
  await edit.getByRole('button', { name: 'Archivieren' }).click();
  await expect(page.getByRole('button', { name: /Bautag/ })).toContainText(/Archiviert/i);
});

test('WF-TER-11: Termin in Google Kalender eintragen oder als .ics herunterladen', async ({ page }) => {
  await open(page);
  await card(page, 'Vorbesprechung Winterrave').getByRole('link').first().click();
  const google = page.getByRole('link', { name: 'In Google Kalender eintragen ↗' });
  await expect(google).toHaveAttribute(
    'href',
    /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/,
  );
  await expect(google).toHaveAttribute('href', /text=Vorbesprechung\+Winterrave/);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '.ics herunterladen' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^Vorbesprechung-Winterrave[A-Za-z0-9-]*\.ics$/);
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const ics = await readFile(path, 'utf8');
  expect(ics).toContain('BEGIN:VEVENT');
  expect(ics).toContain('SUMMARY:Vorbesprechung Winterrave');
  expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
});
