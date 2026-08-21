# Local patches to vendored source

The vendored trees are pinned by SHA-256 in `../registry-js.json`, which records
what npm published. Any file listed here **no longer matches that pin** — the pin
remains the record of upstream, and this file is the record of the difference, so
`upstream + these patches = what is deployed` stays checkable.

## piper-plus/index.js — force English when the voice config has no `language_id_map`

Upstream (v0.6.0):

```js
jsAdapter = await JsG2pAdapter.create(
  jsLanguages,  // undefined when no language_id_map
  this._config.phoneme_id_map,
);
```

Patched:

```js
jsLanguages ?? ['en'],
```

**Why.** `languages` is derived from `this._config.language_id_map` and is
`undefined` when the key is absent — which is the case for every single-language
Piper voice, including `en_US-amy-medium` (verified: the key is not in its
`.onnx.json`). `jsLanguages` is then `undefined`, `JsG2pAdapter.create` passes it
to `G2P.create({languages: undefined})`, which expands to all nine supported
languages. That includes `ja`, so `JapaneseG2P.initialize()` runs and throws
because no `openjtalkModule` was injected — `PiperPlus.initialize()` rejects and
the voice never loads.

There is no app-level way to avoid this: `JsG2pAdapter.create` is called with two
arguments, so the `options` object that would otherwise let `G2P.create` receive
an explicit `languages` never reaches it.

**Scope.** English-only, which is all this project uses. A multilingual voice
supplying a real `language_id_map` is unaffected — `jsLanguages` is then defined
and `??` does not fire.

**Upstream-worthy.** Yes. Defaulting to every language when a config omits an
optional key makes single-language voices fail by default.
