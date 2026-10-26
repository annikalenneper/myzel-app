// S-50 bis S-52 · WF-PRO-01, WF-ADM-01 bis -05
import { expect, test } from './fixtures';
import { login, openTask } from './helpers';

test('WF-PRO-01: Name ändern speichert beim Verlassen des Feldes', async ({ page }) => {
  await login(page);
  await page.goto('/profil');
  await page.getByRole('button', { name: 'Name ändern' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Mo K.');
  await page.getByLabel('Name', { exact: true }).blur();
  await expect(page.getByRole('heading', { name: 'Mo K.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mo K.' })).toBeVisible();
});

test('Verwaltung sehen und öffnen nur Admins', async ({ page }) => {
  await login(page, 'Jule');
  await page.goto('/profil');
  await expect(page.getByRole('heading', { name: 'Jule' })).toBeVisible();
  await expect(page.getByText('Verwaltung (Admin)')).toHaveCount(0);
  await page.goto('/profil/mitglieder');
  await expect(page.getByRole('heading', { name: 'Mitglieder' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Jule' })).toBeVisible();
});

test('WF-ADM-01 / -02: Mitglied anlegen, Kürzel-Vorschlag, eindeutige Angaben, danach anmeldbar', async ({
  page,
}) => {
  await login(page);
  await page.goto('/profil/mitglieder');
  await expect(page.getByText('Aktiv · 11')).toBeVisible();
  await page.getByRole('button', { name: '+ Mitglied' }).click();
  const sheet = page.getByRole('dialog', { name: 'Neues Mitglied' });
  await sheet.getByLabel('Name *').fill('Leon');
  // LE ist vergeben – der Vorschlag weicht aus
  await expect(sheet.getByLabel('Kürzel *')).toHaveValue('LO');
  await sheet.getByLabel('Kürzel *').fill('le');
  await sheet.getByLabel('Google-Mail *').fill('leon@example.org');
  await sheet.getByRole('button', { name: 'Anlegen' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('Das Kürzel LE ist schon vergeben.');
  await sheet.getByLabel('Kürzel *').fill('LN');
  await sheet.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Angelegt – kann sich jetzt anmelden.')).toBeVisible();
  await expect(page.getByText('Aktiv · 12')).toBeVisible();

  await page.goto('/profil');
  await page.getByTestId('WF-LOG-03').click();
  await page.getByLabel('E-Mail-Adresse').fill('leon@example.org');
  await page.getByTestId('WF-LOG-02').click();
  await page.locator('[data-demo="magic-link"]').click();
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
});

test('WF-ADM-03 / -04: Deaktivieren zeigt die Folgen, trägt überall aus; Reaktivieren stellt nichts wieder her', async ({
  page,
}) => {
  await login(page, 'Jule');
  await openTask(page, 'Getränke bei der Brauerei bestellen');
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'In Arbeit' }).click();
  await expect(page.getByTestId('WF-ALL-02')).toContainText('Status: In Arbeit');
  await page.goto('/profil');
  await page.getByTestId('WF-LOG-03').click();
  await expect(page.getByTestId('WF-LOG-01')).toBeVisible();

  await login(page);
  await page.goto('/profil/mitglieder');
  await page.getByRole('button', { name: /Jule/ }).click();
  await page.getByRole('button', { name: 'Deaktivieren …' }).click();
  const sheet = page.getByRole('dialog', { name: 'Jule deaktivieren?' });
  await expect(sheet).toContainText(/2 Aufgaben ohne Bearbeitende danach/i);
  await expect(sheet).toContainText('Getränke bei der Brauerei bestellen · In Arbeit → Geplant');
  await expect(sheet).toContainText('Kasse für Winterrave besorgen · Geplant');
  await expect(sheet).toContainText('0 Aufgaben mit weiteren Bearbeitenden – unkritisch');
  await sheet.getByRole('button', { name: 'Jule deaktivieren' }).click();
  await expect(
    page.getByText('Deaktiviert – 1 Aufgabe ohne Bearbeitende steht jetzt auf Geplant.'),
  ).toBeVisible();
  await expect(page.getByText('Deaktiviert · 2')).toBeVisible();

  await openTask(page, 'Getränke bei der Brauerei bestellen');
  await expect(
    page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Geplant' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /entfernen: Jule/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'VERLAUF' }).click();
  await expect(
    page.getByText(
      /Mo hat Jule deaktiviert – Jule wurde ausgetragen\. Der Status ging von In Arbeit zurück auf Geplant/,
    ),
  ).toBeVisible();

  await page.goto('/profil/mitglieder');
  await page.getByRole('button', { name: 'Reaktivieren' }).first().click();
  await expect(
    page.getByText('Jule ist wieder aktiv – frühere Einträge wurden nicht wiederhergestellt.'),
  ).toBeVisible();
  await openTask(page, 'Getränke bei der Brauerei bestellen');
  await expect(page.getByRole('button', { name: /entfernen: Jule/ })).toHaveCount(0);
});

test('WF-ADM-02 / -03: die letzte Person mit Admin-Rechten bleibt', async ({ page }) => {
  await login(page);
  await page.goto('/profil/mitglieder');
  await page.getByRole('button', { name: /Lea/ }).click();
  const lea = page.getByRole('dialog', { name: 'Lea bearbeiten' });
  await lea.getByRole('checkbox', { name: 'Admin-Rechte' }).click();
  await lea.getByRole('button', { name: 'Speichern' }).click();
  await expect(lea).toBeHidden();

  await page.getByRole('button', { name: /^MO Mo/ }).click();
  const mo = page.getByRole('dialog', { name: 'Mo bearbeiten' });
  await expect(mo).toContainText('Letzte Person mit Admin-Rechten – kann nicht deaktiviert werden.');
  await expect(mo.getByRole('button', { name: 'Deaktivieren …' })).toHaveCount(0);
  await mo.getByRole('checkbox', { name: 'Admin-Rechte' }).click();
  await expect(mo.getByRole('checkbox', { name: 'Admin-Rechte' })).toBeChecked();
});

test('WF-ADM-05: Themen anlegen, umbenennen, löschen (unbenutzt), archivieren und wiederherstellen', async ({
  page,
}) => {
  await login(page);
  await page.goto('/profil/themen');
  await page.getByRole('button', { name: '+ Thema' }).click();
  const create = page.getByRole('dialog', { name: 'Neues Thema' });
  await create.getByLabel('Name *').fill('Awareness');
  await create.getByRole('button', { name: 'Verein', exact: true }).click();
  await create.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('button', { name: /Awareness Unbenutzt/i })).toBeVisible();

  await page.getByRole('button', { name: /Awareness/ }).click();
  const edit = page.getByRole('dialog', { name: 'Thema bearbeiten' });
  await edit.getByLabel('Name *').fill('Awareness & Schutz');
  await edit.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('button', { name: /Awareness & Schutz/ }).click();
  await expect(edit).toContainText('Noch nirgends benutzt.');
  await edit.getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('button', { name: /Awareness/ })).toHaveCount(0);

  // ein Thema mit aktiven Aufgaben lässt sich nicht archivieren (3.2)
  await page.getByRole('button', { name: /Lager & Material/ }).click();
  await expect(edit.getByRole('button', { name: 'Archivieren' })).toBeDisabled();
  await expect(edit).toContainText('Hat noch 4 aktive Aufgaben');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Alte Location/ }).click();
  await edit.getByRole('button', { name: 'Wiederherstellen' }).click();
  await page.getByRole('button', { name: /Alte Location 1 Aufgabe/i }).click();
  await expect(edit).toContainText('Wird benutzt – deshalb nur archivierbar.');
  await edit.getByRole('button', { name: 'Archivieren' }).click();
  await expect(page.getByRole('button', { name: /Alte Location Archiviert/i })).toBeVisible();
});

test('WF-ALL-01: Mitglied in zwei Tabs bearbeitet – Konflikt, danach frischer Stand im Formular', async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto('/profil/mitglieder');
  await page.getByRole('button', { name: /Sam/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Sam bearbeiten' });
  await sheet.getByLabel('Name *').fill('Sammy');

  const other = await context.newPage();
  await other.goto('/profil/mitglieder');
  await other.getByRole('button', { name: /Sam/ }).click();
  await other.getByLabel('Google-Mail *').fill('sam.neu@example.org');
  await other.getByRole('button', { name: 'Speichern' }).click();
  await expect(other.getByText('sam.neu@example.org')).toBeVisible();
  await other.close();

  await sheet.getByRole('button', { name: 'Speichern' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Inzwischen geändert' });
  await expect(dialog).toContainText('Sammy');
  await dialog.getByRole('button', { name: 'Neu laden' }).click();
  await expect(sheet.getByLabel('Google-Mail *')).toHaveValue('sam.neu@example.org');
  await sheet.getByLabel('Name *').fill('Sammy');
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('button', { name: /Sammy/ })).toContainText('sam.neu@example.org');
});

test('WF-ADM-09: weitere Adresse eintragen, damit anmelden, wieder entfernen', async ({ page }) => {
  await login(page);
  await page.goto('/profil/mitglieder');
  await page.getByRole('button', { name: /Jule/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Jule bearbeiten' });
  await expect(sheet).toContainText('Keine – angemeldet wird nur mit der Mail oben.');
  await sheet.getByLabel('Weitere Adresse').fill('sam@example.org');
  await sheet.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('Diese Mail-Adresse ist schon eingetragen.');
  await sheet.getByLabel('Weitere Adresse').fill('jule.privat@example.net');
  await sheet.getByLabel('Weitere Adresse').press('Enter');
  await expect(page.getByText('Adresse hinzugefügt – damit klappt die Anmeldung jetzt auch.')).toBeVisible();
  await expect(sheet.getByText('jule.privat@example.net')).toBeVisible();
  // das Formular darüber bleibt offen und unverändert
  await expect(sheet.getByLabel('Name *')).toHaveValue('Jule');
  await sheet.getByRole('button', { name: 'Schließen' }).click();

  await page.goto('/profil');
  await page.getByTestId('WF-LOG-03').click();
  await page.getByLabel('E-Mail-Adresse').fill('jule.privat@example.net');
  await page.getByTestId('WF-LOG-02').click();
  await page.locator('[data-demo="magic-link"]').click();
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
  await page.goto('/profil');
  await expect(page.getByRole('heading', { name: 'Jule' })).toBeVisible();
  await page.getByTestId('WF-LOG-03').click();
  await expect(page.getByTestId('WF-LOG-01')).toBeVisible();

  await login(page);
  await page.goto('/profil/mitglieder');
  await page.getByRole('button', { name: /Jule/ }).click();
  await page.getByRole('button', { name: 'jule.privat@example.net entfernen' }).click();
  await expect(page.getByText('jule.privat@example.net entfernt')).toBeVisible();
  await expect(
    page
      .getByRole('dialog', { name: 'Jule bearbeiten' })
      .getByText('Keine – angemeldet wird nur mit der Mail oben.'),
  ).toBeVisible();
});

test('WF-PRO-05 / WF-ADM-10: Rückmeldung zur App senden, Admins sehen die Liste', async ({ page }) => {
  await login(page);
  await page.goto('/profil');
  await page.getByRole('button', { name: /Rückmeldung zur App/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Rückmeldung zur App' });
  await expect(sheet).toContainText('Was hast du gemacht, was ist passiert');
  await sheet.getByRole('button', { name: 'Feature-Wunsch' }).click();
  await expect(sheet).toContainText('Was möchtest du tun können');
  await sheet.getByLabel('Deine Rückmeldung').fill('Termine nach Ort filtern');
  await sheet.locator('button[type=submit]').click();
  await expect(page.getByTestId('WF-ALL-02')).toContainText('Danke! Die Rückmeldung ist angekommen.');

  await page.getByRole('link', { name: /Rückmeldungen/ }).click();
  await expect(page.getByRole('heading', { name: 'Rückmeldungen' })).toBeVisible();
  const newest = page.getByRole('article').first();
  await expect(newest).toContainText('Feature-Wunsch');
  await expect(newest).toContainText('Mo');
  await expect(newest).toContainText('Termine nach Ort filtern');
  await expect(page.getByRole('article')).toHaveCount(3);
});

test('WF-ADM-10: ohne Admin-Rechte keine Liste der Rückmeldungen', async ({ page }) => {
  await login(page, 'Jule');
  await page.goto('/profil/rueckmeldungen');
  await expect(page.getByRole('heading', { name: 'Rückmeldungen' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Jule' })).toBeVisible();
});

test('WF-PRO-06: nach einem neuen Deploy einmal „Was ist neu?“, danach im Profil', async ({ page }) => {
  await login(page);
  // eine ältere Version war zuletzt gesehen
  await page.evaluate(() => localStorage.setItem('myzel:version-gesehen', '0.7.0'));
  await page.reload();
  const changes = page.getByRole('dialog', { name: 'Was ist neu?' });
  await expect(changes).toContainText(/Version \d+\.\d+\.\d+/);
  await changes.getByRole('button', { name: 'Alles klar' }).click();
  await expect(changes).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
  await expect(changes).toHaveCount(0);

  await page.goto('/profil');
  await expect(page.getByText(/^Myzel \d+\.\d+\.\d+ · /)).toBeVisible();
  await page.getByRole('button', { name: 'Was ist neu?' }).click();
  await expect(changes).toContainText('Entscheidungen gelten erst');
});

test('kein „+“ im Profil und in der Verwaltung', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('button', { name: 'Neu anlegen' })).toBeVisible();
  await page.goto('/profil');
  await expect(page.getByRole('heading', { name: 'Mo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Neu anlegen' })).toHaveCount(0);
  await page.goto('/profil/mitglieder');
  await expect(page.getByRole('heading', { name: 'Mitglieder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Neu anlegen' })).toHaveCount(0);
});
