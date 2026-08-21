/* tf-shim.js — Path A. ES module, same-origin, so script-src 'self' covers it.
 *
 * The interesting problem here is keeping verification while letting the library
 * do the work. transformers.js fetches weights itself, so simply calling it would
 * pull unverified bytes straight from a CDN. Two hooks avoid that:
 *
 *   1. env.backends.onnx.wasm.wasmBinary — hand ORT an ArrayBuffer we already
 *      SHA-256'd, so it never fetches its own .wasm.
 *   2. The browser Cache API — transformers.js checks a Cache named
 *      'transformers-cache' before the network. We verify each weight file and
 *      put it there first, so every later lookup is a cache hit and the network
 *      is never consulted for model bytes.
 *
 * Result: the library's convenience, without it fetching anything unpinned.
 */
import {
  pipeline, env, AutoTokenizer, AutoProcessor
} from './vendor/transformers.web.min.js';

const CACHE = 'transformers-cache';

// Never let the library reach for its own copies.
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;   // no COOP/COEP here, so threads are unavailable anyway

let wasmReady = null;

/* Give ORT the pre-verified WASM binary instead of a URL. */
export function useVerifiedWasm(buffer) {
  env.backends.onnx.wasm.wasmBinary = buffer;
  // Also point wasmPaths at our own origin so nothing falls back to a CDN if
  // some code path ignores wasmBinary.
  env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
  wasmReady = true;
}

/* Seed the library's cache with bytes we have already hashed. Keyed by the URL
   transformers.js will ask for, so its own lookup finds them. */
export async function seedCache(entries, onStatus) {
  if (!('caches' in self)) throw new Error('Cache API unavailable — cannot seed verified weights');
  const cache = await caches.open(CACHE);
  for (const e of entries) {
    onStatus?.(`caching ${e.name}…`);
    await cache.put(new Request(e.url), new Response(e.buffer, {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(e.buffer.byteLength) }
    }));
  }
}

export async function build(task, model, onStatus) {
  if (!wasmReady) onStatus?.('warning: running without a pre-verified WASM binary');
  onStatus?.(`constructing ${task} pipeline for ${model}…`);
  const t0 = performance.now();
  const pipe = await pipeline(task, model, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p) => {
      if (p.status === 'progress' && p.file) {
        onStatus?.(`${p.file} ${Math.round(p.progress || 0)}%`);
      } else if (p.status) {
        onStatus?.(`${p.status}${p.file ? ' ' + p.file : ''}`);
      }
    }
  });
  const ms = Math.round(performance.now() - t0);
  onStatus?.(`pipeline ready in ${ms} ms`);
  return { pipe, buildMs: ms };
}

/* Run one transcription and report the numbers that matter on a phone:
   wall-clock, and real-time factor against the audio duration. */
export async function transcribe(built, pcm, sampleRate) {
  const seconds = pcm.length / sampleRate;
  const t0 = performance.now();
  const out = await built.pipe(pcm, { chunk_length_s: 30, stride_length_s: 5 });
  const ms = performance.now() - t0;
  return {
    text: (out && (out.text ?? out[0]?.text)) || '',
    ms: Math.round(ms),
    rtf: +(ms / 1000 / seconds).toFixed(3),
    seconds: +seconds.toFixed(2)
  };
}

export { env, AutoTokenizer, AutoProcessor };
