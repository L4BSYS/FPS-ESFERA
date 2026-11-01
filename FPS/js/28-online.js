// js/28-online.js (part 28). LaGrieta FPS — Fase 1: salas cooperativas.
// Contrato RTDB: rooms/{roomId}/{meta,players,playersInfo,state,world,checkpoint,chat}
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
  hostTimeoutMs: 8000,
  hostClaimCooldownMs: 8000,
  presenceHeartbeatMs: 30000,
  snapshotMs: 2000,
  checkpointMs: 60000,
  maxCheckpointBlocks: 800,
  maxWorldBlocks: 800,
  maxWorldItems: 120
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
  lastSnapshot: 0,
  lastCheckpoint: 0,
  lastSeen: 0,
  lastClaim: 0,
  uiAcc: 0,
  refs: null,
  subs: null,
  heartbeatTimer: 0,
  roomLevel: null,
  startedAt: 0,
  leaving: false
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
function onlineOwnInfo(user, ready) {
  return {
    n: onlineOwnName(user),
    c: onlineOwnColor(user),
    ready: !!ready,
    lastSeen: Date.now(),
    down: false
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
    const roomId = db.ref('rooms').push().key;
    let code = null;
    let claimed = false;
    for (let i = 0; i < 8 && !claimed; i++) {
      code = onlineGenerateCode();
      claimed = await onlineClaimCode(db, code, roomId, user.uid);
    }
    if (!claimed) throw new Error('No se pudo reservar un código de sala');
    const levelId = opts.levelId || (typeof LEVEL !== 'undefined' && LEVEL.current) || ONLINE_CONFIG.defaultLevel;
    const seed = (Date.now() ^ ((Math.random() * 0x7fffffff) | 0)) >>> 0;
    const now = Date.now();
    const meta = {
      v: ONLINE_CONFIG.protocolVersion,
      host: user.uid,
      hostEpoch: 1,
      hostSeen: now,
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
    const info = {};
    info[user.uid] = onlineOwnInfo(user, false);
    try {
      // Secuencial para que las reglas vean meta/host antes de world y playersInfo.
      await db.ref('rooms/' + roomId + '/meta').set(meta);
      await db.ref('rooms/' + roomId + '/world').set(world);
      await db.ref('rooms/' + roomId + '/playersInfo/' + user.uid).set(info[user.uid]);
    } catch (writeErr) {
      try { await db.ref('roomCodes/' + code).remove(); } catch (e2) {}
      try { await db.ref('rooms/' + roomId).remove(); } catch (e3) {}
      throw writeErr;
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
    if (Number(meta.v || 0) !== ONLINE_CONFIG.protocolVersion) throw new Error('Versión incompatible');
    if (meta.status === 'ended') throw new Error('La partida ya terminó');
    if (Number(meta.playerCount || 1) >= Number(meta.maxPlayers || ONLINE_CONFIG.maxPlayers)) throw new Error('La sala está llena');
    if (ONLINE.roomId) await onlineLeaveRoom({ silent: true });
    const infoRef = db.ref('rooms/' + roomId + '/playersInfo/' + user.uid);
    await infoRef.set(onlineOwnInfo(user, false));
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
  ONLINE.roomLevel = opts.levelId || (opts.meta && opts.meta.levelId) || ONLINE_CONFIG.defaultLevel;
  ONLINE.info = {};
  ONLINE.state = null;
  ONLINE.ready = false;
  ONLINE.error = '';
  ONLINE.tick = 0;
  ONLINE.lastHostBeat = 0;
  ONLINE.lastSnapshot = 0;
  ONLINE.lastCheckpoint = 0;
  ONLINE.lastSeen = 0;
  ONLINE.lastClaim = 0;
  ONLINE.startedAt = 0;
  ONLINE.loadedLevel = null;
  ONLINE.worldStamp = null;

  const db = onlineDb();
  if (db) {
    ONLINE.refs = {
      room: db.ref('rooms/' + ONLINE.roomId),
      meta: db.ref('rooms/' + ONLINE.roomId + '/meta'),
      info: db.ref('rooms/' + ONLINE.roomId + '/playersInfo'),
      state: db.ref('rooms/' + ONLINE.roomId + '/state'),
      world: db.ref('rooms/' + ONLINE.roomId + '/world'),
      checkpoint: db.ref('rooms/' + ONLINE.roomId + '/checkpoint'),
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
    ONLINE.roomLevel = m.levelId || ONLINE.roomLevel;
    const uid = onlineUser() && onlineUser().uid;
    const wasHost = ONLINE.isHost;
    ONLINE.isHost = !!(uid && m.host === uid);
    if (ONLINE.isHost && !wasHost) {
      onlineToast('Ahora sos el host de la sala');
      ONLINE.lastHostBeat = 0;
      onlineRestoreCheckpoint();
    }
    if (m.status === 'playing') {
      ONLINE.startedAt = Number(m.startedAt || ONLINE.startedAt || 0);
      onlineEnsureLevel(m.levelId || ONLINE.roomLevel);
    }
    onlineRefreshUI();
  };
  const onInfo = function (snap) {
    if (!snap.exists()) { delete ONLINE.info[snap.key]; onlineRefreshUI(); return; }
    ONLINE.info[snap.key] = snap.val() || {};
    const uid = onlineUser() && onlineUser().uid;
    if (snap.key === uid) ONLINE.ready = !!(ONLINE.info[snap.key].ready);
    onlineRefreshUI();
  };
  const onInfoRem = function (snap) { delete ONLINE.info[snap.key]; onlineRefreshUI(); };
  const onState = function (snap) { ONLINE.state = snap.exists() ? snap.val() : null; };
  try {
    metaRef.on('value', onMeta, onErr);
    infoRef.on('child_added', onInfo, onErr);
    infoRef.on('child_changed', onInfo, onErr);
    infoRef.on('child_removed', onInfoRem, onErr);
    stateRef.on('value', onState, onErr);
    ONLINE.subs = { onMeta, onInfo, onInfoRem, onState };
  } catch (e) {}
}
function onlineDetach() {
  const refs = ONLINE.refs;
  const subs = ONLINE.subs;
  if (refs && subs) {
    try { refs.meta.off('value', subs.onMeta); } catch (e) {}
    try { refs.info.off('child_added', subs.onInfo); } catch (e) {}
    try { refs.info.off('child_changed', subs.onInfo); } catch (e) {}
    try { refs.info.off('child_removed', subs.onInfoRem); } catch (e) {}
    try { refs.state.off('value', subs.onState); } catch (e) {}
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
  try { if (typeof netSetRoom === 'function') netSetRoom(null); } catch (e) {}
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
  const others = Object.keys(ONLINE.info).filter(function (uid) { return user && uid !== user.uid; });
  try {
    if (typeof player !== 'undefined' && player && player.inventory && typeof player.inventory.saveProfile === 'function') {
      try { player.inventory.saveProfile(); } catch (e) {}
    }
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
          hostSeen: Date.now(),
          updatedAt: Date.now()
        });
      }
      await db.ref('rooms/' + roomId + '/playersInfo/' + user.uid).remove();
      await db.ref('rooms/' + roomId + '/players/' + user.uid).remove();
      if (wasHost && !others.length) {
        if (code) { try { await db.ref('roomCodes/' + code).remove(); } catch (e) {} }
        try { await db.ref('rooms/' + roomId).remove(); } catch (e) {}
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
    await db.ref('rooms/' + ONLINE.roomId + '/playersInfo/' + user.uid).update({ ready: ready, lastSeen: Date.now() });
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
  const seed = Number(meta.seed || ((now ^ 0x5f3759df) >>> 0));
  const worldSnap = onlineWorldSnapshot();
  try {
    const payload = {
      'meta/status': 'playing',
      'meta/startedAt': now,
      'meta/hostSeen': now,
      'meta/updatedAt': now,
      'meta/seed': seed,
      'world/levelId': meta.levelId || ONLINE_CONFIG.defaultLevel,
      'world/seed': seed,
      'world/createdAt': now,
      'world/savedAt': now
    };
    if (worldSnap) payload['world/snapshot'] = worldSnap;
    await db.ref('rooms/' + ONLINE.roomId).update(payload);
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
    const out = { v: 1 };
    out.blocks = Array.isArray(s.blocks) ? s.blocks.slice(0, ONLINE_CONFIG.maxWorldBlocks) : [];
    if (Array.isArray(s.items)) out.items = s.items.slice(0, ONLINE_CONFIG.maxWorldItems);
    if (Array.isArray(s.benches)) out.benches = s.benches.slice(0, 16);
    if (Array.isArray(s.stairs)) out.stairs = s.stairs.slice(0, 40);
    if (Array.isArray(s.doors)) out.doors = s.doors.slice(0, 20);
    if (Array.isArray(s.containers)) out.containers = s.containers.slice(0, 24);
    return out;
  } catch (e) { return null; }
}
async function onlineLoadWorld() {
  if (!ONLINE.roomId || !ONLINE.refs || !ONLINE.refs.world) return null;
  if (ONLINE.worldLoading) return null;
  ONLINE.worldLoading = true;
  try {
    const snap = await ONLINE.refs.world.get();
    if (!snap.exists()) return null;
    const w = snap.val() || {};
    if (!w.snapshot) return null;
    const stamp = ONLINE.roomId + ':' + (w.savedAt || w.createdAt || '0');
    if (ONLINE.worldStamp === stamp) return null;
    if (typeof applySceneData !== 'function') return null;
    ONLINE.worldStamp = stamp;
    const res = applySceneData(w.snapshot);
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
  const id = levelId || onlineRoomLevel();
  if (!id || typeof playLevel !== 'function') return;
  if (ONLINE.loadedLevel === id) {
    // Si el mundo llegó después de cargar el nivel, aplicarlo una sola vez.
    if (!ONLINE.worldStamp) onlineLoadWorld();
    return;
  }
  ONLINE.loadedLevel = id;
  ONLINE.worldStamp = null;
  try {
    playLevel(id, { preserveInventory: true, skipRestore: true });
  } catch (e) {
    ONLINE.loadedLevel = null;
    console.warn('onlineEnsureLevel', e);
    return;
  }
  if (typeof LEVEL !== 'undefined' && LEVEL.current !== id) {
    ONLINE.loadedLevel = null;
    return;
  }
  onlineLoadWorld();
}

// --- Latidos / host / checkpoint ---
function onlineHeartbeat() {
  if (!ONLINE.roomId || !ONLINE.refs) return;
  const user = onlineUser();
  if (!user) return;
  const now = Date.now();
  if (ONLINE.isHost) {
    if (now - ONLINE.lastHostBeat < ONLINE_CONFIG.hostHeartbeatMs) return;
    ONLINE.lastHostBeat = now;
    const count = Math.max(1, Object.keys(ONLINE.info).length);
    try {
      ONLINE.refs.meta.update({ hostSeen: now, playerCount: count, updatedAt: now });
    } catch (e) {}
    if (ONLINE.meta && ONLINE.meta.status === 'playing') {
      onlineHostSnapshot(now);
      if (now - ONLINE.lastCheckpoint > ONLINE_CONFIG.checkpointMs) {
        ONLINE.lastCheckpoint = now;
        onlineWriteCheckpoint(now);
      }
    }
    return;
  }
  if (now - ONLINE.lastSeen > ONLINE_CONFIG.presenceHeartbeatMs) {
    ONLINE.lastSeen = now;
    try { ONLINE.refs.info.child(user.uid).update({ lastSeen: now }); } catch (e) {}
  }
  const hostSeen = Number((ONLINE.meta && ONLINE.meta.hostSeen) || 0);
  if (hostSeen && now - hostSeen > ONLINE_CONFIG.hostTimeoutMs && now - ONLINE.lastClaim > ONLINE_CONFIG.hostClaimCooldownMs) {
    ONLINE.lastClaim = now;
    onlineTryClaimHost();
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
    w: (typeof waveNumber !== 'undefined') ? waveNumber : 0,
    left: alive,
    timer: ONLINE.startedAt ? Math.max(0, Math.round((now - ONLINE.startedAt) / 1000)) : 0,
    updatedAt: now
  };
  try { ONLINE.refs.state.update(st); } catch (e) {}
}
function onlineWriteCheckpoint(now) {
  if (!ONLINE.refs || !ONLINE.isHost) return;
  let snap = null;
  try { if (typeof snapshotScene === 'function') snap = snapshotScene(); } catch (e) {}
  const blocks = (snap && Array.isArray(snap.blocks)) ? snap.blocks.slice(0, ONLINE_CONFIG.maxCheckpointBlocks) : [];
  const payload = {
    t: now,
    hp: onlineBaseHp(),
    w: (typeof waveNumber !== 'undefined') ? waveNumber : 0,
    blocks: blocks,
    savedAt: now
  };
  if (snap && Array.isArray(snap.benches)) payload.benches = snap.benches.slice(0, 24);
  try { ONLINE.refs.checkpoint.set(payload); } catch (e) {}
}
async function onlineRestoreCheckpoint() {
  if (!ONLINE.refs) return null;
  try {
    const snap = await ONLINE.refs.checkpoint.get();
    if (!snap.exists()) return null;
    const c = snap.val() || {};
    ONLINE.lastCheckpoint = Number(c.savedAt || 0);
    return c;
  } catch (e) { return null; }
}
async function onlineTryClaimHost() {
  if (!ONLINE.roomId || !ONLINE.refs || !onlineUser()) return false;
  const user = onlineUser();
  const ref = ONLINE.refs.meta;
  try {
    const res = await ref.transaction(function (cur) {
      if (!cur) return cur;
      if (cur.host === user.uid) return cur;
      const seen = Number(cur.hostSeen || 0);
      if (seen && Date.now() - seen < ONLINE_CONFIG.hostTimeoutMs) return; // abortar
      cur.host = user.uid;
      cur.hostEpoch = Number(cur.hostEpoch || 1) + 1;
      cur.hostSeen = Date.now();
      cur.updatedAt = Date.now();
      return cur;
    }, undefined, false);
    if (res && res.committed) {
      ONLINE.isHost = true;
      ONLINE.lastHostBeat = 0;
      onlineToast('El host se cayó: tomaste el control');
      await onlineRestoreCheckpoint();
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
  const count = Math.max(1, Object.keys(ONLINE.info).length);
  return 'Sala ' + (ONLINE.code || '?') + ' · ' + role + ' · ' + status + ' · ' + count + '/' + (meta.maxPlayers || ONLINE_CONFIG.maxPlayers);
}
function onlineRefreshUI() {
  if (typeof document === 'undefined' || !document.body) return;
  const setup = document.getElementById('onlineRoomSetup');
  const panel = document.getElementById('onlineRoomPanel');
  const codeEl = document.getElementById('onlineRoomCode');
  const roleEl = document.getElementById('onlineRoomRole');
  const stateEl = document.getElementById('onlineRoomState');
  const listEl = document.getElementById('onlineRoomPlayers');
  const readyBtn = document.getElementById('onlineReadyBtn');
  const startBtn = document.getElementById('onlineStartBtn');
  const cBtn = document.getElementById('onlineCreateBtn');
  const jBtn = document.getElementById('onlineJoinBtn');
  const active = onlineIsActive();
  const user = onlineUser();
  if (setup) setup.style.display = active ? 'none' : 'block';
  if (panel) panel.style.display = active ? 'block' : 'none';
  if (cBtn) { cBtn.disabled = ONLINE.busy || !user; cBtn.textContent = ONLINE.busy ? 'Creando…' : 'Crear sala'; }
  if (jBtn) { jBtn.disabled = ONLINE.busy || !user; }
  if (!active) return;
  const meta = ONLINE.meta || {};
  if (codeEl) codeEl.textContent = ONLINE.code || '—';
  if (roleEl) roleEl.textContent = ONLINE.isHost ? 'Sos el host' : 'Invitado';
  if (stateEl) {
    const st = ONLINE.state;
    let txt = meta.status === 'playing' ? 'En partida' : 'Esperando en el lobby';
    if (st && meta.status === 'playing') {
      txt += ' · oleada ' + (Number(st.w) || 0) + ' · base ' + Math.round(Number(st.hp) || 0) + ' · enemigos ' + (Number(st.left) || 0);
    }
    if (ONLINE.error) txt += ' · ' + ONLINE.error;
    stateEl.textContent = txt;
  }
  if (listEl) {
    listEl.innerHTML = '';
    const uids = Object.keys(ONLINE.info).sort();
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
function onlineJoinFromInput() {
  const input = document.getElementById('onlineJoinCode');
  if (!input) return;
  onlineJoinRoom(input.value);
}

// --- Ciclo ---
function onlineUpdate(delta) {
  if (!ONLINE.roomId) return;
  ONLINE.uiAcc += (delta || 0);
  if (ONLINE.uiAcc > 1) { ONLINE.uiAcc = 0; onlineRefreshUI(); }
  onlineHeartbeat();
}
function onlineOnAuth(user) {
  if (!user) {
    if (ONLINE.roomId) onlineDetach();
    onlineRefreshUI();
    return;
  }
  onlineRefreshUI();
}
function wireOnlineAuth() {
  if (!window.firebase || !firebase.auth) { setTimeout(wireOnlineAuth, 500); return; }
  try {
    firebase.auth().onAuthStateChanged(function (user) { onlineOnAuth(user); });
  } catch (e) { setTimeout(wireOnlineAuth, 1000); }
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
wireOnlineAuth();
