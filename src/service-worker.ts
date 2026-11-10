/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

/**
 * Keeps the app's own code and icons on the device so it opens instantly, and shows pushed notifications ("something
 * arrived from the PC"). Pages and the API always go to the server: the drawer lives there.
 */

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `drawer-${version}`;
const ASSETS = [...build, ...files.filter((f) => !f.endsWith('.webmanifest'))];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin || !ASSETS.includes(url.pathname)) return;
  event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
});

interface PushMessage {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

sw.addEventListener('push', (event) => {
  let message: PushMessage = {};
  try {
    message = event.data?.json() ?? {};
  } catch {
    message = { body: event.data?.text() };
  }
  event.waitUntil(
    sw.registration.showNotification(message.title ?? 'Drawer', {
      body: message.body ?? '',
      tag: message.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: message.url ?? '/' },
    }),
  );
});

sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string })?.url ?? '/', sw.location.origin).href;
  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === sw.location.origin);
      if (open) return open.navigate(target).then((w) => (w ?? open).focus());
      return sw.clients.openWindow(target);
    }),
  );
});
