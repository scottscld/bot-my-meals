const CACHE = "supper-shell-v6";
const SHELL = ["/", "/week", "/list", "/settings", "/login", "/setup", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  // House documents are no-store. A rejected precache must not leave the old worker in control.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          SHELL.map((path) =>
            fetch(path)
              .then((response) => {
                const cacheControl = response.headers.get("cache-control") || "";
                if (!response.ok || /no-store|no-cache/i.test(cacheControl)) return;
                return cache.put(path, response);
              })
              .catch(() => {}),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // Let the browser load pages itself so a saved shell cannot hide new House UI.
  if (event.request.mode === "navigate") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/week"))),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  const title = data.title || "Bot My Meals";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    tag: data.tag,
    icon: "/brand/icon-chef-bot-only-192.png",
    badge: "/brand/icon-chef-bot-only-192.png",
    data: { url: data.url || "/week" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/week", self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) { await c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});
