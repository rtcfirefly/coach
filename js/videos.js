/* videos.js — link exercises to YouTube demo videos.
 * No YouTube API key needed: we detect exercise names the coach mentions, embed a
 * pinned video if one is saved for that exercise, and otherwise offer a one-tap
 * YouTube search plus a "pin this video" box. Pins are remembered in localStorage. */
(function () {
  'use strict';
  window.App = window.App || {};
  var Store = App.Store;

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Common movements, so the coach's free-text recommendations get a Watch button
  // even before anything is logged. (Detection also includes the user's own log.)
  var COMMON_NAMES = [
    'Romanian Deadlift', 'Dumbbell Deadlift', 'Trap Bar Deadlift', 'Deadlift',
    'Goblet Squat', 'Back Squat', 'Front Squat', 'Bulgarian Split Squat', 'Split Squat', 'Lunge',
    'Weighted Step-Up', 'Step-Up', 'Hip Thrust', 'Single-Leg Glute Bridge', 'Glute Bridge',
    'Nordic Hamstring Curl', 'Leg Curl', 'Leg Extension', 'Calf Raise',
    'Incline Bench Press', 'Bench Press', 'Dumbbell Press', 'Overhead Press', 'Push-Up',
    'Ring Pull-Up', 'Pull-Up', 'Chin-Up', 'Lat Pulldown', 'Single-Arm Row', 'Bent-Over Row', 'Row',
    'Face Pull', 'Bicep Curl', 'Tricep Extension',
    'Copenhagen Plank', 'Side Plank', 'Plank', 'Farmer Carry', 'Suitcase Carry',
    'Band Rotational Chop', 'Russian Twist', 'Hanging Leg Raise',
    'Lateral Band Walk', 'Band Walk', 'Monster Walk', 'Clamshell', 'Side-Lying Leg Raise',
    'Fire Hydrant', 'Bird Dog', 'Dead Bug', 'Calf Raise', 'Wall Sit',
    'Kettlebell Swing', 'Burpee', 'Mountain Climber', 'Box Jump', 'Running', 'Rowing', 'Cycling'
  ];

  // Optional shipped name->videoId map (empty by default; users pin their own).
  var DICT = {};

  /* The index is derived from stored workouts and routines, so it only changes
     when those do. It was previously rebuilt per call — and detect() calls it
     once while separately re-reading the same two keys, i.e. four full parses of
     the workout list for every assistant message rendered. */
  var idxCache = null, loggedCache = null, cacheStamp = '';
  function storeStamp() {
    try {
      return String((localStorage.getItem('fit.workouts') || '').length) + ':' +
             String((localStorage.getItem('fit.routines') || '').length);
    } catch (e) { return ''; }
  }
  function ensureCache() {
    var st = storeStamp();
    if (idxCache && st === cacheStamp) return;
    cacheStamp = st;
    idxCache = buildNameIndex();
    loggedCache = {};
    try {
      (Store.getWorkouts() || []).forEach(function (w) {
        (w.exercises || []).forEach(function (ex) { if (ex.name) loggedCache[normalize(ex.name)] = true; });
      });
      (Store.getRoutines() || []).forEach(function (r) {
        (r.exercises || []).forEach(function (n) { if (n) loggedCache[normalize(n)] = true; });
      });
    } catch (e) {}
  }

  function buildNameIndex() {
    var names = COMMON_NAMES.slice();
    try {
      (Store.getWorkouts() || []).forEach(function (w) {
        (w.exercises || []).forEach(function (ex) { if (ex.name) names.push(ex.name); });
      });
      (Store.getRoutines() || []).forEach(function (r) {
        (r.exercises || []).forEach(function (n) { if (n) names.push(n); });
      });
    } catch (e) {}
    var seen = {}, out = [];
    names.forEach(function (n) {
      var k = normalize(n);
      if (k && !seen[k]) { seen[k] = true; out.push(n); }
    });
    out.sort(function (a, b) { return b.length - a.length; }); // longest first
    return out;
  }

  // Find exercise names mentioned in a block of text.
  function detect(text) {
    if (!text) return [];
    var nt = ' ' + normalize(text) + ' ';
    ensureCache();
    var logged = loggedCache;
    var names = idxCache;
    var accepted = [], acceptedNorm = [];
    names.forEach(function (name) {
      var c = normalize(name);
      if (!c) return;
      // Avoid false positives from short, common words ("row", "running") unless
      // they're multi-word, fairly long, or actually in the user's log.
      var ok = (c.indexOf(' ') !== -1) || c.length >= 7 || logged[c];
      if (!ok) return;
      if (nt.indexOf(' ' + c + ' ') === -1 && nt.indexOf(' ' + c + 's ') === -1) return; // allow simple plural
      for (var i = 0; i < acceptedNorm.length; i++) {
        if (acceptedNorm[i].indexOf(c) !== -1) return; // already covered by a longer match
      }
      accepted.push(name); acceptedNorm.push(c);
    });
    return accepted.slice(0, 6);
  }

  function idFor(name) {
    var n = normalize(name);
    return (Store.getVideos() || {})[n] || DICT[n] || null;
  }
  function setForName(name, id) { Store.setVideoFor(normalize(name), id || ''); }

  function parseId(input) {
    if (!input) return null;
    input = String(input).trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
    var m;
    if ((m = input.match(/[?&]v=([A-Za-z0-9_-]{11})/))) return m[1];
    if ((m = input.match(/youtu\.be\/([A-Za-z0-9_-]{11})/))) return m[1];
    if ((m = input.match(/\/embed\/([A-Za-z0-9_-]{11})/))) return m[1];
    if ((m = input.match(/\/shorts\/([A-Za-z0-9_-]{11})/))) return m[1];
    return null;
  }

  function searchUrl(name) {
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name + ' exercise proper form');
  }
  function embedUrl(id) {
    return 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0&modestbranding=1';
  }

  App.Videos = {
    normalize: normalize,
    detect: detect,
    idFor: idFor,
    setForName: setForName,
    parseId: parseId,
    invalidate: function () { idxCache = null; cacheStamp = ''; },
    searchUrl: searchUrl,
    embedUrl: embedUrl
  };
})();
