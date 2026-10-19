// Kürzel für die Initialen-Blasen: eindeutig, aus dem Namen vorgeschlagen (3.1)

/** Schlägt ein freies Kürzel vor: erste zwei Buchstaben, sonst erster + ein späterer, sonst mit Ziffer. */
export function suggestShort(name: string, taken: readonly string[]): string {
  const letters = name
    .normalize('NFD')
    .replace(/[^\p{L}]/gu, '')
    .toUpperCase();
  if (!letters) return '';
  const used = new Set(taken.map((t) => t.toUpperCase()));
  const first = letters[0]!;
  const candidates = [letters.slice(0, 2), ...[...letters.slice(2)].map((c) => first + c)];
  for (const c of candidates) if (c.length === 2 && !used.has(c)) return c;
  for (let i = 2; i <= 9; i++) if (!used.has(`${first}${i}`)) return `${first}${i}`;
  return letters.slice(0, 3);
}
