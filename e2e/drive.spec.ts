// Phase 5 – Wissen & Drive: Verzeichnis, Suche, Verknüpfen, Drive-Ordner der Veranstaltung, Abgleich
// (WF-WIS-08 bis -11, WF-VER-14)
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const openDrive = async (page: Page) => {
  await login(page);
  await page.goto('/wissen');
  await page.getByRole('tab', { name: 'Drive' }).click();
  await expect(page).toHaveURL(/\/wissen\/drive$/);
};
const list = (page: Page) => page.getByRole('list', { name: 'Drive-Inhalt' });
const path = (page: Page) => page.getByRole('navigation', { name: 'Ordnerpfad' });
const folder = (page: Page, name: string) => list(page).getByRole('button', { name: new RegExp(`^${name}`) });
const demo = async (page: Page, action: string) => {
  await page.goto('/profil');
  await page.getByRole('button', { name: new RegExp(`^${action}`) }).click();
};

test('WF-WIS-08 / -10: Ordner öffnen, Pfad, Dateien öffnen in Drive, Suche, „Zuletzt“, neu einlesen', async ({
  page,
}) => {
  await openDrive(page);
  await expect(path(page)).toHaveText('Myzel Drive');
  await expect(folder(page, 'Veranstaltungen')).toContainText('Ordner · 2 Einträge');
  await expect(page.getByText(/^Abgeglichen /i)).toBeVisible();

  await folder(page, 'Veranstaltungen').click();
  await folder(page, '2026-12 Winterrave').click();
  await expect(page).toHaveURL(/\/wissen\/drive\/drive-winterrave$/);
  await expect(path(page)).toHaveText(/Myzel Drive\s*\/\s*Veranstaltungen\s*\/\s*2026-12 Winterrave/i);
  const plan = list(page).getByRole('link', { name: /Schichtplan Winterrave/ });
  await expect(plan).toHaveAttribute('target', '_blank');
  await expect(plan).toHaveAttribute('href', /docs\.google\.com\/spreadsheets/);
  await expect(plan).toContainText(/Tabelle · geändert heute/i);

  await folder(page, 'Flyer & Social').click();
  await expect(list(page).getByRole('listitem').filter({ hasText: 'Flyer_Winterrave_v3.pdf' })).toContainText(
    '1 Aufgabe',
  );
  // Zurück über den Pfad
  await path(page).getByRole('button', { name: 'Veranstaltungen' }).click();
  await expect(folder(page, '2026-12 Winterrave')).toBeVisible();
  await page.goBack();
  await expect(path(page)).toContainText('Flyer & Social');

  await page.getByLabel('Im Drive suchen').fill('protokoll');
  await expect(page.getByRole('status')).toHaveText('4 Treffer für „protokoll“');
  await expect(list(page).getByRole('link', { name: /Protokoll Plenum Juli/ })).toContainText(
    'Verein / Protokolle',
  );
  await page.getByLabel('Im Drive suchen').fill('');

  await page.getByRole('button', { name: 'ZULETZT' }).click();
  await expect(list(page).getByRole('listitem').first()).toContainText('Schichtplan Winterrave');
  // nur Dateien, keine Ordner
  await expect(list(page).getByText(/^Ordner ·/)).toHaveCount(0);

  await page.getByTestId('WF-WIS-10').click();
  await expect(page.getByTestId('WF-ALL-02')).toContainText(/Neu eingelesen · \d+ Einträge/);
});

test('WF-WIS-11: „im Drive suchen“ aus der globalen Suche übernimmt das Suchwort', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Suche über alles' }).click();
  const overlay = page.getByRole('dialog', { name: 'Suche über alles' });
  await overlay.getByLabel('Suche über alles').fill('Flyer');
  await overlay.getByRole('link', { name: /„Flyer“ im Drive suchen/ }).click();
  await expect(page).toHaveURL(/\/wissen\/drive\?q=Flyer$/);
  await expect(page.getByLabel('Im Drive suchen')).toHaveValue('Flyer');
  await expect(list(page).getByRole('link', { name: /Flyer_Winterrave_v2\.pdf/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Drive' })).toHaveAttribute('aria-selected', 'true');
});

test('WF-WIS-09: Datei aus dem Verzeichnis mit einer Aufgabe verknüpfen – der Eintrag entsteht dabei', async ({
  page,
}) => {
  await openDrive(page);
  await page.getByLabel('Im Drive suchen').fill('Getränkeliste');
  await page.getByRole('button', { name: 'Verknüpfen: Getränkeliste' }).click();

  const screen = page.getByRole('dialog', { name: 'Dokument verknüpfen' });
  await expect(screen.getByRole('radio', { name: /Getränkeliste/ })).toHaveAttribute('aria-checked', 'true');
  await expect(screen.getByRole('group', { name: 'Typ' })).toBeVisible();
  await screen
    .getByRole('button', { name: /Nur erfassen/ })
    .first()
    .click();
  await screen.getByLabel('Ziel suchen').fill('Brauerei');
  await screen.getByRole('button', { name: /Getränke bei der Brauerei bestellen/ }).click();
  await screen.getByRole('button', { name: 'Verknüpfen', exact: true }).click();
  await expect(page.getByTestId('WF-ALL-02')).toContainText('Dokument verknüpft · Getränke bei der Brauerei');

  await expect(list(page).getByRole('listitem').filter({ hasText: 'Getränkeliste' })).toContainText(
    '1 Aufgabe',
  );
  await page.goto('/aufgaben');
  await page.getByRole('link', { name: /Getränke bei der Brauerei/ }).click();
  await expect(page.getByRole('link', { name: /Getränkeliste/ })).toHaveAttribute(
    'href',
    /docs\.google\.com\/spreadsheets/,
  );
});

test('WF-WIS-09: „Aus Drive“ in S-43 – Ordner durchgehen, erfasste Datei behält ihren Typ', async ({
  page,
}) => {
  await login(page);
  await page.goto('/events');
  await page
    .getByRole('link', { name: /Winterrave/ })
    .first()
    .click();
  await page.getByTestId('WF-WIS-06').filter({ hasText: '+ Dokument verknüpfen' }).click();
  const screen = page.getByRole('dialog', { name: 'Dokument verknüpfen' });
  await screen.getByRole('button', { name: 'Aus Drive' }).click();
  await screen.getByRole('button', { name: /^Veranstaltungen/ }).click();
  await screen.getByRole('button', { name: /^2026-12 Winterrave/ }).click();
  await screen.getByRole('button', { name: /^Flyer & Social/ }).click();
  await screen.getByRole('radio', { name: /Flyer_Winterrave_v3/ }).click();
  // schon erfasst: kein Typ nötig
  await expect(screen.getByRole('group', { name: 'Typ' })).toHaveCount(0);
  await screen.getByRole('button', { name: 'Verknüpfen', exact: true }).click();
  await expect(page.getByTestId('WF-ALL-02')).toContainText('Dokument verknüpft · Winterrave');
  await expect(page.getByRole('link', { name: /Flyer_Winterrave_v3\.pdf ↗$/ })).toBeVisible();
});

test('WF-VER-14: Drive-Ordner der Veranstaltung – Inhalt aus dem Cache, ändern, entfernen', async ({
  page,
}) => {
  await login(page);
  await page.goto('/events');
  await page
    .getByRole('link', { name: /Winterrave/ })
    .first()
    .click();
  const box = page.getByRole('region', { name: 'Drive-Ordner' });
  await expect(box).toContainText('2026-12 Winterrave');
  await expect(box.getByRole('link', { name: /Schichtplan Winterrave/ })).toHaveAttribute('target', '_blank');

  await box.getByRole('button', { name: 'Ändern' }).click();
  const sheet = page.getByRole('dialog', { name: 'Drive-Ordner wählen' });
  await sheet
    .getByRole('navigation', { name: 'Ordnerpfad' })
    .getByRole('button', { name: 'Veranstaltungen' })
    .click();
  // nur Ordner sind wählbar
  await sheet.getByRole('button', { name: /^2026-08 Hoffest/ }).click();
  await sheet.getByRole('button', { name: '„2026-08 Hoffest“ wählen' }).click();
  await expect(page.getByTestId('WF-ALL-02')).toContainText('Drive-Ordner verknüpft');
  await expect(box).toContainText('Abrechnung Hoffest');

  await box.getByRole('link', { name: /2026-08 Hoffest/ }).click();
  await expect(page).toHaveURL(/\/wissen\/drive\/drive-hoffest$/);
  await page.goBack();
  await box.getByRole('button', { name: 'Entfernen' }).click();
  await expect(page.getByRole('button', { name: '+ Drive-Ordner wählen' })).toBeVisible();
});

test('Abgleich: neue Datei im Drive erscheint beim nächsten Öffnen', async ({ page }) => {
  await login(page);
  await demo(page, 'Datei im Drive anlegen');
  await expect(page.getByTestId('WF-ALL-02')).toContainText('Im Drive angelegt: Neue Notiz 1');
  await page.goto('/wissen/drive/drive-winterrave');
  await expect(list(page).getByRole('link', { name: /Neue Notiz 1/ })).toBeVisible();
  await expect(page.getByText(/^Abgeglichen gerade eben$/i)).toBeVisible();
});

test('Abgleich: in Drive gelöschte verknüpfte Datei bleibt mit Hinweis sichtbar', async ({ page }) => {
  await login(page);
  await demo(page, 'Verknüpfte Datei im Drive löschen');
  await expect(page.getByTestId('WF-ALL-02')).toContainText('Im Drive gelöscht: Code of Conduct');
  await page.goto('/wissen/drive');
  await expect(path(page)).toHaveText('Myzel Drive');
  await page.getByRole('tab', { name: 'Dokumente' }).click();
  const row = page.getByRole('link', { name: /Code of Conduct/ });
  await expect(row).toContainText('In Drive nicht mehr vorhanden');
});
