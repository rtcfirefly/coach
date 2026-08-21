/* sw.js — serves the lab's verified model cache to any fetch the page makes.
 *
 * The problem it solves: lab.js downloads a model, SHA-256 verifies it against
 * registry.json and stores it in Cache Storage. But piper-plus (and any other
 * engine) resolves the same URL and fetches it through its own model manager,
 * which knows nothing about that cache. Two consequences, both bad:
 *
 *   1. The 63 MB voice is downloaded TWICE — once to verify, once to use.
 *   2. The bytes that actually reach ONNX Runtime are the second, unverified
 *      copy. The pin gets checked and then bypassed, which is worse than not
 *      pinning at all because it looks rigorous.
 *
 * A service worker is the only place to fix both, because it is the one hook
 * that sees fetches the page did not make itself. Requests whose URL is in the
 * cache are served from it; everything else passes straight through.
 *
 * Deliberately NOT a general offline cache: it never populates itself, only
 * reads what lab.js verified and put there. A miss is a normal network fetch.
 */
const CACHE = 'speech-lab-v1';

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Only model/runtime hosts are worth a cache lookup; page assets are handled
  // by the normal HTTP cache and intercepting them just adds latency.
  const url = new URL(req.url);
  const interesting = /(^|\.)hf\.co$|huggingface\.co$|jsdelivr\.net$/.test(url.hostname);
  if (!interesting) return;

  event.respondWith(
    caches.open(CACHE)
      .then((c) => c.match(req.url))
      .then((hit) => {
        if (hit) {
          // Signal the source so the page can tell a cache hit from a download.
          const h = new Headers(hit.headers);
          h.set('x-lab-cache', 'verified');
          return hit.blob().then((b) => new Response(b, { status: 200, headers: h }));
        }
        return fetch(req);
      })
      .catch(() => fetch(req))
  );
});
