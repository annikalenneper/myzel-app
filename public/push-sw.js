/* global self, URL */
// Web-Push im Service Worker (6.3): Nachricht anzeigen; Tippen öffnet die Zielansicht in der App (WF-ALL-04).
// Wird über workbox.importScripts in den generierten Service Worker geladen (vite.config.ts).
self.addEventListener('push', (event) => {
  let data = { title: 'Myzel', body: '', link: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    data.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { link: data.link },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.link || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.focus().then(() => open.navigate(target));
      return self.clients.openWindow(target);
    }),
  );
});
