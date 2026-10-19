// „Rückgängig“ (WF-ALL-02): so lange nimmt der Server es an; die Leiste in der App ist kürzer sichtbar.
// Der Joblauf verschickt Nachrichten erst danach, damit ein „Rückgängig“ sie noch zurückziehen kann.
export const UNDO_WINDOW_MS = 30_000;
