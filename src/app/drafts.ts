// Lokaler Entwurf langer Texte (7.3): geht bei Netzabbruch oder Neuladen nicht verloren.
const key = (name: string) => `myzel:entwurf:${name}`;

export function readDraft(name: string): string | null {
  try {
    return window.localStorage.getItem(key(name));
  } catch {
    return null;
  }
}

export function writeDraft(name: string, value: string): void {
  try {
    window.localStorage.setItem(key(name), value);
  } catch {
    // Speicher voll oder gesperrt: der Text bleibt wenigstens im Feld stehen
  }
}

export function clearDraft(name: string): void {
  try {
    window.localStorage.removeItem(key(name));
  } catch {
    // nichts zu tun
  }
}
