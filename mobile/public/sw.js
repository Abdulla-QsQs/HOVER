const CACHE_NAME = "hover-mobile-v1";
const APP_SHELL = ["/", "/manifest.webmanifest", "/assets/hover/icon.png", "/assets/hover/starfield.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))),
  );
});

self.addEventListener("push", (event) => {
  const data = event.data?.json?.() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || "HOVER reminder", {
      body: data.body || "A reminder is ready.",
      icon: "/assets/hover/icon.png",
      badge: "/assets/hover/icon.png",
      tag: data.tag || "hover-reminder",
      renotify: true,
      data: { url: data.url || "/?screen=planner" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/?screen=planner";
  event.waitUntil(self.clients.openWindow(target));
});
