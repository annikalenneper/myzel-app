// Phase 3 – Wissen: S-40 bis S-44 (WF-WIS-01 bis -04, -06, -07, -11, WF-FRA-01 bis -03, WF-AGE-03, WF-AUF-13)
import { expect, test, type Page } from './fixtures';
import { login, openTask, undoBar, createNew } from './helpers';

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

test('WF-WIS-04: Reiter Entscheidungen und Fakten – Standard offene und gültige; Filter Status und Thema', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole('tab', { name: 'Entscheidungen' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Fragen' })).toHaveCount(0);
  await expect(page.getByText('6 Einträge')).toBeVisible();
  await expect(card(page, 'Mate am Tresen für 2 €')).toHaveCount(0);
  await expect(card(page, 'Unser Code of Conduct gilt für alle Veranstaltungen')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Fakten' }).click();
  await expect(page.getByText('1 Eintrag')).toBeVisible();
  await expect(card(page, 'Unser Code of Conduct gilt für alle Veranstaltungen')).toBeVisible();
  await page.getByRole('button', { name: 'Offen & gültig ▾' }).click();
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Alle' }).click();
  await expect(page.getByText('2 Einträge')).toBeVisible();
  await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
  await expect(page.getByText('1 Eintrag')).toBeVisible();

  await page.getByRole('tab', { name: 'Entscheidungen' }).click();
  await page.getByRole('button', { name: 'Offen & gültig ▾' }).click();
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Ersetzt' }).click();
  const old = card(page, 'Mate am Tresen für 2 €');
  await expect(old).toContainText('→ ersetzt durch: Mate am Tresen für 2,50 €');
  // nur gültige lassen sich auf die Agenda setzen
  await expect(old.getByTestId('WF-AGE-03')).toHaveCount(0);
});

test('WF-WIS-01: Entscheidung festhalten geht nur mit Quelle', async ({ page }) => {
  await open(page);
  await createNew(page, 'Entscheidung');
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
  // ein Fakt steht im Reiter „Fakten“
  await expect(card(page, 'Lagerschlüssel liegt bei Mo')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Fakten' }).click();
  await expect(card(page, 'Lagerschlüssel liegt bei Mo')).toContainText(/Quelle: Notiz/i);
});

test('WF-WIS-02 / -03 / WF-AGE-03: Entscheidung auf die Agenda, ersetzen (mit Rückgängig), aufheben', async ({
  page,
}) => {
  await open(page);
  await card(page, 'Eintritt immer auch auf Spendenbasis möglich').getByRole('link').click();
  await expect(page.getByRole('link', { name: /^Plenum September/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Protokoll Plenum September/ })).toBeVisible();
  await page.getByRole('button', { name: 'Auf die Agenda setzen' }).click();
  await expect(page.getByRole('button', { name: 'Von der Agenda nehmen' })).toBeVisible();

  await page.getByRole('button', { name: 'Ersetzen', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Ersetzen durch …' });
  await sheet.getByLabel('Neue Fassung · Titel *').fill('Eintritt auf Spende, Richtwert 5–10 €');
  await sheet.getByLabel('Notiz zur Quelle').fill('Beschluss per Umfrage');
  await sheet.locator('button[type=submit]').click();
  await expect(page.getByText('→ ersetzt durch: Eintritt auf Spende, Richtwert 5–10 €')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ersetzen', exact: true })).toHaveCount(0);
  // der Eintrag geht von der Agenda – ohne eigenen Satz in der Historie
  await expect(page.getByText('Mo hat die Entscheidung ersetzt.', { exact: true })).toBeVisible();

  await undoBar(page).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByRole('button', { name: 'Ersetzen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Von der Agenda nehmen' })).toBeVisible();

  await page.getByRole('button', { name: 'Aufheben', exact: true }).click();
  const ask = page.getByRole('alertdialog', { name: 'Entscheidung aufheben' });
  await ask.getByLabel('Notiz · optional').fill('Passt nicht mehr');
  await ask.getByRole('button', { name: 'Aufheben' }).click();
  await expect(page.getByText('Aufgehoben. Bleibt zum Nachlesen sichtbar.')).toBeVisible();
  await expect(page.getByText('Mo hat die Entscheidung aufgehoben. Notiz: Passt nicht mehr')).toBeVisible();
});

test('WF-FRA-01 bis -05: Frage stellen, mehrere Ergebnisse festhalten, beantworten, wieder öffnen, verwerfen', async ({
  page,
}) => {
  await login(page);
  const question = (title: RegExp) => page.getByRole('link', { name: title });
  await expect(question(/Machen wir an Silvester eine Party/)).toBeVisible();

  await page.getByTestId('WF-FRA-01').filter({ hasText: '+ Frage' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Neue Frage' });
  await sheet.getByLabel('Frage *').fill('Wer hat den Zweitschlüssel?');
  await expect(sheet.locator('button[type=submit]')).toHaveText('Thema wählen, dann stellen');
  await sheet.getByLabel('Thema *').selectOption({ label: 'Lager & Material' });
  await sheet.locator('button[type=submit]').click();
  await expect(question(/Wer hat den Zweitschlüssel/)).toBeVisible();

  await question(/Machen wir an Silvester eine Party/).click();
  // WF-FRA-05: Ergebnisse festhalten – die Frage bleibt offen (16.3)
  const results = page.getByRole('region', { name: 'Ergebnisse' });
  const addResult = async (title: string, kind: 'Entscheidung' | 'Fakt') => {
    await page.getByRole('button', { name: 'Ergebnis festhalten' }).click();
    const sheet = page.getByRole('dialog', { name: 'Ergebnis festhalten' });
    await expect(sheet.getByLabel('Titel *')).toHaveValue('Machen wir an Silvester eine Party?');
    await sheet.getByRole('button', { name: kind, exact: true }).click();
    await sheet.getByLabel('Titel *').fill(title);
    await sheet.getByRole('button', { name: 'Notiz' }).click();
    await sheet.getByLabel('Notiz zur Quelle').fill('Abstimmung im Chat');
    await sheet.locator('button[type=submit]').click();
    await expect(sheet).toBeHidden();
    await expect(results.getByRole('link').filter({ hasText: title })).toBeVisible();
  };
  await addResult('Silvesterparty im Lager', 'Entscheidung');
  await addResult('Getränke bringt jede*r selbst mit', 'Fakt');
  await expect(results).toContainText('Ergebnisse · 2');

  // WF-FRA-02: als beantwortet markieren – mit Ergebnissen ist die Antwort optional
  await page.getByRole('button', { name: 'Beantwortet', exact: true }).click();
  const answer = page.getByRole('dialog', { name: 'Als beantwortet markieren' });
  await answer.getByRole('button', { name: 'Als beantwortet speichern' }).click();
  await expect(undoBar(page)).toContainText('Als beantwortet markiert');
  // WF-FRA-04: wieder öffnen
  await page.getByRole('button', { name: 'Wieder öffnen' }).click();
  await expect(page.getByRole('button', { name: 'Ergebnis festhalten' })).toBeVisible();
  await expect(results).toContainText('Ergebnisse · 2');

  await page.goto('/agenda');
  await question(/Wechseln wir zu einer anderen Bank/).click();
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
  // im Wissen steht die Gruppe des Screens zuerst
  await expect(groups.first()).toContainText(/Entscheidungen & Fakten · \d/i);
  await expect(overlay.getByRole('region', { name: 'Aufgaben' })).toBeVisible();
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

test('WF-WIS-12 / WF-ALL-07: Entscheidung bearbeiten mit Zähler, Text auf der Karte, Kommentar', async ({
  page,
}) => {
  await open(page);
  await card(page, 'Mate am Tresen für 2,50 €').getByRole('link').click();
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Bearbeiten' });
  await sheet.getByLabel(/^Text/).fill('Gilt für alle Sorten.');
  await expect(sheet).toContainText('21/300');
  await sheet.locator('button[type=submit]').click();
  await expect(sheet).toBeHidden();
  await expect(
    page.getByText('Gilt für alle Sorten.', { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();

  await page.getByLabel('Kommentar schreiben').fill('Auch für Club-Mate light?');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByRole('region', { name: 'Kommentare' })).toContainText('Auch für Club-Mate light?');

  await page.goto('/wissen');
  await expect(card(page, 'Mate am Tresen für 2,50 €')).toContainText('Gilt für alle Sorten.');
});

test('WF-WIS-13: offene Entscheidung bestätigen, widersprechen – Widerspruch kommt auf die Agenda', async ({
  page,
}) => {
  await open(page);
  const bier = card(page, 'Bier beim Winterrave für 3 €');
  await expect(bier).toContainText('Offen');
  await expect(bier).toContainText('4/11 bestätigt');
  await bier.getByRole('link').click();
  const box = page.getByRole('region', { name: 'Abstimmung' });
  await expect(box).toContainText('4 von 11 bestätigt');
  await box.getByRole('button', { name: 'Bestätigen' }).click();
  await expect(undoBar(page)).toContainText('Bestätigt');
  await expect(box).toContainText('5 von 11 bestätigt');
  await expect(box.getByRole('button', { name: '✓ Bestätigt' })).toHaveAttribute('aria-pressed', 'true');

  await box.getByRole('button', { name: 'Widersprechen' }).click();
  await expect(undoBar(page)).toContainText('Widersprochen · auf der Agenda');
  await expect(box).toContainText('Widerspruch – die Entscheidung bleibt offen');
  await expect(box).toContainText('Widerspruch: Mo');
  await expect(page.getByText('Mo hat widersprochen.')).toBeVisible();

  await page.goto('/agenda');
  await expect(page.getByText('Zu besprechen')).toBeVisible();
  await expect(page.getByRole('link', { name: /Bier beim Winterrave für 3 €/ })).toContainText(
    'Widerspruch – noch nicht gültig',
  );
});

test('WF-WIS-01: neue Entscheidung mit Frist zum Bestätigen, Fakt ohne', async ({ page }) => {
  await open(page);
  await createNew(page, 'Entscheidung');
  const sheet = page.getByRole('dialog', { name: 'Neu festhalten' });
  await expect(sheet.getByText('Bestätigen bis')).toBeVisible();
  await sheet.getByRole('button', { name: 'Fakt', exact: true }).click();
  await expect(sheet.getByText('Bestätigen bis')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Entscheidung', exact: true }).click();
  await sheet.getByLabel('Titel *').fill('Kasse zählt immer zu zweit');
  await sheet.getByLabel('Thema *').selectOption({ label: 'Organisatorisches' });
  await sheet.getByRole('button', { name: 'Notiz' }).click();
  await sheet.getByLabel('Notiz zur Quelle').fill('Plenum');
  await sheet.locator('button[type=submit]').click();
  await expect(undoBar(page)).toContainText('Entscheidung festgehalten · wartet auf Bestätigung');
  await expect(card(page, 'Kasse zählt immer zu zweit')).toContainText('0/11 bestätigt');
});
