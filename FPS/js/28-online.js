// js/28-online.js (part 28). LaGrieta FPS — Fase 1: salas cooperativas.
// Contrato RTDB: rooms/{roomId}/{meta,players,playersInfo,state,world,build,events,actions,chat}
// - 2 a 5 jugadores, host autoritativo del mundo.
// - La pose la publica 17-net.js en rooms/{id}/players cuando netSetRoom(id) está activo.
// - Firestore no se toca durante la partida: sólo se guarda al salir/terminar.
// Sin sesión no hace nada y no rompe el modo local.

var ONLINE_CONFIG = {
  protocolVersion: 1,
  maxPlayers: 5,
  defaultLevel: 'mundo-1',
  codeLength: 6,
  codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // sin I, O, 0, 1
  hostHeartbeatMs: 5000,
  hostTimeoutMs: 15000,   // tolera pestañas en segundo plano sin migrar de más
  hostClaimCooldownMs: 10000,
  presenceHeartbeatMs: 12000,
  staleMs: 32000, // un jugador sin latido por 32 s se considera desconectado
  snapshotMs: 2000,
  maxWorldBlocks: 800,
  maxWorldItems: 200,
  maxWorldNodes: 400,
  maxWorldSpawns: 30,
  maxWorldZones: 30,
  maxWorldTotems: 30,
  maxWorldStatics: 60,
  maxWorldContainers: 40,
  maxWorldStairs: 40,
  maxWorldDoors: 20,
  eventRetentionMs: 60000,
  // Límites anti-abuso. El host es la única autoridad que escribe build/events.
  maxBuildDeltas: 2000,
  maxActionsPerUser: 20,
  actionSlots: 8,
  maxChatMessages: 200,
  actionRetentionMs: 20000,
  buildActionMaxPerSec: 8,
  maxBenchesPerPlayer: 4,
  staleRoomMs: 900000 // 15 min sin latido: sala abandonada
};

var ONLINE = {
  roomId: null,
  code: null,
  isHost: false,
  meta: null,
  state: null,
  info: {},
  ready: false,
  busy: false,
  error: '',
  loadedLevel: null,
  worldStamp: null,
  worldLoading: false,
  tick: 0,
  lastHostBeat: 0,
  lastHostMetaAt: 0,
  lastSnapshot: 0,
  lastSeen: 0,
  lastClaim: 0,
  uiAcc: 0,
  refs: null,
  subs: null,
  heartbeatTimer: 0,
  roomLevel: null,
  startedAt: 0,
  leaving: false,
  seed: 0,
  buildReady: false,
  buildQueue: {},
  applyingRemote: false,
  applyingWorld: false,
  applyingRemoteBench: false,
  lastBenchSync: 0,
  pendingWave: 0,
  spawnedWave: 0,
  eventSince: 0,
  down: false,
  downAt: 0,
  lastBaseEvent: 0,
  lastEventPrune: 0,
  connected: null,
  disconnectedAt: 0,
  lastPrune: 0,
  lastWorldTry: 0,
  actionSeq: 0,
  lastReviveAsk: 0,
  actionsRootSub: null,
  actionSubs: {},
  inviteCode: null,
  buildKeys: {},
  buildCount: 0,
  buildRate: {},
  lastActionPrune: 0,
  lastChatPrune: 0
};

function onlineUser() {
  try { return (window.firebase && firebase.auth) ? firebase.auth().currentUser : null; } catch (e) { return null; }
}
function onlineDb() {
  try {
    if (typeof netDb === 'function') return netDb();
    return firebase.database();
  } catch (e) { return null; }
}
function onlineToast(text) {
  try { if (typeof lvToast === 'function') lvToast(text); } catch (e) {}
  try { if (typeof setPauseStatus === 'function') setPauseStatus(text); } catch (e) {}
}
function onlineIsActive() {
  return !!(ONLINE.roomId && ONLINE.meta);
}
function onlineNormalizeCode(code) {
  return String(code == null ? '' : code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ONLINE_CONFIG.codeLength);
}
function onlineRoomCodeValid(code) {
  const c = onlineNormalizeCode(code);
  return c.length === ONLINE_CONFIG.codeLength && c.split('').every(function (ch) {
    return ONLINE_CONFIG.codeAlphabet.indexOf(ch) >= 0;
  });
}
function onlineGenerateCode() {
  const alphabet = ONLINE_CONFIG.codeAlphabet;
  let out = '';
  try {
    if (window.crypto && crypto.getRandomValues) {
      const buf = new Uint32Array(ONLINE_CONFIG.codeLength);
      crypto.getRandomValues(buf);
      for (let i = 0; i < ONLINE_CONFIG.codeLength; i++) out += alphabet[buf[i] % alphabet.length];
      return out;
    }
  } catch (e) {}
  for (let i = 0; i < ONLINE_CONFIG.codeLength; i++) out += alphabet[(Math.random() * alphabet.length) | 0];
  return out;
}
function onlineOwnName(user) {
  return String((user && (user.displayName || (user.email ? user.email.split('@')[0] : null))) || 'Jugador').slice(0, 16);
}
function onlineOwnColor(user) {
  try { return netColorFor(user.uid); } catch (e) { return '#33ff66'; }
}
function onlineOwnInfo(user, ready, code) {
  return {
    n: onlineOwnName(user),
    c: onlineOwnColor(user),
    ready: !!ready,
    lastSeen: onlineServerNowMs(),
    down: false,
    code: code || ''
  };
}
function onlineRoomRef(path) {
  const db = onlineDb();
  if (!db || !ONLINE.roomId) return null;
  return db.ref('rooms/' + ONLINE.roomId + (path ? '/' + path : ''));
}
function onlineRoomLevel() {
  return ONLINE.roomLevel || (ONLINE.meta && ONLINE.meta.levelId) || ONLINE_CONFIG.defaultLevel;
}
// Sólo mundos built-in: un host malicioso no debe poder forzar escenas custom
// en la sesión de los invitados.
function onlineSafeLevelId(id) {
  try {
    const def = (typeof LEVEL !== 'undefined' && LEVEL.defs) ? LEVEL.defs[id] : null;
    if (def && def.kind !== 'user' && !def.shared) return id;
  } catch (e) {}
  return ONLINE_CONFIG.defaultLevel;
}
function onlineSeedFromString(s) {
  let h = 2166136261;
  const str = String(s || 'lagrieta');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function onlineSeed() {
  const s = Number(ONLINE.seed || 0);
  return s ? (s >>> 0) : onlineSeedFromString(ONLINE.roomId || 'lagrieta');
}
function onlineIsStale(uid, now) {
  const d = ONLINE.info[uid];
  if (!d) return true;
  const seen = Number(d.lastSeen || 0);
  if (!seen) return false;
  const current = (now != null) ? now : onlineServerNowMs();
  return (current - seen) > ONLINE_CONFIG.staleMs;
}
function onlinePlayerCount() {
  const now = onlineServerNowMs();
  let n = 0;
  for (const uid in ONLINE.info) {
    if (!onlineIsStale(uid, now)) n++;
  }
  return Math.max(1, n);
}
function onlineOtherUids() {
  const me = onlineUser();
  const now = onlineServerNowMs();
  return Object.keys(ONLINE.info).filter(function (uid) {
    return (!me || uid !== me.uid) && !onlineIsStale(uid, now);
  });
}
function onlineBlockKey(x, y, z) {
  return Math.round(x * 2) + '_' + Math.round(y * 2) + '_' + Math.round(z * 2);
}
function onlineServerNow() {
  try {
    if (window.firebase && firebase.database && firebase.database.ServerValue) {
      return firebase.database.ServerValue.TIMESTAMP;
    }
  } catch (e) {}
  return Date.now();
}
// Hora estimada del servidor: evita descartar eventos por relojes desfasados.
function onlineServerNowMs() {
  let offset = 0;
  try {
    const db = onlineDb();
    if (db) offset = Number(db.ref('.info/serverTimeOffset').val()) || 0;
  } catch (e) {}
  return Date.now() + offset;
}
function onlineBlockTypeAllowed(t) {
  try { return !!(typeof BLOCK_MATERIALS !== 'undefined' && BLOCK_MATERIALS[t]); } catch (e) { return false; }
}
function onlineTrackBuildKey(key) {
  if (!key || ONLINE.buildKeys[key]) return;
  ONLINE.buildKeys[key] = 1;
  ONLINE.buildCount = (ONLINE.buildCount || 0) + 1;
}
// Límite simple por segundo para acciones de construcción de invitados.
function onlineAllowBuild(uid) {
  if (!uid) return false;
  const now = Date.now();
  let bucket = ONLINE.buildRate[uid];
  if (!bucket || now - bucket.t > 1000) {
    bucket = ONLINE.buildRate[uid] = { t: now, n: 0 };
  }
  if (bucket.n >= ONLINE_CONFIG.buildActionMaxPerSec) return false;
  bucket.n++;
  return true;
}
// Los invitados no escriben build directamente: mandan una acción al host.
function onlineSendAction(action) {
  if (!ONLINE.roomId || !ONLINE.refs || !ONLINE.refs.actions || !action) return false;
  const me = onlineUser();
  if (!me) return false;
  const seq = ++ONLINE.actionSeq;
  const slot = String(seq % ONLINE_CONFIG.actionSlots);
  const ref = ONLINE.refs.actions.child(me.uid).child(slot);
  try {
    ref.set(Object.assign({ at: onlineServerNow(), by: me.uid, s: seq }, action));
    // El dueño limpia su acción; el host también poda las vencidas.
    setTimeout(function () {
      try {
        ref.once('value').then(function (snap) {
          const v = snap.val();
          if (v && Number(v.s) === seq) ref.remove();
        }).catch(function () {});
      } catch (e) {}
    }, 6000);
    return true;
  } catch (e) { return false; }
}
function onlineEnsureBanner() {
  if (typeof document === 'undefined' || !document.body) return null;
  let el = document.getElementById('onlineConnBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'onlineConnBanner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:6px 10px;text-align:center;' +
      'font:600 13px/1.3 system-ui,-apple-system,sans-serif;background:#7a2a2a;color:#fff;display:none;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;';
    document.body.appendChild(el);
  }
  return el;
}
function onlineSetBanner(text, kind) {
  const el = onlineEnsureBanner();
  if (!el) return;
  if (!text) { el.style.display = 'none'; return; }
  el.textContent = text;
  el.style.display = 'block';
  el.style.background = kind === 'ok' ? '#1f6b3a' : (kind === 'warn' ? '#7a5a12' : '#7a2a2a');
}
function onlinePreserveLocalWorld() {
  try {
    if (ONLINE.roomId) return;
    if (typeof LEVEL === 'undefined' || !LEVEL || !LEVEL.current) return;
    if (LEVEL.transientWorld) return;
    if (typeof saveLevelSnapshot === 'function') saveLevelSnapshot(LEVEL.current);
  } catch (e) {}
}
function onlineInviteUrl() {
  const code = ONLINE.code;
  if (!code) return null;
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('sala', code);
    u.hash = '';
    return u.toString();
  } catch (e) {
    return window.location.origin + window.location.pathname + '?sala=' + code;
  }
}

// --- Códigos de sala ---
function onlineClaimCode(db, code, roomId, uid) {
  return db.ref('roomCodes/' + code).transaction(function (cur) {
    if (cur) return; // ya existe: abortar
    return { roomId: roomId, host: uid, createdAt: Date.now() };
  }).then(function (res) {
    return !!(res && res.committed);
  }).catch(function () { return false; });
}

// --- Crear / unir / salir ---
async function onlineCreateRoom(opts) {
  opts = opts || {};
  if (ONLINE.busy) return null;
  const user = onlineUser();
  if (!user) { onlineToast('Ingresá con Google para crear una sala'); return null; }
  const db = onlineDb();
  if (!db) { onlineToast('Firebase todavía no está listo'); return null; }
  ONLINE.busy = true;
  ONLINE.error = '';
  onlineRefreshUI();
  try {
    if (ONLINE.roomId) await onlineLeaveRoom({ silent: true });
    onlinePreserveLocalWorld();
    const roomId = db.ref('rooms').push().key;
    let levelId = onlineSafeLevelId(opts.levelId || ((typeof LEVEL !== 'undefined' && LEVEL.current && !LEVEL.transientWorld) ? LEVEL.current : ONLINE_CONFIG.defaultLevel));
    const seed = (Date.now() ^ ((Math.random() * 0x7fffffff) | 0)) >>> 0;
    const now = Date.now();
    const meta = {
      v: ONLINE_CONFIG.protocolVersion,
      host: user.uid,
      hostEpoch: 1,
      hostSeen: onlineServerNow(),
      levelId: levelId,
      seed: seed,
      mode: 'coop',
      status: 'lobby',
      maxPlayers: ONLINE_CONFIG.maxPlayers,
      playerCount: 1,
      createdAt: now,
      updatedAt: now
    };
    const world = {
      v: ONLINE_CONFIG.protocolVersion,
      levelId: levelId,
      seed: seed,
      mode: 'coop',
      createdAt: now
    };
    // Orden obligatorio por reglas:
    // 1) rooms/{id}/meta (define el host), 2) roomCodes/{code} (apunta a la
    // sala), 3) playersInfo/{uid} (incluye el código como prueba de pertenencia).
    try {
      await db.ref('rooms/' + roomId + '/meta').set(meta);
      await db.ref('rooms/' + roomId + '/world').set(world);
    } catch (writeErr) {
      try { await db.ref('rooms/' + roomId).remove(); } catch (e3) {}
      throw writeErr;
    }
    let code = null;
    let claimed = false;
    for (let i = 0; i < 8 && !claimed; i++) {
      code = onlineGenerateCode();
      claimed = await onlineClaimCode(db, code, roomId, user.uid);
    }
    if (!claimed) {
      try { await db.ref('rooms/' + roomId).remove(); } catch (e4) {}
      throw new Error('No se pudo reservar un código de sala');
    }
    try {
      await db.ref('rooms/' + roomId + '/playersInfo/' + user.uid).set(onlineOwnInfo(user, false, code));
      try { db.ref('rooms/' + roomId + '/playersInfo/' + user.uid).onDisconnect().remove(); } catch (e) {}
      try { db.ref('rooms/' + roomId + '/players/' + user.uid).onDisconnect().remove(); } catch (e) {}
    } catch (infoErr) {
      try { await db.ref('roomCodes/' + code).remove(); } catch (e5) {}
      try { await db.ref('rooms/' + roomId).remove(); } catch (e6) {}
      throw infoErr;
    }
    await onlineAttach({ roomId: roomId, code: code, isHost: true, meta: meta, levelId: levelId });
    onlineToast('Sala ' + code + ' creada. Compartí el código.');
    return { roomId: roomId, code: code };
  } catch (e) {
    ONLINE.error = (e && e.message) || 'No se pudo crear la sala';
    console.error('onlineCreateRoom', e);
    onlineToast('No se pudo crear la sala: ' + ONLINE.error);
    return null;
  } finally {
    ONLINE.busy = false;
    onlineRefreshUI();
  }
}

async function onlineJoinRoom(rawCode) {
  if (ONLINE.busy) return false;
  const user = onlineUser();
  if (!user) { onlineToast('Ingresá con Google para unirte a una sala'); return false; }
  const code = onlineNormalizeCode(rawCode);
  if (!onlineRoomCodeValid(code)) { ONLINE.error = 'Código inválido: usá 6 letras/números'; onlineToast(ONLINE.error); return false; }
  const db = onlineDb();
  if (!db) { onlineToast('Firebase todavía no está listo'); return false; }
  ONLINE.busy = true;
  ONLINE.error = '';
  onlineRefreshUI();
  try {
    const codeSnap = await db.ref('roomCodes/' + code).get();
    if (!codeSnap.exists()) throw new Error('Ese código no existe o venció');
    const ref = codeSnap.val() || {};
    const roomId = ref.roomId;
    if (!roomId) throw new Error('Código de sala inválido');
    const metaSnap = await db.ref('rooms/' + roomId + '/meta').get();
    if (!metaSnap.exists()) throw new Error('La sala ya no existe');
    const meta = metaSnap.val() || {};
    // Sala abandonada: el host dejó de latir hace mucho y nadie la limpió.
    const updatedAt = Number(meta.updatedAt || 0);
    if (updatedAt && onlineServerNowMs() - updatedAt > ONLINE_CONFIG.staleRoomMs) {
      try { await db.ref('rooms/' + roomId).remove(); } catch (e) {}
      try { await db.ref('roomCodes/' + code).remove(); } catch (e) {}
      throw new Error('La sala venció por inactividad');
    }
    if (Number(meta.v || 0) !== ONLINE_CONFIG.protocolVersion) throw new Error('Versión incompatible');
    meta.levelId = onlineSafeLevelId(meta.levelId);
    if (meta.status === 'ended') throw new Error('La partida ya terminó');
    if (Number(meta.playerCount || 1) >= Number(meta.maxPlayers || ONLINE_CONFIG.maxPlayers)) throw new Error('La sala está llena');
    if (ONLINE.roomId) await onlineLeaveRoom({ silent: true });
    onlinePreserveLocalWorld();
    const infoRef = db.ref('rooms/' + roomId + '/playersInfo/' + user.uid);
    await infoRef.set(onlineOwnInfo(user, false, code));
    try { infoRef.onDisconnect().remove(); } catch (e) {}
    await onlineAttach({ roomId: roomId, code: code, isHost: (meta.host === user.uid), meta: meta, levelId: meta.levelId });
    onlineToast('Entraste a la sala ' + code);
    if (meta.status === 'playing') onlineEnsureLevel(meta.levelId);
    return true;
  } catch (e) {
    ONLINE.error = (e && e.message) || 'No se pudo unir a la sala';
    console.warn('onlineJoinRoom', e);
    onlineToast('No se pudo unir: ' + ONLINE.error);
    return false;
  } finally {
    ONLINE.busy = false;
    onlineRefreshUI();
  }
}

async function onlineAttach(opts) {
  onlineDetach();
  ONLINE.roomId = opts.roomId;
  ONLINE.code = opts.code || null;
  ONLINE.isHost = !!opts.isHost;
  ONLINE.meta = opts.meta || null;
  ONLINE.roomLevel = onlineSafeLevelId(opts.levelId || (opts.meta && opts.meta.levelId) || ONLINE_CONFIG.defaultLevel);
  ONLINE.info = {};
  ONLINE.state = null;
  ONLINE.ready = false;
  ONLINE.error = '';
  ONLINE.tick = 0;
  ONLINE.lastHostBeat = 0;
  ONLINE.lastHostMetaAt = opts.meta ? Date.now() : 0;
  ONLINE.lastSnapshot = 0;
  ONLINE.lastSeen = 0;
  ONLINE.lastClaim = 0;
  ONLINE.startedAt = 0;
  ONLINE.loadedLevel = null;
  ONLINE.worldStamp = null;
  ONLINE.seed = Number(opts.meta && opts.meta.seed) || onlineSeedFromString(ONLINE.roomId);
  ONLINE.buildReady = false;
  ONLINE.buildQueue = {};
  ONLINE.pendingWave = 0;
  ONLINE.spawnedWave = 0;
  ONLINE.eventSince = onlineServerNowMs() - 1500;
  ONLINE.down = false;
  ONLINE.downAt = 0;
  ONLINE.lastBaseEvent = 0;
  ONLINE.lastEventPrune = 0;
  ONLINE.connected = null;
  ONLINE.disconnectedAt = 0;
  ONLINE.lastPrune = 0;
  ONLINE.lastWorldTry = 0;
  ONLINE.actionSeq = 0;
  ONLINE.lastReviveAsk = 0;
  ONLINE.actionsRootSub = null;
  ONLINE.actionSubs = {};
  ONLINE.buildKeys = {};
  ONLINE.buildCount = 0;
  ONLINE.buildRate = {};
  ONLINE.lastActionPrune = 0;
  ONLINE.lastChatPrune = 0;
  ONLINE.applyingWorld = false;
  ONLINE.applyingRemoteBench = false;
  ONLINE.lastBenchSync = 0;
  onlineStopActions();

  const db = onlineDb();
  if (db) {
    ONLINE.refs = {
      room: db.ref('rooms/' + ONLINE.roomId),
      meta: db.ref('rooms/' + ONLINE.roomId + '/meta'),
      info: db.ref('rooms/' + ONLINE.roomId + '/playersInfo'),
      state: db.ref('rooms/' + ONLINE.roomId + '/state'),
      world: db.ref('rooms/' + ONLINE.roomId + '/world'),
      build: db.ref('rooms/' + ONLINE.roomId + '/build'),
      events: db.ref('rooms/' + ONLINE.roomId + '/events'),
      actions: db.ref('rooms/' + ONLINE.roomId + '/actions'),
      chat: db.ref('rooms/' + ONLINE.roomId + '/chat'),
      connected: db.ref('.info/connected'),
      code: ONLINE.code ? db.ref('roomCodes/' + ONLINE.code) : null
    };
    onlineListen();
  }
  // Conectar la pose de 17-net al nodo de la sala.
  try {
    if (typeof netSetRoom === 'function' && typeof netOn !== 'undefined' && netOn) {
      if (typeof netLevel !== 'undefined') netLevel = ONLINE.roomLevel;
      netSetRoom(ONLINE.roomId);
    } else {
      onlineWaitForNet();
    }
  } catch (e) {}
  // Latido de respaldo por si el juego está en pausa o sin loop.
  if (!ONLINE.heartbeatTimer) {
    ONLINE.heartbeatTimer = setInterval(function () {
      try { onlineHeartbeat(); } catch (e) {}
    }, ONLINE_CONFIG.hostHeartbeatMs);
  }
  onlineRefreshUI();
}
function onlineWaitForNet(tries) {
  tries = tries || 0;
  if (!ONLINE.roomId) return;
  try {
    if (typeof netOn !== 'undefined' && netOn && typeof netSetRoom === 'function') {
      if (typeof netLevel !== 'undefined') netLevel = onlineRoomLevel();
      netSetRoom(ONLINE.roomId);
      return;
    }
  } catch (e) {}
  if (tries < 40) setTimeout(function () { onlineWaitForNet(tries + 1); }, 500);
}
function onlineListen() {
  if (!ONLINE.refs) return;
  const metaRef = ONLINE.refs.meta;
  const infoRef = ONLINE.refs.info;
  const stateRef = ONLINE.refs.state;
  const buildRef = ONLINE.refs.build;
  const eventsRef = ONLINE.refs.events;
  const connRef = ONLINE.refs.connected;
  const onErr = function (err) { try { ONLINE.error = (err && err.code) || 'error-sala'; } catch (e) {} };
  const onMeta = function (snap) {
    if (ONLINE.leaving) return;
    if (!snap.exists()) {
      ONLINE.error = 'La sala se cerró';
      onlineDetach();
      onlineRefreshUI();
      return;
    }
    const m = snap.val() || {};
    ONLINE.meta = m;
    ONLINE.lastHostMetaAt = Date.now();
    ONLINE.roomLevel = onlineSafeLevelId(m.levelId || ONLINE.roomLevel);
    if (m.seed) ONLINE.seed = Number(m.seed) >>> 0;
    const uid = onlineUser() && onlineUser().uid;
    const wasHost = ONLINE.isHost;
    ONLINE.isHost = !!(uid && m.host === uid);
    if (ONLINE.isHost && !wasHost) {
      onlineToast('Ahora sos el host de la sala');
      ONLINE.lastHostBeat = 0;
      onlineListenActions();
      onlineReapplyWorld();
    } else if (!ONLINE.isHost && wasHost) {
      onlineStopActions();
    }
    if (m.status === 'playing') {
      ONLINE.startedAt = Number(m.startedAt || ONLINE.startedAt || 0);
      onlineEnsureLevel(m.levelId || ONLINE.roomLevel);
    }
    onlineRefreshUI();
  };
  const onInfo = function (snap) {
    if (!snap.exists()) { delete ONLINE.info[snap.key]; onlineRefreshUI(); return; }
    const isNew = !ONLINE.info[snap.key];
    ONLINE.info[snap.key] = snap.val() || {};
    // Si entró alguien nuevo, el host reemite las mesas actuales.
    if (isNew && ONLINE.isHost) onlineRebroadcastBenches();
    const uid = onlineUser() && onlineUser().uid;
    if (snap.key === uid) {
      ONLINE.ready = !!(ONLINE.info[snap.key].ready);
      const wasDown = ONLINE.down;
      ONLINE.down = !!(ONLINE.info[snap.key].down);
      // Si recargamos la página estando caídos, retomamos el estado correcto.
      if (ONLINE.down && !wasDown && ONLINE.meta && ONLINE.meta.status === 'playing') {
        ONLINE.downAt = onlineServerNowMs();
        try { if (typeof showGameOver === 'function') showGameOver(); } catch (e) {}
      }
    }
    onlineRefreshUI();
  };
  const onInfoRem = function (snap) { delete ONLINE.info[snap.key]; onlineRefreshUI(); };
  const onState = function (snap) {
    ONLINE.state = snap.exists() ? snap.val() : null;
    if (!ONLINE.state) return;
    if (!ONLINE.isHost) {
      const hp = Number(ONLINE.state.hp);
      if (isFinite(hp)) onlineApplyBaseHp(hp, ONLINE.state.bases);
      const w = Number(ONLINE.state.w);
      if (isFinite(w) && w > (typeof waveNumber !== 'undefined' ? waveNumber : 0)) {
        try { waveNumber = w; } catch (e) {}
      }
      // Si entramos a mitad de oleada, alcanzamos a spawnear la actual
      // (sólo cuando el mundo compartido ya está aplicado).
      if (isFinite(w) && w > ONLINE.spawnedWave && ONLINE.worldStamp) {
        try { onlineSpawnWave(w); } catch (e) {}
      }
    }
  };
  const onBuild = function (snap) {
    const d = snap.val();
    if (!d) return;
    if (!ONLINE.buildReady) { ONLINE.buildQueue[snap.key] = d; return; }
    onlineApplyBlockDelta(d, false);
  };
  const onEvent = function (snap) {
    if (!snap.exists()) return;
    onlineApplyEvent(snap.val());
  };
  const onConn = function (snap) {
    const ok = !!snap.val();
    const was = ONLINE.connected;
    ONLINE.connected = ok;
    if (!ok) {
      ONLINE.disconnectedAt = Date.now();
      onlineSetBanner('Sin conexión. Reconectando…', 'warn');
      return;
    }
    onlineSetBanner('');
    if (was === false && ONLINE.roomId) {
      onlineToast('Reconectado');
      // Reaplicar sólo deltas: recargar el snapshot resetearía el HP de la base.
      try { onlineReapplyWorld(); } catch (e) {}
    }
  };
  try {
    metaRef.on('value', onMeta, onErr);
    infoRef.on('child_added', onInfo, onErr);
    infoRef.on('child_changed', onInfo, onErr);
    infoRef.on('child_removed', onInfoRem, onErr);
    stateRef.on('value', onState, onErr);
    if (buildRef) {
      buildRef.on('child_added', onBuild, onErr);
      buildRef.on('child_changed', onBuild, onErr);
    }
    if (eventsRef) eventsRef.on('child_added', onEvent, onErr);
    if (connRef) connRef.on('value', onConn, onErr);
    ONLINE.subs = { onMeta, onInfo, onInfoRem, onState, onBuild, onEvent, onConn };
    if (ONLINE.isHost) onlineListenActions();
  } catch (e) {}
}
function onlineDetach() {
  const refs = ONLINE.refs;
  const subs = ONLINE.subs;
  onlineStopActions();
  if (refs && subs) {
    try { refs.meta.off('value', subs.onMeta); } catch (e) {}
    try { refs.info.off('child_added', subs.onInfo); } catch (e) {}
    try { refs.info.off('child_changed', subs.onInfo); } catch (e) {}
    try { refs.info.off('child_removed', subs.onInfoRem); } catch (e) {}
    try { refs.state.off('value', subs.onState); } catch (e) {}
    try { if (refs.build && subs.onBuild) { refs.build.off('child_added', subs.onBuild); refs.build.off('child_changed', subs.onBuild); } } catch (e) {}
    try { if (refs.events && subs.onEvent) refs.events.off('child_added', subs.onEvent); } catch (e) {}
    try { if (refs.connected && subs.onConn) refs.connected.off('value', subs.onConn); } catch (e) {}
  }
  ONLINE.refs = null;
  ONLINE.subs = null;
  if (ONLINE.heartbeatTimer) { clearInterval(ONLINE.heartbeatTimer); ONLINE.heartbeatTimer = 0; }
  ONLINE.roomId = null;
  ONLINE.code = null;
  ONLINE.isHost = false;
  ONLINE.meta = null;
  ONLINE.state = null;
  ONLINE.info = {};
  ONLINE.ready = false;
  ONLINE.roomLevel = null;
  ONLINE.loadedLevel = null;
  ONLINE.worldStamp = null;
  ONLINE.worldLoading = false;
  ONLINE.startedAt = 0;
  ONLINE.buildReady = false;
  ONLINE.buildQueue = {};
  ONLINE.pendingWave = 0;
  ONLINE.spawnedWave = 0;
  ONLINE.down = false;
  ONLINE.downAt = 0;
  ONLINE.lastBaseEvent = 0;
  ONLINE.lastHostMetaAt = 0;
  ONLINE.connected = null;
  ONLINE.disconnectedAt = 0;
  ONLINE.lastWorldTry = 0;
  ONLINE.buildKeys = {};
  ONLINE.buildCount = 0;
  ONLINE.buildRate = {};
  ONLINE.lastActionPrune = 0;
  ONLINE.lastChatPrune = 0;
  ONLINE.applyingWorld = false;
  ONLINE.applyingRemoteBench = false;
  ONLINE.lastBenchSync = 0;
  onlineSetBanner('');
  try { if (typeof netSetRoom === 'function') netSetRoom(null); } catch (e) {}
}
function onlineListenActions() {
  if (!ONLINE.isHost || !ONLINE.refs || !ONLINE.refs.actions || ONLINE.actionsRootSub) return;
  const root = ONLINE.refs.actions;
  const onUser = function (snap) {
    const uid = snap.key;
    if (!uid || ONLINE.actionSubs[uid]) return;
    const cb = function (seqSnap) {
      if (!seqSnap.exists()) return;
      onlineHandleAction(seqSnap.val(), uid);
    };
    try {
      snap.ref.on('child_added', cb);
      snap.ref.on('child_changed', cb);
      ONLINE.actionSubs[uid] = { ref: snap.ref, cb: cb };
    } catch (e) {}
  };
  try { root.on('child_added', onUser); ONLINE.actionsRootSub = onUser; } catch (e) {}
}
function onlineStopActions() {
  const refs = ONLINE.refs;
  if (refs && ONLINE.actionsRootSub) {
    try { refs.actions.off('child_added', ONLINE.actionsRootSub); } catch (e) {}
  }
  ONLINE.actionsRootSub = null;
  for (const uid in ONLINE.actionSubs) {
    const s = ONLINE.actionSubs[uid];
    try { if (s && s.ref && s.cb) { s.ref.off('child_added', s.cb); s.ref.off('child_changed', s.cb); } } catch (e) {}
  }
  ONLINE.actionSubs = {};
}
function onlineHandleAction(a, fromUid) {
  if (!ONLINE.isHost || !a || !fromUid) return;
  const now = onlineServerNowMs();
  if (a.at && now - Number(a.at) > ONLINE_CONFIG.actionRetentionMs) return;
  // Sólo miembros activos pueden pedir acciones.
  if (!ONLINE.info[fromUid] || onlineIsStale(fromUid, now)) return;
  if (a.k === 'revive') {
    if (!a.target || a.target === fromUid) return;
    const target = ONLINE.info[a.target];
    if (!target || !target.down) return;
    onlinePublishEvent({ k: 'revive', target: a.target, by: fromUid });
    return;
  }
  if (a.k === 'build') onlineHandleBuildAction(a, fromUid);
  else if (a.k === 'bench') onlineHandleBenchAction(a, fromUid);
}
// El host valida y escribe los bloques que piden los invitados. Así un
// invitado no puede inundar rooms/{id}/build ni colocar tipos arbitrarios.
function onlineHandleBuildAction(a, fromUid) {
  if (!ONLINE.isHost || !ONLINE.refs || !ONLINE.refs.build) return;
  const d = a && a.d;
  if (!d || !onlineAllowBuild(fromUid)) return;
  const x = Number(d.x), y = Number(d.y), z = Number(d.z);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
  if (x < -10000 || x > 10000 || y < -1000 || y > 1000 || z < -10000 || z > 10000) return;
  const rm = !!d.rm;
  const key = onlineBlockKey(x, y, z);
  let existing = null;
  try { existing = (typeof blockGrid !== 'undefined') ? blockGrid.get(getGridKey(x, y, z)) : null; } catch (e) {}
  if (rm) {
    // No se puede borrar algo que el host no tiene: evita deltas fantasma.
    if (!existing) return;
  } else {
    if (existing) return;
    if (!onlineBlockTypeAllowed(d.t)) return;
  }
  if (!ONLINE.buildKeys[key] && ONLINE.buildCount >= ONLINE_CONFIG.maxBuildDeltas) return;
  const payload = {
    x: x, y: y, z: z,
    rm: rm,
    t: rm ? null : d.t,
    r: Number(d.r) || 0,
    by: fromUid,
    at: onlineServerNow()
  };
  try {
    ONLINE.refs.build.child(key).set(payload);
    onlineTrackBuildKey(key);
  } catch (e) {}
}
function onlinePublishEvent(ev) {
  if (!ONLINE.isHost || !ONLINE.roomId || !ONLINE.refs || !ONLINE.refs.events) return false;
  if (!ONLINE.meta || ONLINE.meta.status !== 'playing') return false;
  const me = onlineUser();
  const payload = Object.assign({ at: onlineServerNow(), by: me ? me.uid : null }, ev || {});
  try { ONLINE.refs.events.push(payload); return true; } catch (e) { return false; }
}
function onlinePruneEvents() {
  if (!ONLINE.isHost || !ONLINE.refs || !ONLINE.refs.events) return;
  const now = onlineServerNowMs();
  if (now - ONLINE.lastEventPrune < 60000) return;
  ONLINE.lastEventPrune = now;
  const cutoff = now - ONLINE_CONFIG.eventRetentionMs;
  try {
    ONLINE.refs.events.orderByChild('at').endAt(cutoff).once('value').then(function (snap) {
      if (!snap.exists()) return;
      const updates = {};
      snap.forEach(function (ch) { updates[ch.key] = null; });
      try { ONLINE.refs.events.update(updates); } catch (e) {}
    }).catch(function () {});
  } catch (e) {}
}
// Poda de acciones vencidas: un invitado no puede dejar crecer actions/.
function onlinePruneActions() {
  if (!ONLINE.isHost || !ONLINE.refs || !ONLINE.refs.actions) return;
  const now = onlineServerNowMs();
  if (now - ONLINE.lastActionPrune < 30000) return;
  ONLINE.lastActionPrune = now;
  try {
    ONLINE.refs.actions.once('value').then(function (snap) {
      if (!snap.exists()) return;
      const updates = {};
      snap.forEach(function (userSnap) {
        userSnap.forEach(function (seqSnap) {
          const a = seqSnap.val() || {};
          const at = Number(a.at) || 0;
          if (!at || now - at > ONLINE_CONFIG.actionRetentionMs) {
            updates[userSnap.key + '/' + seqSnap.key] = null;
          }
        });
      });
      if (Object.keys(updates).length) {
        try { ONLINE.refs.actions.update(updates); } catch (e) {}
      }
    }).catch(function () {});
  } catch (e) {}
}
// Poda de chat: deja sólo los últimos mensajes para que no crezca sin límite.
function onlinePruneChat() {
  if (!ONLINE.isHost || !ONLINE.refs || !ONLINE.refs.chat) return;
  const now = onlineServerNowMs();
  if (now - ONLINE.lastChatPrune < 60000) return;
  ONLINE.lastChatPrune = now;
  try {
    ONLINE.refs.chat.once('value').then(function (snap) {
      if (!snap.exists()) return;
      const keys = [];
      snap.forEach(function (ch) { keys.push(ch.key); });
      const excess = keys.length - ONLINE_CONFIG.maxChatMessages;
      if (excess <= 0) return;
      const updates = {};
      keys.slice(0, excess).forEach(function (k) { updates[k] = null; });
      try { ONLINE.refs.chat.update(updates); } catch (e) {}
    }).catch(function () {});
  } catch (e) {}
}
function onlineApplyEvent(ev) {
  if (!ev || !ev.k) return;
  // Las mesas se reemiten al entrar: no descartarlas por antigüedad.
  if (ev.k !== 'bench' && ev.at && ONLINE.eventSince && Number(ev.at) < ONLINE.eventSince) return;
  const me = onlineUser();
  const mine = !!(me && ev.by === me.uid);
  if (ev.k === 'wave') {
    if (mine) return;
    const w = Number(ev.w) || 0;
    if (!w || w <= ONLINE.spawnedWave) return;
    if (w > (typeof waveNumber !== 'undefined' ? waveNumber : 0)) {
      try { waveNumber = w; } catch (e) {}
    }
    // Esperar a que el mundo compartido esté aplicado: los spawns deben ser los del host.
    if (!ONLINE.worldStamp) { ONLINE.pendingWave = w; return; }
    if (onlineSpawnWave(w) && typeof showMessage === 'function') showMessage('¡Oleada ' + w + '!');
    return;
  }
  if (ev.k === 'base') {
    if (mine) return;
    onlineApplyBaseHp(Number(ev.hp), ev.bases);
    return;
  }
  if (ev.k === 'bench') {
    onlineApplyBenchEvent(ev);
    return;
  }
  if (ev.k === 'revive') {
    if (me && ev.target === me.uid) onlineCompleteRevive(ev.by);
  }
}
function onlinePublishBaseDamage() {
  if (!onlineIsActive() || !ONLINE.isHost) return;
  const hp = onlineBaseHp();
  const now = Date.now();
  // Throttle: como máximo 2 eventos/s, salvo que la base llegue a 0.
  if (hp > 0 && now - ONLINE.lastBaseEvent < 500) return;
  ONLINE.lastBaseEvent = now;
  onlinePublishEvent({ k: 'base', hp: hp, bases: onlineBaseHpMap() });
}
// Aplica el HP por mesa. Nunca usa el HP agregado del host para borrar las
// mesas de otros jugadores (ese era el bug de la mesa que desaparecía).
function onlineApplyBaseHp(hp, bases) {
  let list = [];
  try { list = (typeof workbenches !== 'undefined' && workbenches) ? workbenches.slice() : []; } catch (e) {}
  if (!list.length) return;
  const map = (bases && typeof bases === 'object') ? bases : null;
  if (map) {
    for (const w of list) {
      if (!w || !w.pos) continue;
      const key = onlineBlockKey(w.pos.x, w.pos.y, w.pos.z);
      if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
      const max = Number(w.maxHp) || 300;
      const next = Math.max(0, Math.min(max, Number(map[key]) || 0));
      if (next <= 0) {
        onlineRemoveBenchAt(w.pos.x, w.pos.y, w.pos.z);
        continue;
      }
      w.hp = next;
      try { if (typeof updateBenchBar === 'function') updateBenchBar(w); } catch (e) {}
    }
    return;
  }
  // Compatibilidad con salas viejas: sólo tocamos mesas del host o sin dueño.
  if (!isFinite(hp)) return;
  const hostUid = (ONLINE.meta && ONLINE.meta.host) || null;
  if (hp <= 0) {
    list.forEach(function (w) {
      if (!w.ownerUid || w.ownerUid === hostUid) {
        onlineRemoveBenchAt(w.pos.x, w.pos.y, w.pos.z);
      }
    });
    return;
  }
  let remaining = hp;
  for (const w of list) {
    if (w.ownerUid && w.ownerUid !== hostUid) continue;
    const max = Number(w.maxHp) || 300;
    w.hp = Math.max(0, Math.min(max, remaining));
    remaining -= w.hp;
    try { if (typeof updateBenchBar === 'function') updateBenchBar(w); } catch (e) {}
    if (remaining <= 0) break;
  }
}
function onlineRemoveBlockAt(x, y, z) {
  try {
    const key = getGridKey(x, y, z);
    const block = blockGrid.get(key);
    if (!block) return false;
    const i = placedBlocks.indexOf(block);
    if (i > -1) placedBlocks.splice(i, 1);
    scene.remove(block);
    if (typeof updateSpatialPartition === 'function') updateSpatialPartition();
    return true;
  } catch (e) { return false; }
}
function onlineApplyBlockDelta(d, force) {
  if (!d) return;
  const me = onlineUser();
  if (!force && me && d.by === me.uid) return;
  const x = Number(d.x), y = Number(d.y), z = Number(d.z);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
  if (!d.rm && !onlineBlockTypeAllowed(d.t)) return;
  const key = onlineBlockKey(x, y, z);
  ONLINE.applyingRemote = true;
  try {
    if (d.rm) {
      const block = blockGrid.get(getGridKey(x, y, z));
      if (block && typeof destroyBlock === 'function') destroyBlock(block, true);
      else onlineRemoveBlockAt(x, y, z);
      onlineTrackBuildKey(key);
      return;
    }
    const existing = blockGrid.get(getGridKey(x, y, z));
    if (existing) {
      // Si ya está igual, no lo tocamos: destruirlo haría caer bloques apoyados.
      const sameType = !d.t || (existing.userData && existing.userData.type === d.t);
      const sameRot = Math.abs((existing.rotation.y || 0) - (Number(d.r) || 0)) < 0.01;
      if (sameType && sameRot) { onlineTrackBuildKey(key); return; }
      if (typeof destroyBlock === 'function') destroyBlock(existing, true);
      else onlineRemoveBlockAt(x, y, z);
    }
    if (d.t && typeof rebuildBlock === 'function') rebuildBlock(d.t, x, y, z, Number(d.r) || 0);
    onlineTrackBuildKey(key);
  } catch (e) {
    console.warn('onlineApplyBlockDelta', e);
  } finally {
    ONLINE.applyingRemote = false;
  }
}
// --- Mesas de trabajo compartidas ---
// Cada jugador es dueño de su mesa. Las mesas se replican como eventos para
// que todos vean las bases de los demás y el host pueda simular su HP.
function onlineBenchAt(x, y, z) {
  try {
    const list = (typeof workbenches !== 'undefined' && workbenches) ? workbenches : [];
    for (const w of list) {
      if (!w || !w.pos) continue;
      const dx = w.pos.x - x, dy = w.pos.y - y, dz = w.pos.z - z;
      if (dx * dx + dy * dy + dz * dz < 2.25) return w;
    }
  } catch (e) {}
  return null;
}
function onlineRemoveBenchAt(x, y, z) {
  const wb = onlineBenchAt(x, y, z);
  if (!wb) return false;
  try {
    scene.remove(wb.mesh);
    (wb.solids || []).forEach(function (m) {
      const i = collidableObjects.indexOf(m);
      if (i > -1) collidableObjects.splice(i, 1);
    });
    const j = workbenches.indexOf(wb);
    if (j > -1) workbenches.splice(j, 1);
    if (typeof currentBench !== 'undefined' && currentBench === wb) {
      currentBench = null;
      if (typeof benchOpen !== 'undefined' && benchOpen) toggleBench(false);
    }
  } catch (e) { return false; }
  return true;
}
function onlineBaseHpMap() {
  const map = {};
  try {
    const list = (typeof workbenches !== 'undefined' && workbenches) ? workbenches : [];
    for (const w of list) {
      if (!w || !w.pos) continue;
      const key = onlineBlockKey(w.pos.x, w.pos.y, w.pos.z);
      map[key] = Math.max(0, Number(w.hp || 0));
    }
  } catch (e) {}
  return map;
}
// Host escribe el evento; invitado manda la acción al host.
function onlinePublishBench(delta) {
  if (!delta || !ONLINE.roomId || !ONLINE.meta || ONLINE.meta.status !== 'playing') return false;
  if (ONLINE.applyingWorld || ONLINE.applyingRemoteBench) return false;
  const x = Number(delta.x), y = Number(delta.y), z = Number(delta.z);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return false;
  const rm = !!delta.rm;
  const hp = rm ? 0 : Math.max(1, Math.min(300, Number(delta.hp) || 300));
  if (!ONLINE.isHost) {
    return onlineSendAction({ k: 'bench', d: { x: x, y: y, z: z, hp: hp, rm: rm } });
  }
  const owner = delta.owner || (onlineUser() && onlineUser().uid) || (ONLINE.meta && ONLINE.meta.host) || '';
  if (!owner) return false;
  return onlinePublishEvent({
    k: 'bench', x: x, y: y, z: z, rm: rm, hp: hp,
    owner: owner
  });
}
function onlineHandleBenchAction(a, fromUid) {
  if (!ONLINE.isHost || !ONLINE.refs || !ONLINE.refs.events) return;
  const d = a && a.d;
  if (!d) return;
  const x = Number(d.x), y = Number(d.y), z = Number(d.z);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
  if (x < -10000 || x > 10000 || y < -1000 || y > 1000 || z < -10000 || z > 10000) return;
  const existing = onlineBenchAt(x, y, z);
  if (d.rm) {
    // Sólo podés retirar tu propia mesa.
    if (!existing) return;
    if (!existing.ownerUid || existing.ownerUid !== fromUid) return;
  } else {
    if (existing) return;
    if (!onlineAllowBuild(fromUid)) return;
    let owned = 0;
    try {
      const list = (typeof workbenches !== 'undefined' && workbenches) ? workbenches : [];
      for (const w of list) if (w && w.ownerUid === fromUid) owned++;
    } catch (e) {}
    if (owned >= ONLINE_CONFIG.maxBenchesPerPlayer) return;
  }
  const hp = d.rm ? 0 : Math.max(1, Math.min(300, Number(d.hp) || 300));
  onlinePublishEvent({ k: 'bench', x: x, y: y, z: z, rm: !!d.rm, hp: hp, owner: fromUid });
}
function onlineApplyBenchEvent(ev) {
  if (!ev) return;
  const x = Number(ev.x), y = Number(ev.y), z = Number(ev.z);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
  const existing = onlineBenchAt(x, y, z);
  if (ev.rm) {
    if (!existing) return;
    onlineRemoveBenchAt(x, y, z);
    return;
  }
  if (existing) {
    const hp = Number(ev.hp);
    if (isFinite(hp)) {
      existing.hp = Math.max(0, Math.min(Number(existing.maxHp) || 300, hp));
      try { if (typeof updateBenchBar === 'function') updateBenchBar(existing); } catch (e) {}
    }
    return;
  }
  ONLINE.applyingRemoteBench = true;
  try {
    const wb = placeWorkbench(new THREE.Vector3(x, y, z), { remote: true, ownerUid: ev.owner || ev.by || null });
    if (wb) {
      const hp = Number(ev.hp);
      if (isFinite(hp)) wb.hp = Math.max(1, Math.min(Number(wb.maxHp) || 300, hp));
      try { if (typeof updateBenchBar === 'function') updateBenchBar(wb); } catch (e) {}
    }
  } catch (e) {
    console.warn('onlineApplyBenchEvent', e);
  } finally {
    ONLINE.applyingRemoteBench = false;
  }
}
// Cuando entra alguien nuevo, el host reemite las mesas actuales para que
// aparezcan aunque hayan sido colocadas hace más de la retención de eventos.
function onlineRebroadcastBenches() {
  if (!ONLINE.isHost || !onlineIsActive() || !ONLINE.meta || ONLINE.meta.status !== 'playing') return;
  const now = Date.now();
  if (now - ONLINE.lastBenchSync < 5000) return;
  ONLINE.lastBenchSync = now;
  try {
    const list = (typeof workbenches !== 'undefined' && workbenches) ? workbenches.slice(0, 40) : [];
    for (const wb of list) {
      if (!wb || !wb.pos) continue;
      const owner = wb.ownerUid || (ONLINE.meta && ONLINE.meta.host) || null;
      if (!owner) continue;
      onlinePublishEvent({
        k: 'bench', x: wb.pos.x, y: wb.pos.y, z: wb.pos.z,
        rm: false, hp: Math.max(1, Number(wb.hp) || 300), owner: owner
      });
    }
  } catch (e) {}
}

async function onlineApplyBuildDeltas() {
  if (!ONLINE.refs || !ONLINE.refs.build) { ONLINE.buildReady = true; return; }
  ONLINE.buildReady = false;
  let all = {};
  try {
    const snap = await ONLINE.refs.build.get();
    if (snap.exists()) all = snap.val() || {};
  } catch (e) {
    console.warn('onlineApplyBuildDeltas', e);
  }
  const keys = Object.keys(all).sort(function (a, b) {
    const da = Number(all[a] && all[a].at) || 0;
    const db = Number(all[b] && all[b].at) || 0;
    return da - db;
  }).slice(0, ONLINE_CONFIG.maxBuildDeltas);
  ONLINE.buildKeys = {};
  ONLINE.buildCount = 0;
  keys.forEach(function (k) { onlineApplyBlockDelta(all[k], true); });
  ONLINE.buildReady = true;
  const queued = ONLINE.buildQueue || {};
  ONLINE.buildQueue = {};
  Object.keys(queued).forEach(function (k) { onlineApplyBlockDelta(queued[k], false); });
}
function onlineBroadcastBlock(delta) {
  if (!delta || !ONLINE.roomId || !ONLINE.refs || !ONLINE.refs.build) return;
  if (ONLINE.applyingRemote) return;
  if (!ONLINE.meta || ONLINE.meta.status !== 'playing') return;
  const x = Number(delta.x), y = Number(delta.y), z = Number(delta.z);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
  const rm = !!delta.rm;
  if (!rm && !onlineBlockTypeAllowed(delta.t)) return;
  const me = onlineUser();
  const key = onlineBlockKey(x, y, z);
  const base = {
    x: x, y: y, z: z,
    rm: rm,
    t: rm ? null : delta.t,
    r: Number(delta.r) || 0
  };
  // Host autoritativo: escribe directo. Invitado: pide al host por actions.
  if (!ONLINE.isHost) {
    onlineSendAction({ k: 'build', d: base });
    return;
  }
  if (!ONLINE.buildKeys[key] && ONLINE.buildCount >= ONLINE_CONFIG.maxBuildDeltas) return;
  const payload = Object.assign({}, base, { by: me ? me.uid : null, at: onlineServerNow() });
  try {
    ONLINE.refs.build.child(key).set(payload);
    onlineTrackBuildKey(key);
  } catch (e) {}
}
function onlineWaveRand(wave, i) {
  let s = (onlineSeed() ^ Math.imul(wave | 0, 2654435761) ^ Math.imul((i | 0) + 1, 40503)) >>> 0;
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  s ^= s >>> 13;
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  return s / 4294967296;
}
function onlineWaveSpawns(wave) {
  let pts = [];
  try { pts = (typeof enemySpawns !== 'undefined' && enemySpawns) ? enemySpawns.slice() : []; } catch (e) {}
  if (!pts.length) return [];
  const count = Math.min(2 + (wave | 0), 6);
  const out = [];
  for (let k = 0; k < count; k++) {
    const sp = pts[k % pts.length];
    out.push({
      x: sp.x + (onlineWaveRand(wave, k) - 0.5) * 4,
      z: sp.z + (onlineWaveRand(wave, k + 97) - 0.5) * 4
    });
  }
  return out;
}
function onlineSpawnWave(wave) {
  if (typeof spawnRobot !== 'function') return false;
  const pts = onlineWaveSpawns(wave);
  if (!pts.length) { ONLINE.pendingWave = wave; return false; }
  pts.forEach(function (p) {
    try { spawnRobot(new THREE.Vector3(p.x, 0, p.z)); } catch (e) {}
  });
  ONLINE.pendingWave = 0;
  ONLINE.spawnedWave = wave | 0;
  return true;
}
async function onlineReapplyWorld() {
  if (!ONLINE.roomId) return null;
  // No aplicar sobre otra escena: onlineEnsureLevel se encarga al cargar el nivel.
  if (ONLINE.loadedLevel !== onlineRoomLevel()) return null;
  // Si nunca cargó el snapshot, lo carga. Si ya lo tiene, sólo re-aplica deltas:
  // volver a aplicar el snapshot resetearía el HP actual de la base.
  if (!ONLINE.worldStamp) return onlineLoadWorld(true);
  ONLINE.buildReady = false;
  await onlineApplyBuildDeltas();
  return true;
}
async function onlineLeaveRoom(opts) {
  opts = opts || {};
  const user = onlineUser();
  const roomId = ONLINE.roomId;
  const code = ONLINE.code;
  const wasHost = ONLINE.isHost;
  const meta = ONLINE.meta || {};
  const db = onlineDb();
  ONLINE.leaving = true;
  const others = onlineOtherUids();
  try {
    if (typeof player !== 'undefined' && player && player.inventory && typeof player.inventory.saveProfile === 'function') {
      try { player.inventory.saveProfile(); } catch (e) {}
    }
    // En salas el mundo es transitorio: saveLevelSnapshot() ya ignora LEVEL.transientWorld.
    if (typeof LEVEL !== 'undefined' && LEVEL.current && typeof saveLevelSnapshot === 'function' && ONLINE.loadedLevel) {
      try { saveLevelSnapshot(LEVEL.current); } catch (e) {}
    }
  } catch (e) {}
  try {
    if (db && roomId && user) {
      if (wasHost && others.length) {
        await db.ref('rooms/' + roomId + '/meta').update({
          host: others[0],
          hostEpoch: Number(meta.hostEpoch || 1) + 1,
          hostSeen: onlineServerNow(),
          updatedAt: onlineServerNow()
        });
      }
      await db.ref('rooms/' + roomId + '/players/' + user.uid).remove();
      try { await db.ref('rooms/' + roomId + '/actions/' + user.uid).remove(); } catch (e) {}
      await db.ref('rooms/' + roomId + '/playersInfo/' + user.uid).remove();
      if (wasHost && !others.length) {
        if (code) { try { await db.ref('roomCodes/' + code).remove(); } catch (e) {} }
        // No hay regla de escritura en la raíz de la sala: limpiamos hijo por hijo.
        const roomRef = db.ref('rooms/' + roomId);
        const children = ['playersInfo', 'players', 'actions', 'events', 'build', 'state', 'world', 'chat', 'meta'];
        for (let i = 0; i < children.length; i++) {
          try { await roomRef.child(children[i]).remove(); } catch (e) {}
        }
        try { await roomRef.remove(); } catch (e) {}
      }
    }
  } catch (e) { ONLINE.error = (e && e.message) || 'No se pudo salir limpio'; }
  onlineDetach();
  ONLINE.leaving = false;
  if (!opts.silent) onlineToast('Saliste de la sala');
  onlineRefreshUI();
}

// --- Lobby ---
async function onlineSetReady(value) {
  const user = onlineUser();
  if (!user || !ONLINE.roomId) return;
  const db = onlineDb();
  if (!db) return;
  const ready = (typeof value === 'boolean') ? value : !ONLINE.ready;
  try {
    await db.ref('rooms/' + ONLINE.roomId + '/playersInfo/' + user.uid).update({ ready: ready, lastSeen: onlineServerNowMs() });
    ONLINE.ready = ready;
    onlineRefreshUI();
  } catch (e) { onlineToast('No se pudo marcar listo: ' + ((e && e.message) || e)); }
}
async function onlineStartGame() {
  const user = onlineUser();
  if (!user || !ONLINE.roomId || !ONLINE.isHost) { onlineToast('Sólo el host puede iniciar'); return false; }
  const db = onlineDb();
  if (!db) return false;
  const meta = ONLINE.meta || {};
  if (meta.status === 'playing') { onlineEnsureLevel(meta.levelId); return true; }
  const now = Date.now();
  const seed = Number(meta.seed || ((now ^ 0x5f3759df) >>> 0)) >>> 0;
  ONLINE.seed = seed;
  // Sólo compartimos el snapshot si el host ya está en ESE mundo. Si creó la
  // sala desde el menú principal, la escena actual puede ser otra: en ese caso
  // arrancamos con el mundo determinístico del nivel elegido.
  const targetLevel = onlineSafeLevelId(meta.levelId || ONLINE_CONFIG.defaultLevel);
  const canSnapshot = (typeof LEVEL !== 'undefined' && LEVEL.current === targetLevel && !LEVEL.transientWorld);
  const worldSnap = canSnapshot ? onlineWorldSnapshot() : null;
  try {
    // La partida arranca con un mundo limpio de eventos/deltas viejos.
    try { await db.ref('rooms/' + ONLINE.roomId + '/events').remove(); } catch (e) {}
    try { await db.ref('rooms/' + ONLINE.roomId + '/build').remove(); } catch (e) {}
    try { await db.ref('rooms/' + ONLINE.roomId + '/state').remove(); } catch (e) {}
    try { await db.ref('rooms/' + ONLINE.roomId + '/actions').remove(); } catch (e) {}
    ONLINE.buildKeys = {};
    ONLINE.buildCount = 0;
    const payload = {
      'meta/status': 'playing',
      'meta/startedAt': now,
      'meta/hostSeen': onlineServerNow(),
      'meta/updatedAt': onlineServerNowMs(),
      'meta/seed': seed,
      'world/levelId': targetLevel,
      'world/seed': seed,
      'world/createdAt': now,
      'world/savedAt': now
    };
    // Si no hay snapshot, limpiamos el anterior para no cargar un mundo viejo.
    payload['world/snapshot'] = worldSnap || null;
    await db.ref('rooms/' + ONLINE.roomId).update(payload);
    ONLINE.eventSince = onlineServerNowMs() - 1000;
    ONLINE.spawnedWave = 0;
    ONLINE.pendingWave = 0;
    onlineEnsureLevel(meta.levelId || ONLINE_CONFIG.defaultLevel);
    onlineToast('¡Empieza la defensa!');
    onlineRefreshUI();
    return true;
  } catch (e) {
    onlineToast('No se pudo iniciar: ' + ((e && e.message) || e));
    return false;
  }
}
function onlineWorldSnapshot() {
  try {
    if (typeof snapshotScene !== 'function') return null;
    const s = snapshotScene();
    if (!s) return null;
    const out = { v: 2 };
    out.blocks = Array.isArray(s.blocks) ? s.blocks.slice(0, ONLINE_CONFIG.maxWorldBlocks) : [];
    if (Array.isArray(s.items)) out.items = s.items.slice(0, ONLINE_CONFIG.maxWorldItems);
    if (Array.isArray(s.nodes)) out.nodes = s.nodes.slice(0, ONLINE_CONFIG.maxWorldNodes);
    if (Array.isArray(s.benches)) out.benches = s.benches.slice(0, 16);
    if (Array.isArray(s.stairs)) out.stairs = s.stairs.slice(0, ONLINE_CONFIG.maxWorldStairs);
    if (Array.isArray(s.doors)) out.doors = s.doors.slice(0, ONLINE_CONFIG.maxWorldDoors);
    if (Array.isArray(s.containers)) out.containers = s.containers.slice(0, ONLINE_CONFIG.maxWorldContainers);
    if (Array.isArray(s.spawns)) out.spawns = s.spawns.slice(0, ONLINE_CONFIG.maxWorldSpawns);
    if (Array.isArray(s.zones)) out.zones = s.zones.slice(0, ONLINE_CONFIG.maxWorldZones);
    if (Array.isArray(s.totems)) out.totems = s.totems.slice(0, ONLINE_CONFIG.maxWorldTotems);
    if (Array.isArray(s.statics)) out.statics = s.statics.slice(0, ONLINE_CONFIG.maxWorldStatics);
    return out;
  } catch (e) { return null; }
}
async function onlineLoadWorld(force) {
  if (!ONLINE.roomId || !ONLINE.refs || !ONLINE.refs.world) return null;
  if (ONLINE.worldLoading) return null;
  ONLINE.worldLoading = true;
  try {
    const snap = await ONLINE.refs.world.get();
    if (!snap.exists()) return null;
    const w = snap.val() || {};
    if (!w.snapshot) return null;
    const stamp = ONLINE.roomId + ':' + (w.savedAt || w.createdAt || '0');
    if (!force && ONLINE.worldStamp === stamp) return null;
    if (typeof applySceneData !== 'function') return null;
    ONLINE.buildReady = false;
    ONLINE.applyingWorld = true;
    let res = null;
    try {
      res = applySceneData(w.snapshot);
    } finally {
      ONLINE.applyingWorld = false;
    }
    ONLINE.worldStamp = stamp;
    // Las mesas que vienen del snapshot sin dueño pertenecen al host.
    try {
      const hostUid = (ONLINE.meta && ONLINE.meta.host) || null;
      if (hostUid && typeof workbenches !== 'undefined' && workbenches) {
        for (const w of workbenches) { if (w && !w.ownerUid) w.ownerUid = hostUid; }
      }
    } catch (e) {}
    await onlineApplyBuildDeltas();
    if (ONLINE.pendingWave) {
      const wv = ONLINE.pendingWave;
      ONLINE.pendingWave = 0;
      onlineSpawnWave(wv);
    } else {
      // Alcanzar la oleada en curso si el estado llegó antes que el mundo.
      const wv = Number(ONLINE.state && ONLINE.state.w);
      if (isFinite(wv) && wv > ONLINE.spawnedWave) onlineSpawnWave(wv);
    }
    onlineToast('Mundo compartido cargado');
    return res;
  } catch (e) {
    console.warn('onlineLoadWorld', e);
    return null;
  } finally {
    ONLINE.worldLoading = false;
  }
}
function onlineEnsureLevel(levelId) {
  const id = onlineSafeLevelId(levelId || onlineRoomLevel());
  if (!id || typeof playLevel !== 'function') return;
  if (ONLINE.loadedLevel === id) {
    // Si el mundo llegó después de cargar el nivel, aplicarlo una sola vez.
    if (!ONLINE.worldStamp) onlineLoadWorld();
    return;
  }
  ONLINE.loadedLevel = id;
  ONLINE.worldStamp = null;
  ONLINE.buildReady = false;
  ONLINE.buildQueue = {};
  ONLINE.pendingWave = 0;
  try {
    ONLINE.applyingWorld = true;
    playLevel(id, { preserveInventory: true, skipRestore: true, seed: onlineSeed(), transientWorld: true });
  } catch (e) {
    ONLINE.loadedLevel = null;
    console.warn('onlineEnsureLevel', e);
    return;
  } finally {
    ONLINE.applyingWorld = false;
  }
  if (typeof LEVEL !== 'undefined' && LEVEL.current !== id) {
    ONLINE.loadedLevel = null;
    return;
  }
  onlineLoadWorld();
}

// --- Latidos / host ---
function onlineHeartbeat() {
  if (!ONLINE.roomId || !ONLINE.refs) return;
  const user = onlineUser();
  if (!user) return;
  const now = Date.now();
  if (ONLINE.isHost) {
    if (now - ONLINE.lastHostBeat < ONLINE_CONFIG.hostHeartbeatMs) return;
    ONLINE.lastHostBeat = now;
    const count = onlinePlayerCount();
    try {
      ONLINE.refs.meta.update({ hostSeen: onlineServerNow(), playerCount: count, updatedAt: onlineServerNowMs() });
    } catch (e) {}
    // El host también mantiene fresca su propia presencia.
    try { ONLINE.refs.info.child(user.uid).update({ lastSeen: onlineServerNowMs() }); } catch (e) {}
    if (ONLINE.meta && ONLINE.meta.status === 'playing') {
      onlineHostSnapshot(now);
    }
    onlinePruneEvents();
    onlinePruneActions();
    onlinePruneChat();
    return;
  }
  if (now - ONLINE.lastSeen > ONLINE_CONFIG.presenceHeartbeatMs) {
    ONLINE.lastSeen = now;
    try { ONLINE.refs.info.child(user.uid).update({ lastSeen: onlineServerNowMs() }); } catch (e) {}
  }
  if (ONLINE.connected === false) return;
  const hostSeen = Number((ONLINE.meta && ONLINE.meta.hostSeen) || 0);
  const sinceHost = ONLINE.lastHostMetaAt
    ? (now - ONLINE.lastHostMetaAt)
    : (hostSeen ? onlineServerNowMs() - hostSeen : 0);
  if (sinceHost > ONLINE_CONFIG.hostTimeoutMs) {
    if (now - ONLINE.lastClaim > ONLINE_CONFIG.hostClaimCooldownMs) {
      ONLINE.lastClaim = now;
      onlineSetBanner('El host no responde. Intentando tomar el control…', 'warn');
      onlineTryClaimHost();
    }
  } else if (ONLINE.connected) {
    onlineSetBanner('');
  }
}
function onlineBaseHp() {
  try {
    if (typeof workbenches !== 'undefined' && workbenches && workbenches.length) {
      let hp = 0;
      for (let i = 0; i < workbenches.length; i++) hp += Math.max(0, Number(workbenches[i].hp || 0));
      return hp;
    }
  } catch (e) {}
  return 0;
}
function onlineHostSnapshot(now) {
  if (!ONLINE.refs || !ONLINE.meta || ONLINE.meta.status !== 'playing') return;
  if (now - ONLINE.lastSnapshot < ONLINE_CONFIG.snapshotMs) return;
  ONLINE.lastSnapshot = now;
  let alive = 0;
  try { if (typeof npcs !== 'undefined' && npcs) alive = npcs.filter(function (n) { return n && n.health > 0; }).length; } catch (e) {}
  const st = {
    t: ++ONLINE.tick,
    hp: onlineBaseHp(),
    bases: onlineBaseHpMap(),
    w: (typeof waveNumber !== 'undefined') ? waveNumber : 0,
    left: alive,
    timer: ONLINE.startedAt ? Math.max(0, Math.round((now - ONLINE.startedAt) / 1000)) : 0,
    updatedAt: now
  };
  try { ONLINE.refs.state.update(st); } catch (e) {}
}
async function onlineTryClaimHost() {
  if (!ONLINE.roomId || !ONLINE.refs || !onlineUser()) return false;
  const user = onlineUser();
  const ref = ONLINE.refs.meta;
  try {
    // Leer primero evita lanzar una transacción (y su warning de permisos)
    // cuando el host está vivo y las reglas no nos dejarían escribir.
    const snap = await ref.get();
    const cur = snap.val();
    if (!cur || cur.host === user.uid) return false;
    const seen = Number(cur.hostSeen || 0);
    if (seen && onlineServerNowMs() - seen < ONLINE_CONFIG.hostTimeoutMs) return false;
  } catch (e) { return false; }
  try {
    const res = await ref.transaction(function (cur) {
      if (!cur) return cur;
      if (cur.host === user.uid) return cur;
      const seen = Number(cur.hostSeen || 0);
      const srvNow = onlineServerNowMs();
      if (seen && srvNow - seen < ONLINE_CONFIG.hostTimeoutMs) return; // abortar
      cur.host = user.uid;
      cur.hostEpoch = Number(cur.hostEpoch || 1) + 1;
      cur.hostSeen = srvNow;
      cur.updatedAt = srvNow;
      return cur;
    }, undefined, false);
    if (res && res.committed) {
      ONLINE.isHost = true;
      ONLINE.lastHostBeat = 0;
      onlineSetBanner('Sos el host ahora. Reaplicando el mundo…', 'ok');
      onlineToast('El host se cayó: tomaste el control');
      onlineListenActions();
      await onlineReapplyWorld();
      onlineSetBanner('');
      onlineRefreshUI();
      return true;
    }
  } catch (e) { /* otro cliente ganó la carrera */ }
  return false;
}

// --- UI ---
function onlineRoomStatusText() {
  if (!onlineIsActive()) return '';
  const meta = ONLINE.meta || {};
  const role = ONLINE.isHost ? 'host' : 'invitado';
  const status = meta.status === 'playing' ? 'en partida' : (meta.status === 'ended' ? 'terminada' : 'lobby');
  const count = onlinePlayerCount();
  return 'Sala ' + (ONLINE.code || '?') + ' · ' + role + ' · ' + status + ' · ' + count + '/' + (meta.maxPlayers || ONLINE_CONFIG.maxPlayers);
}
// Actualiza la vista "Con amigos" del menú principal. Usa IDs propios
// (mmOnline*) para no chocar con la pestaña Online del menú de pausa.
function onlineRefreshMenuUI() {
  if (typeof document === 'undefined' || !document.body) return;
  const user = onlineUser();
  const active = onlineIsActive();
  const meta = ONLINE.meta || {};
  const authHint = document.getElementById('mmOnlineAuthHint');
  const loginBtn = document.getElementById('mmOnlineLoginBtn');
  const setup = document.getElementById('mmOnlineSetup');
  const panel = document.getElementById('mmOnlinePanel');
  const createBtn = document.getElementById('mmOnlineCreateBtn');
  const joinBtn = document.getElementById('mmOnlineJoinBtn');
  const joinInput = document.getElementById('mmOnlineJoinCode');
  const codeEl = document.getElementById('mmOnlineCode');
  const roleEl = document.getElementById('mmOnlineRole');
  const stateEl = document.getElementById('mmOnlineState');
  const playersEl = document.getElementById('mmOnlinePlayers');
  const readyBtn = document.getElementById('mmOnlineReadyBtn');
  const startBtn = document.getElementById('mmOnlineStartBtn');
  const enterBtn = document.getElementById('mmOnlineEnterBtn');
  const leaveBtn = document.getElementById('mmOnlineLeaveBtn');

  if (authHint) {
    if (user) authHint.textContent = 'Sesión: ' + (user.displayName || user.email || user.uid);
    else if (window.firebase && firebase.auth) authHint.textContent = 'Ingresá con Google para crear o unirte a una sala.';
    else authHint.textContent = 'Cargando los servicios online…';
  }
  if (loginBtn) loginBtn.style.display = user ? 'none' : 'inline-block';
  if (setup) setup.style.display = active ? 'none' : '';
  if (panel) panel.style.display = active ? 'block' : 'none';
  if (createBtn) {
    createBtn.disabled = ONLINE.busy || !user;
    createBtn.textContent = ONLINE.busy ? 'Creando…' : 'Crear sala';
  }
  if (joinBtn) joinBtn.disabled = ONLINE.busy || !user;
  if (!active) {
    if (joinInput && ONLINE.inviteCode && !joinInput.value) joinInput.value = ONLINE.inviteCode;
    return;
  }

  if (codeEl) codeEl.textContent = ONLINE.code || '—';
  if (roleEl) roleEl.textContent = ONLINE.isHost ? 'Sos el host de esta sala.' : 'Sos invitado en esta sala.';
  if (stateEl) {
    let txt = meta.status === 'playing' ? 'En partida' : 'Esperando en el lobby';
    const st = ONLINE.state;
    if (st && meta.status === 'playing') {
      txt += ' · oleada ' + (Number(st.w) || 0) + ' · base ' + Math.round(Number(st.hp) || 0) +
        ' · enemigos ' + (Number(st.left) || 0);
    }
    if (ONLINE.down) txt += ' · ESTÁS CAÍDO (un compañero puede revivirte con E)';
    if (ONLINE.connected === false) txt += ' · sin conexión';
    if (ONLINE.error) txt += ' · ' + ONLINE.error;
    stateEl.textContent = txt;
  }
  if (playersEl) {
    playersEl.innerHTML = '';
    const now = onlineServerNowMs();
    const uids = Object.keys(ONLINE.info).filter(function (uid) { return !onlineIsStale(uid, now); }).sort();
    if (!uids.length) playersEl.textContent = 'Conectando…';
    uids.forEach(function (uid) {
      const d = ONLINE.info[uid] || {};
      const row = document.createElement('div');
      const isMe = user && uid === user.uid;
      const host = meta.host === uid;
      row.textContent = (host ? '★ ' : '● ') + (d.n || 'Jugador') + (isMe ? ' (vos)' : '') +
        (d.ready ? ' — listo' : '') + (d.down ? ' — caído' : '');
      try { row.style.color = d.c || '#fff'; } catch (e) {}
      playersEl.appendChild(row);
    });
  }
  if (readyBtn) {
    readyBtn.style.display = (ONLINE.isHost || meta.status === 'playing') ? 'none' : 'inline-block';
    readyBtn.textContent = ONLINE.ready ? 'Cancelar listo' : 'Estoy listo';
  }
  if (startBtn) {
    startBtn.style.display = (ONLINE.isHost && meta.status !== 'playing') ? 'inline-block' : 'none';
    startBtn.disabled = meta.status === 'playing';
  }
  if (enterBtn) enterBtn.style.display = meta.status === 'playing' ? 'inline-block' : 'none';
  if (leaveBtn) leaveBtn.style.display = 'inline-block';
}

function onlineRefreshUI() {
  if (typeof document === 'undefined' || !document.body) return;
  try { onlineRefreshMenuUI(); } catch (e) {}
  const setup = document.getElementById('onlineRoomSetup');
  const panel = document.getElementById('onlineRoomPanel');
  const codeEl = document.getElementById('onlineRoomCode');
  const roleEl = document.getElementById('onlineRoomRole');
  const stateEl = document.getElementById('onlineRoomState');
  const listEl = document.getElementById('onlineRoomPlayers');
  const readyBtn = document.getElementById('onlineReadyBtn');
  const startBtn = document.getElementById('onlineStartBtn');
  const inviteBtn = document.getElementById('onlineInviteBtn');
  const active = onlineIsActive();
  const user = onlineUser();
  if (setup) setup.style.display = active ? 'none' : 'block';
  if (panel) panel.style.display = active ? 'block' : 'none';
  if (!active) return;
  const meta = ONLINE.meta || {};
  if (codeEl) codeEl.textContent = ONLINE.code || '—';
  if (inviteBtn) inviteBtn.style.display = ONLINE.code ? 'inline-block' : 'none';
  if (roleEl) roleEl.textContent = ONLINE.isHost ? 'Sos el host' : 'Invitado';
  if (stateEl) {
    const st = ONLINE.state;
    let txt = meta.status === 'playing' ? 'En partida' : 'Esperando en el lobby';
    if (st && meta.status === 'playing') {
      txt += ' · oleada ' + (Number(st.w) || 0) + ' · base ' + Math.round(Number(st.hp) || 0) + ' · enemigos ' + (Number(st.left) || 0);
    }
    if (ONLINE.down) txt += ' · ESTÁS CAÍDO (E de un compañero para revivirte)';
    if (ONLINE.connected === false) txt += ' · sin conexión';
    if (ONLINE.error) txt += ' · ' + ONLINE.error;
    stateEl.textContent = txt;
  }
  if (listEl) {
    listEl.innerHTML = '';
    const now = onlineServerNowMs();
    const uids = Object.keys(ONLINE.info).filter(function (uid) { return !onlineIsStale(uid, now); }).sort();
    if (!uids.length) listEl.textContent = 'Conectando…';
    uids.forEach(function (uid) {
      const d = ONLINE.info[uid] || {};
      const row = document.createElement('div');
      const isMe = user && uid === user.uid;
      const host = meta.host === uid;
      row.textContent = (host ? '★ ' : '● ') + (d.n || 'Jugador') + (isMe ? ' (vos)' : '') + (d.ready ? ' — listo' : '') + (d.down ? ' — caído' : '');
      try { row.style.color = d.c || '#fff'; } catch (e) {}
      listEl.appendChild(row);
    });
  }
  if (readyBtn) {
    readyBtn.style.display = ONLINE.isHost ? 'none' : 'inline-block';
    readyBtn.textContent = ONLINE.ready ? 'Cancelar listo' : 'Estoy listo';
  }
  if (startBtn) {
    startBtn.style.display = ONLINE.isHost ? 'inline-block' : 'none';
    startBtn.disabled = meta.status === 'playing';
    startBtn.textContent = meta.status === 'playing' ? 'Partida en curso' : 'Iniciar partida';
  }
}
function onlineCopyCode() {
  const code = ONLINE.code;
  if (!code) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code);
      onlineToast('Código copiado: ' + code);
      return;
    }
  } catch (e) {}
  onlineToast('Código de sala: ' + code);
}
function onlineCopyInvite() {
  const url = onlineInviteUrl();
  if (!url) { onlineCopyCode(); return; }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url);
      onlineToast('Link de invitación copiado');
      return;
    }
  } catch (e) {}
  onlineToast('Link: ' + url);
}
function onlineOpenMenu() {
  // Destino único del multijugador: la vista "Con amigos" del menú principal.
  // Antes se intentaba abrir la pestaña Online del menú de pausa; si el juego
  // ya estaba pausado (como al volver del menú principal) el toggle no hacía
  // nada y quedaba la partida pausada sin ningún panel visible.
  try {
    if (typeof showMainMenu === 'function') showMainMenu('online');
    else if (typeof LEVEL !== 'undefined') {
      LEVEL.menuOpen = true;
      LEVEL.menuView = 'online';
      if (typeof renderMainMenu === 'function') renderMainMenu();
    }
  } catch (e) { console.warn('onlineOpenMenu', e); }
  setTimeout(function () { try { onlineRefreshUI(); } catch (e) {} }, 60);
}
function onlineJoinFromMenuInput() {
  const input = document.getElementById('mmOnlineJoinCode');
  if (!input) return;
  onlineJoinRoom(input.value);
}
function onlineEnterGame() {
  if (!onlineIsActive()) return false;
  const id = onlineRoomLevel();
  try {
    if (typeof LEVEL !== 'undefined' && LEVEL.current === id && ONLINE.loadedLevel === id) {
      if (typeof hideMainMenu === 'function') hideMainMenu();
      if (typeof isGamePaused !== 'undefined') isGamePaused = false;
      try { if (typeof pauseMenu !== 'undefined' && pauseMenu) pauseMenu.style.display = 'none'; } catch (e) {}
      try { if (typeof lockPointer === 'function') lockPointer(); } catch (e) {}
      return true;
    }
  } catch (e) {}
  onlineEnsureLevel(id);
  return true;
}
function onlineMarkDown() {
  if (!onlineIsActive()) return;
  const user = onlineUser();
  ONLINE.down = true;
  ONLINE.downAt = Date.now();
  if (!user || !ONLINE.refs) return;
  try { ONLINE.refs.info.child(user.uid).update({ down: true, lastSeen: onlineServerNowMs() }); } catch (e) {}
}
function onlineClearDown() {
  ONLINE.down = false;
  ONLINE.downAt = 0;
  const user = onlineUser();
  if (!user || !ONLINE.refs) return;
  try { ONLINE.refs.info.child(user.uid).update({ down: false, lastSeen: onlineServerNowMs() }); } catch (e) {}
}
function onlineNearestDowned(maxDist) {
  if (!onlineIsActive() || !ONLINE.meta || ONLINE.meta.status !== 'playing') return null;
  const me = onlineUser();
  if (!me || typeof player === 'undefined' || !player || !player.container) return null;
  let best = null;
  let bd = maxDist || 3.5;
  for (const uid in ONLINE.info) {
    if (uid === me.uid) continue;
    const d = ONLINE.info[uid];
    if (!d || !d.down) continue;
    const r = (typeof remotes !== 'undefined') ? remotes[uid] : null;
    if (!r) continue;
    const dist = Math.hypot(r.tx - player.container.position.x, r.tz - player.container.position.z);
    if (dist < bd) { bd = dist; best = uid; }
  }
  return best;
}
function onlineTryRevive() {
  const target = onlineNearestDowned(3.5);
  if (!target) return false;
  const me = onlineUser();
  if (!me || !ONLINE.refs || !ONLINE.refs.actions) return false;
  const now = Date.now();
  if (now - ONLINE.lastReviveAsk < 2000) return true;
  ONLINE.lastReviveAsk = now;
  const ok = onlineSendAction({ k: 'revive', target: target });
  if (ok) onlineToast('Pediste revivir a un compañero…');
  else onlineToast('No se pudo pedir el revivir');
  return ok;
}
function onlineCompleteRevive(byUid) {
  ONLINE.down = false;
  ONLINE.downAt = 0;
  const by = (byUid && ONLINE.info[byUid] && ONLINE.info[byUid].n) || 'un compañero';
  try { if (typeof respawnPlayer === 'function') respawnPlayer(); } catch (e) {}
  onlineClearDown();
  onlineToast('¡Te revivió ' + by + '!');
}

// --- Ciclo ---
function onlineUpdate(delta) {
  if (!ONLINE.roomId) return;
  const now = Date.now();
  ONLINE.uiAcc += (delta || 0);
  if (ONLINE.uiAcc > 1) { ONLINE.uiAcc = 0; onlineRefreshUI(); }
  onlineHeartbeat();
  // Si nadie te revive en 20s, te recuperás solo para no trabar la partida.
  if (ONLINE.down && ONLINE.downAt && now - ONLINE.downAt > 20000) {
    ONLINE.down = false;
    ONLINE.downAt = 0;
    try { if (typeof respawnPlayer === 'function') respawnPlayer(); } catch (e) {}
    onlineClearDown();
    onlineToast('Te recuperaste solo.');
  }
  if (now - ONLINE.lastPrune > 5000) {
    ONLINE.lastPrune = now;
    const srvNow = onlineServerNowMs();
    for (const uid in ONLINE.info) {
      if (onlineIsStale(uid, srvNow)) delete ONLINE.info[uid];
    }
  }
  if (ONLINE.meta && ONLINE.meta.status === 'playing' && !ONLINE.worldStamp &&
      ONLINE.loadedLevel === onlineRoomLevel() && now - ONLINE.lastWorldTry > 5000) {
    ONLINE.lastWorldTry = now;
    onlineLoadWorld();
  }
}
function onlineOnAuth(user) {
  if (!user) {
    if (ONLINE.roomId) onlineDetach();
    if (ONLINE.inviteCode) { try { onlineOpenMenu(); } catch (e) {} }
    onlineRefreshUI();
    return;
  }
  onlineRefreshUI();
  if (ONLINE.inviteCode && !ONLINE.roomId && !ONLINE.busy) {
    const code = ONLINE.inviteCode;
    ONLINE.inviteCode = null;
    try { onlineOpenMenu(); } catch (e) {}
    setTimeout(function () { try { onlineJoinRoom(code); } catch (e) {} }, 700);
  }
}
function wireOnlineAuth() {
  if (!window.firebase || !firebase.auth) { setTimeout(wireOnlineAuth, 500); return; }
  try {
    firebase.auth().onAuthStateChanged(function (user) { onlineOnAuth(user); });
  } catch (e) { setTimeout(wireOnlineAuth, 1000); }
}
function onlineCheckInviteParam() {
  try {
    if (typeof window === 'undefined' || !window.location) return;
    const u = new URL(window.location.href);
    const raw = u.searchParams.get('sala') || u.searchParams.get('join') || '';
    const code = onlineNormalizeCode(raw);
    if (!onlineRoomCodeValid(code)) return;
    ONLINE.inviteCode = code;
    u.searchParams.delete('sala');
    u.searchParams.delete('join');
    try { history.replaceState(null, '', u.toString()); } catch (e) {}
    onlineToast('Invitación a la sala ' + code + '. Ingresá para unirte.');
    // Este script se carga antes de init(); abrimos el hub cuando el menú ya existe.
    setTimeout(function () {
      if (!ONLINE.inviteCode || ONLINE.roomId) return;
      try { onlineOpenMenu(); } catch (e) {}
    }, 1200);
  } catch (e) {}
}
if (typeof window !== 'undefined') {
  // Al cerrar la pestaña, intentar sacar la presencia de la sala.
  window.addEventListener('beforeunload', function () {
    if (!ONLINE.roomId) return;
    try {
      const user = onlineUser();
      const db = onlineDb();
      if (db && user) db.ref('rooms/' + ONLINE.roomId + '/playersInfo/' + user.uid).remove();
    } catch (e) {}
  });
}
onlineCheckInviteParam();
wireOnlineAuth();
