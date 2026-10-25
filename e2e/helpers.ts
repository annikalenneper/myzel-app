import { expect, type Page } from '@playwright/test';

/** Anmeldung über die Testkonten der Testdaten-Schicht (Schritt A, ersetzt Google). */
export async function login(page: Page, name = 'Mo') {
  await page.goto('/');
  await page.getByTestId('WF-LOG-01').click();
  await page.getByRole('button', { name: new RegExp(`^${name} `) }).click();
  if (name !== 'Jemand') await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
}

export async function openTask(page: Page, title: string) {
  await page.goto('/agenda');
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await expect(page.getByRole('button', { name: new RegExp(`Titel bearbeiten: ${title}`) })).toBeVisible();
}

export const card = (page: Page, title: string) => page.getByRole('article').filter({ hasText: title });
export const undoBar = (page: Page) => page.getByTestId('WF-ALL-02');
export const statusChip = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Status' }).getByRole('button', { name, exact: true });
