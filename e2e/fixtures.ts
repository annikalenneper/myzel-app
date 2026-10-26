// Gemeinsame Testbasis: Der Hinweis „Was ist neu?“ (16.5) gilt als gesehen, damit er die Abläufe nicht verdeckt.
// Wer ihn prüfen will, löscht den Eintrag selbst (e2e/verwaltung.spec.ts).
import { test as base } from '@playwright/test';
import pkg from '../package.json' with { type: 'json' };

export { devices, expect, type Locator, type Page } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.addInitScript((version) => {
      if (!sessionStorage.getItem('myzel:test-version-gesetzt')) {
        localStorage.setItem('myzel:version-gesehen', version);
        sessionStorage.setItem('myzel:test-version-gesetzt', '1');
      }
    }, pkg.version);
    await provide(page);
  },
});
