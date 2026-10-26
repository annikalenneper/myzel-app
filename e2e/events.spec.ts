// S-20 bis S-22 · WF-VER-01 bis -05
import { expect, test } from '@playwright/test';
import { login, undoBar, createNew } from './helpers';

const eventStatus = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('group', { name: 'Status' }).getByRole('button', { name, exact: true });

test.beforeEach(async ({ page }) => {
  await login(page);
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .last()
    .getByRole('link', { name: 'Events' })
    .click();
  // erst weiter, wenn die Veranstaltungen geladen sind – sonst trifft ein Klick noch die Aufgabenliste
  await expect(page.getByRole('tabpanel').getByRole('link').first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'KOMMEND' })).toBeVisible();
});

test('WF-VER-01: kommend und vergangen nach Datum, mit Status und Fortschritt', async ({ page }) => {
  const cards = page.getByRole('tabpanel').getByRole('link');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Siebdruck-Workshop');
  await expect(cards.nth(0)).toContainText('Bestätigt');
  await expect(cards.nth(0)).toContainText('3/4');
  await expect(cards.nth(1)).toContainText('Winterrave');
  await expect(cards.nth(1)).toContainText('4/9');

  await page.getByRole('tab', { name: 'VERGANGEN' }).click();
  await expect(cards.nth(0)).toContainText('Soli-Tresen Sporenflug');
  await expect(cards.nth(1)).toContainText('Hoffest');
  await expect(cards.nth(1)).toContainText('Abgeschlossen');
});

test('WF-VER-02 / -03: anlegen als Idee, Ende muss nach dem Beginn liegen, bearbeiten', async ({ page }) => {
  await createNew(page, 'Veranstaltung');
  const sheet = page.getByRole('dialog', { name: 'Neue Veranstaltung' });
  const submit = sheet.locator('button[type=submit]');
  await expect(submit).toBeDisabled();
  await sheet.getByLabel('Titel *').fill('Frühlingsfest');
  await sheet.getByRole('button', { name: 'Workshop' }).click();
  await sheet.getByLabel('Beginn *').fill('2027-03-20T20:00');
  await sheet.getByLabel('Ende').fill('2027-03-20T18:00');
  await expect(sheet.getByRole('alert')).toHaveText('Das Ende muss nach dem Beginn liegen.');
  await expect(submit).toBeDisabled();
  await sheet.getByLabel('Ende').fill('2027-03-21T02:00');
  await submit.click();
  // ab P4 öffnet sich danach der Vorlagen-Dialog (S-23) – überspringbar
  const template = page.getByRole('dialog', { name: 'Vorlage „Workshop“' });
  await expect(template).toBeVisible();
  await template.getByRole('button', { name: 'Überspringen' }).click();

  const created = page.getByRole('tabpanel').getByRole('link', { name: /Frühlingsfest/ });
  await expect(created).toContainText('Idee');
  await expect(created).toContainText('KEINE AUFGABEN');
  await created.click();
  await expect(page.getByText('SA 20.03.2027 · 20:00–02:00')).toBeVisible();

  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  const edit = page.getByRole('dialog', { name: 'Veranstaltung bearbeiten' });
  await edit.getByLabel('Titel *').fill('Frühlingsfest im Hof');
  await edit.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('heading', { name: 'Frühlingsfest im Hof' })).toBeVisible();
});

test('WF-VER-04: nur der nächste Schritt oder Absage, mit Rückgängig und Bestätigung beim Abschließen', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'VERGANGEN' }).click();
  await page.getByRole('link', { name: /Soli-Tresen Sporenflug/ }).click();
  await expect(eventStatus(page, 'In Nachbereitung')).toHaveAttribute('aria-pressed', 'true');
  await expect(eventStatus(page, 'Idee')).toHaveAttribute('aria-disabled', 'true');
  await expect(eventStatus(page, 'Bestätigt')).toHaveAttribute('aria-disabled', 'true');

  await eventStatus(page, 'Abgeschlossen').click();
  const confirm = page.getByRole('dialog', { name: 'Veranstaltung abschließen?' });
  await expect(confirm).toContainText('1 Aufgabe ist noch offen.');
  await confirm.getByRole('button', { name: 'Trotzdem abschließen' }).click();
  await expect(eventStatus(page, 'Abgeschlossen')).toHaveAttribute('aria-pressed', 'true');
  await expect(eventStatus(page, 'Abgesagt')).toHaveAttribute('aria-disabled', 'true');

  await undoBar(page).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(eventStatus(page, 'In Nachbereitung')).toHaveAttribute('aria-pressed', 'true');
});

test('WF-VER-05 / WF-AGE-02: Aufgabe aus der Veranstaltung anlegen, Fortschritt und Agenda', async ({
  page,
}) => {
  await page.getByRole('link', { name: /Winterrave/ }).click();
  await expect(page.getByText('4 VON 9 ERLEDIGT · 1 ÜBERFÄLLIG')).toBeVisible();
  await page.getByTestId('WF-VER-05').click();
  const sheet = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  await expect(sheet).toContainText(/Veranstaltung: Winterrave/i);
  await sheet.getByLabel('Titel *').fill('Garderobe organisieren');
  await sheet.getByRole('button', { name: 'Veranstaltungen' }).click();
  await sheet.locator('button[type=submit]').click();
  await expect(page.getByText('4 VON 10 ERLEDIGT')).toBeVisible();

  await page.getByRole('button', { name: 'Aufgaben und offene Fragen zu diesem Event' }).click();
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Winterrave ▾' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('article')).toHaveCount(6);
  await expect(page.getByRole('article').filter({ hasText: 'Garderobe organisieren' })).toBeVisible();
  // offene Fragen zur Veranstaltung stehen mit auf der Agenda
  await expect(
    page.getByRole('link', { name: /Brauchen wir für den Winterrave eine Garderobe/ }),
  ).toBeVisible();
});

test('WF-ALL-01: Änderung aus einem zweiten Tab führt zum Konflikt statt zum Überschreiben', async ({
  page,
  context,
}) => {
  await page.getByRole('link', { name: /Winterrave/ }).click();
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  const edit = page.getByRole('dialog', { name: 'Veranstaltung bearbeiten' });
  await edit.getByLabel('Beschreibung').fill('Mit Garderobe');

  const other = await context.newPage();
  await other.goto(page.url());
  await other.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Bestätigt' }).click();
  await expect(other.getByTestId('WF-ALL-02')).toContainText('Status: Bestätigt');
  await other.close();

  await edit.getByRole('button', { name: 'Speichern' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Inzwischen geändert' });
  await expect(dialog).toContainText('Mo hat diese Veranstaltung gerade eben geändert.');
  await expect(dialog).toContainText('Beschreibung: Mit Garderobe');
  await dialog.getByRole('button', { name: 'Neu laden' }).click();
  await expect(eventStatus(page, 'Bestätigt')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Großer Rave zum Jahresende, Erlös an die Lagermiete.').first()).toBeVisible();
});

test('WF-VER-04: Absagen ist endgültig; Abschließen ohne offene Aufgaben fragt nicht nach', async ({
  page,
}) => {
  await page.getByRole('link', { name: /Siebdruck-Workshop/ }).click();
  await eventStatus(page, 'Abgesagt').click();
  await expect(eventStatus(page, 'Abgesagt')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Abgesagt – der Status lässt sich nicht mehr ändern.')).toBeVisible();
  await expect(eventStatus(page, 'In Nachbereitung')).toHaveAttribute('aria-disabled', 'true');
});
