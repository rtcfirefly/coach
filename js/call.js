/* call.js — "phone call to a coach" controller with barge-in.
 * The mic stays open for the whole call. While the coach is speaking, if the user
 * starts talking (and it isn't just the coach's own audio echoing back) we cancel
 * the speech and take their turn. Logging still happens via the log_workout tool. */
(function () {
  'use strict';
  window.App = window.App || {};

  var active = false, muted = false, processing = false;
  var pending = 0;          // outstanding TTS utterances for the current generation
  var gen = 0;              // bumped on every interruption / new turn to void stale callbacks
  var ttsBuf = '', coachText = '';
  var coachWords = {}, coachWordCount = 0;
  var rec = null, restartTimer = null, lastFinal = '';
  var micGen = 0;          // supersedes stale recognizers so their callbacks go inert
  var utterBuf = '', utterTimer = null;
  var UTTER_GAP_MS = 800;  // silence that ends an utterance when VAD cannot tell us
  var lastSpeakEnd = 0;
  var timerInt = null, startTs = 0;
  var interrupted = false, queuedUtterance = null;
  var turnAbort = null;     // AbortController for the in-flight LLM turn

  function S() { return App.Store; }
  function U() { return App.UI; }
  function Sp() { return App.Speech; }

  // Strip markdown/emoji so the TTS doesn't read "asterisk" or choke on symbols.
  var EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍•]/gu;
  function cleanForSpeech(s) {
    return String(s)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(EMOJI_RE, '')
      .replace(/[*_`#>]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // ----- echo / noise filtering -------------------------------------------
  function words(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(function (w) { return w.length >= 2; });
  }
  function setCoachWords(s) {
    coachWords = {};
    var ws = words(s);
    coachWordCount = ws.length;
    ws.forEach(function (w) { coachWords[w] = true; });
  }
  function isEcho(text) {
    if (!coachWordCount) return false;
    var tw = words(text);
    if (!tw.length) return false;
    var hits = 0;
    tw.forEach(function (w) { if (coachWords[w]) hits++; });
    return (hits / tw.length) >= 0.6;
  }
  // Short answers are the most common thing said on a coaching call, and the old
  // "4+ chars or 2+ words" rule silently threw away every one of them ("yes", "no",
  // "ok", "done"). Allow-list them explicitly.
  var SHORT_OK = {
    yes: 1, yeah: 1, yep: 1, yup: 1, ya: 1, sure: 1, ok: 1, okay: 1, k: 1,
    no: 1, nope: 1, nah: 1, not: 1, stop: 1, wait: 1, hold: 1,
    done: 1, next: 1, skip: 1, again: 1, more: 1, less: 1, go: 1, ready: 1,
    hi: 1, hey: 1, what: 1, huh: 1, why: 1, how: 1
  };
  function isMeaningful(text) {
    var t = (text || '').trim();
    if (!t) return false;
    if (SHORT_OK[t.toLowerCase().replace(/[^a-z]/g, '')]) return true;
    return t.length >= 4 || words(t).length >= 2;
  }

  // ----- state / timer ----------------------------------------------------
  function refreshState() {
    U().setCallState(!active ? 'idle' : muted ? 'muted' : processing ? 'thinking'
      : pending > 0 ? 'speaking' : 'listening');
  }
  function fmt(t) { var m = Math.floor(t / 60), s = t % 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
  function startTimer() {
    startTs = Date.now(); U().setCallTimer('00:00');
    timerInt = setInterval(function () { U().setCallTimer(fmt(Math.floor((Date.now() - startTs) / 1000))); }, 1000);
  }
  function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }

  // ----- speaking ---------------------------------------------------------
  function enqueueSpeech(text) {
    if (!active || interrupted) return; // call ended, or user cut in
    text = cleanForSpeech(text || '');
    if (!text) return;
    var g = gen;
    if (pending === 0 && App.Vad) App.Vad.setSensitivity(5.0, 2.5);
    pending++;
    Sp().speak(text, {
      onstart: function () { if (g === gen) refreshState(); },
      onend: function () {
        if (g !== gen) return;
        pending = Math.max(0, pending - 1);
        if (pending === 0) {
          lastSpeakEnd = Date.now();
          if (App.Vad) App.Vad.setSensitivity(3.5, 2.0);   // back to normal
        }
        refreshState();
      }
    });
    refreshState();
  }
  function say(text) {
    setCoachWords(text);
    coachText = text;
    U().addAssistantBubble(cleanForSpeech(text));   // show fixed coach lines in chat
    enqueueSpeech(text);
  }
  function pushSentences(force) {
    if (interrupted) { ttsBuf = ''; return; }
    var re = /[.!?…]+["')\]]*\s/g, lastIndex = 0, m;
    while ((m = re.exec(ttsBuf))) {
      var end = m.index + m[0].length;
      var sentence = ttsBuf.slice(lastIndex, end).trim();
      if (sentence) enqueueSpeech(sentence);
      lastIndex = end;
    }
    ttsBuf = ttsBuf.slice(lastIndex);
    if (force && ttsBuf.trim()) { enqueueSpeech(ttsBuf.trim()); ttsBuf = ''; }
  }
  function onCoachDelta(delta) {
    coachText += delta;
    setCoachWords(coachText);
    U().appendAssistantDelta(delta);     // stream coach reply into the chat (Watch chips appear)
    ttsBuf += delta;
    pushSentences(false);
  }

  // ----- barge-in ---------------------------------------------------------
  function bargeIn() {
    gen++;            // void any in-flight utterance + stream callbacks
    pending = 0;
    ttsBuf = '';
    interrupted = true;   // suppress the rest of the current reply's speech
    if (turnAbort) { try { turnAbort.abort(); } catch (e) {} }  // stop the LLM generation too
    Sp().cancelSpeech();
    lastSpeakEnd = Date.now();   // audio stopped now; keep the echo guard armed
    U().hideTyping();
    U().finishAssistant();   // seal any partial coach bubble in the chat
    refreshState();
  }

  // ----- always-on mic ----------------------------------------------------
  function startMic() {
    if (!active || muted || document.hidden) return;   // mic can't run while backgrounded
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }

    // Supersede any previous recognizer. Without this, a stale instance whose
    // onend had not yet fired would still push a turn AND re-arm the restart
    // timer, so two or three could end up live at once and the mic stayed hot
    // after hang-up. Every callback below is gated on its own generation.
    var myMic = ++micGen;
    if (rec) { try { rec.abort(); } catch (e) {} rec = null; }

    var r = Sp().create({
      onStart: function () { if (myMic === micGen) refreshState(); },
      onInterim: function (t) {
        if (myMic !== micGen) return;
        U().setUserCaption(t);
        if (pending > 0 && isMeaningful(t) && !isEcho(t)) bargeIn(); // interrupt the coach
      },
      // In continuous mode a single sentence arrives as many small finals — on
      // Android, one per word. Dispatching each would fire an LLM turn per word,
      // so they are buffered and flushed once speech actually stops.
      onFinal: function (t) {
        if (myMic !== micGen) return;
        lastFinal = '';
        pushFragment((t || '').trim());
      },
      onError: function (code) { if (myMic === micGen) onRecError(code); },
      onEnd: function () {
        if (myMic !== micGen) return;      // superseded — stay inert
        rec = null;
        flushUtterance();
        // Flush whatever is buffered — the recogniser ending IS an endpoint, so
        // waiting out the gap timer would only add latency. Deliberately not
        // using speech.js's onEnd argument: that is the running total for the
        // whole session, and acting on it would replay the entire call.
        if (active && !muted && !document.hidden) restartTimer = setTimeout(startMic, 300);
      }
    }, { continuous: true });

    if (!r) return;
    rec = r;
    try { r.start(); } catch (e) { /* already running */ }
  }

  /* Accumulate recogniser fragments; flush as one utterance. */
  function pushFragment(t) {
    if (!t) return;
    utterBuf += (utterBuf ? ' ' : '') + t;
    U().setUserCaption(utterBuf);
    if (utterTimer) clearTimeout(utterTimer);
    utterTimer = setTimeout(flushUtterance, UTTER_GAP_MS);
  }
  function flushUtterance() {
    if (utterTimer) { clearTimeout(utterTimer); utterTimer = null; }
    var t = utterBuf.trim();
    utterBuf = '';
    if (t) handleFinal(t);
  }
  function dropUtterance() {
    if (utterTimer) { clearTimeout(utterTimer); utterTimer = null; }
    utterBuf = '';
  }

  function onRecError(code) {
    if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
      U().toast('Microphone unavailable (' + code + ').', 'error');
      end();
    }
    // 'no-speech' / 'aborted' -> onEnd restarts the mic
  }

  function handleFinal(t) {
    if (!active) return;
    if (!isMeaningful(t)) { U().setUserCaption(''); return; }
    // Drop the coach's own audio echoing back (during speech or just after).
    if ((pending > 0 || (Date.now() - lastSpeakEnd) < 1200) && isEcho(t)) { U().setUserCaption(''); return; }
    if (pending > 0 || processing) bargeIn();        // interrupt speech and/or the streaming reply
    if (processing) { queuedUtterance = t; U().setUserCaption(t); return; } // run it once this turn ends
    handleUserUtterance(t);
  }

  // ----- thinking ---------------------------------------------------------
  function handleUserUtterance(t) {
    U().addUserMessage(t);          // show the user's turn in the chat
    U().setUserCaption('');
    gen++;
    pending = 0; ttsBuf = ''; coachText = ''; coachWords = {}; coachWordCount = 0;
    interrupted = false; queuedUtterance = null;
    processing = true;
    refreshState();

    var myGen = gen;
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    turnAbort = ctrl;

    App.Api.runTurn(t, {
      onRoundStart: function () { if (myGen === gen) U().showTyping(); },
      onText: function (d) { if (myGen === gen) onCoachDelta(d); },   // ignore stale/superseded streams
      onRoundEnd: function () { if (myGen === gen) U().finishAssistant(); },
      onLogged: function (e) { U().addLogChip(e); U().refreshHistory(); },
      onSession: function (n) { U().addSessionChip(n); U().refreshSessions(); },
      onTimer: function (secs, label) { U().startTimer(secs, label); }
    }, { voice: true, signal: ctrl ? ctrl.signal : undefined }).then(function () {
      if (ctrl === turnAbort) turnAbort = null;
      if (myGen !== gen) return;          // a newer turn / barge-in took over
      processing = false;
      if (drainQueued()) return;
      pushSentences(true);
      refreshState();
    }, function (err) {
      if (ctrl === turnAbort) turnAbort = null;
      if (myGen !== gen || (err && err.code === 'aborted')) {
        processing = false;
        drainQueued();                    // run whatever the user said while interrupting
        return;
      }
      processing = false;
      if (drainQueued()) return;
      say('Sorry, something went wrong. ' + (err && err.message ? err.message : ''));
    });
  }

  // If the user interrupted mid-reply, run the utterance they queued next.
  function drainQueued() {
    if (!interrupted) return false;
    interrupted = false;
    var q = queuedUtterance; queuedUtterance = null;
    if (q && active) { handleUserUtterance(q); return true; }
    refreshState();
    return true;
  }

  // ----- acoustic barge-in -------------------------------------------------
  // The transcript path (onInterim -> isMeaningful -> isEcho) can only react
  // once the recognizer has produced words, which is far too slow to feel like
  // an interruption. VAD reacts to energy, so we cut the coach off as soon as
  // the user actually starts talking. Purely additive: if VAD is unavailable
  // the transcript path still runs exactly as before.
  var vadOn = false;
  function startVad() {
    if (!App.Vad) return;
    App.Vad.start({
      onSpeechStart: function () {
        if (!active || muted) return;
        // Only meaningful as an interruption while the coach holds the floor.
        if (pending > 0) bargeIn();
      },
      onSpeechEnd: function () {
        // A real acoustic endpoint beats waiting out UTTER_GAP_MS, so flush
        // early when the VAD is available and something is pending.
        if (active && !muted && utterBuf) flushUtterance();
      }
    }).then(function (ok) { vadOn = !!ok; });
  }
  function stopVad() { vadOn = false; if (App.Vad) App.Vad.stop(); }

  // ----- controls ---------------------------------------------------------
  function start() {
    if (active) return;
    if (!Sp().available) {
      U().toast('Voice calls need speech recognition — try Chrome or an Android browser.', 'error');
      return;
    }
    if (!S().getApiKey()) {
      U().toast('Add your Anthropic API key first.', 'error');
      U().showScreen('settings');
      return;
    }
    active = true; muted = false; processing = false;
    pending = 0; gen++; ttsBuf = ''; coachText = ''; coachWords = {}; coachWordCount = 0; lastFinal = '';
    interrupted = false; queuedUtterance = null;
    U().openCall();
    U().setComposerEnabled(false);   // avoid a typed turn racing the call
    U().setCallState('connecting');
    startTimer();
    requestWakeLock();   // keep the screen awake so the call isn't killed by auto-lock
    startMic();
    startVad();
    say('Hey, coach here. What did you train today?');
  }

  function toggleMute() {
    if (!active) return;
    muted = !muted;
    U().setCallMuted(muted);
    if (muted) {
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      micGen++;   // discard anything this recognizer still reports
      dropUtterance();
      if (rec) { try { rec.abort(); } catch (e) {} rec = null; }
    } else {
      startMic();
    }
    refreshState();
  }

  function end() {
    active = false; muted = false; processing = false;
    gen++;            // supersede any in-flight turn so its callbacks go inert
    if (turnAbort) { try { turnAbort.abort(); } catch (e) {} turnAbort = null; }
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    micGen++;
    dropUtterance();
    if (rec) { try { rec.abort(); } catch (e) {} rec = null; }
    Sp().cancelSpeech();
    stopVad();
    pending = 0;
    stopTimer();
    releaseWakeLock();
    U().hideTyping();
    U().finishAssistant();           // seal any partial bubble; keep the live transcript
    U().setCallState('ended');
    U().closeCall();
    U().setComposerEnabled(true);
    U().refreshHistory();
  }

  // ----- background / screen-wake handling --------------------------------
  // The mic can't run while the page is hidden (browser privacy restriction), so
  // the best we can do is (a) hold a screen Wake Lock so the device doesn't auto-
  // lock mid-call, and (b) cleanly pause on background and resume when visible.
  var wakeLock = null;
  function requestWakeLock() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request && !document.hidden) {
        navigator.wakeLock.request('screen').then(function (wl) {
          wakeLock = wl;
          if (wl.addEventListener) wl.addEventListener('release', function () { wakeLock = null; });
        }).catch(function () {});
      }
    } catch (e) {}
  }
  function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  }
  function onVisibility() {
    if (!active) return;
    if (document.hidden) {
      // Backgrounded: the OS suspends the recognizer anyway. Stop our restart
      // loop so it doesn't error-spam, but keep the call "active".
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      micGen++;
      if (rec) { try { rec.abort(); } catch (e) {} rec = null; }
    } else {
      requestWakeLock();          // wake locks are auto-released on hide — re-acquire
      if (!muted) startMic();     // resume listening
      refreshState();
    }
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', onVisibility);
  }

  App.Call = {
    start: start,
    end: end,
    toggleMute: toggleMute,
    isActive: function () { return active; }
  };
})();
