// Phase 3 – Plenum: S-33 (WF-PLE-03, -19, -20) – Ergebnis und Protokoll; die Agenda ist eine eigene Ansicht (16.1)
import { expect, test, type Page } from '@playwright/test';
import { login, undoBar, createNew } from './helpers';

const openPlenum = async (page: Page, title = 'Plenum Oktober') => {
  await login(page);
  await page.goto('/termine');
  await page.getByRole('article').filter({ hasText: title }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
};
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });

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
  await createNew(page, 'Termin');
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

  // keine Agenda mehr im Plenum (16.2): Ergebnis und Protokoll
  await expect(tab(page, /Agenda/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Plenum abschließen' }).click();
  const close = page.getByRole('dialog', { name: 'Plenum abschließen?' });
  await close.getByRole('button', { name: 'Lea war da' }).click();
  await close.getByRole('button', { name: 'Abschließen und verschicken' }).click();
  await expect(page.getByText(/Abgeschlossen · Zusammenfassung an \d+ Mitglieder verschickt/)).toBeVisible();
  await expect(tab(page, /Ergebnis/)).toHaveAttribute('aria-selected', 'true');
});

test('WF-PLE-21: während des Plenums fragt die App einmal nach – die Änderung steht im Ergebnis', async ({
  page,
}) => {
  await login(page);
  await page.goto('/termine');
  await createNew(page, 'Termin');
  const sheet = page.getByRole('dialog', { name: 'Neuer Termin' });
  await sheet.getByRole('button', { name: 'Plenum' }).click();
  await sheet.getByLabel('Titel *').fill('Plenum Jetzt');
  // vor zehn Minuten begonnen, ohne Ende: läuft drei Stunden
  const d = new Date(Date.now() - 10 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await sheet
    .getByLabel('Beginn *')
    .fill(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
  await sheet.getByLabel('Link zum Call *').fill('https://meet.example.org/myzel');
  await sheet.locator('button[type=submit]').click();
  await expect(undoBar(page)).toBeVisible();

  // Mo hat nicht zugesagt: die erste Änderung fragt nach
  await page.goto('/agenda');
  await page.getByRole('link', { name: /Vereinshaftpflicht verlängern/ }).click();
  await page
    .getByRole('group', { name: 'Status' })
    .getByRole('button', { name: 'Geplant', exact: true })
    .click();
  const ask = page.getByRole('alertdialog', { name: 'Gehört das zum Plenum?' });
  await expect(ask).toContainText('Gerade läuft Plenum Jetzt.');
  await ask.getByRole('button', { name: 'Ja, gehört zum Plenum' }).click();
  await expect(undoBar(page)).toContainText('Status: Geplant');
  // die Antwort gilt für weitere Änderungen
  await page.getByRole('button', { name: 'Folgen' }).first().click();
  await expect(ask).toHaveCount(0);

  await page.goto('/termine');
  await page.getByRole('article').filter({ hasText: 'Plenum Jetzt' }).getByRole('link').first().click();
  await expect(page.getByRole('region', { name: 'Aufgaben' })).toContainText(
    'Vereinshaftpflicht verlängern · Geplant',
  );
});
