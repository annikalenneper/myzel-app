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
  const link = new URL(event.notification.data?.link || '/', self.location.origin);
  // nur Ansichten der App, nie eine fremde Seite
  const target = link.origin === self.location.origin ? link.href : self.location.origin + '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      // ein Fenster, das der Service Worker nicht steuert, lässt sich nicht umleiten – dann ein neues öffnen
      if (open)
        return open
          .focus()
          .then(() => open.navigate(target))
          .catch(() => self.clients.openWindow(target));
      return self.clients.openWindow(target);
    }),
  );
});
