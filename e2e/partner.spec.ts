// Phase 4 – Kooperationspartner: S-24 (WF-VER-10, WF-VER-13), Suche, Plenum
import { expect, test, type Page } from '@playwright/test';
import { login, undoBar } from './helpers';

const openRavePartners = async (page: Page) => {
  await login(page);
  await page.goto('/events');
  await page.getByRole('link', { name: /Winterrave/ }).click();
  const partner = page.getByRole('region', { name: 'Partner' });
  await expect(partner).toContainText('Kollektiv Sporenflug, Druckerei Tinte & Tusche');
  await partner.getByRole('button', { expanded: false }).click();
  return partner;
};

test('WF-VER-10: Partner verknüpfen, mit Rolle; entfernen mit Rückgängig', async ({ page }) => {
  const partner = await openRavePartners(page);
  await expect(partner.getByRole('link', { name: /Kollektiv Sporenflug.*3 EVENTS/ })).toBeVisible();
  await partner.getByRole('button', { name: '+ Partner verknüpfen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Partner verknüpfen' });
  // bereits verknüpfte stehen nicht zur Wahl
  await expect(sheet.getByRole('radio', { name: /Sporenflug/ })).toHaveCount(0);
  await sheet.getByRole('radio', { name: /Nachbarschaftsverein/ }).click();
  await sheet.getByLabel('Rolle bei dieser Veranstaltung · optional').fill('Nachbarschaft informieren');
  await sheet.getByRole('button', { name: 'Verknüpfen' }).click();
  await expect(undoBar(page)).toContainText('Partner verknüpft');
  await expect(partner).toContainText(/Nachbarschaft informieren/i);

  await partner.getByRole('button', { name: 'Partner entfernen: Druckerei Tinte & Tusche' }).click();
  await expect(partner.getByRole('link', { name: /Druckerei/ })).toHaveCount(0);
  await undoBar(page).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(partner.getByRole('link', { name: /Druckerei/ })).toBeVisible();
});

test('WF-VER-10: neuen Partner direkt aus der Veranstaltung anlegen und verknüpfen', async ({ page }) => {
  const partner = await openRavePartners(page);
  await partner.getByRole('button', { name: '+ Partner verknüpfen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Partner verknüpfen' });
  await sheet.getByLabel('Partner suchen').fill('Radio Myzel');
  await expect(sheet).toContainText('Kein passender Partner.');
  await sheet.getByRole('button', { name: '+ Neuen Partner anlegen „Radio Myzel“' }).click();
  const form = page.getByRole('dialog', { name: 'Neuer Partner' });
  await expect(form.getByLabel('Name *')).toHaveValue('Radio Myzel');
  await form.getByLabel('Art').fill('Radio');
  await form.getByLabel('Mail').fill('keine-mail');
  await form.getByRole('button', { name: 'Anlegen' }).click();
  await expect(form).toContainText('Bitte eine gültige Mail-Adresse eingeben.');
  await form.getByLabel('Mail').fill('studio@radio.example.org');
  await form.getByLabel('Interne Kontaktperson').selectOption({ label: 'Jule' });
  await form.getByRole('button', { name: 'Anlegen' }).click();
  await expect(partner.getByRole('link', { name: /Radio Myzel/ })).toBeVisible();
});

test('WF-VER-13: Partnerliste mit Suche, Detail mit bisherigen Veranstaltungen, bearbeiten', async ({
  page,
}) => {
  const partner = await openRavePartners(page);
  await partner.getByRole('link', { name: 'Alle Partner ›' }).click();
  await expect(page.getByRole('heading', { name: 'Partner' })).toBeVisible();
  await page.getByLabel('Partner suchen').fill('druck');
  await expect(page.getByRole('link', { name: /Druckerei/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Sporenflug/ })).toHaveCount(0);
  await page.getByLabel('Partner suchen').fill('');
  await page.getByRole('link', { name: /Kollektiv Sporenflug/ }).click();

  await expect(page.getByRole('heading', { name: 'Kollektiv Sporenflug' })).toBeVisible();
  await expect(page.getByText('Beteiligt an · 3 Veranstaltungen')).toBeVisible();
  await expect(page.getByRole('link', { name: /Winterrave/ })).toContainText(/Line-up und Deko/i);
  await expect(page.getByText('Rana')).toBeVisible();

  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  const form = page.getByRole('dialog', { name: 'Partner bearbeiten' });
  await form.getByLabel('Telefon').fill('0170 1234567');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('link', { name: '0170 1234567' })).toBeVisible();
});

test('WF-WIS-11: die Suche findet Partner', async ({ page }) => {
  await login(page);
  await page.goto('/events');
  await page.getByRole('button', { name: 'Suche über alles' }).click();
  const overlay = page.getByRole('dialog', { name: 'Suche über alles' });
  await overlay.getByLabel('Suche über alles').fill('Sporen');
  await overlay
    .getByRole('region', { name: 'Partner' })
    .getByRole('link', { name: /Kollektiv Sporenflug/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Kollektiv Sporenflug' })).toBeVisible();
});
