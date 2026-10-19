// Phase 4 – Veranstaltung ausgebaut: S-22 mit Detailbereichen (WF-VER-07 bis -11), Deaktivieren (WF-ADM-03)
import { expect, test, type Page } from '@playwright/test';
import { login, undoBar } from './helpers';

const openRave = async (page: Page) => {
  await login(page);
  await page.goto('/events');
  await page.getByRole('link', { name: /Winterrave/ }).click();
  await expect(page.getByRole('heading', { name: 'Winterrave' })).toBeVisible();
};
const section = (page: Page, name: string) => page.getByRole('region', { name });
const expand = async (page: Page, name: string) => {
  await section(page, name).getByRole('button', { expanded: false }).click();
  await expect(section(page, name).getByRole('button', { expanded: true })).toBeVisible();
};

test('F-VER-04: Kurzzusammenfassungen, offene Punkte in Bernstein, Aufbau im Kopf', async ({ page }) => {
  await openRave(page);
  await expect(page.getByText(/Aufbau ab 16:00/i)).toBeVisible();
  await expect(section(page, 'Location')).toContainText('Halle am Kanal · Angefragt · bis 300 Personen');
  await expect(section(page, 'Location')).toContainText('offene Punkte');
  await expect(section(page, 'Booking')).toContainText('1 zugesagt · 2 angefragt');
  await expect(section(page, 'Bar')).not.toContainText('offene Punkte');
  await expect(section(page, 'Rahmen')).toContainText('GEMA, Awareness-Team offen · 4 von 6 geklärt');
});

test('WF-VER-08: kurze Felder speichern beim Verlassen, Auswahlen sofort; Zusammenfassung folgt', async ({
  page,
}) => {
  await openRave(page);
  await expand(page, 'Location');
  const location = section(page, 'Location');
  await location
    .getByRole('group', { name: 'Bestätigung' })
    .getByRole('button', { name: 'Zugesagt' })
    .click();
  await expect(location).toContainText('Halle am Kanal · Zugesagt · bis 300 Personen');
  await expect(location).not.toContainText('offene Punkte');

  await location.getByLabel('Kapazität').fill('350');
  await location.getByLabel('Kapazität').press('Enter');
  await expect(location).toContainText('bis 350 Personen');

  await location.getByLabel('Kapazität').fill('viele');
  await location.getByLabel('Kapazität').blur();
  await expect(location).toContainText('Bitte eine Zahl eingeben.');
  // was der Server ablehnt, steht am Feld (deutsche Schreibweise wird verstanden)
  await location.getByLabel('Kapazität').fill('120,5');
  await location.getByLabel('Kapazität').blur();
  await expect(location).toContainText('Bitte eine ganze Zahl.');
  await location.getByLabel('Kapazität').fill('1.200');
  await location.getByLabel('Kapazität').blur();
  await expect(location).toContainText('bis 1200 Personen');

  await expand(page, 'Rahmen');
  const frame = section(page, 'Rahmen');
  await frame.getByRole('group', { name: 'GEMA' }).getByRole('button', { name: 'Erledigt' }).click();
  await frame.getByLabel('Notiz GEMA').fill('Angemeldet am 3.11.');
  await frame.getByLabel('Notiz GEMA').blur();
  await expect(frame).toContainText('Awareness-Team offen · 5 von 6 geklärt');
});

test('Booking: Act anlegen, bearbeiten, entfernen mit Rückgängig', async ({ page }) => {
  await openRave(page);
  await expand(page, 'Booking');
  const booking = section(page, 'Booking');
  await booking.getByRole('button', { name: '+ Act hinzufügen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Neuer Act' });
  await sheet.getByLabel('Name *').fill('Myzelium Soundsystem');
  await expect(sheet.getByRole('button', { name: 'Art wählen, dann speichern' })).toBeDisabled();
  await sheet.getByRole('group', { name: 'Art *' }).getByRole('button', { name: 'Band' }).click();
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(undoBar(page)).toContainText('Act angelegt: Myzelium Soundsystem');
  await expect(booking).toContainText('1 zugesagt · 3 angefragt');

  await booking.getByRole('button', { name: 'Act bearbeiten: Myzelium Soundsystem' }).click();
  const edit = page.getByRole('dialog', { name: 'Act bearbeiten' });
  await edit.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Zugesagt' }).click();
  await edit.getByLabel('Gage').fill('200 €');
  await edit.getByRole('button', { name: 'Speichern' }).click();
  await expect(booking).toContainText('2 zugesagt · 2 angefragt');
  await expect(booking).toContainText(/Band · 200 €/i);

  await booking.getByRole('button', { name: 'Act bearbeiten: Myzelium Soundsystem' }).click();
  await page
    .getByRole('dialog', { name: 'Act bearbeiten' })
    .getByRole('button', { name: 'Act entfernen' })
    .click();
  await expect(booking.getByRole('button', { name: /Myzelium/ })).toHaveCount(0);
  await undoBar(page).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(booking.getByRole('button', { name: 'Act bearbeiten: Myzelium Soundsystem' })).toBeVisible();
});

test('WF-VER-09 / -11: Hauptverantwortliche eintragen und austragen, Schichtplan verknüpfen', async ({
  page,
}) => {
  await openRave(page);
  const leads = page.getByTestId('WF-VER-09').first();
  await page.getByRole('button', { name: 'Hauptverantwortliche hinzufügen' }).click();
  await page
    .getByRole('dialog', { name: 'Hauptverantwortlich' })
    .getByRole('button', { name: 'Jule' })
    .click();
  await expect(undoBar(page)).toContainText('Hauptverantwortlich: Jule');
  await expect(page.getByRole('button', { name: 'Austragen: Jule' })).toBeVisible();
  await page.getByRole('button', { name: 'Austragen: Jule' }).click();
  await expect(page.getByRole('button', { name: 'Austragen: Jule' })).toHaveCount(0);
  await expect(leads).toBeVisible();

  await page.getByRole('button', { name: '+ Schichtplan verknüpfen' }).click();
  await page
    .getByRole('dialog', { name: 'Schichtplan verknüpfen' })
    .getByRole('button', { name: /Code of Conduct/ })
    .click();
  await expect(page.getByRole('link', { name: /Code of Conduct/ })).toBeVisible();
});

test('Nachbereitung: Text mit Speichern/Abbrechen, Entscheidung mit vorbelegter Quelle', async ({ page }) => {
  await openRave(page);
  await expand(page, 'Nachbereitung');
  const retro = section(page, 'Nachbereitung');
  await retro.getByRole('button', { name: 'Schreiben' }).click();
  await retro.getByLabel('Nachbereitung').fill('Einlass war zu langsam.\nZwei Kassen nächstes Mal.');
  await retro.getByRole('button', { name: 'Speichern' }).click();
  await expect(retro).toContainText('Einlass war zu langsam.');
  await retro.getByRole('button', { name: 'Entscheidung daraus festhalten' }).click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: /Notiz/ })).toHaveValue(
    'Nachbereitung Winterrave',
  );
});

test('Aufbau und Abbau im Bearbeiten-Formular – Abbau vor dem Ende geht nicht', async ({ page }) => {
  await openRave(page);
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  const sheet = page.getByRole('dialog', { name: 'Veranstaltung bearbeiten' });
  const begin = await sheet.getByLabel('Beginn *').inputValue();
  await sheet.getByLabel('Abbau bis').fill(begin);
  await expect(sheet).toContainText('Der Abbau muss nach dem Ende liegen.');
  await sheet.getByLabel('Abbau bis').fill('');
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(undoBar(page)).toContainText('Gespeichert');
});

test('WF-ADM-03: Deaktivieren nennt und trägt Hauptverantwortliche aus', async ({ page }) => {
  await login(page);
  await page.goto('/profil/mitglieder');
  await page.getByRole('button', { name: /Lea/ }).click();
  await page.getByRole('button', { name: 'Deaktivieren …' }).click();
  const sheet = page.getByRole('dialog', { name: 'Lea deaktivieren?' });
  await expect(sheet).toContainText('Hauptverantwortlich bei 1 Veranstaltung – wird ausgetragen');
  await sheet.getByRole('button', { name: 'Lea deaktivieren' }).click();
  await expect(undoBar(page)).toContainText('Deaktiviert');
  await page.goto('/events');
  await page.getByRole('link', { name: /Winterrave/ }).click();
  await expect(page.getByRole('button', { name: /^Austragen:/ })).toHaveCount(0);
});

test('WF-VER-07: am Tag danach schlägt die App „In Nachbereitung“ vor', async ({ page }) => {
  await login(page);
  await page.goto('/events');
  await page.getByRole('button', { name: 'Veranstaltung anlegen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Neue Veranstaltung' });
  const d = new Date(Date.now() - 3 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await sheet.getByLabel('Titel *').fill('Hofkonzert');
  await sheet.getByRole('button', { name: 'Konzert' }).click();
  await sheet
    .getByLabel('Beginn *')
    .fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T19:00`);
  await sheet.locator('button[type=submit]').click();
  await page
    .getByRole('dialog', { name: 'Vorlage „Konzert“' })
    .getByRole('button', { name: 'Überspringen' })
    .click();
  await page.getByRole('tab', { name: /vergangen/i }).click();
  await page
    .getByRole('tabpanel')
    .getByRole('link', { name: /Hofkonzert/ })
    .click();
  const status = page.getByRole('group', { name: 'Status' });
  await status.getByRole('button', { name: 'In Planung' }).click();
  await expect(undoBar(page)).toContainText('Status: In Planung');
  await status.getByRole('button', { name: 'Bestätigt' }).click();
  const hint = page.getByText('Die Veranstaltung ist vorbei. Auf „In Nachbereitung“ setzen?');
  await expect(hint).toBeVisible();
  await page.getByTestId('WF-VER-07').getByRole('button', { name: 'Ja' }).click();
  await expect(status.getByRole('button', { name: 'In Nachbereitung' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(hint).toHaveCount(0);
});
