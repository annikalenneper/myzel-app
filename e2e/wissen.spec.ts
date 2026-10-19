// Phase 3 – Wissen: S-40 bis S-44 (WF-WIS-01 bis -07, -11, WF-FRA-01 bis -03, WF-VER-06, WF-AUF-13)
import { expect, test, type Page } from '@playwright/test';
import { login, openTask, undoBar } from './helpers';

const open = async (page: Page) => {
  await login(page);
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .last()
    .getByRole('link', { name: 'Wissen' })
    .click();
  await expect(page.getByRole('heading', { name: 'Wissen' })).toBeVisible();
};
const card = (page: Page, title: string) => page.getByRole('article').filter({ hasText: title });

test('WF-WIS-04: Beschlüsse – Standard nur gültige; Filter Art, Status, Thema kombinierbar', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByText('5 Einträge')).toBeVisible();
  await expect(card(page, 'Mate am Tresen für 2 €')).toHaveCount(0);

  await page.getByRole('button', { name: 'Art ▾' }).click();
  await page.getByRole('group', { name: 'Art' }).getByRole('button', { name: 'Nur Fakten' }).click();
  await expect(page.getByText('1 Eintrag')).toBeVisible();
  await expect(card(page, 'Unser Code of Conduct gilt für alle Veranstaltungen')).toBeVisible();

  await page.getByRole('button', { name: 'Gültig ▾' }).click();
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Alle' }).click();
  await expect(page.getByText('2 Einträge')).toBeVisible();
  await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
  await expect(page.getByText('5 Einträge')).toBeVisible();

  await page.getByRole('button', { name: 'Gültig ▾' }).click();
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Ersetzt' }).click();
  const old = card(page, 'Mate am Tresen für 2 €');
  await expect(old).toContainText('→ ersetzt durch: Mate am Tresen für 2,50 €');
  // nur gültige sind markierbar
  await expect(old.getByTestId('WF-WIS-05')).toHaveCount(0);
});

test('WF-WIS-01: Entscheidung festhalten geht nur mit Quelle', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Entscheidung oder Fakt anlegen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Neu festhalten' });
  const submit = sheet.locator('button[type=submit]');
  await sheet.getByLabel('Titel *').fill('Lagerschlüssel liegt bei Mo');
  await sheet.getByRole('button', { name: 'Fakt' }).click();
  await expect(submit).toBeDisabled();
  await expect(sheet).toContainText('Ohne Quelle lässt sich nichts festhalten.');
  await sheet.getByRole('button', { name: 'Notiz' }).click();
  await expect(submit).toBeDisabled();
  await sheet.getByLabel('Notiz zur Quelle').fill('Absprache im Lager');
  await submit.click();
  const created = card(page, 'Lagerschlüssel liegt bei Mo');
  await expect(created).toContainText(/Fakt/i);
  await expect(created).toContainText(/Quelle: Notiz/i);
});

test('WF-WIS-02 / -03 / -05: Entscheidung markieren, ersetzen (mit Rückgängig), aufheben', async ({
  page,
}) => {
  await open(page);
  await card(page, 'Eintritt immer auch auf Spendenbasis möglich').getByRole('link').click();
  await expect(page.getByRole('link', { name: /^Plenum September/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Protokoll Plenum September/ })).toBeVisible();
  await page.getByRole('button', { name: 'Fürs Plenum markieren' }).click();
  await expect(page.getByRole('button', { name: 'Markierung „Fürs Plenum“ entfernen' })).toBeVisible();

  await page.getByRole('button', { name: 'Ersetzen', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Ersetzen durch …' });
  await sheet.getByLabel('Neue Fassung · Titel *').fill('Eintritt auf Spende, Richtwert 5–10 €');
  await sheet.getByLabel('Notiz zur Quelle').fill('Beschluss per Umfrage');
  await sheet.locator('button[type=submit]').click();
  await expect(page.getByText('→ ersetzt durch: Eintritt auf Spende, Richtwert 5–10 €')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ersetzen', exact: true })).toHaveCount(0);
  await expect(page.getByText(/Mo hat die Entscheidung ersetzt\. Die Markierung/)).toBeVisible();

  await undoBar(page).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByRole('button', { name: 'Ersetzen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Markierung „Fürs Plenum“ entfernen' })).toBeVisible();

  await page.getByRole('button', { name: 'Aufheben', exact: true }).click();
  const ask = page.getByRole('alertdialog', { name: 'Entscheidung aufheben' });
  await ask.getByLabel('Notiz · optional').fill('Passt nicht mehr');
  await ask.getByRole('button', { name: 'Aufheben' }).click();
  await expect(page.getByText('Aufgehoben. Bleibt zum Nachlesen sichtbar.')).toBeVisible();
  await expect(page.getByText('Mo hat die Entscheidung aufgehoben. Notiz: Passt nicht mehr')).toBeVisible();
});

test('WF-FRA-01 bis -03: Frage stellen, klären als Entscheidung, verwerfen', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Fragen' }).click();
  await expect(page.getByRole('article').first()).toContainText('Machen wir an Silvester eine Party?');
  await expect(page.getByText('Zuletzt geklärt')).toBeVisible();

  await page.getByRole('button', { name: 'Frage stellen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Neue Frage' });
  await sheet.getByLabel('Frage *').fill('Wer hat den Zweitschlüssel?');
  await expect(sheet.locator('button[type=submit]')).toHaveText('Thema wählen, dann stellen');
  await sheet.getByLabel('Thema *').selectOption({ label: 'Lager & Material' });
  await expect(sheet.getByRole('checkbox', { name: /Fürs Plenum/ })).toBeChecked();
  await sheet.locator('button[type=submit]').click();
  await expect(card(page, 'Wer hat den Zweitschlüssel?')).toContainText(/fürs Plenum/i);

  await card(page, 'Machen wir an Silvester eine Party?').getByRole('link').click();
  await page.getByRole('button', { name: 'Klären' }).click();
  const clarify = page.getByRole('dialog', { name: 'Frage klären' });
  await expect(clarify.locator('button[type=submit]')).toBeDisabled();
  await clarify.getByLabel('Antwort *').fill('Ja – kleine Party im Lager.');
  await clarify.getByRole('button', { name: 'Entscheidung' }).click();
  await clarify.getByLabel('Notiz zur Quelle').fill('Abstimmung im Chat');
  await clarify.locator('button[type=submit]').click();
  await expect(page.getByText('Ja – kleine Party im Lager.')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Entscheidung: Machen wir an Silvester eine Party/ }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Klären' })).toHaveCount(0);

  await page.goto('/wissen');
  await page.getByRole('tab', { name: 'Fragen' }).click();
  await card(page, 'Wechseln wir zu einer anderen Bank?').getByRole('link').click();
  await page.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page.getByText('Verworfen. Steht weiter in der Historie.')).toBeVisible();
  await undoBar(page).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByRole('button', { name: 'Verwerfen' })).toBeVisible();
});

test('WF-WIS-06 / WF-AUF-13: Dokument per Link erfassen und mit einer Aufgabe verknüpfen', async ({
  page,
}) => {
  await login(page);
  await openTask(page, 'Getränke bei der Brauerei bestellen');
  await page.getByRole('button', { name: '+ Dokument verknüpfen' }).click();
  const screen = page.getByRole('dialog', { name: 'Dokument verknüpfen' });
  await expect(screen).toContainText(/Verknüpfen mit · Aufgabe/i);
  const submit = screen.locator('button[type=submit]');
  await expect(submit).toBeDisabled();
  await screen.getByLabel('Link *').fill('kein-link');
  await screen.getByLabel('Titel *').fill('Angebot Brauerei');
  await screen.getByRole('button', { name: 'Sonstiges' }).click();
  await submit.click();
  await expect(screen.getByRole('alert')).toHaveText('Bitte einen Link eingeben, der mit https:// beginnt.');
  await screen.getByLabel('Link *').fill('https://example.org/angebot.pdf');
  await submit.click();
  await expect(screen).toBeHidden();
  await expect(page.getByRole('link', { name: /Angebot Brauerei/ })).toBeVisible();

  // ein schon erfasstes Dokument dazuholen und wieder lösen
  await page.getByRole('button', { name: '+ Dokument verknüpfen' }).click();
  await screen.getByRole('button', { name: 'Erfasste' }).click();
  await screen.getByRole('radio', { name: /Code of Conduct/ }).click();
  await submit.click();
  await expect(page.getByRole('link', { name: /Code of Conduct/ })).toBeVisible();
  await page.getByRole('button', { name: 'Verknüpfung lösen: Code of Conduct' }).click();
  await expect(page.getByRole('link', { name: /Code of Conduct/ })).toHaveCount(0);

  await page.goto('/wissen');
  await page.getByRole('tab', { name: 'Dokumente' }).click();
  await expect(page.getByRole('link', { name: /Angebot Brauerei/ })).toContainText(
    /Sonstiges · Link · 1 Aufgabe/i,
  );
});

test('WF-WIS-07: Link zu MeinVerein öffnet in neuem Tab', async ({ page }) => {
  await open(page);
  const link = page.getByTestId('WF-WIS-07');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('href', /^https:\/\//);
});

test('WF-WIS-11: globale Suche – Treffer beim Tippen, gruppiert, Gruppe des Screens zuerst', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Suche über alles' }).click();
  const overlay = page.getByRole('dialog', { name: 'Suche über alles' });
  await overlay.getByLabel('Suche über alles').fill('Winterrave');
  await expect(overlay.getByRole('status')).toContainText(/\d+ Treffer/);
  const groups = overlay.getByRole('heading', { level: 2 });
  await expect(groups.first()).toContainText(/Aufgaben · \d/i);
  await expect(overlay.getByRole('region', { name: 'Veranstaltungen' })).toContainText('Winterrave');
  await expect(overlay.getByRole('region', { name: 'Termine' })).toContainText('Vorbesprechung Winterrave');
  await expect(overlay.getByRole('region', { name: 'Fragen' })).toContainText('Garderobe');
  await expect(overlay.getByRole('region', { name: 'Dokumente' })).toContainText('Flyer_Winterrave_v3.pdf');

  await overlay.getByLabel('Suche über alles').fill('Spendenbasis');
  await expect(groups.first()).toContainText(/Entscheidungen & Fakten · 1/i);
  await overlay.getByRole('link', { name: /Eintritt immer auch auf Spendenbasis/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Eintritt immer auch auf Spendenbasis möglich' }),
  ).toBeVisible();

  await page.goto('/events');
  await page.getByRole('button', { name: 'Suche über alles' }).click();
  await overlay.getByLabel('Suche über alles').fill('Winterrave');
  await expect(groups.first()).toContainText(/Veranstaltungen · 1/i);
  await overlay.getByLabel('Suche über alles').fill('xyzxyz');
  await expect(overlay.getByTestId('WF-ALL-05')).toContainText('Nichts gefunden');
});

test('WF-VER-06: Veranstaltung fürs Plenum markieren; Statuswechsel entfernt die Markierung', async ({
  page,
}) => {
  await login(page);
  await page.goto('/events');
  await page.getByRole('link', { name: /Winterrave/ }).click();
  await page.getByRole('button', { name: 'Fürs Plenum markieren' }).click();
  await expect(page.getByRole('button', { name: 'Markierung „Fürs Plenum“ entfernen' })).toBeVisible();
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Bestätigt' }).click();
  await expect(page.getByRole('button', { name: 'Fürs Plenum markieren' })).toBeVisible();
});
