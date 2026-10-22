// Startinhalt der Vorlagen (src/shared/seed/event-templates.yaml) in die Datenbank – einmalig, solange es noch keine
// Vorlagen gibt: `npm run db:seed-templates` mit DATABASE_URL aus der .env. Die Datei wird gegen das Schema geprüft.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { templateSeedFileSchema } from '../../src/shared/schema';
import { database } from '../db/connection';
import { seedTemplates } from './templates';

const file = join(import.meta.dirname, '..', '..', 'src', 'shared', 'seed', 'event-templates.yaml');
const seed = templateSeedFileSchema.safeParse(parseYaml(readFileSync(file, 'utf8')));
if (!seed.success)
  throw new Error(`event-templates.yaml passt nicht zum Schema: ${seed.error.issues[0]?.message}`);
const db = database();
const count = await db.transaction().execute((trx) => seedTemplates(trx, seed.data, new Date()));
await db.destroy();
console.log(count ? `${count} Vorlagenaufgaben angelegt.` : 'Es gibt schon Vorlagen – nichts geändert.');
