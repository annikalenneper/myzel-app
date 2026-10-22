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
    window.localStorage.setItem('sb-127-auth-token', value);
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

test('Phase 2: Telegram über den Einmal-Code verknüpfen, Systemstatus für Admins', async ({ page }) => {
  await signIn(page, authId(1), 'mo@example.org');
  await page.goto('/profil');
  const telegram = page.getByRole('button', { name: /^Telegram/ });
  await expect(telegram).toContainText('Verbunden · Trennen');
  await telegram.click();
  await expect(telegram).toContainText('Verknüpfen');
  await telegram.click();
  await expect(telegram).toContainText('Warte auf Start …');
  await expect(page.getByRole('link', { name: 'Telegram öffnen' })).toHaveAttribute(
    'href',
    /^https:\/\/t\.me\/myzel_smoke_bot\?start=\w{16}$/,
  );
  await page.reload();
  await expect(telegram).toContainText('Warte auf Start …');

  await page.getByRole('link', { name: /Systemstatus/ }).click();
  await expect(page.getByText('Push-Abos')).toBeVisible();
  await expect(page.getByText('7 / 11')).toBeVisible();
});

test('Phase 3: Zusage am Termin, Plenum-Agenda, Einplanen mit Ergebnis und Rückgängig', async ({ page }) => {
  await signIn(page, authId(1), 'mo@example.org');
  await page.goto('/termine');
  await expect(page.getByRole('heading', { name: 'Termine' })).toBeVisible();
  const bautag = page.getByRole('article').filter({ hasText: 'Bautag Oktober' });
  await expect(bautag).toContainText('4 ✓');
  await bautag.getByRole('button', { name: 'Komme', exact: true }).click();
  await expect(bautag).toContainText('5 ✓');
  await page.reload();
  await expect(page.getByRole('article').filter({ hasText: 'Bautag Oktober' })).toContainText('5 ✓');

  await page.getByRole('article').filter({ hasText: 'Plenum Oktober' }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Plenum Oktober' })).toBeVisible();
  const item = (title: string) => page.getByRole('article', { name: new RegExp(`^${title}`) });
  // frühere Smoke-Tests haben Aufgaben „Fürs Plenum“ angelegt – gezählt wird relativ
  const agendaTab = page.getByRole('tab', { name: /^Agenda · \d+/ });
  const before = Number((await agendaTab.textContent())!.match(/\d+/)![0]);
  await expect(item('Awareness-Team')).toContainText('Entscheidung · Gültig');
  const task = item('Vereinshaftpflicht');
  await task.getByRole('button', { name: 'Einplanen' }).click();
  await task.getByRole('button', { name: 'Jule' }).click();
  await task.getByTestId('WF-PLE-07').getByRole('button', { name: 'Einplanen' }).click();
  await expect(page.getByTestId('WF-ALL-02')).toContainText('Eingeplant');
  await expect(page.getByRole('tab', { name: new RegExp(`Agenda · ${before - 1}`) })).toBeVisible();
  await expect(item('Vereinshaftpflicht')).toHaveCount(0);
  await page.getByRole('tab', { name: /Ergebnis · 1/ }).click();
  await expect(page.getByRole('region', { name: 'Aufgaben' })).toContainText(
    'Eingeplant: Vereinshaftpflicht verlängern · Jule',
  );
  await page.getByTestId('WF-ALL-02').getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByRole('tab', { name: /Ergebnis · 0/ })).toBeVisible();
});

test('Phase 3: Beschlüsse lesen, Frage stellen – bleibt nach Neuladen', async ({ page }) => {
  await signIn(page, authId(1), 'mo@example.org');
  await page.goto('/wissen');
  await expect(page.getByRole('heading', { name: 'Wissen' })).toBeVisible();
  await expect(page.getByText('5 Einträge')).toBeVisible();
  await page.getByRole('tab', { name: 'Fragen' }).click();
  await page.getByRole('button', { name: 'Frage stellen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Neue Frage' });
  await sheet.getByLabel('Frage *').fill('Smoke: Wer hat den Zweitschlüssel?');
  await sheet.getByLabel('Thema *').selectOption({ label: 'Lager & Material' });
  await sheet.locator('button[type=submit]').click();
  const card = page.getByRole('article').filter({ hasText: 'Smoke: Wer hat den Zweitschlüssel?' });
  await expect(card).toContainText(/fürs Plenum/i);
  await page.reload();
  await page.getByRole('tab', { name: 'Fragen' }).click();
  await expect(card).toBeVisible();
});

test('Phase 4: Party mit Vorlagen-Dialog anlegen, Detailbereich pflegen – bleibt nach Neuladen', async ({
  page,
}) => {
  await signIn(page, authId(1), 'mo@example.org');
  await page.goto('/events');
  await page.getByRole('button', { name: 'Veranstaltung anlegen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Neue Veranstaltung' });
  await sheet.getByLabel('Titel *').fill('Smoke: Maifest');
  await sheet.getByLabel('Beginn *').fill('2027-05-01T22:00');
  await sheet.locator('button[type=submit]').click();
  const dialog = page.getByRole('dialog', { name: 'Vorlage „Party“' });
  await expect(dialog.getByRole('checkbox', { name: 'Location anfragen' })).toContainText(
    'Bis Di, 02.03. · 60 Tage vorher',
  );
  await dialog.getByRole('checkbox', { name: 'Baustein Bar' }).click();
  await dialog.getByRole('button', { name: /^\d+ Aufgaben anlegen$/ }).click();
  await expect(page.getByTestId('WF-ALL-02')).toContainText('Aufgaben angelegt');

  await page
    .getByRole('tabpanel')
    .getByRole('link', { name: /Smoke: Maifest/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Smoke: Maifest' })).toBeVisible();
  const location = page.getByRole('region', { name: 'Location' });
  await location.getByRole('button', { expanded: false }).click();
  await location.getByLabel('Kapazität').fill('350');
  await location.getByLabel('Kapazität').press('Enter');
  await expect(location).toContainText('bis 350 Personen');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Location' })).toContainText('bis 350 Personen');
});
