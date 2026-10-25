const CACHE_NAME = 'interactive-exhibition-v2';
const CACHE_PREFIX = 'interactive-exhibition-';

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            cache.addAll([
                './',
                './manifest.json',
                './icon-192.png',
                './icon-512.png',
                './og-image.jpg'
            ])
        )
    );

    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key =>
                        key.startsWith(CACHE_PREFIX) &&
                        key !== CACHE_NAME
                    )
                    .map(key => caches.delete(key))
            )
        )
    );

    self.clients.claim();
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        fetch(event.request).catch(async () => {
            const cache = await caches.open(CACHE_NAME);
            return await cache.match(event.request) ||
                Response.error();
        })
    );
});
