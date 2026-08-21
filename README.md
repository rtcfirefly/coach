# Fitness Coach

A voice-and-text workout logger with an AI coach. Vanilla JS, no build step, no
backend, no dependencies. You bring your own Anthropic API key.

Open `index.html` from any static host. That is the whole deployment.

## How it works

Tell the coach what you did — by typing or by voice call — and it logs it as
structured data through tool calls, then answers with coaching grounded in your
history. It keeps a rolling summary so context stays small as history grows.

| file | |
|---|---|
| `js/store.js` | localStorage persistence, quota pruning, backup/restore |
| `js/api.js` | Anthropic Messages API: SSE streaming, the tool-use loop, history import |
| `js/speech.js` | Web Speech recognition and synthesis, voice ranking |
| `js/call.js` | Hands-free call: barge-in, echo suppression, utterance buffering |
| `js/vad.js` | Voice activity detection over its own `getUserMedia` stream |
| `js/videos.js` | Exercise-name detection and pinned YouTube demos |
| `js/ui.js` | Screens, chat rendering, timer, modals |
| `js/app.js` | Bootstrap and session orchestration |

## Security posture

**Your API key is in `localStorage` and goes straight to Anthropic from the
browser** via the `anthropic-dangerous-direct-browser-access` header. There is no
server to hold it. Use this on a personal device with a scoped, low-limit key.

Given that, the app is built so a bug cannot make it worse:

- **CSP is `default-src 'none'` with `connect-src` limited to `api.anthropic.com`.**
  A successful injection still has nowhere to send the key.
- **No `innerHTML` on any user- or model-controlled string.** Everything renders
  through `textContent`; the highlighter builds nodes with `createTextNode`.
- **`base-uri 'none'`, `form-action 'none'`**, no inline scripts.
- Backups exclude the key and are validated before anything is written.

## `lab/` — the speech test harness

Answers "is on-device speech good enough" with measurements rather than opinion,
on the phone you actually train with. Desktop numbers do not transfer.

- Web Speech recognition scored as **word error rate** against fixed coach
  phrases, quiet and with simulated gym noise
- Every installed system voice, played in sequence, shortlisted and A/B'd
- **Piper** (4 voices) and **Kokoro** (4 voices) running on-device via WASM,
  reporting real-time factor
- VAD meter showing the adaptive noise floor against the speech threshold

Nothing large downloads without explicit consent. Every model file is pinned by
SHA-256 in `lab/registry.json` / `registry-js.json`, verified in the browser
before use, and cached; a service worker serves that verified cache to engine
fetches so nothing unpinned reaches the runtime.

The lab carries its own CSP — it needs `wasm-unsafe-eval` and model hosts in
`connect-src`. The app's CSP is untouched.

## Development

```sh
lab/run-tests.sh          # the whole suite
lab/pin.sh                # re-pin model hashes from Hugging Face metadata
lab/verify-vendor.sh      # check vendored blobs against their pins
lab/fetch-vendor.sh       # restore vendored blobs not kept in git
```

Vendored third-party code lives in `lab/vendor/` as readable ES source with
hashes in `vendor.hash`. Local changes are recorded in `lab/vendor/PATCHES.md`,
so upstream-plus-patches equals what is deployed. One minified bundle is
deliberately not committed — GitHub secret scanning rejects it over a gist URL
embedded in a warning string.
