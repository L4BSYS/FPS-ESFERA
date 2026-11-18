// js/29-progress.js (part 29). LaGrieta FPS — progresión del jugador.
//
// Guarda el tiempo jugado, calcula el rango y desbloquea opciones del menú.
// Persiste en localStorage (siempre) y en Firestore `fpsProfiles/{uid}`
// cuando hay sesión. El FPS embebido comparte la sesión con el sitio.
//
// Reglas de diseño:
// - El tiempo sólo corre mientras se juega (no en menú/pausa/pestaña oculta).
// - Un invitado también progresa; al ingresar, su tiempo se fusiona.
// - Los desbloqueos son por minutos acumulados, no por partida.

(function () {
  'use strict';

  var STORAGE_PREFIX = 'lagrieta_fps_progress:';
  var FLUSH_EVERY_MS = 30000;
  var TICK_MS = 1000;
  var MAX_SECONDS = 100000000;

  // Rangos: nombre visible, minutos necesarios y una frase de progresión.
  var RANKS = [
    { id: 'vecino', name: 'Vecino nuevo', minutes: 0, blurb: 'Recién llegado al conurbano. Todo por descubrir.' },
    { id: 'barrio', name: 'Pibe de barrio', minutes: 10, blurb: 'Ya sabés juntar recursos y volver vivo.' },
    { id: 'sobreviviente', name: 'Sobreviviente', minutes: 30, blurb: 'La noche ya no te agarra desprevenido.' },
    { id: 'veterano', name: 'Veterano de la grieta', minutes: 60, blurb: 'Conocés el mapa, los atajos y a sus vecinos.' },
    { id: 'leyenda', name: 'Leyenda del conurbano', minutes: 180, blurb: 'Tu nombre circula en las salas.' },
    { id: 'dueno', name: 'Dueño de la grieta', minutes: 360, blurb: 'El conurbano cósmico te debe favores.' }
  ];

  // Minutos jugados necesarios para desbloquear cada opción avanzada.
  var UNLOCKS = {
    mine: 10,
    playground: 30,
    build: 30,
    online: 60,
    community: 60,
    create: 60
  };

  var UNLOCK_LABELS = {
    mine: 'Mis mundos',
    playground: 'Playground',
    build: 'Constructor libre',
    online: 'Jugar con amigos',
    community: 'Comunidad',
    create: 'Crear mundo'
  };

  var state = {
    uid: null,
    totalSeconds: 0,
    sessionSeconds: 0,
    sessions: 0,
    lastPlayedAt: null,
    loaded: false,
    dirty: false,
    lastTick: 0,
    lastFlush: 0,
    lastLocalSave: 0,
    flushing: false,
    sessionCounted: false,
    authBound: false,
    lastRankIndex: null,
    unlockedCache: null
  };

  /* ------------------------------------------------------------------ */
  /* Persistencia local                                                  */
  /* ------------------------------------------------------------------ */

  function storageKey() {
    return STORAGE_PREFIX + (state.uid || 'guest');
  }

  function readStored(key) {
    var data = {};
    try {
      var raw = localStorage.getItem(key);
      if (raw) data = JSON.parse(raw) || {};
    } catch (e) {}
    return {
      totalSeconds: Math.max(0, Math.min(MAX_SECONDS, Number(data.totalSeconds) || 0)),
      sessions: Math.max(0, Number(data.sessions) || 0),
      lastPlayedAt: data.lastPlayedAt || null
    };
  }

  function applyStored(key) {
    var data = readStored(key);
    state.totalSeconds = data.totalSeconds;
    state.sessions = data.sessions;
    state.lastPlayedAt = data.lastPlayedAt;
  }

  function saveLocal(force) {
    var now = Date.now();
    if (!force && now - state.lastLocalSave < 5000) return;
    state.lastLocalSave = now;
    try {
      localStorage.setItem(storageKey(), JSON.stringify({
        totalSeconds: Math.floor(state.totalSeconds),
        sessions: state.sessions,
        lastPlayedAt: state.lastPlayedAt || now
      }));
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ */
  /* Firestore                                                           */
  /* ------------------------------------------------------------------ */

  function firestoreReady() {
    try {
      return !!(window.firebase && firebase.firestore && firebase.apps && firebase.apps.length);
    } catch (e) {
      return false;
    }
  }

  function profileDoc(uid) {
    return firebase.firestore().collection('fpsProfiles').doc(uid);
  }

  function loadRemote(user) {
    if (!firestoreReady()) return Promise.resolve();
    return profileDoc(user.uid).get().then(function (snap) {
      var data = snap && snap.exists ? snap.data() : {};
      var remote = Math.max(0, Math.min(MAX_SECONDS, Number(data.totalSeconds) || 0));
      var remoteSessions = Math.max(0, Number(data.sessions) || 0);
      // Nunca perdemos el tiempo local: nos quedamos con el mayor.
      state.totalSeconds = Math.max(state.totalSeconds, remote);
      state.sessions = Math.max(state.sessions, remoteSessions);
      if (data.lastPlayedAt && !state.lastPlayedAt) {
        state.lastPlayedAt = data.lastPlayedAt;
      }
      state.loaded = true;
      state.dirty = state.totalSeconds > remote;
      saveLocal(true);
      syncMilestones(true);
      if (state.dirty) flush(true);
      notifyChange();
    }).catch(function (error) {
      console.warn('No se pudo leer la progresión del FPS:', error);
      state.loaded = true;
      notifyChange();
    });
  }

  function flush(force) {
    saveLocal(true);
    if (!state.uid || !state.dirty || !firestoreReady()) return Promise.resolve();
    if (state.flushing && !force) return Promise.resolve();
    state.flushing = true;
    state.lastFlush = Date.now();
    var payload = {
      totalSeconds: Math.floor(state.totalSeconds),
      sessions: state.sessions,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (state.lastPlayedAt) payload.lastPlayedAt = state.lastPlayedAt;
    return profileDoc(state.uid).set(payload, { merge: true })
      .then(function () {
        state.dirty = false;
      })
      .catch(function (error) {
        console.warn('No se pudo guardar la progresión del FPS:', error);
      })
      .then(function () {
        state.flushing = false;
      });
  }

  /* ------------------------------------------------------------------ */
  /* Tiempo jugado                                                       */
  /* ------------------------------------------------------------------ */

  function isPlaying() {
    try {
      if (document.hidden) return false;
      if (typeof isGamePaused === 'undefined' || isGamePaused) return false;
      if (typeof LEVEL !== 'undefined' && LEVEL) {
        if (LEVEL.menuOpen || LEVEL.loading) return false;
      }
      if (typeof player === 'undefined' || !player) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function tick() {
    var now = Date.now();
    var elapsed = state.lastTick ? (now - state.lastTick) / 1000 : 0;
    state.lastTick = now;
    // Si la pestaña estuvo suspendida, no acredites horas de golpe.
    if (elapsed < 0 || elapsed > 5) elapsed = 0;
    if (!isPlaying()) return;

    if (!state.sessionCounted) {
      state.sessionCounted = true;
      state.sessions += 1;
      state.lastPlayedAt = now;
    }
    state.totalSeconds = Math.min(MAX_SECONDS, state.totalSeconds + elapsed);
    state.sessionSeconds = Math.min(MAX_SECONDS, state.sessionSeconds + elapsed);
    state.dirty = true;
    syncMilestones(false);
    saveLocal(false);
    if (now - state.lastFlush >= FLUSH_EVERY_MS) flush(false);
  }

  /* ------------------------------------------------------------------ */
  /* Rangos y desbloqueos                                                */
  /* ------------------------------------------------------------------ */

  function formatDuration(seconds) {
    var s = Math.max(0, Math.floor(Number(seconds) || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + ' h ' + m + ' min';
    if (m > 0) return m + ' min';
    return s + ' s';
  }

  function formatPoints(value) {
    try { return Number(value || 0).toLocaleString('es-AR'); } catch (e) {
      return String(Math.round(Number(value) || 0));
    }
  }

  function rankInfo(seconds) {
    var total = seconds == null ? state.totalSeconds : seconds;
    var minutes = Math.max(0, total / 60);
    var index = 0;
    for (var i = 0; i < RANKS.length; i++) {
      if (minutes >= RANKS[i].minutes) index = i;
    }
    var current = RANKS[index];
    var next = RANKS[index + 1] || null;
    var pct = 100;
    var remaining = 0;
    if (next) {
      var span = Math.max(1, next.minutes - current.minutes);
      pct = Math.max(0, Math.min(100, ((minutes - current.minutes) / span) * 100));
      remaining = Math.max(0, next.minutes - minutes);
    }
    return {
      current: current,
      next: next,
      index: index,
      pct: pct,
      minutes: minutes,
      remainingSeconds: remaining * 60
    };
  }

  function unlocked(feature) {
    if (!feature || !(feature in UNLOCKS)) return true;
    return (state.totalSeconds / 60) >= UNLOCKS[feature];
  }

  function nextUnlock(seconds) {
    var total = seconds == null ? state.totalSeconds : seconds;
    var minutes = Math.max(0, total / 60);
    var best = null;
    Object.keys(UNLOCKS).forEach(function (key) {
      var need = UNLOCKS[key];
      if (minutes >= need) return;
      if (!best || need < best.minutes) {
        best = { key: key, minutes: need, label: UNLOCK_LABELS[key] || key };
      }
    });
    return best;
  }

  function toast(message) {
    try {
      if (typeof lvToast === 'function') { lvToast(message); return; }
    } catch (e) {}
    try {
      if (typeof showMessage === 'function') { showMessage(message); return; }
    } catch (e) {}
  }

  // Avisa en el HUD cuando sube el rango o se desbloquea algo nuevo.
  // En cargas silenciosas (perfil remoto) sólo actualiza el estado interno.
  function syncMilestones(silent) {
    var info = rankInfo();
    if (state.lastRankIndex == null) {
      state.lastRankIndex = info.index;
    } else if (info.index > state.lastRankIndex) {
      state.lastRankIndex = info.index;
      if (!silent) toast('🏅 Nuevo rango: ' + info.current.name);
    } else if (info.index < state.lastRankIndex) {
      state.lastRankIndex = info.index;
    }

    var cache = state.unlockedCache || {};
    Object.keys(UNLOCKS).forEach(function (key) {
      var now = unlocked(key);
      if (now && !cache[key]) {
        cache[key] = true;
        if (!silent) toast('🔓 Desbloqueado: ' + (UNLOCK_LABELS[key] || key));
      } else if (!now) {
        cache[key] = false;
      }
    });
    state.unlockedCache = cache;
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                  */
  /* ------------------------------------------------------------------ */

  function notifyChange() {
    try {
      document.dispatchEvent(new CustomEvent('lagrieta:fps-progress', {
        detail: {
          totalSeconds: Math.floor(state.totalSeconds),
          rank: rankInfo().current
        }
      }));
    } catch (e) {}
  }

  function renderCard() {
    var card = document.createElement('div');
    card.className = 'rg-home-card rg-progress-card';

    var info = rankInfo();
    var head = document.createElement('h3');
    head.textContent = 'Progresión';
    card.appendChild(head);

    var rank = document.createElement('div');
    rank.className = 'rg-rank-name';
    rank.textContent = info.current.name;
    card.appendChild(rank);

    var blurb = document.createElement('p');
    blurb.className = 'rg-rank-blurb';
    blurb.textContent = info.current.blurb;
    card.appendChild(blurb);

    var bar = document.createElement('div');
    bar.className = 'rg-progress-bar';
    var fill = document.createElement('div');
    fill.className = 'rg-progress-fill';
    fill.style.width = info.pct.toFixed(1) + '%';
    bar.appendChild(fill);
    card.appendChild(bar);

    var time = document.createElement('p');
    time.className = 'rg-rank-time';
    time.textContent = 'Tiempo jugado: ' + formatDuration(state.totalSeconds) +
      (info.next ? ' · Próximo rango: ' + info.next.name +
        ' (faltan ' + formatDuration(info.remainingSeconds) + ')' :
        ' · Rango máximo alcanzado');
    card.appendChild(time);

    var unlock = nextUnlock();
    var unlockEl = document.createElement('p');
    unlockEl.className = 'rg-rank-unlock';
    if (unlock) {
      unlockEl.textContent = 'Próximo desbloqueo: ' + unlock.label +
        ' a los ' + unlock.minutes + ' min jugados.';
    } else {
      unlockEl.textContent = 'Tenés todo el menú desbloqueado. Ahora queda dominar la grieta.';
    }
    card.appendChild(unlockEl);

    // Aporte de la sesión actual a la grieta (30-influence.js).
    try {
      if (typeof fpsInfluenceBreakdown === 'function') {
        var b = fpsInfluenceBreakdown();
        var inf = document.createElement('p');
        inf.className = 'rg-rank-influence';
        inf.textContent = 'Aporte de esta sesión: ' + formatPoints(b.total) +
          ' pts (' + b.kills + ' bajas · ' + b.blocks + ' bloques · oleada ' +
          b.wave + ')';
        card.appendChild(inf);
      }
    } catch (e) {}

    return card;
  }

  /* ------------------------------------------------------------------ */
  /* Sesión                                                              */
  /* ------------------------------------------------------------------ */

  function handleAuth(user) {
    var previousUid = state.uid;
    var previousSeconds = state.totalSeconds;
    flush(true);

    state.uid = user ? user.uid : null;
    state.loaded = false;
    state.sessionCounted = false;
    applyStored(storageKey());

    // Si venías jugando como invitado, ese tiempo pasa a tu cuenta.
    if (user && !previousUid && previousSeconds > state.totalSeconds) {
      state.totalSeconds = previousSeconds;
      state.dirty = true;
    }
    if (user && previousUid === user.uid) {
      state.totalSeconds = Math.max(state.totalSeconds, previousSeconds);
    }

    if (user) {
      syncMilestones(true);
      loadRemote(user);
    } else {
      state.loaded = true;
      syncMilestones(true);
      saveLocal(true);
      notifyChange();
    }
  }

  function bindAuth() {
    if (state.authBound) return;
    try {
      if (!window.firebase || !firebase.auth || !firebase.apps || !firebase.apps.length) {
        setTimeout(bindAuth, 500);
        return;
      }
      state.authBound = true;
      firebase.auth().onAuthStateChanged(function (user) {
        handleAuth(user);
      });
    } catch (e) {
      setTimeout(bindAuth, 800);
    }
  }

  function start() {
    applyStored(storageKey());
    syncMilestones(true);
    state.lastTick = Date.now();
    state.lastFlush = Date.now();
    setInterval(tick, TICK_MS);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) flush(true);
    });
    window.addEventListener('pagehide', function () { flush(true); });
    window.addEventListener('beforeunload', function () { flush(true); });

    bindAuth();
    notifyChange();
  }

  /* ------------------------------------------------------------------ */
  /* API pública                                                         */
  /* ------------------------------------------------------------------ */

  window.fpsProgressGet = function () {
    return {
      totalSeconds: Math.floor(state.totalSeconds),
      sessionSeconds: Math.floor(state.sessionSeconds),
      sessions: state.sessions,
      lastPlayedAt: state.lastPlayedAt,
      uid: state.uid,
      rank: rankInfo().current
    };
  };
  // Tiempo de la sesión actual (sólo cuenta mientras se juega). Lo usa el
  // módulo de influencia para puntuar sin premiar el tiempo en pausa.
  window.fpsProgressSessionSeconds = function () {
    return Math.floor(state.sessionSeconds);
  };
  window.fpsProgressRank = rankInfo;
  window.fpsProgressUnlocked = unlocked;
  window.fpsProgressNextUnlock = nextUnlock;
  window.fpsProgressFormat = formatDuration;
  window.fpsProgressRenderCard = renderCard;
  window.fpsProgressFlush = flush;
  window.fpsProgressStart = start;

  start();
})();
