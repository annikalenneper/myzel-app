import { useEffect, useState } from 'react';

/** Die aktuelle Zeit, die alle halbe Minute weiterläuft – z. B. damit „Abschließen ab 19 Uhr“ von selbst freigeht. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
