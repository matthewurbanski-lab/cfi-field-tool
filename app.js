// sw.js — CFI Field Tool
// Network-first for HTML so the app updates reliably.
// Cache-first for static assets so it still works offline.

const CACHE_VERSION = "v3";
const CACHE_NAME = `cfi-field-tool-${CACHE_VERSION}`;

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./decision-tree.json",
  "./products.json",
  "./arscite-objects.json",
  "./cheat-sheet.md",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// Install: pre-cache core assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: delete old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - HTML/nav: network-first, fallback to cached index.html
// - Other assets: cache-first, fallback to network
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const accept = req.headers.get("accept") || "";

  const isHtml =
    req.mode === "navigate" ||
    accept.includes("text/html") ||
    req.destination === "document";

  if (isHtml) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Update cached index.html so offline gets the latest
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Optionally cache same-origin GET requests
          try {
            const url = new URL(req.url);
            if (req.method === "GET" && url.origin === self.location.origin) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            }
          } catch (_) {}
          return res;
        });
    })
  );
});