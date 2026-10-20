// Smoke-Tests gegen das echte Backend (7.4 Nr. 6): Kernabläufe der Phase 1 durch App, HTTP-Schicht,
// Server-Funktionen und Postgres. Die Daten bleiben über Neuladen erhalten, weil sie auf dem Server liegen.
import { expect, test, type Page } from '@playwright/test';
import { card, openTask, statusChip, undoBar } from '../helpers';

/** Login-ID der Testkonten wie in server/db/seedFromMock.ts */
const authId = (n: number) => `aaaaaaaa-0000-4000-8000-0001${String(n).padStart(8, '0')}`;

/** steht für einen von Supabase geprüften Login: die Sitzung, wie supabase-js sie im Browser ablegt */
async function signIn(page: Page, authUserId: string, email: string) {
  const session = {
    access_token: `smoke:${authUserId}:${email}`,
    refresh_token: 'smoke',
    token_type: 'bearer',
    expires_in: 3600 * 24,
    expires_at: Math.floor(Date.now() / 1000) + 3600 * 24,
    user: {
      id: authUserId,
      email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
    },
  };
  await page.addInitScript((value) => {
    window.localStorage.setItem('sb-localhost-auth-token', value);
  }, JSON.stringify(session));
  await page.goto('/');
}

test.describe.configure({ mode: 'serial' });

test('ohne Login: Anmeldeseite, keine Daten', async ({ page }) => {
  await page.goto('/aufgaben');
  await expect(page.getByTestId('WF-LOG-01')).toBeVisible();
  await expect(page.getByText('Location für Winterrave bestätigen')).toHaveCount(0);
});

test('WF-LOG-01: wer nicht auf der Mitgliederliste steht, sieht keine Daten', async ({ page }) => {
  await signIn(page, '99999999-9999-4999-8999-999999999999', 'fremd@example.org');
  await expect(page.getByRole('heading', { name: 'Du bist noch nicht dabei' })).toBeVisible();
  await expect(page.getByText('fremd@example.org')).toBeVisible();
});

test('Aufgaben: Liste, Schnellanlage, Status mit Rückgängig, Kommentar – alles bleibt nach Neuladen', async ({
  page,
}) => {
  await signIn(page, authId(1), 'mo@example.org');
  await expect(page.getByRole('heading', { name: 'Aufgaben' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Winterrave Priorität hoch Location für Winterrave bestätigen/ }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Aufgabe anlegen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  await sheet.getByLabel('Titel *').fill('Smoke: Nebelfluid nachbestellen');
  await sheet.getByRole('button', { name: 'Lager & Material' }).click();
  await sheet.locator('button[type=submit]').click();
  await expect(sheet).toBeHidden();
  await expect(card(page, 'Smoke: Nebelfluid nachbestellen')).toContainText('Neu');

  await openTask(page, 'Smoke: Nebelfluid nachbestellen');
  await statusChip(page, 'In Arbeit').click();
  await expect(undoBar(page)).toContainText('Status: In Arbeit · du bist eingetragen');
  await undoBar(page).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(statusChip(page, 'Neu')).toHaveAttribute('aria-pressed', 'true');
  await statusChip(page, 'Geplant').click();
  await expect(statusChip(page, 'Geplant')).toHaveAttribute('aria-pressed', 'true');

  await page.getByLabel('Kommentar schreiben').fill('Händler liefert am Freitag');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByText('Händler liefert am Freitag')).toBeVisible();

  await page.reload();
  await expect(statusChip(page, 'Geplant')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Händler liefert am Freitag')).toBeVisible();
  await page.getByRole('tab', { name: 'VERLAUF' }).click();
  await expect(page.getByText(/^Mo hat die Aufgabe angelegt/)).toBeVisible();
  await expect(page.getByText(/^Mo hat den Status von Neu auf Geplant geändert/)).toBeVisible();
  await expect(page.getByText('Mo hat rückgängig gemacht: Status: In Arbeit.')).toBeVisible();
});

test('Veranstaltungen: Detail mit Fortschritt, Aufgabe aus der Veranstaltung', async ({ page }) => {
  await signIn(page, authId(1), 'mo@example.org');
  await page.goto('/events');
  await page
    .getByRole('tabpanel')
    .getByRole('link', { name: /Winterrave/ })
    .click();
  await expect(page.getByText('4 VON 9 ERLEDIGT · 1 ÜBERFÄLLIG')).toBeVisible();
  await page.getByTestId('WF-VER-05').click();
  const sheet = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  await sheet.getByLabel('Titel *').fill('Smoke: Garderobe besetzen');
  await sheet.getByRole('button', { name: 'Veranstaltungen' }).click();
  await sheet.locator('button[type=submit]').click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('4 VON 10 ERLEDIGT · 1 ÜBERFÄLLIG')).toBeVisible();
});

test('ohne Admin-Rechte keine Mitgliederverwaltung', async ({ page }) => {
  await signIn(page, authId(3), 'jule@example.org');
  await page.goto('/profil/mitglieder');
  await expect(page.getByRole('heading', { name: 'Jule' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mitglieder' })).toHaveCount(0);
});

test('WF-ADM-05: mit Admin-Rechten ein Thema anlegen', async ({ page }) => {
  await signIn(page, authId(1), 'mo@example.org');
  await page.goto('/profil/themen');
  await page.getByRole('button', { name: '+ Thema' }).click();
  const create = page.getByRole('dialog', { name: 'Neues Thema' });
  await create.getByLabel('Name *').fill('Awareness');
  await create.getByRole('button', { name: 'Verein', exact: true }).click();
  await create.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('button', { name: /Awareness Unbenutzt/i })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Awareness Unbenutzt/i })).toBeVisible();
});
