import { describe, expect, it } from 'vitest';
import { formatDueLabel } from '../format';
import { TASK_STATUSES, type Task } from '../schema';
import { wouldCreateBlockerCycle } from './blockers';
import { driveFileIdFromUrl, reachableDriveIds } from './drive';
import { addDays, berlinDate, daysUntil, dueState, isPlausibleDate } from './due';
import { suggestsFollowUp } from './eventDetails';
import { allowedEventTransitions, canTransitionEvent } from './eventStatus';
import { suggestShort } from './members';
import { sortTasks } from './taskSort';
import { blockReasonMissing, canTransitionTask, statusAfterLastAssigneeLeft } from './taskStatus';
import { orderTopics, topicFilterIds, topicLabel } from './topics';

const TODAY = '2026-10-11';

describe('Statusmodell Aufgabe (4.1)', () => {
  it('führt nie zurück zu „neu“', () => {
    for (const from of TASK_STATUSES) expect(canTransitionTask(from, 'neu')).toBe(false);
  });

  it('erlaubt die Übergänge der Tabelle', () => {
    expect(canTransitionTask('neu', 'geplant')).toBe(true);
    expect(canTransitionTask('neu', 'in_arbeit')).toBe(true);
    expect(canTransitionTask('geplant', 'in_arbeit')).toBe(true);
    expect(canTransitionTask('in_arbeit', 'geplant')).toBe(true);
    expect(canTransitionTask('blockiert', 'geplant')).toBe(true);
    expect(canTransitionTask('blockiert', 'in_arbeit')).toBe(true);
    for (const from of ['neu', 'geplant', 'in_arbeit', 'blockiert'] as const) {
      expect(canTransitionTask(from, 'erledigt')).toBe(true);
      expect(canTransitionTask(from, 'verworfen')).toBe(true);
    }
    for (const from of ['neu', 'geplant', 'in_arbeit'] as const)
      expect(canTransitionTask(from, 'blockiert')).toBe(true);
  });

  it('öffnet erledigte und verworfene nur nach geplant oder in_arbeit', () => {
    for (const from of ['erledigt', 'verworfen'] as const) {
      expect(canTransitionTask(from, 'geplant')).toBe(true);
      expect(canTransitionTask(from, 'in_arbeit')).toBe(true);
      expect(canTransitionTask(from, 'blockiert')).toBe(false);
      expect(canTransitionTask(from, 'erledigt')).toBe(false);
      expect(canTransitionTask(from, 'verworfen')).toBe(false);
    }
  });

  it('verlangt beim Blockieren einen Grund', () => {
    expect(blockReasonMissing('blockiert', '')).toBe(true);
    expect(blockReasonMissing('blockiert', '   ')).toBe(true);
    expect(blockReasonMissing('blockiert', undefined)).toBe(true);
    expect(blockReasonMissing('blockiert', 'Adresse fehlt')).toBe(false);
    expect(blockReasonMissing('geplant', '')).toBe(false);
  });

  it('setzt nur „In Arbeit“ zurück, wenn niemand mehr eingetragen ist', () => {
    expect(statusAfterLastAssigneeLeft('in_arbeit')).toBe('geplant');
    expect(statusAfterLastAssigneeLeft('geplant')).toBe('geplant');
    expect(statusAfterLastAssigneeLeft('blockiert')).toBe('blockiert');
    expect(statusAfterLastAssigneeLeft('neu')).toBe('neu');
  });
});

describe('Statusmodell Veranstaltung (4.2)', () => {
  it('läuft Schritt für Schritt und jederzeit nach abgesagt', () => {
    expect(allowedEventTransitions('idee')).toEqual(['in_planung', 'abgesagt']);
    expect(allowedEventTransitions('in_nachbereitung')).toEqual(['abgeschlossen', 'abgesagt']);
    expect(canTransitionEvent('idee', 'bestaetigt')).toBe(false);
    expect(canTransitionEvent('bestaetigt', 'in_planung')).toBe(false);
  });

  it('kennt aus abgeschlossen und abgesagt keinen Übergang', () => {
    expect(allowedEventTransitions('abgeschlossen')).toEqual([]);
    expect(allowedEventTransitions('abgesagt')).toEqual([]);
  });
});

describe('Fristen (F-AUF-02)', () => {
  it('rechnet Tage über Monats- und Zeitumstellungsgrenzen', () => {
    expect(daysUntil('2026-10-14', TODAY)).toBe(3);
    expect(daysUntil('2026-10-09', TODAY)).toBe(-2);
    expect(daysUntil('2026-11-01', '2026-10-24')).toBe(8);
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });

  it('unterscheidet überfällig, bald und normal', () => {
    expect(dueState(null, 'geplant', TODAY)).toBe('none');
    expect(dueState('2026-10-10', 'geplant', TODAY)).toBe('overdue');
    expect(dueState('2026-10-11', 'geplant', TODAY)).toBe('soon');
    expect(dueState('2026-10-14', 'in_arbeit', TODAY)).toBe('soon');
    expect(dueState('2026-10-15', 'in_arbeit', TODAY)).toBe('normal');
  });

  it('kennt bei abgeschlossenen Aufgaben keine Überfälligkeit', () => {
    expect(dueState('2026-10-01', 'erledigt', TODAY)).toBe('normal');
    expect(dueState('2026-10-01', 'verworfen', TODAY)).toBe('normal');
  });

  it('lässt nur vollständige Daten zwischen 2000 und 2100 zu', () => {
    expect(isPlausibleDate('2026-11-06')).toBe(true);
    expect(isPlausibleDate('0002-11-06')).toBe(false);
    expect(isPlausibleDate('0202-11-06')).toBe(false);
    expect(isPlausibleDate('2101-01-01')).toBe(false);
    expect(isPlausibleDate('')).toBe(false);
  });

  it('beschriftet die Frist wie im Prototyp', () => {
    expect(formatDueLabel('2026-10-09', 'in_arbeit', TODAY)).toBe('SEIT 09.10.');
    expect(formatDueLabel('2026-10-14', 'geplant', TODAY)).toBe('14.10. · 3 TAGE');
    expect(formatDueLabel('2026-10-12', 'geplant', TODAY)).toBe('12.10. · MORGEN');
    expect(formatDueLabel('2026-10-11', 'geplant', TODAY)).toBe('11.10. · HEUTE');
    expect(formatDueLabel('2026-10-20', 'geplant', TODAY)).toBe('20.10.');
    expect(formatDueLabel(null, 'geplant', TODAY)).toBe('OHNE FRIST');
  });
});

describe('Sortierung der Aufgabenliste (F-AUF-01)', () => {
  const task = (
    title: string,
    priority: Task['priority'],
    due_date: string | null,
    created_at = '2026-10-01T10:00:00.000Z',
    status: Task['status'] = 'geplant',
  ) => ({ title, priority, due_date, created_at, status });

  it('stellt überfällige immer nach oben, dann Priorität, Frist, Erstelldatum', () => {
    const sorted = sortTasks(
      [
        task('niedrig ohne Frist', 'niedrig', null),
        task('hoch ohne Frist', 'hoch', null),
        task('hoch spät', 'hoch', '2026-10-30'),
        task('hoch früh', 'hoch', '2026-10-14'),
        task('niedrig überfällig', 'niedrig', '2026-10-09'),
        task('mittel später angelegt', 'mittel', '2026-10-20', '2026-10-05T10:00:00.000Z'),
        task('mittel früher angelegt', 'mittel', '2026-10-20', '2026-10-02T10:00:00.000Z'),
      ],
      TODAY,
    );
    expect(sorted.map((t) => t.title)).toEqual([
      'niedrig überfällig',
      'hoch früh',
      'hoch spät',
      'hoch ohne Frist',
      'mittel früher angelegt',
      'mittel später angelegt',
      'niedrig ohne Frist',
    ]);
  });

  it('behandelt erledigte mit alter Frist nicht als überfällig', () => {
    const sorted = sortTasks(
      [task('erledigt alt', 'niedrig', '2026-09-01', undefined, 'erledigt'), task('hoch', 'hoch', null)],
      TODAY,
    );
    expect(sorted[0]!.title).toBe('hoch');
  });
});

describe('Abhängigkeiten (3.3)', () => {
  const edge = (task_id: string, blocker_task_id: string) => ({ task_id, blocker_task_id });

  it('verbietet Selbstbezug und Zyklen, auch über Ketten', () => {
    expect(wouldCreateBlockerCycle([], 'a', 'a')).toBe(true);
    expect(wouldCreateBlockerCycle([edge('b', 'a')], 'a', 'b')).toBe(true);
    expect(wouldCreateBlockerCycle([edge('b', 'a'), edge('c', 'b')], 'a', 'c')).toBe(true);
  });

  it('erlaubt Ketten und Rauten ohne Kreis', () => {
    expect(wouldCreateBlockerCycle([edge('b', 'a')], 'c', 'b')).toBe(false);
    expect(wouldCreateBlockerCycle([edge('b', 'a'), edge('c', 'a')], 'd', 'b')).toBe(false);
  });
});

describe('Themen (3.2)', () => {
  const topics = [
    { id: 'v', name: 'Verein', parent_id: null, sort_order: 2 },
    { id: 'e', name: 'Veranstaltungen', parent_id: null, sort_order: 1 },
    { id: 'r', name: 'Versicherung & Recht', parent_id: 'v', sort_order: 2 },
    { id: 'm', name: 'Mitglieder', parent_id: 'v', sort_order: 1 },
  ];
  const byId = new Map(topics.map((t) => [t.id, t]));

  it('benennt Unterkategorien mit ihrem Bereich', () => {
    expect(topicLabel(byId.get('r')!, byId)).toBe('Verein · Versicherung & Recht');
    expect(topicLabel(byId.get('e')!, byId)).toBe('Veranstaltungen');
  });

  it('ordnet Unterkategorien unter ihren Bereich', () => {
    expect(orderTopics(topics).map((t) => t.id)).toEqual(['e', 'v', 'm', 'r']);
  });

  it('filtert einen Bereich samt Unterkategorien', () => {
    expect([...topicFilterIds('v', topics)].sort()).toEqual(['m', 'r', 'v']);
    expect([...topicFilterIds('m', topics)]).toEqual(['m']);
  });
});

describe('Kürzel-Vorschlag (3.1)', () => {
  it('nimmt die ersten zwei Buchstaben und weicht bei Dopplung aus', () => {
    expect(suggestShort('Lea', [])).toBe('LE');
    expect(suggestShort('Leon', ['LE'])).toBe('LO');
    expect(suggestShort('Le', ['LE'])).toBe('L2');
    expect(suggestShort('Émile', [])).toBe('EM');
    expect(suggestShort('', [])).toBe('');
  });
});

describe('Drive (3.13)', () => {
  it('liest die Datei-ID nur aus Links von Google Drive und Docs', () => {
    expect(driveFileIdFromUrl('https://docs.google.com/document/d/abc-123/edit#x')).toBe('abc-123');
    expect(driveFileIdFromUrl('https://drive.google.com/file/d/xyz_9/view')).toBe('xyz_9');
    expect(driveFileIdFromUrl('https://drive.google.com/open?id=q1')).toBe('q1');
    expect(driveFileIdFromUrl('https://example.org/seite?id=drive-coc&ref=google.com')).toBeNull();
    expect(driveFileIdFromUrl('https://docs.google.com.example.org/document/d/abc')).toBeNull();
    expect(driveFileIdFromUrl('kein Link')).toBeNull();
    // „Im Web veröffentlichen“ nennt keine Datei-ID – sonst wären alle solchen Links „dieselbe Datei“
    expect(driveFileIdFromUrl('https://docs.google.com/document/d/e/2PACX-1vAAA/pub')).toBeNull();
    expect(driveFileIdFromUrl('https://docs.google.com/spreadsheets/d/e/2PACX-1vBBB/pubhtml')).toBeNull();
  });

  it('zählt nur, was über nicht gelöschte Ordner an der Wurzel hängt', () => {
    const items = [
      { file_id: 'w', parent_id: null, trashed: false },
      { file_id: 'a', parent_id: 'w', trashed: false },
      { file_id: 'a1', parent_id: 'a', trashed: false },
      { file_id: 'b', parent_id: 'w', trashed: true },
      { file_id: 'b1', parent_id: 'b', trashed: false },
      { file_id: 'fremd', parent_id: 'anderswo', trashed: false },
    ];
    expect([...reachableDriveIds(items, 'w')].sort()).toEqual(['a', 'a1', 'w']);
  });
});

describe('Kalenderdatum in Köln (Server läuft in UTC)', () => {
  it('kurz nach Mitternacht in Köln ist schon der neue Tag', () => {
    expect(berlinDate(new Date('2026-07-10T22:30:00Z'))).toBe('2026-07-11');
    expect(berlinDate(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(berlinDate(new Date('2026-07-10T21:30:00Z'))).toBe('2026-07-10');
  });

  it('„In Nachbereitung?“ erst am Kölner Tag nach dem Ende', () => {
    // Party endet Samstag 01:00 in Köln (Freitag 23:00 UTC)
    const event = {
      status: 'bestaetigt' as const,
      starts_at: '2026-07-10T20:00:00Z',
      ends_at: '2026-07-10T23:00:00Z',
    };
    expect(suggestsFollowUp(event, new Date('2026-07-11T00:30:00Z'))).toBe(false);
    expect(suggestsFollowUp(event, new Date('2026-07-11T21:59:00Z'))).toBe(false);
    expect(suggestsFollowUp(event, new Date('2026-07-11T22:00:00Z'))).toBe(true);
  });
});
