import { describe, expect, it } from 'vitest';
import { CHANGELOG, CHANGELOG_ITEM, compareVersions, unseenChanges } from './changelog';

const log = [
  { version: '0.10.0', date: '2026-12-01', items: ['C'] },
  { version: '0.9.0', date: '2026-11-01', items: ['B'] },
  { version: '0.8.0', date: '2026-10-29', items: ['A'] },
];

describe('Was ist neu? (16.5)', () => {
  it('vergleicht Versionen als Zahlen', () => {
    expect(compareVersions('0.10.0', '0.9.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });

  it('zeigt alles seit der gesehenen Version bis zur laufenden, einmal', () => {
    expect(unseenChanges('0.8.0', '0.10.0', log).map((e) => e.version)).toEqual(['0.10.0', '0.9.0']);
    expect(unseenChanges('0.10.0', '0.10.0', log)).toEqual([]);
    // noch nicht ausgeliefert: kommt erst mit der eigenen Version
    expect(unseenChanges('0.8.0', '0.9.0', log).map((e) => e.version)).toEqual(['0.9.0']);
    // zum ersten Mal in diesem Browser: nur die laufende Version
    expect(unseenChanges(null, '0.9.0', log).map((e) => e.version)).toEqual(['0.9.0']);
  });

  it('jeder Eintrag beginnt mit „Feat:“ oder „Fix:“, Versionen absteigend und eindeutig', () => {
    for (const e of CHANGELOG) for (const item of e.items) expect(item, e.version).toMatch(CHANGELOG_ITEM);
    for (let i = 1; i < CHANGELOG.length; i++)
      expect(compareVersions(CHANGELOG[i - 1]!.version, CHANGELOG[i]!.version)).toBeGreaterThan(0);
  });

  it('der Changelog passt zur Version in package.json', async () => {
    const pkg = (await import('../../package.json')).default as { version: string };
    expect(CHANGELOG[0]!.version).toBe(pkg.version);
  });
});
