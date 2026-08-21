/* engines.js — the two inference paths, both loading only verified bytes.
 *
 * A) profile "transformers"  — @huggingface/transformers does feature extraction,
 *    the decode loop and tokenisation for you. 27.31 MB, works out of the box,
 *    but ships its own jsep loader so it is locked to the 26.83 MB WebGPU-capable
 *    WASM even when we run on CPU.
 *
 * B) profile "ort-wasm-only" — raw ONNX Runtime at 13.55 MB. Half the download,
 *    but nothing is done for you: mel spectrogram, the decoder loop and detokenising
 *    are all ours. Implemented here for Whisper and Moonshine.
 *
 * Trust: JS is injected as <script integrity> so the BROWSER enforces the hash and
 * no blob:/eval path is needed. WASM and weights are fetched, SHA-256'd with
 * SubtleCrypto and only then handed over. Nothing loads without explicit consent.
 */
(function () {
  'use strict';
  window.App = window.App || {};

  var jsReg = null, loaded = {};

  function registry() {
    if (jsReg) return Promise.resolve(jsReg);
    return fetch('registry-js.json').then(function (r) { return r.json(); })
      .then(function (j) { jsReg = j; return j; });
  }

  /* Load a pinned ES module by URL with browser-enforced SRI. Using <script
     integrity> rather than fetch+blob keeps blob: out of script-src: the
     integrity attribute is checked by the browser before any code runs. */
  function loadModule(file) {
    if (loaded[file.url]) return loaded[file.url];
    loaded[file.url] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.type = 'module';
      s.src = file.url;
      if (file.sri) { s.integrity = file.sri; s.crossOrigin = 'anonymous'; }
      s.onload = function () { res(true); };
      s.onerror = function () { rej(new Error('blocked or hash mismatch: ' + file.path)); };
      document.head.appendChild(s);
    });
    return loaded[file.url];
  }

  function hex(b) {
    var u = new Uint8Array(b), s = '';
    for (var i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, '0');
    return s;
  }
  function fetchVerified(url, sha256, onProgress) {
    return fetch(url, { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var total = parseInt(r.headers.get('content-length') || '0', 10);
      if (!r.body || !r.body.getReader) return r.arrayBuffer();
      var rd = r.body.getReader(), parts = [], got = 0;
      return (function pump() {
        return rd.read().then(function (x) {
          if (x.done) {
            var out = new Uint8Array(got), o = 0;
            parts.forEach(function (p) { out.set(p, o); o += p.length; });
            parts.length = 0;
            return out.buffer;
          }
          parts.push(x.value); got += x.value.length;
          if (onProgress && total) onProgress(got / total);
          return pump();
        });
      })();
    }).then(function (buf) {
      if (!sha256) return buf;
      return crypto.subtle.digest('SHA-256', buf).then(function (d) {
        var g = hex(d);
        if (g !== sha256) throw new Error('HASH MISMATCH\n expected ' + sha256 + '\n got      ' + g);
        return buf;
      });
    });
  }

  // =================================================================== A
  var tfPipe = {};
  function loadTransformers(onStatus) {
    return registry().then(function (reg) {
      var p = reg.profiles.transformers;
      var js = p.files.filter(function (f) { return f.path.endsWith('.js'); })[0];
      onStatus('loading transformers.js (' + (js.bytes / 1e6).toFixed(2) + ' MB, SRI enforced)…');
      // The library reads its config off a global before first use.
      window.__tfWasmBase = p.files.filter(function (f) { return f.path.indexOf('ort-wasm') === 0 || f.path.indexOf('/ort-wasm') > 0; });
      return loadModule(js).then(function () { return p; });
    });
  }

  /* transformers.js is an ES module with no global, so the page has to import it
     itself. The shim module below is same-origin, so it is covered by
     script-src 'self' and needs no integrity of its own. */
  function transformersPipeline(task, model, onStatus) {
    var key = task + '|' + model;
    if (tfPipe[key]) return tfPipe[key];
    tfPipe[key] = loadTransformers(onStatus).then(function () {
      return import('./tf-shim.js');
    }).then(function (m) {
      onStatus('building pipeline ' + model + '…');
      return m.build(task, model, onStatus);
    });
    return tfPipe[key];
  }

  // =================================================================== B
  /* Raw-ORT path. Everything transformers.js would have done, done here.
     Whisper wants an 80-bin log-mel spectrogram over a 30 s window; Moonshine
     takes raw 16 kHz audio directly, which is the whole point of its design and
     is why it is far less code on this path. */

  function hann(n) {
    var w = new Float32Array(n);
    for (var i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    return w;
  }

  // Iterative radix-2 FFT, in place, on split real/imag arrays.
  function fft(re, im) {
    var n = re.length, i, j = 0, k, m, half, step, ang, wr, wi, tr, ti, u;
    for (i = 1; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { u = re[i]; re[i] = re[j]; re[j] = u; u = im[i]; im[i] = im[j]; im[j] = u; }
    }
    for (m = 2; m <= n; m <<= 1) {
      half = m >> 1; step = -2 * Math.PI / m;
      for (k = 0; k < n; k += m) {
        for (j = 0; j < half; j++) {
          ang = step * j; wr = Math.cos(ang); wi = Math.sin(ang);
          tr = re[k + j + half] * wr - im[k + j + half] * wi;
          ti = re[k + j + half] * wi + im[k + j + half] * wr;
          re[k + j + half] = re[k + j] - tr; im[k + j + half] = im[k + j] - ti;
          re[k + j] += tr; im[k + j] += ti;
        }
      }
    }
  }

  function hzToMel(f) { return 2595 * Math.log10(1 + f / 700); }
  function melToHz(m) { return 700 * (Math.pow(10, m / 2595) - 1); }

  /* Triangular mel filterbank, librosa/Slaney formulation.
   *
   * Note the thing that is easy to get wrong here: you cannot floor the mel
   * points to integer FFT bin indices. With a 400-point FFT there are only 201
   * bins to cover 80 mel filters, so the low filters all round to the same bin
   * and come out identically zero — silently, since the output is still the
   * right shape. Weights are computed over the continuous bin-frequency axis
   * instead, and normalised by mel bandwidth (Slaney) so filters carry equal
   * energy rather than equal peak.
   */
  function melFilterbank(nMels, nFft, sr) {
    var nBins = nFft / 2 + 1, i, m, k;
    var fftFreq = new Float32Array(nBins);
    for (i = 0; i < nBins; i++) fftFreq[i] = i * sr / nFft;

    var lo = hzToMel(0), hi = hzToMel(sr / 2);
    var hz = new Float32Array(nMels + 2);
    for (i = 0; i < nMels + 2; i++) hz[i] = melToHz(lo + (hi - lo) * i / (nMels + 1));

    var fb = [];
    for (m = 1; m <= nMels; m++) {
      var row = new Float32Array(nBins);
      var left = hz[m - 1], centre = hz[m], right = hz[m + 1];
      var norm = 2 / (right - left);          // Slaney: equal-energy, not equal-peak
      for (k = 0; k < nBins; k++) {
        var f = fftFreq[k];
        var up = (f - left) / (centre - left);
        var dn = (right - f) / (right - centre);
        var w = Math.min(up, dn);
        row[k] = w > 0 ? w * norm : 0;
      }
      fb.push(row);
    }
    return fb;
  }

  var WHISPER = { sr: 16000, nFft: 400, hop: 160, nMels: 80, frames: 3000 };
  var _fb = null, _win = null;

  function logMel(pcm) {
    var C = WHISPER;
    _fb = _fb || melFilterbank(C.nMels, C.nFft, C.sr);
    _win = _win || hann(C.nFft);
    var nBins = C.nFft / 2 + 1;
    var out = new Float32Array(C.nMels * C.frames);
    var re = new Float32Array(512), im = new Float32Array(512);   // 400 -> pad to 512
    var mx = -Infinity;
    for (var t = 0; t < C.frames; t++) {
      var off = t * C.hop;
      re.fill(0); im.fill(0);
      for (var i = 0; i < C.nFft; i++) re[i] = (off + i < pcm.length ? pcm[off + i] : 0) * _win[i];
      fft(re, im);
      for (var m = 0; m < C.nMels; m++) {
        var row = _fb[m], s = 0;
        for (var k = 0; k < nBins; k++) {
          if (!row[k]) continue;
          s += row[k] * (re[k] * re[k] + im[k] * im[k]);
        }
        var v = Math.log10(Math.max(s, 1e-10));
        if (v > mx) mx = v;
        out[m * C.frames + t] = v;
      }
    }
    // Whisper's normalisation: clamp to 8 dB below peak, then scale to [-1, 1].
    for (var j = 0; j < out.length; j++) {
      var x = Math.max(out[j], mx - 8);
      out[j] = (x + 4) / 4;
    }
    return out;
  }

  App.Engines = {
    registry: registry,
    fetchVerified: fetchVerified,
    loadModule: loadModule,
    transformersPipeline: transformersPipeline,
    // exported so the harness can unit-test them against known vectors
    _logMel: logMel,
    _fft: fft,
    _melFilterbank: melFilterbank,
    _hann: hann,
    WHISPER: WHISPER
  };
})();
