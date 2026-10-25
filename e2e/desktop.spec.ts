// Abläufe, die eine echte Tastatur bzw. das Desktop-Layout brauchen (8.3: Liste und Detail nebeneinander)
import { devices, expect, test } from '@playwright/test';
import { login, statusChip } from './helpers';

test.use({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } });

test('Desktop: Seitenleiste, Liste und Detail nebeneinander', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: /Flyer drucken lassen/ }).click();
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
  await expect(page.getByText('BLOCKIERT – GRUND')).toBeVisible();
});

test('WF-AUF-04: Frist per Tastatur ändern speichert genau einmal das fertige Datum', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: /Vereinshaftpflicht verlängern/ }).click();
  const due = page.getByLabel('Frist', { exact: true });
  await expect(due).not.toHaveValue('');
  await due.focus();
  await page.keyboard.type('06112027', { delay: 60 });
  // Zwischenwerte beim Tippen werden nicht gespeichert – erst beim Verlassen des Feldes
  await expect(page.getByTestId('WF-ALL-02')).toHaveCount(0);
  await due.blur();
  await expect(page.getByTestId('WF-ALL-02')).toContainText('Gespeichert');
  await expect(due).toHaveValue('2027-11-06');
  await page.getByRole('tab', { name: 'VERLAUF' }).click();
  await expect(page.getByText(/Mo hat die Frist von .* auf 06\.11\. geändert\./)).toHaveCount(1);
  await expect(page.getByText('Mo hat die Frist entfernt.')).toHaveCount(0);
});

test('WF-ALL-03: offene Netzfehler-Meldung verschwindet beim Wechsel der Ansicht und blockiert nichts', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: /Vereinshaftpflicht verlängern/ }).click();
  await page.evaluate(() => window.__myzelDemo!.failNextWrites(1));
  await statusChip(page, 'Geplant').click();
  await expect(page.getByTestId('WF-ALL-03')).toBeVisible();

  await page.getByRole('link', { name: /Nebelmaschine reparieren/ }).click();
  await expect(page.getByTestId('WF-ALL-03')).toHaveCount(0);
  await statusChip(page, 'Erledigt').click();
  await expect(statusChip(page, 'Erledigt')).toHaveAttribute('aria-pressed', 'true');

  // die verworfene Aktion wurde nicht nachträglich ausgeführt
  await page.getByRole('link', { name: /Vereinshaftpflicht verlängern/ }).click();
  await expect(statusChip(page, 'Neu')).toHaveAttribute('aria-pressed', 'true');
});

test('WF-AUF-04: halb gelöschtes oder halb getipptes Datum ändert die Frist nicht', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: /Flyer drucken lassen/ }).click();
  const due = page.getByLabel('Frist', { exact: true });
  const before = await due.inputValue();
  for (const key of ['Backspace', '0']) {
    await due.focus();
    await page.keyboard.press(key);
    await due.blur();
    await expect(due).toHaveValue(before);
  }
  await expect(page.getByTestId('WF-ALL-02')).toHaveCount(0);
  await page.getByRole('tab', { name: 'VERLAUF' }).click();
  await expect(page.getByText(/Mo hat die Frist/)).toHaveCount(0);
});

test('WF-AUF-12: was während des Sendens weitergetippt wird, bleibt im Feld', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: /Vereinshaftpflicht verlängern/ }).click();
  const field = page.getByLabel('Kommentar schreiben');
  await field.fill('Erster Kommentar');
  await page.keyboard.press('Enter');
  await page.keyboard.type(' Zweiter Text');
  await expect(page.getByRole('tab', { name: 'KOMMENTARE · 1' })).toBeVisible();
  await expect(field).toHaveValue(' Zweiter Text');
  await expect(page.getByText('Erster Kommentar', { exact: true })).toHaveCount(1);
});

test('WF-ALL-03: neue Aktion bei offener Netzfehler-Meldung läuft sofort und verwirft die alte', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: /Vereinshaftpflicht verlängern/ }).click();
  await page.evaluate(() => window.__myzelDemo!.failNextWrites(1));
  await statusChip(page, 'Geplant').click();
  await expect(page.getByTestId('WF-ALL-03')).toBeVisible();
  await statusChip(page, 'Erledigt').click();
  await expect(statusChip(page, 'Erledigt')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('WF-ALL-03')).toHaveCount(0);
  await page.getByRole('tab', { name: 'VERLAUF' }).click();
  await expect(
    page.getByText('Mo hat den Status von Neu auf Erledigt geändert.', { exact: false }),
  ).toHaveCount(1);
});
