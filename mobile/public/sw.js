const CACHE_NAME = "hover-mobile-v3";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/assets/hover/icon.png",
  "/assets/hover/icon-192.png",
  "/assets/hover/icon-maskable.png",
  "/assets/hover/icon-maskable-192.png",
  "/assets/hover/apple-touch-icon.png",
  "/assets/hover/starfield.png",
];

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
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/").then((cached) => cached || Response.error())));
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || Response.error())),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json?.() || {};
  } catch {
    data = { title: "HOVER reminder", body: event.data?.text?.() || "A reminder is ready." };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "HOVER reminder", {
      body: data.body || "A reminder is ready.",
      icon: "/assets/hover/icon-maskable.png",
      badge: "/assets/hover/icon-maskable-192.png",
      tag: data.tag || "hover-reminder",
      renotify: true,
      requireInteraction: true,
      timestamp: Date.now(),
      data: { url: data.url || "/?screen=planner" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/?screen=planner";
  event.waitUntil((async () => {
    const targetUrl = new URL(target, self.location.origin).toString();
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(targetUrl);
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl);
  })());
});
