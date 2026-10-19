// Phase 6 – Telegram-Buttons (6.4): in Schritt A unter den Telegram-Nachrichten der Demo-Werkzeuge
import { expect, test } from '@playwright/test';
import { login, openTask, undoBar } from './helpers';

test('„Übernehme ich“ unter der Zuweisung setzt die Aufgabe auf In Arbeit – mit Person in der Historie', async ({
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
  const telegramMessage = page
    .locator('div')
    .filter({ has: page.getByRole('group', { name: 'Telegram-Buttons' }) })
    .filter({ hasText: /TELEGRAM/i })
    .filter({ hasText: 'Du bist jetzt bei „Vereinshaftpflicht verlängern“ eingetragen.' })
    .last();
  const buttons = telegramMessage.getByRole('group', { name: 'Telegram-Buttons' });
  await expect(buttons.getByRole('button')).toHaveText(['Übernehme ich', 'Passt nicht']);
  await buttons.getByRole('button', { name: 'Übernehme ich' }).click();
  await expect(undoBar(page)).toContainText('Danke! „Vereinshaftpflicht verlängern“ ist jetzt „In Arbeit“.');
  await buttons.getByRole('button', { name: 'Übernehme ich' }).click();
  await expect(undoBar(page)).toContainText('ist schon „In Arbeit“');

  await openTask(page, 'Vereinshaftpflicht verlängern');
  await expect(
    page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'In Arbeit' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: 'VERLAUF' }).click();
  await expect(page.getByText(/Jule hat den Status von .+ auf In Arbeit geändert/)).toBeVisible();
});
