import { describe, expect, it } from 'vitest';
import { describeFieldChanges, entityHistorySentence } from './entityHistory';
import type { HistoryEntry } from './schema';

const entry = (action: string, changes: HistoryEntry['changes']): HistoryEntry =>
  ({
    id: 'h1',
    entity_type: 'partner',
    entity_id: 'p1',
    action,
    changes,
    actor_member_id: 'm1',
    created_at: '2026-10-26T10:00:00.000Z',
  }) as HistoryEntry;
const look = {
  memberName: (id: string) => (id === 'm1' ? 'Mo' : 'Lea'),
  topicName: (id: string) => (id === 't1' ? 'Lager' : 'Finanzen'),
  eventTitle: () => 'Winterrave',
};

describe('Verlauf: vorher → nachher (16.3)', () => {
  it('Titel, Beschreibung, Thema und Veranstaltung mit altem und neuem Stand, richtige Artikel', () => {
    expect(
      describeFieldChanges(
        {
          title: { old: 'Alt', new: 'Neu' },
          description: { old: 'Kurz', new: 'Länger' },
          topic_id: { old: 't1', new: 't2' },
          event_id: { old: null, new: 'e1' },
          phone: { old: '1', new: '2' },
          ends_at: { old: 'a', new: 'b' },
        },
        look,
      ),
    ).toBe(
      'den Titel von „Alt“ auf „Neu“ geändert, die Beschreibung von „Kurz“ auf „Länger“ geändert, das Thema von „Lager“ auf „Finanzen“ geändert, die Veranstaltung ergänzt: „Winterrave“, die Telefonnummer von „1“ auf „2“ geändert und das Ende geändert',
    );
  });

  it('geleerte Beschreibung nennt den alten Stand; bearbeitete Kommentare zeigen alt und neu', () => {
    expect(describeFieldChanges({ description: { old: 'Weg damit', new: '' } })).toBe(
      'die Beschreibung entfernt (vorher: „Weg damit“)',
    );
    expect(
      entityHistorySentence(entry('comment_edited', { body: { old: 'Dez', new: 'Jan' } }), 'Partner', look),
    ).toBe('Mo hat einen Kommentar von „Dez“ auf „Jan“ geändert.');
  });

  it('Leerraum und Zeilenumbrüche werden zu einem Leerzeichen, Buchstaben bleiben', () => {
    expect(describeFieldChanges({ description: { old: 'Mate am Tresen\n\nfür Gäste', new: 'Saft' } })).toBe(
      'die Beschreibung von „Mate am Tresen für Gäste“ auf „Saft“ geändert',
    );
  });
});
