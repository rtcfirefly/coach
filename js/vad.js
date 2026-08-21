/* vad.js — voice-activity detection over our own microphone stream.
 *
 * Why this exists: the Web Speech API opens its own microphone and never hands
 * back a MediaStream, so the app cannot apply echo cancellation, cannot measure
 * levels, and cannot tell "the user started talking" from "the coach's voice is
 * coming back through the speaker". call.js compensates with transcript
 * word-overlap scoring, which only works *after* the recognizer has produced
 * text — far too late for a natural barge-in.
 *
 * This module owns a second, independent stream purely for measurement. It gives:
 *   - immediate, acoustic barge-in (energy, not transcript)
 *   - an adaptive noise floor, so a gym is not treated like a quiet room
 *   - a speech/silence signal usable later to gate what gets streamed to a
 *     paid STT vendor, which is the single largest cost lever in a cascade
 *
 * Honest limitation: echoCancellation below applies to THIS stream only. Web
 * Speech's own capture is unaffected, so this improves interruption latency but
 * does not remove echo. That needs Web Speech to be replaced outright.
 */
(function () {
  'use strict';
  window.App = window.App || {};

  // Resolve the worklet against THIS script's URL, not the document's. A page in
  // a subdirectory (lab/) would otherwise ask for lab/js/vad-processor.js.
  var HERE = (document.currentScript && document.currentScript.src) || '';
  var WORKLET = HERE ? HERE.replace(/[^/]*$/, 'vad-processor.js') : 'js/vad-processor.js';

  var ctx = null, stream = null, node = null, src = null;
  var running = false, speaking = false;
  var cbs = {};

  // Tuning. Thresholds are relative to a rolling noise floor, not absolute, so
  // the same numbers work in a quiet bedroom and a loud gym.
  var OPEN_MULT = 3.5;    // speech starts at 3.5x the noise floor
  var CLOSE_MULT = 2.0;   // ...and ends below 2x — hysteresis stops chattering
  var OPEN_MS = 60;       // sustained this long before we call it speech
  var CLOSE_MS = 450;     // silence this long before we call the turn over
  var FLOOR_MIN = 0.001;  // never trust a floor of exactly zero (muted device)

  var floor = 0.01;
  var aboveSince = 0, belowSince = 0;

  function now() { return Date.now(); }

  function onLevel(rms) {
    if (!running) return;

    // Track the noise floor from quiet frames only, so someone talking
    // continuously cannot drag the threshold up over their own voice.
    if (!speaking) floor = Math.max(FLOOR_MIN, floor * 0.95 + rms * 0.05);

    var openAt = floor * OPEN_MULT;
    var closeAt = floor * CLOSE_MULT;

    if (!speaking) {
      if (rms > openAt) {
        if (!aboveSince) aboveSince = now();
        if (now() - aboveSince >= OPEN_MS) {
          speaking = true; belowSince = 0;
          if (cbs.onSpeechStart) cbs.onSpeechStart();
        }
      } else {
        aboveSince = 0;
      }
    } else {
      if (rms < closeAt) {
        if (!belowSince) belowSince = now();
        if (now() - belowSince >= CLOSE_MS) {
          speaking = false; aboveSince = 0;
          if (cbs.onSpeechEnd) cbs.onSpeechEnd();
        }
      } else {
        belowSince = 0;
      }
    }

    if (cbs.onLevel) cbs.onLevel(rms, floor, speaking);
  }

  /* start(callbacks) -> Promise<boolean>. Resolves false (never rejects) when
   * VAD is unavailable — no AudioWorklet, no mic permission, insecure context —
   * so callers can treat it as a pure enhancement and carry on without it. */
  function start(callbacks) {
    cbs = callbacks || {};
    if (running) return Promise.resolve(true);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia ||
        !(window.AudioContext || window.webkitAudioContext)) {
      return Promise.resolve(false);
    }

    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,   // the reason for owning a stream at all
        noiseSuppression: true,
        autoGainControl: true
      }
    }).then(function (s) {
      stream = s;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (!ctx.audioWorklet) throw new Error('no audioWorklet');
      return ctx.audioWorklet.addModule(WORKLET);
    }).then(function () {
      src = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, 'vad-processor');
      node.port.onmessage = function (e) { onLevel(e.data); };
      src.connect(node);
      // Deliberately NOT connected to ctx.destination — routing the mic to the
      // speakers would create the feedback loop this module exists to avoid.
      running = true;
      speaking = false;
      floor = 0.01; aboveSince = 0; belowSince = 0;
      return true;
    }).catch(function () {
      stop();
      return false;
    });
  }

  function stop() {
    running = false;
    speaking = false;
    if (node) { try { node.port.onmessage = null; node.disconnect(); } catch (e) {} node = null; }
    if (src) { try { src.disconnect(); } catch (e) {} src = null; }
    if (stream) {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      stream = null;
    }
    if (ctx) { try { ctx.close(); } catch (e) {} ctx = null; }
  }

  App.Vad = {
    start: start,
    stop: stop,
    isRunning: function () { return running; },
    isSpeaking: function () { return speaking; },
    // Exposed so call.js can widen the gate while the coach is speaking, when
    // residual echo makes false triggers more likely.
    setSensitivity: function (openMult, closeMult) {
      if (openMult > 0) OPEN_MULT = openMult;
      if (closeMult > 0) CLOSE_MULT = closeMult;
    }
  };
})();
