// Phase 2 – Erinnerungen: S-50 (WF-PRO-02, WF-PRO-03), S-54 (WF-ADM-07), WF-ALL-04
import { expect, test } from '@playwright/test';
import { login, openTask } from './helpers';

test('WF-PRO-02: Push für dieses Gerät an und aus, mit Erklärung davor', async ({ page }) => {
  await login(page);
  await page.goto('/profil');
  const push = page.getByRole('button', { name: /Push · dieses Gerät/ });
  await expect(push).toContainText('Aus · Einschalten');
  await expect(page.getByText(/Mit Push meldet sich Myzel auf diesem Gerät/)).toBeVisible();
  await push.click();
  await expect(push).toContainText('Aktiv');
  await expect(page.getByText(/Mit Push meldet sich Myzel/)).toHaveCount(0);
  await page.reload();
  await expect(push).toContainText('Aktiv');
  await push.click();
  await expect(push).toContainText('Aus · Einschalten');
});

test('WF-PRO-03: Telegram trennen und über den Einmal-Code neu verknüpfen', async ({ page }) => {
  await login(page);
  await page.goto('/profil');
  const telegram = page.getByRole('button', { name: /^Telegram/ });
  await expect(telegram).toContainText('Verbunden · Trennen');
  await telegram.click();
  await expect(telegram).toContainText('Verknüpfen');
  await telegram.click();
  await expect(telegram).toContainText('Warte auf Start …');
  await expect(page.getByText('Der Link gilt 15 Minuten und nur einmal.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Telegram öffnen' })).toHaveAttribute(
    'href',
    /^https:\/\/t\.me\/\w+\?start=\w+$/,
  );
  await page.locator('[data-demo="telegram-start"]').click();
  await expect(telegram).toContainText('Verbunden · Trennen');
});

test('WF-ADM-07: Systemstatus zeigt die letzten Läufe und warnt nach 2 Stunden ohne Lauf', async ({
  page,
}) => {
  await login(page);
  await page.goto('/profil');
  await expect(page.getByRole('link', { name: /Systemstatus/ })).toContainText(/OK · VOR \d+ MIN/);
  await page.getByRole('link', { name: /Systemstatus/ }).click();
  const state = page.getByRole('status').first();
  await expect(state).toContainText('LÄUFT');
  await expect(state).toContainText(/Letzter Lauf vor \d+ Minuten?/);
  await expect(page.getByText('Push-Abos')).toBeVisible();
  await expect(page.getByText('8 / 11')).toBeVisible();

  await page.evaluate(() => window.__myzelDemo!.setOutage(true));
  await page.reload();
  await expect(state).toContainText('WARNUNG');
  await expect(state).toContainText(/Seit 2 Std\. \d+ Min\. kein Lauf/);
  await page.goto('/profil');
  await expect(page.getByRole('link', { name: /Systemstatus/ })).toContainText('WARNUNG');
});

test('Systemstatus sehen nur Admins', async ({ page }) => {
  await login(page, 'Jule');
  await page.goto('/profil/system');
  await expect(page.getByRole('heading', { name: 'Systemstatus' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Jule' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Systemstatus/ })).toHaveCount(0);
});

test('Zuweisung erreicht die Person; Antippen der Nachricht öffnet die Aufgabe (WF-ALL-04)', async ({
  page,
}) => {
  await login(page);
  await openTask(page, 'Vereinshaftpflicht verlängern');
  await page.getByRole('button', { name: 'Bearbeitende hinzufügen' }).click();
  await page.getByRole('dialog', { name: 'Wer bearbeitet?' }).getByRole('checkbox', { name: /Jule/ }).click();
  await expect(page.getByRole('button', { name: 'Bearbeitende entfernen: Jule' })).toBeVisible();
  await page.goto('/profil');
  await page.getByTestId('WF-LOG-03').click();
  await expect(page.getByTestId('WF-LOG-01')).toBeVisible();

  await login(page, 'Jule');
  await page.goto('/profil');
  const message = page
    .getByTestId('WF-ALL-04')
    .filter({ hasText: 'Du bist jetzt bei „Vereinshaftpflicht verlängern“ eingetragen.' });
  await expect(message).toHaveCount(2); // Push und Telegram
  await message.first().click();
  await expect(
    page.getByRole('button', { name: /Titel bearbeiten: Vereinshaftpflicht verlängern/ }),
  ).toBeVisible();
});
