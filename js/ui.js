/* ui.js — all DOM rendering and view wiring. Talks to Store/Api/Speech/Call.
 * Orchestration (sending turns, finishing sessions, importing) lives in app.js
 * and is passed in via UI.init(handlers). Call controls delegate to App.Call. */
(function () {
  'use strict';
  window.App = window.App || {};
  var Store = App.Store;

  var PRESET_MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8'];

  var el = {};
  var handlers = {};
  var currentAssistantEl = null;
  var typingEl = null;
  var micRec = null;
  var micListening = false;
  var micBase = '';
  var currentVideoName = '';
  var pickerRoutineId = null;

  function $(id) { return document.getElementById(id); }

  function make(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---------------------------------------------------------------- init / nav
  function init(h) {
    handlers = h || {};
    cache();
    wire();
    refreshSettings();
    refreshHistory();
    setupMic();
    setupVoices();
  }

  function cache() {
    el.screens = {
      coach: $('screen-coach'), history: $('screen-history'),
      exercises: $('screen-exercises'), sessions: $('screen-sessions'), settings: $('screen-settings')
    };
    el.tabs = Array.prototype.slice.call(document.querySelectorAll('.tabbar button'));
    el.title = $('topbar-title');
    el.topActions = $('topbar-actions');
    el.callBtn = $('call-btn');
    el.newChatBtn = $('newchat-btn');
    el.finishBtn = $('finish-btn');

    el.chat = $('chat');
    el.composer = $('composer');
    el.input = $('msg-input');
    el.sendBtn = $('send-btn');
    el.micBtn = $('mic-btn');

    el.summaryText = $('summary-text');
    el.summaryUpdated = $('summary-updated');
    el.stats = $('stats');
    el.historyList = $('history-list');
    el.clearHistoryBtn = $('clear-history-btn');
    el.exerciseList = $('exercise-list');
    el.sessionList = $('session-list');
    el.newSessionBtn = $('new-session-btn');
    el.suggestSessionsBtn = $('suggest-sessions-btn');
    el.pickerModal = $('picker-modal');
    el.pickerInput = $('picker-input');
    el.pickerAdd = $('picker-add');
    el.pickerClose = $('picker-close');
    el.pickerSuggestions = $('picker-suggestions');
    el.sheetModal = $('sheet-modal');
    el.sheetTitle = $('sheet-title');
    el.sheetClose = $('sheet-close');
    el.sheetActions = $('sheet-actions');

    el.settingsForm = $('settings-form');
    el.apiKey = $('api-key');
    el.toggleKey = $('toggle-key');
    el.modelSelect = $('model-select');
    el.customModelWrap = $('custom-model-wrap');
    el.customModel = $('custom-model');
    el.unitsSelect = $('units-select');
    el.voiceField = $('voice-field');
    el.voiceSelect = $('voice-select');
    el.voicePreview = $('voice-preview');
    el.profileName = $('profile-name');
    el.profileGoals = $('profile-goals');
    el.profileEquipment = $('profile-equipment');
    el.clearKeyBtn = $('clear-key-btn');
    el.clearAllBtn = $('clear-all-btn');
    el.micHint = $('mic-hint');

    el.importText = $('import-text');
    el.importBtn = $('import-btn');
    el.importStatus = $('import-status');

    el.exportBtn = $('export-btn');
    el.importDataBtn = $('import-data-btn');
    el.importFile = $('import-file');
    el.backupStatus = $('backup-status');

    // video modal
    el.videoModal = $('video-modal');
    el.videoTitle = $('video-title');
    el.videoFrameWrap = $('video-frame-wrap');
    el.videoFrame = $('video-frame');
    el.videoEmpty = $('video-empty');
    el.videoSearchBtn = $('video-search-btn');
    el.videoUrlInput = $('video-url-input');
    el.videoSaveBtn = $('video-save-btn');
    el.videoChange = $('video-change');
    el.videoClose = $('video-close');

    // call overlay
    el.callBar = $('call-bar');
    el.callDot = $('call-dot');
    el.callStateLabel = $('call-state-label');
    el.callTimer = $('call-timer');
    el.capUser = $('cap-user');
    el.callMute = $('call-mute');
    el.callEnd = $('call-end');

    // timer widget
    el.timerWidget = $('timer-widget');
    el.timerLabel = $('timer-label');
    el.timerTime = $('timer-time');
    el.timerFill = $('timer-fill');
    el.timerToggle = $('timer-toggle');
    el.timerStop = $('timer-stop');
  }

  function wire() {
    el.tabs.forEach(function (btn) {
      btn.addEventListener('click', function () { showScreen(btn.getAttribute('data-screen')); });
    });
    el.callBtn.addEventListener('click', function () { if (App.Call) App.Call.start(); });
    el.finishBtn.addEventListener('click', function () { if (handlers.onFinish) handlers.onFinish(); });
    el.newChatBtn.addEventListener('click', function () { if (handlers.onNewChat) handlers.onNewChat(); });

    el.composer.addEventListener('submit', function (e) { e.preventDefault(); submitComposer(); });
    el.input.addEventListener('input', autoGrow);
    el.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComposer(); }
    });
    el.input.addEventListener('focus', function () { setTimeout(scrollChatToBottom, 200); });
    el.micBtn.addEventListener('click', toggleMic);

    // settings
    el.settingsForm.addEventListener('submit', saveSettings);
    el.toggleKey.addEventListener('click', function () {
      var showing = el.apiKey.type === 'text';
      el.apiKey.type = showing ? 'password' : 'text';
      el.toggleKey.textContent = showing ? 'Show' : 'Hide';
    });
    el.modelSelect.addEventListener('change', function () {
      var custom = el.modelSelect.value === '__custom__';
      el.customModelWrap.hidden = !custom;
      if (!custom) { Store.setModel(el.modelSelect.value); toast('Model set to ' + el.modelSelect.value, 'info'); }
      else el.customModel.focus();
    });
    el.customModel.addEventListener('change', function () {
      var v = el.customModel.value.trim();
      if (v) { Store.setModel(v); toast('Model set to ' + v, 'info'); }
    });
    el.unitsSelect.addEventListener('change', function () { Store.setUnits(el.unitsSelect.value); });
    el.voiceSelect.addEventListener('change', function () { Store.setVoice(el.voiceSelect.value); });
    el.voicePreview.addEventListener('click', function () {
      if (!App.Speech || !App.Speech.ttsAvailable) { toast('Text-to-speech isn’t available in this browser.', 'info'); return; }
      App.Speech.cancelSpeech();
      App.Speech.speak('Nice work today. Let’s keep that momentum going — what’s next?');
    });
    el.clearKeyBtn.addEventListener('click', function () {
      Store.clearApiKey(); el.apiKey.value = ''; toast('API key cleared', 'info');
    });
    el.clearAllBtn.addEventListener('click', function () {
      if (window.confirm('Delete ALL local data (key, settings, workouts, chat, history)? This cannot be undone.')) {
        if (handlers.onClearAll) handlers.onClearAll();
      }
    });
    el.importBtn.addEventListener('click', function () { if (handlers.onImport) handlers.onImport(); });

    // history maintenance
    el.clearHistoryBtn.addEventListener('click', function () {
      if (window.confirm('Delete ALL logged workouts? Your coach summary is kept. This cannot be undone.')) {
        Store.clearWorkouts();
        refreshHistory();
        toast('Logged workouts cleared.', 'info');
      }
    });

    // backup & restore
    el.exportBtn.addEventListener('click', exportData);
    el.importDataBtn.addEventListener('click', function () { el.importFile.click(); });
    el.importFile.addEventListener('change', importDataFile);

    // sessions
    el.newSessionBtn.addEventListener('click', function () {
      var name = window.prompt('Name this session (e.g. Push, Pull, Legs, or A):', '');
      if (name === null) return;
      Store.addRoutine(name);
      refreshSessions();
    });
    el.suggestSessionsBtn.addEventListener('click', function () { if (handlers.onSuggestSessions) handlers.onSuggestSessions(); });
    el.pickerClose.addEventListener('click', closePicker);
    el.pickerModal.addEventListener('click', function (e) { if (e.target === el.pickerModal) closePicker(); });
    el.pickerAdd.addEventListener('click', pickerAddTyped);
    el.pickerInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); pickerAddTyped(); } });
    el.sheetClose.addEventListener('click', closeSheet);
    el.sheetModal.addEventListener('click', function (e) { if (e.target === el.sheetModal) closeSheet(); });

    // video modal
    el.videoClose.addEventListener('click', closeVideo);
    el.videoModal.addEventListener('click', function (e) { if (e.target === el.videoModal) closeVideo(); });
    el.videoSearchBtn.addEventListener('click', function () {
      if (currentVideoName) window.open(App.Videos.searchUrl(currentVideoName), '_blank', 'noopener');
    });
    el.videoSaveBtn.addEventListener('click', saveVideoPin);
    el.videoUrlInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveVideoPin(); } });
    el.videoChange.addEventListener('click', function () {
      el.videoFrameWrap.hidden = true; el.videoEmpty.hidden = false; el.videoChange.hidden = true;
      el.videoUrlInput.focus();
    });

    // call controls
    el.callMute.addEventListener('click', function () { if (App.Call) App.Call.toggleMute(); });
    el.callEnd.addEventListener('click', function () { if (App.Call) App.Call.end(); });

    // timer controls
    el.timerToggle.addEventListener('click', toggleTimer);
    el.timerStop.addEventListener('click', stopTimer);
  }

  function showScreen(name) {
    Object.keys(el.screens).forEach(function (key) {
      el.screens[key].classList.toggle('active', key === name);
    });
    el.tabs.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-screen') === name);
    });
    el.title.textContent = { coach: 'Coach', history: 'History', exercises: 'Exercises', sessions: 'Sessions', settings: 'Settings' }[name] || 'Coach';
    el.topActions.hidden = name !== 'coach';
    if (name === 'history') refreshHistory();
    if (name === 'exercises') refreshExercises();
    if (name === 'sessions') refreshSessions();
    if (name === 'settings' && App.Speech && App.Speech.refreshVoices) App.Speech.refreshVoices();
    if (name === 'coach') scrollChatToBottom();
  }

  // ---------------------------------------------------------------- composer
  function autoGrow() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 140) + 'px';
  }
  function submitComposer() {
    var text = el.input.value.trim();
    if (!text) return;
    el.input.value = '';
    autoGrow();
    if (handlers.onSend) handlers.onSend(text);
  }
  function setComposerEnabled(enabled) {
    el.input.disabled = !enabled;
    el.sendBtn.disabled = !enabled;
    el.micBtn.disabled = !enabled;
    // Also the Call button: leaving it live let a call start mid-turn, giving
    // two runTurn calls the same session object to push messages into.
    if (el.callBtn) el.callBtn.disabled = !enabled;
  }
  function focusInput() { try { el.input.focus(); } catch (e) {} }

  // Put text in the composer ready to edit & resend.
  function fillComposer(text) {
    el.input.value = text || '';
    autoGrow();
    focusInput();
    try { el.input.setSelectionRange(el.input.value.length, el.input.value.length); } catch (e) {}
    scrollChatToBottom();
  }

  // ---------------------------------------------------------------- chat render
  function scrollChatToBottom() { if (el.chat) el.chat.scrollTop = el.chat.scrollHeight; }

  function addUserMessage(text, ordinal) {
    var row = make('div', 'msg user');
    if (ordinal == null) row.setAttribute('data-pending', '1');
    else row.setAttribute('data-msg-ordinal', String(ordinal));
    row.appendChild(make('div', 'bubble', text));
    var edit = make('button', 'msg-edit', '✎');
    edit.type = 'button';
    edit.title = 'Edit & resend';
    edit.setAttribute('aria-label', 'Edit message');
    edit.addEventListener('click', function () { startEditMessage(row); });
    row.appendChild(edit);
    el.chat.appendChild(row);
    scrollChatToBottom();
    return row;
  }

  // A turn that failed (or was aborted by barge-in) is rolled back out of stored
  // history by api.js, but we had already painted it. Drop the optimistic DOM so
  // the chat and the store agree — otherwise every later edit targets the wrong
  // message, because the ordinals silently diverge by one per failed turn.
  function dropPendingTurn() {
    finishAssistant();
    var pend = el.chat.querySelectorAll('.msg.user[data-pending]');
    for (var i = pend.length - 1; i >= 0; i--) {
      var row = pend[i];
      // anything rendered after the dropped user message went with it
      while (row.nextSibling) el.chat.removeChild(row.nextSibling);
      el.chat.removeChild(row);
    }
    scrollChatToBottom();
  }

  // Edit a previously-sent message: drop it and everything after, refill composer.
  function startEditMessage(row) {
    if (App.Call && App.Call.isActive()) { toast('Can’t edit during a call.', 'info'); return; }
    // Counting .msg.user nodes was wrong: the DOM keeps messages that rollback()
    // removed from the store, so the Nth bubble is not the Nth stored message.
    if (row.hasAttribute('data-pending')) {
      toast('That message isn’t saved yet — wait for the reply to finish.', 'info');
      return;
    }
    var ordinal = parseInt(row.getAttribute('data-msg-ordinal'), 10);
    if (isNaN(ordinal)) return;
    if (handlers.onEditMessage) handlers.onEditMessage(ordinal);
  }

  function showTyping() {
    if (!typingEl) {
      typingEl = make('div', 'msg assistant typing');
      var b = make('div', 'bubble');
      b.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      typingEl.appendChild(b);
    }
    el.chat.appendChild(typingEl);
    scrollChatToBottom();
  }
  function hideTyping() { if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl); }

  function appendAssistantDelta(text) {
    hideTyping();
    if (!currentAssistantEl) {
      var row = make('div', 'msg assistant');
      currentAssistantEl = make('div', 'bubble');
      row.appendChild(currentAssistantEl);
      el.chat.appendChild(row);
    }
    currentAssistantEl.textContent += text;
    scrollChatToBottom();
  }
  function finishAssistant() {
    if (currentAssistantEl) {
      if (!currentAssistantEl.textContent) {
        var row = currentAssistantEl.parentNode;
        if (row && row.parentNode) row.parentNode.removeChild(row);
      } else {
        appendWatchChips(currentAssistantEl.textContent);
      }
      currentAssistantEl = null;
    }
  }

  // Render "▶ Watch" chips for any exercises the coach mentioned.
  function appendWatchChips(text) {
    var names = (App.Videos ? App.Videos.detect(text) : []);
    if (!names.length) return;
    var wrap = make('div', 'msg watch');
    var row = make('div', 'watch-row');
    names.forEach(function (n) {
      var b = make('button', 'watch-chip', '▶ ' + n);
      b.type = 'button';
      b.addEventListener('click', function () { openVideo(n); });
      row.appendChild(b);
    });
    wrap.appendChild(row);
    el.chat.appendChild(wrap);
    scrollChatToBottom();
  }

  function chipLabel(input) {
    var names = (input && Array.isArray(input.exercises) ? input.exercises : [])
      .map(function (ex) { return ex.name || 'exercise'; });
    return '✓ Logged: ' + (names.length ? names.join(', ') : 'workout');
  }
  function addLogChip(input) {
    var row = make('div', 'msg log');
    row.appendChild(make('div', 'log-chip', chipLabel(input)));
    el.chat.appendChild(row);
    scrollChatToBottom();
  }
  function addSessionChip(name) {
    var row = make('div', 'msg log');
    row.appendChild(make('div', 'log-chip', '📋 Updated session: ' + (name || '')));
    el.chat.appendChild(row);
    scrollChatToBottom();
  }

  function clearChat() { el.chat.innerHTML = ''; currentAssistantEl = null; typingEl = null; }

  function renderSession(session) {
    clearChat();
    if (!session || !Array.isArray(session.messages) || !session.messages.length) {
      var hello = make('div', 'msg assistant');
      hello.appendChild(make('div', 'bubble',
        "Hey! I'm your coach. Tap Call to talk, or just type what you did — like “3x10 bench at 135 and a 20 min run” — and I'll log it and help you train smart."));
      el.chat.appendChild(hello);
      return;
    }
    var userOrdinal = 0;
    session.messages.forEach(function (m) {
      if (m.role === 'user') {
        if (typeof m.content === 'string') addUserMessage(m.content, userOrdinal++);
        return;
      }
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        var text = m.content.filter(function (b) { return b.type === 'text'; })
          .map(function (b) { return b.text; }).join('');
        if (text.trim()) {
          var row = make('div', 'msg assistant');
          row.appendChild(make('div', 'bubble', text));
          el.chat.appendChild(row);
        }
        m.content.forEach(function (b) {
          if (b.type === 'tool_use' && b.name === 'log_workout') addLogChip(b.input);
        });
        if (text.trim()) appendWatchChips(text);
      }
    });
    scrollChatToBottom();
  }

  // ---------------------------------------------------------------- history
  function dayKey(d) { var x = new Date(d); return x.getFullYear() + '-' + (x.getMonth() + 1) + '-' + x.getDate(); }

  function computeStats(workouts) {
    var total = workouts.length;
    var now = Date.now();
    var weekMs = 7 * 24 * 60 * 60 * 1000;
    var thisWeek = workouts.filter(function (w) { return (now - new Date(w.timestamp).getTime()) <= weekMs; }).length;
    var days = {};
    workouts.forEach(function (w) { days[dayKey(w.timestamp)] = true; });
    var streak = 0, d = new Date();
    if (!days[dayKey(d)]) d.setDate(d.getDate() - 1);
    while (days[dayKey(d)]) { streak++; d.setDate(d.getDate() - 1); }
    return { total: total, thisWeek: thisWeek, streak: streak };
  }
  function statCard(value, label) {
    var c = make('div', 'stat');
    c.appendChild(make('div', 'stat-value', String(value)));
    c.appendChild(make('div', 'stat-label', label));
    return c;
  }
  function round(n, dp) { var p = Math.pow(10, dp || 0); return Math.round(n * p) / p; }
  function fmtW(w, unit, defUnit) { return round(w, 2) + (unit || defUnit); }
  function fmtDuration(min) {
    if (min == null) return '';
    if (min < 1) return Math.round(min * 60) + 's';
    return round(min, 1) + ' min';
  }
  function fmtDistance(d, unit) {
    if (d == null) return '';
    if (unit === 'km' && d < 1) return Math.round(d * 1000) + ' m';
    return round(d, 2) + (unit ? ' ' + unit : '');
  }

  // Collapse a set list into compact gym notation, e.g.
  //   3 identical 10@20kg  -> "3 × 10 @ 20kg"
  //   varied reps          -> "10, 10, 8 @ 20kg"
  //   varied weights       -> "10@20kg, 8@22kg"
  //   bodyweight / 1-rep holds -> "3 × 10" / "3 sets"
  function summarizeSets(sets, defUnit) {
    sets = (Array.isArray(sets) ? sets : []).filter(function (s) {
      return s && (s.reps != null || s.weight != null);
    });
    if (!sets.length) return '';
    var n = sets.length;
    var reps = sets.map(function (s) { return s.reps != null ? s.reps : null; });
    var allRepsEqual = reps.every(function (r) { return r === reps[0]; });
    var hasWeight = sets.some(function (s) { return s.weight != null && s.weight > 0; });
    var weightsEqual = sets.every(function (s) {
      return s.weight === sets[0].weight && (s.unit || defUnit) === (sets[0].unit || defUnit);
    });

    function repsToken() {
      if (allRepsEqual) {
        var r = reps[0];
        if (r == null || r <= 1) return n + (n > 1 ? ' sets' : ' set'); // 1-rep = a hold placeholder
        return n + ' × ' + r;
      }
      return reps.map(function (r) { return r == null ? '–' : r; }).join(', ');
    }

    if (!hasWeight) return repsToken();
    if (weightsEqual) return repsToken() + ' @ ' + fmtW(sets[0].weight, sets[0].unit, defUnit);
    return sets.map(function (s) {
      var r = s.reps != null ? s.reps : '';
      return (s.weight != null && s.weight > 0)
        ? (r !== '' ? r + '@' : '') + fmtW(s.weight, s.unit, defUnit)
        : (r !== '' ? '' + r : '–');
    }).join(', ');
  }

  function formatExercise(ex, defUnit, opts) {
    opts = opts || {};
    var parts = [];
    var ss = summarizeSets(ex.sets, defUnit);
    if (ss) parts.push(ss);
    var dur = fmtDuration(ex.duration_min); if (dur) parts.push(dur);
    var dist = fmtDistance(ex.distance, ex.distance_unit); if (dist) parts.push(dist);
    if (opts.notes !== false && ex.notes) parts.push(ex.notes);
    return parts.join(' · ');
  }

  // Concise one-liner for the Exercises / Sessions summaries (no notes unless
  // there is no structured data, in which case fall back to a short note).
  function exerciseDetail(ex, defUnit) {
    var d = formatExercise(ex, defUnit, { notes: false });
    if (d) return d;
    var n = ex.notes || '';
    return n.length > 70 ? n.slice(0, 67) + '…' : n;
  }

  // Emphasise only the LOAD (a number directly tied to a unit: weight, distance,
  // duration) in the accent colour. Everything else stays plain — one focal point
  // per row, not a rainbow. Safe: each token is its own textContent node.
  function metricLine(cls, text) {
    var parent = make('div', cls);
    if (text == null) return parent;
    var re = /\d+(?:\.\d+)?\s?(?:kg|lb|km|mi|min|m|s)\b/gi;
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      parent.appendChild(make('span', 'tok-load', m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
    return parent;
  }

  function refreshHistory() {
    refreshSummary();
    var units = Store.getUnits();
    var workouts = Store.getWorkouts().slice().sort(function (a, b) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

    el.stats.innerHTML = '';
    var s = computeStats(workouts);
    el.stats.appendChild(statCard(s.thisWeek, 'This week'));
    el.stats.appendChild(statCard(s.streak, 'Day streak'));
    el.stats.appendChild(statCard(s.total, 'Total logged'));

    el.historyList.innerHTML = '';
    el.clearHistoryBtn.hidden = workouts.length === 0;
    if (!workouts.length) {
      el.historyList.appendChild(make('p', 'empty', 'No workouts logged yet. Head to Coach and tell me what you did.'));
      return;
    }
    var lastDay = null;
    workouts.forEach(function (w) {
      var key = dayKey(w.timestamp);
      if (key !== lastDay) {
        lastDay = key;
        var heading = new Date(w.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        el.historyList.appendChild(make('h3', 'day-heading', heading));
      }
      var card = make('div', 'workout-card');
      var time = new Date(w.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      card.appendChild(make('div', 'workout-time', time));

      var del = make('button', 'card-del', '✕');
      del.type = 'button';
      del.setAttribute('aria-label', 'Delete workout');
      del.addEventListener('click', function () {
        if (window.confirm('Delete this workout?')) { Store.deleteWorkout(w.id); refreshHistory(); }
      });
      card.appendChild(del);

      (w.exercises || []).forEach(function (ex) {
        var line = make('div', 'ex-line');
        line.appendChild(make('span', 'ex-name', ex.name || 'Exercise'));
        var detail = formatExercise(ex, units);
        if (detail) line.appendChild(make('span', 'ex-detail', detail));
        var watch = make('button', 'ex-watch', '▶');
        watch.type = 'button';
        watch.title = 'Watch video';
        watch.setAttribute('aria-label', 'Watch ' + (ex.name || 'exercise') + ' video');
        watch.addEventListener('click', function () { openVideo(ex.name || ''); });
        line.appendChild(watch);
        card.appendChild(line);
      });
      if (w.notes) card.appendChild(make('div', 'workout-notes', w.notes));
      el.historyList.appendChild(card);
    });
  }

  function refreshSummary() {
    var summary = Store.getSummary();
    if (summary && summary.text) {
      el.summaryText.textContent = summary.text;
      el.summaryUpdated.textContent = 'Updated ' + new Date(summary.updatedAt).toLocaleString();
    } else {
      el.summaryText.textContent = 'No history yet. Finish a session (or import history in Settings) and I’ll build a summary the coach reads before each new workout.';
      el.summaryUpdated.textContent = '';
    }
  }

  // ---------------------------------------------------------------- exercises
  // Normalize a weight to kilograms so lb/kg entries can be compared fairly.
  function toKg(weight, unit) { return (unit === 'lb') ? weight * 0.453592 : weight; }

  function maxWeight(ex) {
    var best = null, bestKg = -1;
    (ex.sets || []).forEach(function (s) {
      if (s.weight == null || s.weight <= 0) return;   // 0 / null = bodyweight
      var u = s.unit || Store.getUnits();
      var kg = toKg(s.weight, u);
      if (kg > bestKg) { bestKg = kg; best = { weight: s.weight, unit: u }; }
    });
    return best;
  }
  function statsMap() {
    var map = {};
    Store.getWorkouts().forEach(function (w) {
      var ts = new Date(w.timestamp).getTime();
      (w.exercises || []).forEach(function (ex) {
        var key = App.Videos.normalize(ex.name || '');
        if (!key) return;
        var rec = map[key] || { name: ex.name, lastTs: 0, latest: null, count: 0, best: null };
        rec.count++;
        if (ts >= rec.lastTs) { rec.lastTs = ts; rec.latest = ex; rec.name = ex.name || rec.name; }
        var mw = maxWeight(ex);
        if (mw) {
          var bestKg = rec.best ? toKg(rec.best.weight, rec.best.unit) : -1;
          if (toKg(mw.weight, mw.unit) > bestKg) rec.best = mw;
        }
        map[key] = rec;
      });
    });
    return map;
  }
  function buildExerciseList() {
    var map = statsMap();
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.lastTs - a.lastTs; });
  }
  // Up to three scannable stat cells (SETS / REPS / LOAD) from the latest entry.
  // Load is last (right column) so weights line up down the list. Returns null
  // when there's no structured data (e.g. a free-text "band walk" note).
  // Always three fixed slots — SETS · REPS · LOAD — so columns line up down the
  // whole list. A muted "–" fills a slot that doesn't apply. Returns null only
  // when there is no structured data at all (free-text note → fallback line).
  function statCells(rec, units) {
    var ex = rec && rec.latest;
    if (!ex) return null;
    var sets = (Array.isArray(ex.sets) ? ex.sets : []).filter(function (s) {
      return s && (s.reps != null || s.weight != null);
    });
    if (!sets.length && ex.duration_min == null && ex.distance == null) return null;

    var setsCell = sets.length ? { v: String(sets.length), l: 'sets' } : { v: '–', l: 'sets', empty: true };

    // Middle slot = per-set effort: reps, else distance, else time.
    var reps = sets.map(function (s) { return s.reps; }).filter(function (r) { return r != null; });
    var usedDist = false, usedDur = false, midCell;
    if (reps.length && reps[0] > 1) {
      var allEq = reps.every(function (r) { return r === reps[0]; });
      midCell = { v: allEq ? String(reps[0]) : (Math.min.apply(null, reps) + '–' + Math.max.apply(null, reps)), l: 'reps' };
    } else if (ex.distance != null) {
      midCell = { v: fmtDistance(ex.distance, ex.distance_unit), l: 'dist', load: true }; usedDist = true;
    } else if (ex.duration_min != null) {
      midCell = { v: fmtDuration(ex.duration_min), l: 'time', load: true }; usedDur = true;
    } else {
      midCell = { v: '–', l: 'reps', empty: true };
    }

    // Load slot = resistance: weight, else any not-yet-shown distance/time, else BW.
    var mw = maxWeight(ex), loadCell;
    if (mw) loadCell = { v: fmtW(mw.weight, mw.unit, units), l: 'load', load: true };
    else if (ex.distance != null && !usedDist) loadCell = { v: fmtDistance(ex.distance, ex.distance_unit), l: 'dist', load: true };
    else if (ex.duration_min != null && !usedDur) loadCell = { v: fmtDuration(ex.duration_min), l: 'time', load: true };
    else if (sets.length) loadCell = { v: 'BW', l: 'load' };
    else loadCell = { v: '–', l: 'load', empty: true };

    return [setsCell, midCell, loadCell];
  }

  function refreshExercises() {
    var units = Store.getUnits();
    var list = buildExerciseList();
    el.exerciseList.innerHTML = '';
    if (!list.length) {
      el.exerciseList.appendChild(make('p', 'empty', 'No exercises yet. Log a workout and they’ll show up here.'));
      return;
    }
    list.forEach(function (rec) {
      var card = make('div', 'exercise-card');

      var main = make('div', 'ex-main');
      main.appendChild(make('div', 'exercise-name', rec.name));

      var cells = statCells(rec, units);
      if (!cells) {   // fallback: free-text detail (e.g. band walk)
        var d = rec.latest ? exerciseDetail(rec.latest, units) : '';
        if (d) main.appendChild(metricLine('exercise-current', d));
      }

      var meta = [new Date(rec.lastTs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        rec.count + (rec.count === 1 ? ' log' : ' logs')];
      if (rec.best && rec.best.weight > 0) meta.push('best ' + fmtW(rec.best.weight, rec.best.unit, units));
      main.appendChild(make('div', 'exercise-meta', meta.join(' · ')));
      card.appendChild(main);

      if (cells) {
        var stats = make('div', 'ex-stats');
        cells.forEach(function (c) {
          var cell = make('div', 'stat-cell' + (c.load ? ' load' : '') + (c.empty ? ' empty' : ''));
          cell.appendChild(make('span', 'stat-v', c.v));
          cell.appendChild(make('span', 'stat-l', c.l));
          stats.appendChild(cell);
        });
        card.appendChild(stats);
      }

      var watch = make('button', 'ex-watch', '▶');
      watch.type = 'button';
      watch.title = 'Watch video';
      watch.setAttribute('aria-label', 'Watch ' + rec.name + ' video');
      watch.addEventListener('click', function () { openVideo(rec.name); });
      card.appendChild(watch);

      el.exerciseList.appendChild(card);
    });
  }

  // ---------------------------------------------------------------- sessions
  function refreshSessions() {
    var units = Store.getUnits();
    var routines = Store.getRoutines();
    var stats = statsMap();
    el.sessionList.innerHTML = '';
    if (!routines.length) {
      el.sessionList.appendChild(make('p', 'empty',
        'No sessions yet. Create one (e.g. “Push”, “Pull”, “Legs”, or A/B/C) and add exercises — an exercise can live in several sessions.'));
      return;
    }
    routines.forEach(function (r) {
      var card = make('div', 'session-card');
      var head = make('div', 'session-head');
      var title = make('button', 'session-name', r.name);
      title.type = 'button'; title.title = 'Rename';
      title.addEventListener('click', function () {
        var name = window.prompt('Rename session', r.name);
        if (name !== null) { Store.renameRoutine(r.id, name); refreshSessions(); }
      });
      head.appendChild(title);
      var del = make('button', 'card-del', '✕');
      del.type = 'button'; del.setAttribute('aria-label', 'Delete session');
      del.addEventListener('click', function () {
        if (window.confirm('Delete session “' + r.name + '”? Your logged history is not affected.')) {
          Store.deleteRoutine(r.id); refreshSessions();
        }
      });
      head.appendChild(del);
      card.appendChild(head);

      if (!r.exercises.length) {
        card.appendChild(make('div', 'session-empty', 'No exercises yet.'));
      } else {
        r.exercises.forEach(function (name) {
          var rec = stats[App.Videos.normalize(name)];
          var row = make('div', 'session-ex');
          var info = make('div', 'session-ex-info');
          info.appendChild(make('div', 'session-ex-name', name));
          var sub = (rec && rec.latest) ? exerciseDetail(rec.latest, units) : 'Not logged yet';
          if (rec && rec.lastTs) sub += ' · last ' + new Date(rec.lastTs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          info.appendChild(metricLine('session-ex-sub', sub));
          row.appendChild(info);

          var watch = make('button', 'ex-watch', '▶');
          watch.type = 'button'; watch.setAttribute('aria-label', 'Watch ' + name + ' video');
          watch.addEventListener('click', function () { openVideo(name); });
          row.appendChild(watch);

          var more = make('button', 'ex-more', '⋮');
          more.type = 'button'; more.setAttribute('aria-label', 'Move or remove ' + name);
          more.addEventListener('click', function () { openExerciseSheet(r, name); });
          row.appendChild(more);

          card.appendChild(row);
        });
      }

      var add = make('button', 'session-add', '+ Add exercise');
      add.type = 'button';
      add.addEventListener('click', function () { openPicker(r); });
      card.appendChild(add);

      el.sessionList.appendChild(card);
    });
  }

  // add-exercise picker
  function openPicker(routine) {
    pickerRoutineId = routine.id;
    el.pickerInput.value = '';
    renderPickerSuggestions();
    el.pickerModal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function renderPickerSuggestions() {
    var routine = Store.getRoutines().filter(function (r) { return r.id === pickerRoutineId; })[0];
    var have = routine ? routine.exercises.map(function (e) { return e.toLowerCase(); }) : [];
    var sm = statsMap();
    el.pickerSuggestions.innerHTML = '';
    Object.keys(sm).forEach(function (k) {
      var nm = sm[k].name;
      if (have.indexOf(nm.toLowerCase()) !== -1) return;
      var b = make('button', null, nm);
      b.type = 'button';
      b.addEventListener('click', function () { addPicked(nm); });
      el.pickerSuggestions.appendChild(b);
    });
  }
  function addPicked(name) {
    if (!pickerRoutineId || !name) return;
    Store.routineAddExercise(pickerRoutineId, name);
    refreshSessions();
    renderPickerSuggestions();
  }
  function pickerAddTyped() {
    var v = el.pickerInput.value.trim();
    if (!v) return;
    addPicked(v);
    el.pickerInput.value = '';
  }
  function closePicker() { el.pickerModal.hidden = true; document.body.classList.remove('modal-open'); }

  // move / copy / remove action sheet
  function openExerciseSheet(routine, name) {
    el.sheetTitle.textContent = name;
    el.sheetActions.innerHTML = '';
    var others = Store.getRoutines().filter(function (x) { return x.id !== routine.id; });

    function action(text, cls, fn) {
      var b = make('button', cls || '', text);
      b.type = 'button';
      if (fn) b.addEventListener('click', fn);
      el.sheetActions.appendChild(b);
    }

    if (others.length) {
      action('Move to', 'sheet-section');
      others.forEach(function (t) {
        action('→ ' + t.name, '', function () {
          Store.routineAddExercise(t.id, name);
          Store.routineRemoveExercise(routine.id, name);
          closeSheet(); refreshSessions();
        });
      });
      var copyTargets = others.filter(function (t) {
        return t.exercises.map(function (e) { return e.toLowerCase(); }).indexOf(name.toLowerCase()) === -1;
      });
      if (copyTargets.length) {
        action('Also add to', 'sheet-section');
        copyTargets.forEach(function (t) {
          action('+ ' + t.name, '', function () {
            Store.routineAddExercise(t.id, name);
            closeSheet(); refreshSessions();
          });
        });
      }
    }
    action('Remove from ' + routine.name, 'danger', function () {
      Store.routineRemoveExercise(routine.id, name);
      closeSheet(); refreshSessions();
    });

    el.sheetModal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeSheet() { el.sheetModal.hidden = true; document.body.classList.remove('modal-open'); }
  function setSuggestBusy(b) {
    el.suggestSessionsBtn.disabled = b;
    el.suggestSessionsBtn.textContent = b ? 'Building…' : '✨ Build sessions from my history';
  }

  // ---------------------------------------------------------------- settings
  function refreshSettings() {
    el.apiKey.value = Store.getApiKey();
    var model = Store.getModel();
    if (PRESET_MODELS.indexOf(model) !== -1) {
      el.modelSelect.value = model; el.customModelWrap.hidden = true;
    } else {
      el.modelSelect.value = '__custom__'; el.customModelWrap.hidden = false; el.customModel.value = model;
    }
    el.unitsSelect.value = Store.getUnits();
    var p = Store.getProfile();
    el.profileName.value = p.name || '';
    el.profileGoals.value = p.goals || '';
    el.profileEquipment.value = p.equipment || '';
  }

  function saveSettings(e) {
    e.preventDefault();
    var key = el.apiKey.value.trim();
    if (key) Store.setApiKey(key); else Store.clearApiKey();
    var model = el.modelSelect.value === '__custom__'
      ? (el.customModel.value.trim() || 'claude-sonnet-4-6') : el.modelSelect.value;
    Store.setModel(model);
    Store.setUnits(el.unitsSelect.value);
    Store.setProfile({
      name: el.profileName.value.trim(),
      goals: el.profileGoals.value.trim(),
      equipment: el.profileEquipment.value.trim()
    });
    toast('Settings saved', 'success');
  }

  // import history
  function getImportText() { return el.importText.value.trim(); }
  function clearImportText() { el.importText.value = ''; }
  function setImportStatus(msg) { el.importStatus.textContent = msg || ''; }
  function setImportBusy(b) { el.importBtn.disabled = b; el.importText.disabled = b; }

  // ---------------------------------------------------------------- mic (composer)
  function setupMic() {
    if (!App.Speech || !App.Speech.available) {
      el.micBtn.hidden = true;
      if (el.micHint) el.micHint.hidden = false;
    }
  }
  function micErrorMsg(code) {
    if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone blocked. Allow mic access (voice needs https or localhost).';
    if (code === 'no-speech') return "Didn't catch that — try again.";
    if (code === 'audio-capture') return 'No microphone found.';
    return 'Voice error: ' + code;
  }
  function toggleMic() {
    if (!App.Speech || !App.Speech.available) {
      toast('Voice not supported here — use your keyboard’s mic button instead.', 'info');
      return;
    }
    if (micListening) { if (micRec) micRec.stop(); return; }
    micRec = App.Speech.create({
      onStart: function () { micListening = true; el.micBtn.classList.add('listening'); },
      onInterim: function (t) { el.input.value = (micBase ? micBase + ' ' : '') + t; autoGrow(); },
      onFinal: function (t) { micBase = (micBase ? micBase + ' ' : '') + t; el.input.value = micBase; autoGrow(); },
      onError: function (code) { toast(micErrorMsg(code), 'error'); },
      onEnd: function () { micListening = false; el.micBtn.classList.remove('listening'); focusInput(); }
    });
    if (!micRec) { toast('Voice not available.', 'info'); return; }
    micBase = el.input.value.trim();
    try { micRec.start(); } catch (e) {}
  }

  // ---------------------------------------------------------------- voice picker
  function setupVoices() {
    if (!App.Speech || !App.Speech.ttsAvailable) {
      if (el.voiceField) el.voiceField.hidden = true;
      return;
    }
    App.Speech.onVoices(populateVoices); // fires now if ready, and again when loaded
  }
  function populateVoices() {
    var net = App.Speech.isNetwork;
    // English first, then higher-quality network voices, then by name.
    var list = App.Speech.listVoices().slice().sort(function (a, b) {
      var ae = /^en/i.test(a.lang) ? 0 : 1, be = /^en/i.test(b.lang) ? 0 : 1;
      if (ae !== be) return ae - be;
      var an = net(a) ? 0 : 1, bn = net(b) ? 0 : 1;
      if (an !== bn) return an - bn;
      return (a.name || '').localeCompare(b.name || '');
    });
    el.voiceSelect.innerHTML = '';
    var auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'Automatic (best available)' + (list.length ? ' — ' + list.length + ' voices' : '');
    el.voiceSelect.appendChild(auto);
    list.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.name;
      o.textContent = v.name + ' (' + v.lang + ')' + (net(v) ? ' — HQ' : '');
      el.voiceSelect.appendChild(o);
    });
    el.voiceSelect.value = Store.getVoice() || '';
  }

  // ---------------------------------------------------------------- call bar
  // The call is now a docked bar, not a full-screen takeover — chat, history and
  // the video Watch buttons stay usable while a call is in progress.
  var CALL_LABELS = {
    connecting: 'Connecting…', listening: 'Listening…', thinking: 'Thinking…',
    speaking: 'Speaking — talk to interrupt', muted: 'Muted — tap mic to talk', idle: 'Paused', ended: ''
  };
  function openCall() {
    el.capUser.textContent = '';
    setCallMuted(false);
    showScreen('coach');        // keep the conversation in view, but stay navigable
    el.callBar.hidden = false;
  }
  function closeCall() { el.callBar.hidden = true; }
  function setCallState(state) {
    el.callBar.className = 'call-bar ' + state;
    el.callStateLabel.textContent = CALL_LABELS[state] || '';
  }
  function setCallTimer(text) { el.callTimer.textContent = text; }
  function setCoachCaption() { /* coach text now streams into the chat itself */ }
  function setUserCaption(text) { el.capUser.textContent = text || ''; }
  function setCallMuted(m) {
    el.callMute.classList.toggle('muted', m);
    el.callMute.setAttribute('aria-pressed', m ? 'true' : 'false');
  }

  // A complete coach line (greeting / nudge / error) rendered as a chat bubble,
  // with Watch chips — used by the call for fixed lines that don't stream.
  function addAssistantBubble(text) {
    if (!text) return;
    var row = make('div', 'msg assistant');
    row.appendChild(make('div', 'bubble', text));
    el.chat.appendChild(row);
    appendWatchChips(text);
    scrollChatToBottom();
  }

  // ---------------------------------------------------------------- timer
  var timer = { iv: null, remaining: 0, total: 0, label: '', running: false, endAt: 0 };
  var audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25, 0.5].forEach(function (t) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
        var s = audioCtx.currentTime + t;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.3, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
        o.start(s); o.stop(s + 0.2);
      });
    } catch (e) {}
  }
  function fmtTimer(s) {
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function renderTimer() {
    el.timerLabel.textContent = timer.label || 'Timer';
    el.timerTime.textContent = fmtTimer(Math.max(0, timer.remaining));
    var pct = timer.total ? Math.max(0, timer.remaining) / timer.total * 100 : 0;
    el.timerFill.style.width = pct + '%';
    el.timerToggle.textContent = timer.running ? 'Pause' : 'Resume';
  }
  function clearTimerIv() { if (timer.iv) { clearInterval(timer.iv); timer.iv = null; } }
  // Wall-clock, not tick-counting. setInterval is throttled hard in a background
  // tab and stops entirely on screen lock, so counting ticks made the timer wrong
  // by however long the phone was asleep — the one thing a rest timer must not do.
  function tickTimer() {
    timer.remaining = Math.ceil((timer.endAt - Date.now()) / 1000);
    if (timer.remaining <= 0) { finishTimer(); return; }
    renderTimer();
  }
  function startTimer(seconds, label) {
    seconds = Math.max(1, Math.round(seconds || 0));
    clearTimerIv();
    timer.total = seconds; timer.remaining = seconds; timer.label = label || 'Timer'; timer.running = true;
    timer.endAt = Date.now() + seconds * 1000;
    el.timerWidget.classList.remove('done');
    el.timerWidget.hidden = false;
    renderTimer();
    timer.iv = setInterval(tickTimer, 1000);
    var row = make('div', 'msg log');
    var chip = make('div', 'log-chip timer-chip', '⏱ ' + (timer.label) + ' — ' + fmtTimer(seconds));
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', function () { startTimer(seconds, label); });
    row.appendChild(chip);
    el.chat.appendChild(row);
    scrollChatToBottom();
  }
  function finishTimer() {
    clearTimerIv();
    timer.running = false; timer.remaining = 0;
    renderTimer();
    el.timerWidget.classList.add('done');
    el.timerTime.textContent = 'Done';
    beep();
    if (App.Call && App.Call.isActive() && App.Speech) App.Speech.speak('Time! ' + (timer.label || ''));
    setTimeout(function () { if (!timer.running) el.timerWidget.hidden = true; }, 5000);
  }
  function toggleTimer() {
    if (timer.remaining <= 0) return;
    timer.running = !timer.running;
    clearTimerIv();
    // Resuming restarts the deadline from whatever is left on the clock.
    if (timer.running) { timer.endAt = Date.now() + timer.remaining * 1000; timer.iv = setInterval(tickTimer, 1000); }
    renderTimer();
  }
  function stopTimer() {
    clearTimerIv();
    timer.running = false;
    el.timerWidget.hidden = true;
  }

  // ---------------------------------------------------------------- video modal
  function openVideo(name) {
    if (!name) return;
    currentVideoName = name;
    el.videoTitle.textContent = name;
    el.videoUrlInput.value = '';
    renderVideoBody();
    el.videoModal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function renderVideoBody() {
    var id = App.Videos.idFor(currentVideoName);
    if (id) {
      el.videoFrame.src = App.Videos.embedUrl(id);
      el.videoFrameWrap.hidden = false;
      el.videoEmpty.hidden = true;
      el.videoChange.hidden = false;
    } else {
      el.videoFrame.src = '';
      el.videoFrameWrap.hidden = true;
      el.videoEmpty.hidden = false;
      el.videoChange.hidden = true;
    }
  }
  function saveVideoPin() {
    var id = App.Videos.parseId(el.videoUrlInput.value);
    if (!id) { toast('Paste a valid YouTube link or video id.', 'error'); return; }
    App.Videos.setForName(currentVideoName, id);
    el.videoUrlInput.value = '';
    renderVideoBody();
    toast('Video pinned for ' + currentVideoName + '.', 'success');
  }
  function closeVideo() {
    el.videoFrame.src = '';            // stop playback
    el.videoModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  // ---------------------------------------------------------------- backup
  function setBackupStatus(msg) { el.backupStatus.textContent = msg || ''; }
  function exportData() {
    try {
      var obj = Store.exportData();
      var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'fitness-coach-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 200);
      setBackupStatus('Exported. Check your downloads.');
    } catch (e) {
      setBackupStatus('Export failed: ' + (e.message || 'error'));
    }
  }
  function importDataFile() {
    var f = el.importFile.files && el.importFile.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        if (!window.confirm('Restore from this file? It overwrites matching local data (workouts, summary, sessions, settings, videos). Your API key is untouched.')) {
          el.importFile.value = ''; return;
        }
        Store.importData(obj);
        refreshSettings();
        refreshHistory();
        renderSession(Store.getCurrentSession());
        setBackupStatus('Data restored.');
        toast('Backup restored.', 'success');
      } catch (e) {
        setBackupStatus('Import failed: ' + (e.message || 'invalid file'));
      }
      el.importFile.value = '';
    };
    reader.readAsText(f);
  }

  // ---------------------------------------------------------------- toast
  var toastTimer = null;
  function toast(msg, kind) {
    var box = $('toast');
    if (!box) { box = make('div'); box.id = 'toast'; document.body.appendChild(box); }
    box.className = 'toast show ' + (kind || 'info');
    box.textContent = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.className = 'toast'; }, 3600);
  }

  App.UI = {
    init: init,
    showScreen: showScreen,
    renderSession: renderSession,
    addUserMessage: addUserMessage,
    dropPendingTurn: dropPendingTurn,
    showTyping: showTyping,
    hideTyping: hideTyping,
    appendAssistantDelta: appendAssistantDelta,
    finishAssistant: finishAssistant,
    addLogChip: addLogChip,
    addSessionChip: addSessionChip,
    refreshHistory: refreshHistory,
    refreshSummary: refreshSummary,
    refreshSettings: refreshSettings,
    refreshSessions: refreshSessions,
    setSuggestBusy: setSuggestBusy,
    setComposerEnabled: setComposerEnabled,
    focusInput: focusInput,
    fillComposer: fillComposer,
    toast: toast,
    // import
    getImportText: getImportText,
    clearImportText: clearImportText,
    setImportStatus: setImportStatus,
    setImportBusy: setImportBusy,
    // call
    openCall: openCall,
    closeCall: closeCall,
    setCallState: setCallState,
    setCallTimer: setCallTimer,
    setCoachCaption: setCoachCaption,
    setUserCaption: setUserCaption,
    setCallMuted: setCallMuted,
    addAssistantBubble: addAssistantBubble,
    // timer
    startTimer: startTimer
  };
})();
