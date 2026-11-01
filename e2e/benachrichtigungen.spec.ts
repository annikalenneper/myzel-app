// Phase 6 – Benachrichtigungs-Matrix und Vorlauf im Profil (F-PRO-02, WF-PRO-04)
import { expect, test } from './fixtures';
import { confirmStatus, login, openTask, statusChip } from './helpers';

test('WF-PRO-04: Schalter je Ereignis und Kanal, Vorlauf – gespeichert und sofort wirksam', async ({
  page,
}) => {
  await login(page);
  await page.goto('/profil');
  const matrix = page.getByTestId('WF-PRO-04').first();
  await expect(matrix).toContainText('Benachrichtigen bei');

  const comment = page.getByRole('button', { name: 'Neuer Kommentar per Telegram' });
  await expect(comment).toHaveAttribute('aria-pressed', 'true');
  await comment.click();
  await expect(comment).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Neuer Kommentar per Push' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // eigene Statusänderungen werden nie gemeldet – dafür gibt es keinen Schalter
  await expect(page.getByText('Auch eigene Statusänderungen')).toHaveCount(0);

  const lead = page.getByRole('group', { name: 'Vorlauf Fristerinnerung' });
  await expect(lead.getByRole('button', { name: '3 Tage vorher' })).toHaveAttribute('aria-pressed', 'true');
  await lead.getByRole('button', { name: '7 Tage vorher' }).click();
  await expect(lead.getByRole('button', { name: '7 Tage vorher' })).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(comment).toHaveAttribute('aria-pressed', 'false');
  await expect(lead.getByRole('button', { name: '7 Tage vorher' })).toHaveAttribute('aria-pressed', 'true');
});

test('WF-ALL-10: Glocke zeigt Änderungen anderer seit dem letzten Blick', async ({ page }) => {
  await login(page);
  await openTask(page, 'Getränke bei der Brauerei bestellen');
  await statusChip(page, 'In Arbeit').click();
  await confirmStatus(page);
  await expect(page.getByTestId('WF-ALL-02')).toContainText('Status: In Arbeit');
  await page.goto('/profil');
  await page.getByTestId('WF-LOG-03').click();
  await expect(page.getByTestId('WF-LOG-01')).toBeVisible();

  await login(page, 'Jule');
  const bell = page.getByRole('button', { name: /^Benachrichtigungen, \d+ neu$/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const sheet = page.getByRole('dialog', { name: 'Benachrichtigungen' });
  const entry = sheet.getByRole('link').filter({ hasText: 'ist jetzt „In Arbeit“' });
  await expect(entry).toContainText('Neu');
  await sheet.getByRole('button', { name: 'Schließen' }).first().click();
  // gesehen: keine Zahl mehr
  await expect(page.getByRole('button', { name: 'Benachrichtigungen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Benachrichtigungen', exact: true }).click();
  await expect(entry).not.toContainText('Neu');
  await entry.click();
  await expect(
    page.getByRole('button', { name: /Titel bearbeiten: Getränke bei der Brauerei bestellen/ }),
  ).toBeVisible();
});
