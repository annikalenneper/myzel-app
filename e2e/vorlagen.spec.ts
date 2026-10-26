// Phase 4 – Vorlagen: S-23 Vorlagen-Dialog (WF-VER-12), S-55 Vorlagen bearbeiten (WF-ADM-08)
import { expect, test, type Page } from './fixtures';
import { login, undoBar, createNew } from './helpers';

const createParty = async (page: Page, title: string, { signIn = true } = {}) => {
  if (signIn) await login(page);
  await page.goto('/events');
  await createNew(page, 'Veranstaltung');
  const sheet = page.getByRole('dialog', { name: 'Neue Veranstaltung' });
  await sheet.getByLabel('Titel *').fill(title);
  await sheet.getByLabel('Beginn *').fill('2027-05-01T22:00');
  await sheet.locator('button[type=submit]').click();
  return page.getByRole('dialog', { name: 'Vorlage „Party“' });
};

test('WF-VER-12: Bausteine und Aufgaben abwählen, Fristen aus dem Datum, nur Ausgewähltes anlegen', async ({
  page,
}) => {
  const dialog = await createParty(page, 'Maifest');
  await expect(dialog.getByRole('checkbox', { name: 'Location anfragen' })).toContainText(
    'Bis Di, 02.03. · 60 Tage vorher',
  );
  await expect(dialog.getByRole('button', { name: '13 Aufgaben anlegen' })).toBeVisible();
  // ganzer Block „Bar“ aus, wenn keine Bar
  await dialog.getByRole('checkbox', { name: 'Baustein Bar' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Getränke bestellen' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await dialog.getByRole('checkbox', { name: 'GEMA anmelden' }).click();
  await dialog.getByRole('button', { name: '10 Aufgaben anlegen' }).click();
  await expect(undoBar(page)).toContainText('10 Aufgaben angelegt');

  await page
    .getByRole('tabpanel')
    .getByRole('link', { name: /Maifest/ })
    .click();
  await expect(page.getByText(/0 VON 10 ERLEDIGT/)).toBeVisible();

  // erneut aufrufen: Angelegtes ist markiert, nichts doppelt
  await page.getByRole('button', { name: 'Aus Vorlage …' }).click();
  const again = page.getByRole('dialog', { name: 'Vorlage „Party“' });
  await expect(again.getByRole('checkbox', { name: 'Location anfragen' })).toBeDisabled();
  await expect(again.getByRole('checkbox', { name: 'Location anfragen' })).toContainText('Schon angelegt');
  await expect(again.getByRole('button', { name: '3 Aufgaben anlegen' })).toBeVisible();
  await again.getByRole('checkbox', { name: 'Baustein Bar' }).click();
  await again.getByRole('button', { name: '1 Aufgabe anlegen' }).click();
  await expect(page.getByText(/0 VON 11 ERLEDIGT/)).toBeVisible();
});

test('WF-VER-12: „Überspringen“ legt nichts an', async ({ page }) => {
  const dialog = await createParty(page, 'Stilles Fest');
  await dialog.getByRole('button', { name: 'Überspringen' }).click();
  await page
    .getByRole('tabpanel')
    .getByRole('link', { name: /Stilles Fest/ })
    .click();
  await expect(page.getByText('NOCH KEINE AUFGABEN')).toBeVisible();
});

test('WF-ADM-08: Vorlage bearbeiten wirkt auf den nächsten Dialog', async ({ page }) => {
  await login(page, 'Jule');
  await page.goto('/profil');
  await page.getByRole('link', { name: 'Veranstaltungsvorlagen' }).click();
  await expect(page.getByRole('heading', { name: 'Vorlagen' })).toBeVisible();
  await page.getByRole('tab', { name: 'Party' }).click();
  await page.getByRole('button', { name: 'Aufgabe zu Bar hinzufügen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Neue Aufgabe · Party' });
  await expect(sheet.getByLabel('Baustein *')).toHaveValue('Bar');
  await sheet.getByLabel('Titel *').fill('Kühlschrank aus dem Lager holen');
  await sheet.getByLabel(/Frist: Tage zum Beginn/).fill('-1');
  await expect(sheet).toContainText('1 Tag vorher');
  await sheet.getByLabel('Thema *').selectOption({ label: 'Lager & Material' });
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('region', { name: 'Baustein Bar' })).toContainText(
    'Kühlschrank aus dem Lager holen',
  );

  await page.getByRole('button', { name: /Barschichten besetzen/ }).click();
  const edit = page.getByRole('dialog', { name: 'Vorlagenaufgabe bearbeiten' });
  await edit.getByRole('button', { name: 'Aus der Vorlage entfernen' }).click();
  await edit.getByRole('button', { name: 'Wirklich aus der Vorlage entfernen?' }).click();
  await expect(page.getByRole('region', { name: 'Baustein Bar' })).not.toContainText('Barschichten');

  const dialog = await createParty(page, 'Sommerfest', { signIn: false });
  await expect(dialog.getByRole('checkbox', { name: 'Kühlschrank aus dem Lager holen' })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Barschichten besetzen' })).toHaveCount(0);
});
