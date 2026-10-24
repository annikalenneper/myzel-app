// Phase 6 – Serien: anlegen, bearbeiten, einzelner Termin als Ausnahme, beenden (WF-TER-09, WF-TER-10)
import { expect, test, type Page } from '@playwright/test';
import { login, undoBar } from './helpers';

const open = async (page: Page) => {
  await login(page);
  await page.goto('/termine');
  await expect(page.getByRole('heading', { name: 'Termine' })).toBeVisible();
};
const seriesCards = (page: Page) => page.getByRole('article').filter({ hasText: '· Serie' });
const localInput = (daysFromNow: number, time: string) => {
  // nach Kalendertagen, nicht 24-Stunden-Schritten – sonst verrutscht der Tag bei der Zeitumstellung
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${time}`;
};
const openBautag = async (page: Page) => {
  await seriesCards(page).first().getByRole('link').click();
  await expect(page.getByTestId('WF-TER-09')).toContainText(/Serie · jeden 3\. Samstag im Monat/i);
};

test('WF-TER-09: Serie anlegen – Auswahl passend zum Tag, Termine entstehen sofort', async ({ page }) => {
  await open(page);
  const before = await seriesCards(page).count();
  await page.getByRole('button', { name: 'Termin anlegen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Neuer Termin' });
  await sheet.getByRole('button', { name: 'Betriebsausflug' }).click();
  await sheet.getByLabel('Titel *').fill('Lauftreff');
  await sheet.getByLabel('Ort *').fill('Park');
  await sheet.getByLabel('Beginn *').fill(localInput(2, '18:00'));
  await sheet.getByLabel('Ende').fill(localInput(2, '19:00'));
  const repeat = sheet.getByLabel('Wiederholen');
  await expect(repeat.locator('option').first()).toHaveText('nicht wiederholen');
  await expect(repeat.locator('option').nth(1)).toHaveText(/^jeden \S+$/);
  await repeat.selectOption({ index: 1 });
  await expect(sheet.locator('button[type=submit]')).toHaveText('Serie anlegen');
  await expect(sheet).toContainText('Termine entstehen 3 Monate im Voraus');
  await expect(sheet.getByText('Veranstaltung ·')).toHaveCount(0);

  // mehrtägig geht bei einer Serie nicht
  await sheet.getByLabel('Ende').fill(localInput(3, '19:00'));
  await expect(sheet.getByRole('alert')).toHaveText('Bei einer Serie endet der Termin am selben Tag.');
  await sheet.getByLabel('Ende').fill(localInput(2, '19:00'));
  await sheet.locator('button[type=submit]').click();
  await expect(undoBar(page)).toContainText(/Serie angelegt · 1[2-4] Termine/);
  await expect(seriesCards(page).filter({ hasText: 'Lauftreff' }).first()).toBeVisible();
  expect(await seriesCards(page).count()).toBeGreaterThan(before + 10);
});

test('WF-TER-09: Serie bearbeiten wirkt auf künftige Termine; WF-TER-10: einzelner Termin als Ausnahme', async ({
  page,
}) => {
  await open(page);
  await openBautag(page);

  // nur diesen Termin ändern
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  const edit = page.getByRole('dialog', { name: 'Termin bearbeiten' });
  await expect(edit.getByRole('button', { name: 'Nur dieser Termin' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await edit.getByLabel('Titel *').fill('Bautag mit Grillen');
  await edit.locator('button[type=submit]').click();
  await expect(page.getByRole('heading', { name: 'Bautag mit Grillen' })).toBeVisible();
  await expect(page.getByTestId('WF-TER-09')).toContainText(/einzeln geändert/i);

  // von dort aus die ganze Serie
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await edit.getByRole('button', { name: 'Ganze Serie' }).click();
  const series = page.getByRole('dialog', { name: 'Serie bearbeiten' });
  await expect(series).toContainText('(1 einzeln geändert)');
  await series.getByLabel('Beginn *').fill('11:00');
  await series.getByRole('button', { name: 'Für künftige Termine speichern' }).click();
  await expect(undoBar(page)).toContainText(/Serie (geändert|gespeichert)/);

  await page.goto('/termine');
  const cards = seriesCards(page);
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const c = cards.nth(i);
    if ((await c.textContent())?.includes('Grillen')) await expect(c).toContainText('10:00');
    else await expect(c).toContainText('11:00');
  }
});

test('WF-TER-09: Serie beenden – künftige Termine entfallen, einzeln geänderte bleiben', async ({ page }) => {
  await open(page);
  await openBautag(page);
  await page.getByTestId('WF-TER-09').click();
  const series = page.getByRole('dialog', { name: 'Serie bearbeiten' });
  await series.getByRole('button', { name: 'Serie beenden …' }).click();
  await expect(series).toContainText(/künftige[rn]? Termine? entfall/);
  await series.getByRole('button', { name: 'Serie beenden', exact: true }).click();
  await expect(undoBar(page)).toContainText('Serie beendet');
  await page.goto('/termine');
  await expect(seriesCards(page)).toHaveCount(0);
});
