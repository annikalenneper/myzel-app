// Anbindung ans echte Backend: Lesen meldet sich nicht bei den Ansichten (sonst lädt die Sitzung endlos neu),
// Schreiben schon; Fehler des Servers kommen als dieselben AppErrors wie in der Testdaten-Schicht.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../shared/errors';
import { createRemoteApi } from './remoteApi';

const reply = (body: unknown) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Remote-Schnittstelle', () => {
  it('Lesen löst kein Neuladen aus, Schreiben schon', async () => {
    const fetchMock = reply({ result: { state: 'anonymous' } });
    vi.stubGlobal('fetch', fetchMock);
    const api = createRemoteApi({ supabaseUrl: 'https://x.supabase.co', anonKey: 'k', apiBase: '/api' });
    const listener = vi.fn();
    api.subscribe(listener);
    expect(await api.getSession()).toEqual({ state: 'anonymous' });
    await api.listTasks();
    expect(listener).not.toHaveBeenCalled();
    await api.createTopic({ name: 'Neu' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      '/api/getSession',
      '/api/listTasks',
      '/api/createTopic',
    ]);
  });

  it('Fehler des Servers werden zu AppErrors mit deutschem Satz', async () => {
    vi.stubGlobal(
      'fetch',
      reply({ error: { code: 'conflict', message: 'Wurde inzwischen von Lea geändert.' } }),
    );
    const api = createRemoteApi({ supabaseUrl: 'https://x.supabase.co', anonKey: 'k' });
    const error = await api.listTasks().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'conflict', message: 'Wurde inzwischen von Lea geändert.' });
  });
});
