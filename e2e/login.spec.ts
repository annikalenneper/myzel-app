// S-01 Anmeldung, S-02 Kein Zugriff · WF-LOG-01 bis -03
import { expect, test } from './fixtures';
import { login } from './helpers';

test('WF-LOG-01: aktives Mitglied landet auf der Agenda, Sitzung bleibt bestehen', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Flyer drucken lassen')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
});

test('WF-LOG-01: wer nicht auf der Mitgliederliste steht, sieht S-02 und keine Daten', async ({ page }) => {
  await login(page, 'Jemand');
  await expect(page.getByRole('heading', { name: 'Du bist noch nicht dabei' })).toBeVisible();
  await expect(page.getByText('jemand@example.org')).toBeVisible();
  await page.goto('/agenda');
  await expect(page.getByRole('heading', { name: 'Du bist noch nicht dabei' })).toBeVisible();
  await expect(page.getByText('Flyer drucken lassen')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mit anderem Konto anmelden' }).click();
  await expect(page.getByTestId('WF-LOG-01')).toBeVisible();
});

test('WF-LOG-02: Mail-Link zeigt immer dieselbe Meldung und meldet über den Link an', async ({ page }) => {
  await page.goto('/');
  const send = page.getByTestId('WF-LOG-02');
  await expect(send).toBeDisabled();
  await page.getByLabel('E-Mail-Adresse').fill('keine-adresse');
  await expect(send).toBeDisabled();

  await page.getByLabel('E-Mail-Adresse').fill('unbekannt@example.org');
  await send.click();
  await expect(page.getByText('Wenn die Adresse bekannt ist, kommt gleich ein Link.')).toBeVisible();
  await page.getByRole('button', { name: 'Zurück' }).click();

  await page.getByLabel('E-Mail-Adresse').fill('jule@example.org');
  await send.click();
  await expect(page.getByText('Wenn die Adresse bekannt ist, kommt gleich ein Link.')).toBeVisible();
  await page.locator('[data-demo="magic-link"]').click();
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
});

test('WF-LOG-03: Abmelden beendet die Sitzung', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Profil' }).last().click();
  await page.getByTestId('WF-LOG-03').click();
  await expect(page.getByTestId('WF-LOG-01')).toBeVisible();
  await page.goto('/agenda');
  await expect(page.getByTestId('WF-LOG-01')).toBeVisible();
});

test('Navigation: Agenda, Events, Termine, Wissen, Profil', async ({ page }) => {
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' }).last();
  await expect(nav.getByRole('link')).toHaveText(['Agenda', 'Events', 'Termine', 'Wissen', 'Profil']);
  await nav.getByRole('link', { name: 'Events' }).click();
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
});
