// Testdaten für Schritt A: Startbestand der Themen (3.2) und die Beispieldaten des Prototyps.
// Erfundene Personen mit example.org-Adressen – keine echten personenbezogenen Daten.
// Alle Daten sind relativ zu „heute“, damit Fristen und Listen jeden Tag gleich aussehen.
import { addDays, toIsoDate } from '../../shared/rules/due';
import type {
  AppointmentFormat,
  DecisionKind,
  DocType,
  EventType,
  Member,
  Priority,
  Topic,
} from '../../shared/schema';
import { DRIVE_FOLDER_MIME, NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS } from '../../shared/schema';
import * as appts from './appointments';
import * as drive from './drive';
import * as events from './events';
import * as partners from './partners';
import { seedTemplates } from './templates';
import * as know from './knowledge';
import * as reports from './reports';
import { runJob } from './notify';
import * as series from './series';
import * as server from './server';
import { DRIVE_ROOT_ID, emptyDb, type Ctx, type Db } from './server';

const fixedId = (group: number, n: number) =>
  `00000000-0000-4000-8000-${String(group).padStart(4, '0')}${String(n).padStart(8, '0')}`;

export const SYSTEM_MEMBER_ID = fixedId(1, 0);
/** Ordner des Winterraves im Vereins-Drive – auch Ziel der Demo „Datei im Drive anlegen“ */
export const DRIVE_EVENT_FOLDER_ID = 'drive-winterrave';

const MIME = {
  ordner: DRIVE_FOLDER_MIME,
  doc: 'application/vnd.google-apps.document',
  tabelle: 'application/vnd.google-apps.spreadsheet',
  pdf: 'application/pdf',
  bild: 'image/png',
} as const;

/**
 * Vereins-Drive wie im Prototyp (D-Wissen): [Datei-ID, Elternordner, Name, Art, vor wie vielen Tagen geändert].
 * Die Wurzel heißt hier „Myzel Drive“ – welcher Ordner es wirklich wird, ist Frage 11.4.
 */
const DRIVE_TREE: [id: string, parent: string | null, name: string, kind: keyof typeof MIME, days: number][] =
  [
    [DRIVE_ROOT_ID, null, 'Myzel Drive', 'ordner', 200],
    ['drive-verein', DRIVE_ROOT_ID, 'Verein', 'ordner', 120],
    ['drive-protokolle', 'drive-verein', 'Protokolle', 'ordner', 26],
    ['drive-protokoll-09', 'drive-protokolle', 'Protokoll Plenum September', 'doc', 26],
    ['drive-protokoll-08', 'drive-protokolle', 'Protokoll Plenum August', 'doc', 54],
    ['drive-protokoll-07', 'drive-protokolle', 'Protokoll Plenum Juli', 'doc', 93],
    ['drive-leitlinien', 'drive-verein', 'Leitlinien', 'ordner', 40],
    ['drive-coc', 'drive-leitlinien', 'Code of Conduct', 'doc', 40],
    ['drive-hausordnung', 'drive-leitlinien', 'Hausordnung Lager', 'doc', 75],
    ['drive-satzung', 'drive-verein', 'Satzung.pdf', 'pdf', 400],
    ['drive-veranstaltungen', DRIVE_ROOT_ID, 'Veranstaltungen', 'ordner', 3],
    [DRIVE_EVENT_FOLDER_ID, 'drive-veranstaltungen', '2026-12 Winterrave', 'ordner', 0],
    ['drive-rave-booking', DRIVE_EVENT_FOLDER_ID, 'Booking', 'ordner', 12],
    ['drive-rider', 'drive-rave-booking', 'Rider DJ Hyphae.pdf', 'pdf', 18],
    ['drive-vertrag', 'drive-rave-booking', 'Mietvertrag Halle am Kanal.pdf', 'pdf', 12],
    ['drive-rave-flyer', DRIVE_EVENT_FOLDER_ID, 'Flyer & Social', 'ordner', 11],
    ['drive-flyer-v3', 'drive-rave-flyer', 'Flyer_Winterrave_v3.pdf', 'pdf', 11],
    ['drive-flyer-v2', 'drive-rave-flyer', 'Flyer_Winterrave_v2.pdf', 'pdf', 16],
    ['drive-story', 'drive-rave-flyer', 'Insta-Story Winterrave.png', 'bild', 11],
    ['drive-schichtplan', DRIVE_EVENT_FOLDER_ID, 'Schichtplan Winterrave', 'tabelle', 0],
    ['drive-getraenke', DRIVE_EVENT_FOLDER_ID, 'Getränkeliste', 'tabelle', 1],
    ['drive-awareness', DRIVE_EVENT_FOLDER_ID, 'Awareness-Konzept', 'doc', 17],
    ['drive-hoffest', 'drive-veranstaltungen', '2026-08 Hoffest', 'ordner', 60],
    ['drive-hoffest-abrechnung', 'drive-hoffest', 'Abrechnung Hoffest', 'tabelle', 60],
    ['drive-lager', DRIVE_ROOT_ID, 'Lager & Material', 'ordner', 30],
    ['drive-inventar', 'drive-lager', 'Inventarliste', 'tabelle', 30],
    ['drive-vorlagen', DRIVE_ROOT_ID, 'Vorlagen', 'ordner', 100],
    ['drive-vorlage-schichtplan', 'drive-vorlagen', 'Vorlage Schichtplan', 'tabelle', 100],
    ['drive-vorlage-abrechnung', 'drive-vorlagen', 'Vorlage Abrechnung', 'tabelle', 140],
  ];

function driveUrl(id: string, kind: keyof typeof MIME): string {
  if (kind === 'ordner') return `https://drive.google.com/drive/folders/${id}`;
  if (kind === 'doc') return `https://docs.google.com/document/d/${id}`;
  if (kind === 'tabelle') return `https://docs.google.com/spreadsheets/d/${id}`;
  return `https://drive.google.com/file/d/${id}`;
}

/** Das simulierte Vereins-Drive anlegen und den Cache einmal vollständig einlesen (3.13 Nr. 5) */
function seedDrive(db: Db, at: (daysAgo: number, time?: string) => Date, now: Date): void {
  for (const [id, parent, name, kind, days] of DRIVE_TREE)
    drive.remotePut(db, {
      file_id: id,
      parent_id: parent,
      name,
      mime_type: MIME[kind],
      modified_time: at(days, '10:30').toISOString(),
      web_url: driveUrl(id, kind),
    });
  drive.rebuildDrive(db, new Date(now.getTime() - 2 * 60_000));
}

const MEMBERS: [short: string, name: string, admin: boolean, active: boolean][] = [
  ['MO', 'Mo', true, true],
  ['LE', 'Lea', true, true],
  ['JU', 'Jule', false, true],
  ['SA', 'Sam', false, true],
  ['KI', 'Kim', false, true],
  ['NO', 'Noa', false, true],
  ['TI', 'Timo', false, true],
  ['RA', 'Rana', false, true],
  ['EL', 'Elif', false, true],
  ['BE', 'Ben', false, true],
  ['PA', 'Paula', false, true],
  ['TA', 'Tarek', false, false],
];

const TOPICS: [name: string, children: string[], archived?: boolean][] = [
  ['Veranstaltungen', []],
  ['Verein', []],
  ['Lager & Material', []],
  ['Öffentlichkeitsarbeit', []],
  ['Organisatorisches', []],
  ['Sonstiges', []],
  ['Alte Location', [], true],
];

export function seedDb(now: Date): Db {
  const db = emptyDb();
  const at = (daysAgo: number, time = '12:00') => {
    const [h, m] = time.split(':').map(Number) as [number, number];
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m);
  };
  const today = toIsoDate(now);
  const due = (offset: number) => addDays(today, offset);
  const founded = at(120).toISOString();

  db.members.push({
    id: SYSTEM_MEMBER_ID,
    auth_user_id: null,
    email: null,
    display_name: 'Myzel (automatisch)',
    short: '⚙',
    is_admin: false,
    active: true,
    is_system: true,
    reminder_lead_days: 3,
    created_at: founded,
    updated_at: founded,
    created_by: null,
    version: 1,
  });
  const member: Record<string, Member> = {};
  MEMBERS.forEach(([short, name, admin, active], i) => {
    member[short] = {
      id: fixedId(1, i + 1),
      auth_user_id: null,
      email: `${name.toLowerCase()}@example.org`,
      display_name: name,
      short,
      is_admin: admin,
      active,
      is_system: false,
      reminder_lead_days: 3,
      created_at: founded,
      updated_at: founded,
      created_by: null,
      version: 1,
    };
    db.members.push(member[short]);
    // Benachrichtigungen sind standardmäßig aus (F-PRO-02); die Testpersonen haben alle Zeilen eingeschaltet
    for (const event_type of NOTIFICATION_EVENTS)
      for (const channel of NOTIFICATION_CHANNELS)
        db.notification_preferences.push({ member_id: member[short].id, event_type, channel, enabled: true });
  });

  const topic: Record<string, Topic> = {};
  let topicNo = 0;
  const addTopic = (name: string, parent: Topic | null, sort: number, archived = false) => {
    const row: Topic = {
      id: fixedId(2, ++topicNo),
      name,
      parent_id: parent?.id ?? null,
      sort_order: sort,
      archived_at: archived ? at(30).toISOString() : null,
      created_at: founded,
      updated_at: founded,
      created_by: null,
      version: 1,
    };
    db.topics.push(row);
    topic[name] = row;
    return row;
  };
  TOPICS.forEach(([name, children, archived], i) => {
    const parent = addTopic(name, null, i + 1, archived);
    children.forEach((child, j) => addTopic(child, parent, j + 1));
  });

  const as = (short: string, daysAgo: number, time?: string): Ctx => ({
    db,
    actor: member[short]!,
    now: at(daysAgo, time),
    inverse: [],
  });
  const version = (id: string) => db.tasks.find((t) => t.id === id)!.version;

  const addEvent = (
    title: string,
    type: EventType,
    startsInDays: number,
    start: string,
    hours: number,
    description: string | null,
    statuses: number,
  ) => {
    const starts = at(-startsInDays, start);
    const { id } = server.createEvent(as('LE', 90), {
      title,
      type,
      description,
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + hours * 3_600_000).toISOString(),
    });
    const flow = ['in_planung', 'bestaetigt', 'in_nachbereitung', 'abgeschlossen'] as const;
    flow.slice(0, statuses).forEach((status, i) => {
      server.setEventStatus(as('LE', 80 - i * 10), id, status, db.events.find((e) => e.id === id)!.version);
    });
    return id;
  };
  const workshop = addEvent(
    'Siebdruck-Workshop',
    'workshop',
    14,
    '14:00',
    4,
    'Offener Workshop im Lager, 12 Plätze.',
    2,
  );
  const rave = addEvent(
    'Winterrave',
    'party',
    62,
    '22:00',
    8,
    'Großer Rave zum Jahresende, Erlös an die Lagermiete.',
    1,
  );
  const soli = addEvent('Soli-Tresen Sporenflug', 'soli', -21, '19:00', 5, null, 3);
  const hoffest = addEvent('Hoffest', 'sonstiges', -63, '15:00', 8, null, 4);

  interface TaskSeed {
    title: string;
    topic: string;
    event?: string;
    prio: Priority;
    due?: number;
    by: string;
    daysAgo: number;
  }
  const addTask = (s: TaskSeed) =>
    server.createTask(as(s.by, s.daysAgo, '19:38'), {
      title: s.title,
      topic_id: topic[s.topic]!.id,
      event_id: s.event ?? null,
      priority: s.prio,
      due_date: s.due === undefined ? null : due(s.due),
    }).id;
  const plan = (id: string, by: string, daysAgo: number, assignees: string[]) => {
    server.setTaskStatus(as(by, daysAgo, '19:40'), id, { status: 'geplant', version: version(id) });
    for (const a of assignees) server.addAssignee(as(by, daysAgo, '19:40'), id, member[a]!.id);
  };
  const setStatus = (
    id: string,
    by: string,
    daysAgo: number,
    status: 'in_arbeit' | 'erledigt',
    time = '18:04',
  ) => server.setTaskStatus(as(by, daysAgo, time), id, { status, version: version(id) });
  const done = (s: TaskSeed, assignee: string) => {
    const id = addTask(s);
    plan(id, s.by, s.daysAgo, [assignee]);
    setStatus(id, assignee, Math.max(1, s.daysAgo - 5), 'erledigt');
    return id;
  };

  // Die sechs Aufgaben der Aufgabenliste im Prototyp
  const location = addTask({
    title: 'Location für Winterrave bestätigen',
    topic: 'Veranstaltungen',
    event: rave,
    prio: 'hoch',
    due: -2,
    by: 'LE',
    daysAgo: 9,
  });
  plan(location, 'LE', 9, ['LE']);
  setStatus(location, 'MO', 6, 'in_arbeit');
  server.addComment(
    as('LE', 5, '11:20'),
    location,
    'Vermieter will den Vertrag erst nach der Begehung schicken.',
  );
  server.addComment(as('MO', 3, '09:15'), location, 'Begehung ist am Mittwoch um 17 Uhr, ich gehe hin.');
  server.addComment(as('LE', 1, '20:31'), location, 'Bitte auch nach der Lautstärke-Auflage fragen.');

  const drinks = addTask({
    title: 'Getränke bei der Brauerei bestellen',
    topic: 'Veranstaltungen',
    event: rave,
    prio: 'hoch',
    due: 3,
    by: 'LE',
    daysAgo: 9,
  });
  plan(drinks, 'LE', 9, ['JU']);
  server.updateTaskDescription(as('JU', 8, '10:00'), drinks, '6 Fässer, 4 Kästen Mate …', version(drinks));
  server.addComment(as('MO', 2, '14:40'), drinks, 'Denk an die Pfandkisten vom letzten Mal.');

  const flyer = addTask({
    title: 'Flyer drucken lassen',
    topic: 'Öffentlichkeitsarbeit',
    event: rave,
    prio: 'mittel',
    due: 9,
    by: 'LE',
    daysAgo: 9,
  });
  plan(flyer, 'LE', 9, ['SA']);
  server.updateTaskDescription(
    as('SA', 8, '12:10'),
    flyer,
    'A6, 500 Stück, beidseitig. Druckdatei liegt im Drive-Ordner Winterrave.',
    version(flyer),
  );
  server.setTaskStatus(as('SA', 3, '21:14'), flyer, {
    status: 'blockiert',
    block_reason: 'Druckerei braucht die finale Adresse für den Flyer.',
    blocker_ids: [location],
    version: version(flyer),
  });
  server.addComment(
    as('SA', 1, '21:14'),
    flyer,
    'Druckerei hat uns einen Slot am 18.10. reserviert. Fehlt nur noch die Adresse.',
  );
  server.addComment(
    as('MO', 0, '10:02'),
    flyer,
    'Location klärt sich bis Mittwoch, ich melde mich direkt hier.',
  );
  server.addFollower(as('LE', 0, '10:05'), flyer, member.LE!.id);

  addTask({
    title: 'Vereinshaftpflicht verlängern',
    topic: 'Verein',
    prio: 'mittel',
    due: 20,
    by: 'NO',
    daysAgo: 4,
  });

  const fog = addTask({
    title: 'Nebelmaschine reparieren',
    topic: 'Lager & Material',
    prio: 'niedrig',
    by: 'KI',
    daysAgo: 14,
  });
  setStatus(fog, 'KI', 12, 'in_arbeit');
  server.addComment(as('KI', 10, '16:00'), fog, 'Pumpe ist hin, Ersatzteil ist bestellt.');
  server.addComment(as('TI', 7, '18:22'), fog, 'Ich hätte noch eine alte Pumpe im Keller.');

  done(
    {
      title: 'Insta-Post Bautag',
      topic: 'Öffentlichkeitsarbeit',
      prio: 'niedrig',
      due: -6,
      by: 'MO',
      daysAgo: 12,
    },
    'MO',
  );

  // Weitere Aufgaben für Fortschritt, „Meine“ und den Deaktivieren-Dialog
  const cash = addTask({
    title: 'Kasse für Winterrave besorgen',
    topic: 'Veranstaltungen',
    event: rave,
    prio: 'mittel',
    due: 40,
    by: 'LE',
    daysAgo: 9,
  });
  plan(cash, 'LE', 9, ['JU']);
  const awareness = addTask({
    title: 'Awareness-Briefing vorbereiten',
    topic: 'Veranstaltungen',
    event: rave,
    prio: 'mittel',
    due: 30,
    by: 'RA',
    daysAgo: 6,
  });
  plan(awareness, 'RA', 6, ['RA', 'EL']);
  for (const [title, who] of [
    ['Datum mit dem Kollektiv Sporenflug abstimmen', 'LE'],
    ['Line-up-Anfragen verschicken', 'BE'],
    ['Technik-Liste aus dem Lager prüfen', 'TI'],
    ['Awareness-Team zusammenstellen', 'RA'],
  ] as const)
    done({ title, topic: 'Veranstaltungen', event: rave, prio: 'mittel', by: 'LE', daysAgo: 20 }, who);

  const colors = addTask({
    title: 'Farben und Siebe besorgen',
    topic: 'Lager & Material',
    event: workshop,
    prio: 'mittel',
    due: 10,
    by: 'KI',
    daysAgo: 8,
  });
  plan(colors, 'KI', 8, ['KI', 'SA']);
  setStatus(colors, 'KI', 4, 'in_arbeit');
  for (const [title, who] of [
    ['Anmeldeliste Workshop aufsetzen', 'PA'],
    ['Workshop auf Instagram ankündigen', 'MO'],
    ['Lager für den Workshop freiräumen', 'TI'],
  ] as const)
    done(
      { title, topic: 'Öffentlichkeitsarbeit', event: workshop, prio: 'mittel', by: 'KI', daysAgo: 18 },
      who,
    );

  const billing = addTask({
    title: 'Abrechnung Soli-Tresen an die Kasse geben',
    topic: 'Verein',
    event: soli,
    prio: 'mittel',
    due: 5,
    by: 'LE',
    daysAgo: 20,
  });
  plan(billing, 'LE', 20, ['EL']);
  for (const title of ['Tresenschichten Soli-Tresen besetzen', 'Spendenziel mit Sporenflug abstimmen'])
    done({ title, topic: 'Veranstaltungen', event: soli, prio: 'mittel', by: 'LE', daysAgo: 40 }, 'NO');
  for (const title of ['Bühne fürs Hoffest aufbauen', 'Bands fürs Hoffest buchen'])
    done({ title, topic: 'Veranstaltungen', event: hoffest, prio: 'hoch', by: 'LE', daysAgo: 85 }, 'BE');
  done(
    {
      title: 'Schlüssel der alten Location zurückgeben',
      topic: 'Organisatorisches',
      prio: 'mittel',
      by: 'MO',
      daysAgo: 60,
    },
    'MO',
  );
  // hängt am archivierten Thema – dort nur noch abgeschlossene Aufgaben
  db.tasks.at(-1)!.topic_id = topic['Alte Location']!.id;

  // Phase 3: Terminarten (Startbestand 3.6) und Termine wie im Prototyp
  const typeDefs: [
    label: string,
    topicName: string,
    format: AppointmentFormat,
    place: string | null,
    color: string,
    plenum: boolean,
  ][] = [
    ['Plenum', 'Organisatorisches', 'online', null, '#F062C0', true],
    ['Bautag', 'Lager & Material', 'vor_ort', 'Lager', '#B59AF5', false],
    ['Betriebsausflug', 'Organisatorisches', 'vor_ort', null, '#E2DCF0', false],
    ['Besprechung mit Externen', 'Organisatorisches', 'vor_ort', null, '#8FA6FF', false],
    ['Sonstiges', 'Organisatorisches', 'vor_ort', null, '#A69FB8', false],
  ];
  const type: Record<string, string> = {};
  typeDefs.forEach(([label, topicName, format, place, color, plenum], i) => {
    type[label] = fixedId(4, i + 1);
    db.appointment_types.push({
      id: type[label],
      key: label.toLowerCase().replace(/[^a-z]+/g, '_'),
      label,
      default_topic_id: topic[topicName]!.id,
      default_format: format,
      default_location: place,
      has_plenum_features: plenum,
      color,
      sort_order: i + 1,
      archived_at: null,
      created_at: founded,
      updated_at: founded,
      created_by: null,
      version: 1,
    });
  });
  const CALL = 'https://meet.example.org/myzel';
  const addAppointment = (
    typeLabel: string,
    title: string,
    inDays: number,
    start: string,
    hours: number | null,
    format: AppointmentFormat,
    yes: string[],
    no: string[] = [],
    eventId: string | null = null,
  ) => {
    const starts = at(-inDays, start);
    const { id } = appts.createAppointment(as('LE', Math.max(40, -inDays + 14)), {
      type_id: type[typeLabel]!,
      title,
      starts_at: starts.toISOString(),
      ends_at: hours ? new Date(starts.getTime() + hours * 3_600_000).toISOString() : null,
      format,
      location: format === 'online' ? null : 'Lager',
      online_url: format === 'vor_ort' ? null : CALL,
      event_id: eventId,
    });
    const answered = at(Math.max(1, -inDays + 7)).toISOString();
    for (const [list, answer] of [
      [yes, 'ja'],
      [no, 'nein'],
    ] as const)
      for (const short of list)
        db.appointment_rsvps.push({
          appointment_id: id,
          member_id: member[short]!.id,
          answer,
          answered_at: answered,
        });
    if (inDays < 0) {
      const appointment = db.appointments.find((a) => a.id === id)!;
      appts.markHappened(
        as('LE', -inDays - 1),
        id,
        yes.map((short) => member[short]!.id),
        appointment.version,
      );
    }
    return id;
  };
  const plenumSept = addAppointment('Plenum', 'Plenum September', -26, '19:00', 2, 'online', [
    'LE',
    'MO',
    'JU',
    'SA',
    'KI',
    'NO',
    'RA',
  ]);
  addAppointment('Bautag', 'Bautag September', -22, '10:00', 6, 'vor_ort', ['LE', 'KI', 'TI', 'MO'], ['SA']);
  addAppointment('Plenum', 'Plenum Oktober', 4, '19:00', 2, 'online', [
    'LE',
    'JU',
    'SA',
    'KI',
    'NO',
    'TI',
    'MO',
  ]);
  const bautag = addAppointment(
    'Bautag',
    'Bautag Oktober',
    6,
    '10:00',
    6,
    'vor_ort',
    ['LE', 'KI', 'JU', 'NO'],
    ['SA'],
  );
  addAppointment(
    'Besprechung mit Externen',
    'Vorbesprechung Winterrave mit Kollektiv Sporenflug',
    23,
    '18:30',
    null,
    'hybrid',
    ['LE', 'RA', 'MO'],
    [],
    rave,
  );
  addAppointment('Plenum', 'Plenum November', 32, '19:00', 2, 'online', ['LE', 'EL', 'BE']);
  addAppointment('Bautag', 'Bautag November', 41, '10:00', 6, 'vor_ort', ['KI', 'TI']);
  // Phase 6: Bis November von Hand angelegt, danach als Serie – jeden 3. Samstag (F-TER-02, Startbestand)
  series.createSeries(as('LE', 1), {
    type_id: type.Bautag!,
    title: 'Bautag',
    format: 'vor_ort',
    location: 'Lager',
    start_time: '10:00',
    end_time: '16:00',
    rrule: 'FREQ=MONTHLY;BYDAY=SA;BYSETPOS=3',
    valid_from: due(42),
  });

  const tools = server.createTask(as('KI', 5, '11:00'), {
    title: 'Werkzeug mitbringen (Akkuschrauber, Leiter)',
    topic_id: topic['Lager & Material']!.id,
    appointment_id: bautag,
  }).id;
  plan(tools, 'KI', 5, ['KI']);
  server.createTask(as('TI', 3, '17:20'), {
    title: 'Schwerlastregal im Lager aufbauen',
    topic_id: topic['Lager & Material']!.id,
    appointment_id: bautag,
  });

  // Ältere Plenen stehen als Quelle für Entscheidungen in der Historie (F-PLE-01): nur Datum und Status
  const MONTH_NAMES = [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ];
  const oldPlenum = (daysAgo: number) => {
    const starts = at(daysAgo, '19:00');
    const id = fixedId(5, daysAgo);
    db.appointments.push({
      id,
      type_id: type.Plenum!,
      title: `Plenum ${MONTH_NAMES[starts.getMonth()]} ${starts.getFullYear()}`,
      topic_id: topic.Organisatorisches!.id,
      event_id: null,
      description: null,
      starts_at: starts.toISOString(),
      ends_at: null,
      format: 'online',
      location: null,
      online_url: CALL,
      status: 'abgeschlossen',
      series_id: null,
      series_date: null,
      is_exception: false,
      protocol_document_id: null,
      protocol_member_id: null,
      notes: null,
      archived_at: null,
      created_at: starts.toISOString(),
      updated_at: starts.toISOString(),
      created_by: member.LE!.id,
      version: 1,
    });
    return id;
  };
  const plenumOld1 = oldPlenum(93);
  const plenumOld2 = oldPlenum(211);
  const plenumOld3 = oldPlenum(486);
  db.appointments.find((a) => a.id === plenumSept)!.status = 'abgeschlossen';

  // Wissen: Dokumente, Entscheidungen und Fakten, offene Fragen – wie im Prototyp.
  // Die Dokumente sind Dateien aus dem Vereins-Drive (Phase 5).
  seedDrive(db, at, now);
  db.events.find((e) => e.id === rave)!.drive_folder_id = DRIVE_EVENT_FOLDER_ID;
  // der Drive-Link genügt: createDocument erkennt die Datei im Cache und setzt drive_file_id
  const addDocument = (title: string, doc_type: DocType, fileId: string, topicName: string | null = null) =>
    know.createDocument(as('LE', 30), {
      title,
      url: db.drive_items.find((i) => i.file_id === fileId)!.web_url,
      doc_type,
      topic_id: topicName ? topic[topicName]!.id : null,
    }).id;
  const coc = addDocument('Code of Conduct', 'leitlinie', 'drive-coc', 'Organisatorisches');
  addDocument('Hausordnung Lager', 'leitlinie', 'drive-hausordnung', 'Lager & Material');
  const protokollSept = addDocument('Protokoll Plenum September', 'protokoll', 'drive-protokoll-09');
  const flyerPdf = addDocument(
    'Flyer_Winterrave_v3.pdf',
    'sonstiges',
    'drive-flyer-v3',
    'Öffentlichkeitsarbeit',
  );
  db.appointments.find((a) => a.id === plenumSept)!.protocol_document_id = protokollSept;
  know.linkDocument(as('SA', 3), flyerPdf, 'task', flyer);
  know.linkDocument(as('LE', 20), coc, 'event', rave);
  know.linkDocument(as('LE', 20), coc, 'event', workshop);

  const addDecision = (
    title: string,
    kind: DecisionKind,
    topicName: string,
    daysAgo: number,
    source: { plenum?: string; document?: string; note?: string },
    description: string | null = null,
  ) =>
    know.createDecision(as('LE', daysAgo, '20:41'), {
      title,
      description,
      kind,
      topic_id: topic[topicName]!.id,
      decided_on: toIsoDate(at(daysAgo)),
      source_plenum_id: source.plenum ?? null,
      source_document_id: source.document ?? null,
      source_note: source.note ?? null,
    }).id;
  const decisionVersion = (id: string) => db.decisions.find((d) => d.id === id)!.version;
  // Entscheidungen werden gültig, wenn die Frist (7 Tage) ohne Widerspruch abläuft (16.4) – im Joblauf, automatisch
  const system = db.members.find((m) => m.is_system)!;
  const settleAt = (daysAgo: number) => know.settleOpenDecisions(db, system, at(daysAgo, '06:00'));
  addDecision(
    'Keine Partys mit weniger als 6 aktiven Kollektiv-Leuten',
    'entscheidung',
    'Veranstaltungen',
    486,
    { plenum: plenumOld3 },
  );
  settleAt(478);
  const mateAlt = addDecision('Mate am Tresen für 2 €', 'entscheidung', 'Veranstaltungen', 211, {
    plenum: plenumOld2,
  });
  settleAt(203);
  const mateNeu = addDecision('Mate am Tresen für 2,50 €', 'entscheidung', 'Veranstaltungen', 93, {
    plenum: plenumOld1,
  });
  settleAt(85);
  know.replaceDecision(as('LE', 85, '20:45'), mateAlt, {
    successor_id: mateNeu,
    version: decisionVersion(mateAlt),
  });
  addDecision(
    'Eintritt immer auch auf Spendenbasis möglich',
    'entscheidung',
    'Veranstaltungen',
    26,
    { plenum: plenumSept, document: protokollSept },
    'Bei allen eigenen Veranstaltungen gibt es neben dem festen Preis immer die Möglichkeit, nach Selbsteinschätzung zu zahlen.',
  );
  const awareness4 = addDecision(
    'Awareness-Team mit mindestens 4 Personen',
    'entscheidung',
    'Veranstaltungen',
    26,
    { plenum: plenumSept },
  );
  settleAt(18);
  // „Stimmt das noch?“ auf der Agenda (16.1)
  know.setDecisionAgenda(as('RA', 2), awareness4, true);
  // noch offen (16.4): eine wartet auf Bestätigung, gegen eine gibt es Widerspruch – sie steht auf der Agenda
  const bier = addDecision(
    'Bier beim Winterrave für 3 €',
    'entscheidung',
    'Veranstaltungen',
    2,
    { note: 'Absprache im Barteam' },
    'Gilt für Flaschenbier; alkoholfreie Getränke bleiben bei 2 €.',
  );
  db.decisions.find((d) => d.id === bier)!.event_id = rave;
  for (const by of ['LE', 'SA', 'RA', 'JU']) know.voteDecision(as(by, 1), bier, 'bestaetigt');
  const lager = addDecision(
    'Lager nur noch zu zweit öffnen',
    'entscheidung',
    'Lager & Material',
    4,
    { note: 'Vorschlag aus der Lager-AG' },
    'Wer ins Lager geht, kommt mindestens zu zweit – wegen der schweren Boxen und der Treppe.',
  );
  know.voteDecision(as('KI', 3), lager, 'bestaetigt');
  know.voteDecision(as('NO', 2), lager, 'widerspruch');

  // Rückmeldungen aus der App (16.5) – die Liste sehen Admins im Profil
  reports.createAppReport(as('SA', 6, '22:10'), {
    kind: 'bug',
    text: 'Ich habe im Termin auf „Komme“ getippt, danach stand da kurz „Komme nicht“. Nach dem Neuladen stimmte es.',
    app_version: '0.7.0',
  });
  reports.createAppReport(as('JU', 1, '09:30'), {
    kind: 'wunsch',
    text: 'Ich möchte Aufgaben nach Frist sortieren können, damit ich vor dem Plenum sehe, was dringend ist.',
    app_version: '0.8.0',
  });
  addDecision('Unser Code of Conduct gilt für alle Veranstaltungen', 'fakt', 'Organisatorisches', 60, {
    document: coc,
  });
  const schluessel = addDecision('Lagerschlüssel hängt im Kasten am Tor', 'fakt', 'Lager & Material', 150, {
    note: 'Aushang im Lager',
  });
  know.revokeDecision(as('KI', 12), schluessel, 'Kasten wurde abgebaut', decisionVersion(schluessel));

  const addQuestion = (
    by: string,
    daysAgo: number,
    title: string,
    topicName: string,
    urgency: Priority,
    opts: { event?: string; description?: string } = {},
  ) =>
    know.createQuestion(as(by, daysAgo, '21:12'), {
      title,
      topic_id: topic[topicName]!.id,
      urgency,
      event_id: opts.event ?? null,
      description: opts.description ?? null,
    }).id;
  addQuestion('JU', 3, 'Machen wir an Silvester eine Party?', 'Veranstaltungen', 'hoch', {
    description:
      'Das Lager wäre frei. Wir müssten bis Ende Oktober wissen, ob wir einladen – sonst ist zu wenig Vorlauf für Getränke und Awareness.',
  });
  addQuestion('SA', 5, 'Brauchen wir für den Winterrave eine Garderobe?', 'Veranstaltungen', 'mittel', {
    event: rave,
  });
  addQuestion('NO', 16, 'Wechseln wir zu einer anderen Bank?', 'Verein', 'niedrig');
  const geklaert = addQuestion(
    'RA',
    40,
    'Wie viele Leute braucht das Awareness-Team?',
    'Veranstaltungen',
    'mittel',
  );
  const frage = db.questions.find((q) => q.id === geklaert)!;
  frage.status = 'geklaert';
  frage.answer = 'Mindestens 4 Personen pro Veranstaltung.';
  frage.answered_in_plenum_id = plenumSept;
  db.decisions.find((d) => d.id === awareness4)!.source_question_id = geklaert;

  // Phase 4: der Winterrave mit Detailbereichen wie im Prototyp (D-Event)
  const raveRow = db.events.find((e) => e.id === rave)!;
  raveRow.setup_at = new Date(new Date(raveRow.starts_at).getTime() - 6 * 3_600_000).toISOString();
  const detail = (field: string, value: unknown, by = 'LE', daysAgo = 20) =>
    events.updateEventDetail(as(by, daysAgo), rave, { field, value, version: raveRow.version });
  detail('location.name', 'Halle am Kanal');
  detail('location.address', 'Kanalstraße 12');
  detail('location.capacity', 300);
  detail('location.confirmation', 'angefragt');
  detail('bar.mode', 'selbst');
  detail('bar.drinks_planning', 'Liste im Drive');
  detail('entry.mode', 'spende');
  detail('entry.price', '5–10 €');
  detail('numbers.expected_visitors', 250);
  for (const [act_name, act_type, status, fee_status, fee, tech] of [
    ['DJ Hyphae', 'dj', 'zugesagt', 'ja', '150 €', 'CDJs vorhanden'],
    ['Sporenflug b2b Nebelkind', 'dj', 'angefragt', 'nein', null, null],
    ['Live-Act (noch offen)', 'band', 'angefragt', 'offen', null, 'Technik klären'],
  ] as const)
    events.addBooking(as('MO', 18), rave, {
      act_name,
      act_type,
      status,
      fee_status,
      fee,
      tech_requirements: tech,
    });
  events.addLead(as('LE', 30), rave, member.LE!.id);
  events.addLead(as('LE', 30), workshop, member.KI!.id);

  // Vorlagen (3.12): Startinhalt aus src/shared/seed/event-templates.yaml
  seedTemplates(db, at(100));

  // Kooperationspartner (3.5): zentral gespeichert, an mehreren Veranstaltungen beteiligt
  const sporenflug = partners.createPartner(as('LE', 120), {
    name: 'Kollektiv Sporenflug',
    kind: 'Kollektiv',
    description: 'Befreundetes DJ-Kollektiv, macht Musik und Teile der Deko.',
    contact_person: 'Ari',
    email: 'kontakt@sporenflug.example.org',
    internal_contact_member_id: member.RA!.id,
  }).id;
  const druckerei = partners.createPartner(as('SA', 60), {
    name: 'Druckerei Tinte & Tusche',
    kind: 'Firma',
    contact_person: 'Frau Berg',
    phone: '0123 456789',
    internal_contact_member_id: member.SA!.id,
  }).id;
  partners.createPartner(as('KI', 40), { name: 'Nachbarschaftsverein Hafenviertel', kind: 'Verein' });
  partners.linkPartner(as('LE', 25), rave, sporenflug, 'Line-up und Deko');
  partners.linkPartner(as('LE', 70), soli, sporenflug, 'Gastgebende');
  partners.linkPartner(as('LE', 90), hoffest, sporenflug, null);
  partners.linkPartner(as('SA', 10), rave, druckerei, 'Flyer');

  // Phase 2: wer wie erreichbar ist, und die letzten Jobläufe (alle 15 Minuten)
  db.notification_outbox = [];
  MEMBERS.forEach(([short], i) => {
    const m = member[short]!;
    if (!m.active) return;
    if (i >= 2)
      db.push_subscriptions.push({
        id: fixedId(3, i),
        member_id: m.id,
        endpoint: `testgeraet-${short.toLowerCase()}`,
        created_at: founded,
      });
    if (i < 8)
      db.telegram_links.push({ member_id: m.id, chat_id: `chat-${short.toLowerCase()}`, linked_at: founded });
  });
  for (const minutesAgo of [66, 51, 36, 21, 6]) runJob(db, new Date(now.getTime() - minutesAgo * 60_000));

  db.undo = [];
  return db;
}
