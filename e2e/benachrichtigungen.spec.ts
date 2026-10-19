// Phase 6 – Benachrichtigungs-Matrix und Vorlauf im Profil (F-PRO-02, WF-PRO-04)
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('WF-PRO-04: Schalter je Ereignis und Kanal, eigene Statusänderungen, Vorlauf – gespeichert und sofort wirksam', async ({
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

  const own = page.getByRole('button', { name: 'Auch eigene Statusänderungen' });
  await expect(own).toHaveAttribute('aria-pressed', 'false');
  await own.click();
  await expect(own).toHaveAttribute('aria-pressed', 'true');

  const lead = page.getByRole('group', { name: 'Vorlauf Fristerinnerung' });
  await expect(lead.getByRole('button', { name: '3 Tage vorher' })).toHaveAttribute('aria-pressed', 'true');
  await lead.getByRole('button', { name: '7 Tage vorher' }).click();
  await expect(lead.getByRole('button', { name: '7 Tage vorher' })).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(comment).toHaveAttribute('aria-pressed', 'false');
  await expect(own).toHaveAttribute('aria-pressed', 'true');
  await expect(lead.getByRole('button', { name: '7 Tage vorher' })).toHaveAttribute('aria-pressed', 'true');
});
