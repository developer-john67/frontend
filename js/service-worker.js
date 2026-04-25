const CACHE_NAME = 'dropship-v3';
const STATIC_ASSETS = [
    '/',
    '/html/index.html',
    '/html/checkout.html',
    '/html/products.html',
    '/html/account.html',
    '/html/cart.html',
    '/manifest.json',
    '/css/style.css',
    '/js/main.js',
    '/js/api.js',
    '/js/account.js',
    '/js/help.js',
    '/images/logo.svg',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

const CACHE_STRATEGIES = {
    CACHE_FIRST: 'cache-first',
    NETWORK_FIRST: 'network-first',
    STALE_WHILE_REVALIDATE: 'stale-while-revalidate'
};

function log(msg, data) {
    console.log(`[SW] ${msg}`, data || '');
}

self.addEventListener('install', (event) => {
    log('Installing service worker v3...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                log('Caching static assets');
                // Use addAll but don't fail if one asset is missing
                return Promise.allSettled(
                    STATIC_ASSETS.map(url => cache.add(url).catch(err => log(`Failed to cache: ${url}`, err)))
                );
            })
            .then(() => {
                log('Install complete, skipping waiting');
                return self.skipWaiting();
            })
    );
});

self.addEventListener('activate', (event) => {
    log('Activating service worker v3...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => {
                        log(`Deleting old cache: ${name}`);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            log('Activation complete, claiming clients');
            return self.clients.claim();
        })
    );
});

function fetchWithCache(request, strategy = CACHE_STRATEGIES.NETWORK_FIRST) {
    return new Promise((resolve, reject) => {
        if (strategy === CACHE_STRATEGIES.CACHE_FIRST) {
            caches.match(request).then((cachedResponse) => {
                if (cachedResponse) {
                    return resolve(cachedResponse);
                }
                fetch(request).then((response) => {
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseClone);
                        });
                    }
                    resolve(response);
                }).catch(reject);
            });
        } else if (strategy === CACHE_STRATEGIES.NETWORK_FIRST) {
            fetch(request).then((response) => {
                if (response.ok) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseClone);
                    });
                }
                resolve(response);
            }).catch(() => {
                caches.match(request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return resolve(cachedResponse);
                    }
                    reject(new Error('No cache available'));
                });
            });
        } else if (strategy === CACHE_STRATEGIES.STALE_WHILE_REVALIDATE) {
            caches.match(request).then((cachedResponse) => {
                const fetchPromise = fetch(request).then((response) => {
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseClone);
                        });
                    }
                    return response;
                });

                // Return cached immediately, update in background
                if (cachedResponse) {
                    resolve(cachedResponse);
                    return;
                }

                // No cache — wait for network
                fetchPromise.then(resolve).catch(reject);
            });
        }
    });
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Skip chrome-extension and non-http requests
    if (!url.protocol.startsWith('http')) {
        return;
    }

    // API calls — always network first, short circuit if offline
    if (url.pathname.startsWith('/api/') || url.hostname !== self.location.hostname) {
        if (url.hostname === 'cdnjs.cloudflare.com') {
            // CDN assets — cache first
            event.respondWith(fetchWithCache(event.request, CACHE_STRATEGIES.CACHE_FIRST));
        }
        // Let API calls go through without SW interference
        return;
    }

    // JS, CSS, JSON — stale while revalidate (fast load + background update)
    if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.json')) {
        event.respondWith(fetchWithCache(event.request, CACHE_STRATEGIES.STALE_WHILE_REVALIDATE));
        return;
    }

    // Images — cache first (they rarely change)
    if (url.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp|ico)$/)) {
        event.respondWith(fetchWithCache(event.request, CACHE_STRATEGIES.CACHE_FIRST));
        return;
    }

    // HTML pages — network first (always get latest content)
    event.respondWith(fetchWithCache(event.request, CACHE_STRATEGIES.NETWORK_FIRST));
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        log('Skip waiting triggered by client');
        self.skipWaiting();
    }
});