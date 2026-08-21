/* speech.js — speech-to-text (Web Speech API) AND text-to-speech (SpeechSynthesis).
 * STT powers the composer mic and the call screen; TTS gives the coach a voice.
 * Both require a secure context (https or localhost) for the microphone.
 * TTS quality depends on the voices installed in the OS/browser, so the user can
 * pick one in Settings; otherwise we choose the best-sounding available voice. */
(function () {
  'use strict';
  window.App = window.App || {};

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var available = !!SR;

  var synth = window.speechSynthesis || null;
  var ttsAvailable = !!synth;
  var voiceListeners = [];

  function listVoices() { return synth ? (synth.getVoices() || []) : []; }

  // A "network"/remote voice generally sounds far better than an on-device one.
  // On Android the good Google voices (e.g. en-us-x-iom-network) are exposed with
  // localService === false but have no quality keyword in their name — so we must
  // detect them via localService / the voiceURI, not just the display name.
  function isNetwork(v) {
    if (v && v.localService === false) return true;
    var id = (v && (v.voiceURI || v.name)) || '';
    return /network/i.test(id);
  }

  // Rank installed voices: prefer network voices, then modern
  // natural/neural/enhanced/Google voices, then any US English, then any English.
  function bestVoice(list) {
    var en = list.filter(function (v) { return /^en/i.test(v.lang); });
    var pool = en.length ? en : list;
    function pick(re) { return pool.filter(function (v) { return re.test(v.name || ''); })[0]; }
    var network = pool.filter(isNetwork);
    function pickNet(re) { return network.filter(function (v) { return re.test(v.name || v.voiceURI || ''); })[0]; }
    return pickNet(/natural|neural|enhanced|premium|google/i) ||
           network.filter(function (v) { return /en[-_]US/i.test(v.lang); })[0] ||
           network[0] ||
           pick(/natural|neural|enhanced|premium/i) ||
           pick(/google/i) ||
           pick(/samantha|aria|jenny|libby|sonia/i) ||
           pool.filter(function (v) { return /en[-_]US/i.test(v.lang); })[0] ||
           pool[0] || list[0] || null;
  }

  function resolveVoice() {
    var list = listVoices();
    if (!list.length) return null;
    var prefName = App.Store ? App.Store.getVoice() : '';
    if (prefName) {
      var found = list.filter(function (v) { return v.name === prefName; })[0];
      if (found) return found;
    }
    return bestVoice(list);
  }

  function notifyVoices() { voiceListeners.forEach(function (cb) { try { cb(); } catch (e) {} }); }
  function onVoices(cb) { voiceListeners.push(cb); if (listVoices().length) cb(); }

  // Android Chrome often returns an empty/short list on load and may never fire
  // `onvoiceschanged`. Poll a few seconds until the count stabilises, notifying
  // listeners whenever it grows so the picker re-populates.
  var lastVoiceCount = -1;
  function pollVoices(triesLeft) {
    var n = listVoices().length;
    if (n !== lastVoiceCount) { lastVoiceCount = n; if (n) notifyVoices(); }
    if (triesLeft > 0) setTimeout(function () { pollVoices(triesLeft - 1); }, 500);
  }

  if (synth) {
    try { synth.getVoices(); } catch (e) {}            // kick off async load
    try { synth.onvoiceschanged = notifyVoices; } catch (e) {}
    pollVoices(12);                                    // ~6s of retries for slow engines
  }

  // Force a fresh enumeration (e.g. when the Settings screen opens).
  function refreshVoices() { try { synth && synth.getVoices(); } catch (e) {} notifyVoices(); }

  /* Recognizer. With opts.continuous the mic stays open across utterances, so there
   * is no teardown/restart gap where speech is lost; otherwise it auto-ends on silence.
   * onFinal fires once per NEWLY finalised segment — never the running total — so
   * callers can append its argument safely.
   * cb: { onStart, onInterim(text), onFinal(text), onError(code), onEnd(finalText) } */
  function create(cb, opts) {
    cb = cb || {};
    opts = opts || {};
    if (!SR) return null;
    var rec = new SR();
    rec.lang = (App.Store ? App.Store.getLang() : 'en-US');
    rec.interimResults = true;
    rec.continuous = !!opts.continuous;
    rec.maxAlternatives = 1;

    var finalText = '';
    var emitted = 0;   // result slots already handed to onFinal

    // Engines disagree about what a "final" result contains. Chrome on Android
    // emits CUMULATIVE finals at successive indices — "I", "I did", "I did 20" —
    // so taking each new index verbatim replays the whole utterance and, in a
    // call, fires one LLM turn per word. Others emit only the new fragment.
    //
    // Compare each final against the PREVIOUS final, not against the whole
    // session transcript: in a continuous session e.results keeps growing across
    // utterances, so a session-wide comparison fails to spot cumulative growth
    // once a second utterance begins.
    var prevFinal = '';
    function delta(prev, next) {
      var p = prev.trim(), n = next.trim();
      if (!n) return '';
      if (!p) return n;
      var lp = p.toLowerCase(), ln = n.toLowerCase();
      if (ln === lp) return '';                                    // repeated verbatim
      if (ln.indexOf(lp) === 0) return n.slice(p.length).trim();   // cumulative growth
      return n;                                                    // a new fragment
    }

    rec.onstart = function () {
      finalText = ''; emitted = 0; prevFinal = '';
      if (cb.onStart) cb.onStart();
    };
    rec.onresult = function (e) {
      var interim = '', fresh = '';
      for (var i = 0; i < e.results.length; i++) {
        var r = e.results[i];
        if (r.isFinal) {
          if (i >= emitted) {
            var t = r[0].transcript;
            var add = delta(prevFinal, t);
            if (add) fresh += (fresh ? ' ' : '') + add;
            prevFinal = t;
            emitted = i + 1;
          }
        } else {
          interim += r[0].transcript;
        }
      }
      if (fresh) finalText += (finalText ? ' ' : '') + fresh;
      if (interim && cb.onInterim) cb.onInterim(interim);
      if (fresh && cb.onFinal) cb.onFinal(fresh.trim());
    };
    rec.onerror = function (e) { if (cb.onError) cb.onError((e && e.error) || 'speech_error'); };
    rec.onend = function () { if (cb.onEnd) cb.onEnd(finalText.trim()); };
    return rec;
  }

  /* Speak one chunk of text. Utterances queue inside the browser, so calling
   * speak() repeatedly plays them in order. cb: { onstart, onend } */
  function speak(text, cb) {
    cb = cb || {};
    text = (text || '').trim();
    if (!synth || !text) { if (cb.onend) cb.onend(); return null; }
    var u = new SpeechSynthesisUtterance(text);
    var v = resolveVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    u.onstart = function () { if (cb.onstart) cb.onstart(); };
    u.onend = function () { if (cb.onend) cb.onend(); };
    u.onerror = function () { if (cb.onend) cb.onend(); };
    try { synth.speak(u); } catch (e) { if (cb.onend) cb.onend(); }
    return u;
  }

  function cancelSpeech() { if (synth) { try { synth.cancel(); } catch (e) {} } }

  App.Speech = {
    available: available,           // STT available
    ttsAvailable: ttsAvailable,     // TTS available
    secureContext: !!window.isSecureContext,
    create: create,
    speak: speak,
    cancelSpeech: cancelSpeech,
    listVoices: listVoices,         // for the Settings picker
    onVoices: onVoices,             // fires when the async voice list is ready
    refreshVoices: refreshVoices,   // re-enumerate (Android workaround)
    isNetwork: isNetwork            // true for higher-quality remote voices
  };
})();
