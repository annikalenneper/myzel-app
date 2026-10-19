// Nächtlicher Export (E-08): gültig gegen das Schema, ohne Kontaktdaten; das JSON-Schema liegt neben dem Export-Code
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { createMockApi } from '../data/mock/mockApi';
import { seedDb } from '../data/mock/seed';
import { buildExport, exportSchema, exportToYaml } from './export';

const now = new Date(2026, 9, 11, 3);

describe('Nächtlicher Export (E-08)', () => {
  it('enthält alle fachlichen Daten und ist gegen das Schema gültig – auch nach dem Rücklesen', () => {
    const db = seedDb(now);
    const data = buildExport(db, now);
    expect(data.tasks).toHaveLength(db.tasks.length);
    expect(data.history).toHaveLength(db.history.length);
    expect(data.appointment_series).toHaveLength(1);
    const yaml = exportToYaml(data);
    expect(exportSchema.safeParse(parse(yaml)).success).toBe(true);
  });

  it('enthält keine E-Mails, Telefonnummern, Telegram-Chat-IDs oder Push-Daten', async () => {
    const api = createMockApi({ now: () => now });
    await api.demo!.signInAs('mo@example.org');
    // Kontaktdaten auch in der Historie: E-Mail eines Mitglieds und Telefon eines Partners geändert
    const kim = (await api.listMembers()).find((m) => m.display_name === 'Kim')!;
    await api.updateMember(kim.id, {
      display_name: kim.display_name,
      short: kim.short,
      email: 'kim.neu@example.org',
      is_admin: kim.is_admin,
      version: kim.version,
    });
    const druckerei = (await api.listPartners()).find((p) => p.name.startsWith('Druckerei'))!;
    await api.updatePartner(druckerei.id, { ...druckerei, phone: '0987 654321', version: druckerei.version });
    // Kontakt der Location und eines Acts
    const rave = (await api.listEvents()).find((e) => e.title === 'Winterrave')!;
    await api.updateEventDetail(rave.id, {
      field: 'location.contact',
      value: 'Herr Kanal, 0151 2222333',
      version: (await api.getEventDetail(rave.id)).version,
    });
    const act = (await api.getEventDetail(rave.id)).bookings[0]!;
    await api.updateBooking(act.id, { ...act, contact: 'booking@hyphae.example.net', version: act.version });
    const yaml = await api.demo!.exportYaml();
    expect(yaml.split('\n').filter((l) => /0151 2222333|hyphae/.test(l))).toEqual([]);

    expect(yaml).not.toMatch(/@example\.org/);
    expect(yaml).not.toMatch(/0123 456789|0987 654321/);
    expect(yaml).not.toMatch(/chat-[a-z]{2}\b/);
    expect(yaml).not.toMatch(/testgeraet-/);
    // als Schlüssel mit Wert kommen sie nirgends vor (in der Historie steht nur „changed: true“ darunter)
    expect(yaml).not.toMatch(/^\s*(email|phone|auth_user_id|chat_id|endpoint): \S/m);
    const data = parse(yaml) as { history: { changes: Record<string, unknown> }[] };
    expect(data.history.some((h) => JSON.stringify(h.changes.email) === '{"changed":true}')).toBe(true);
    expect(data.history.some((h) => JSON.stringify(h.changes.phone) === '{"changed":true}')).toBe(true);
  });

  it('das JSON-Schema im Repo ist aktuell (npm run schema:export)', async () => {
    await expect(`${JSON.stringify(z.toJSONSchema(exportSchema), null, 2)}\n`).toMatchFileSnapshot(
      './export.schema.json',
    );
  });
});
