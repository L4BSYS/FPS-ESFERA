// js/28-online.js (part 28). LaGrieta FPS — salas cooperativas.
// Contrato RTDB: rooms/{roomId}/{meta,players,playersInfo,state,world,build,events,actions,chat,mobs}
// - 2 a 5 jugadores, host autoritativo del mundo.
// - Protocol v2 (PR4): actions/events polimórficos + slots 0–11 + mobs host-write.
// - Join acepta meta.v ∈ {1,2}; salas nuevas escriben v:2.
// - La pose la publica 17-net.js en rooms/{id}/players cuando netSetRoom(id) está activo.
// Sin sesión no hace nada y no rompe el modo local.

var ONLINE_CONFIG = {
  protocolVersion: 2,
  maxPlayers: 5,
  defaultLevel: 'mundo-1',
  // Niveles permitidos en sala coop (client guard; rules pueden listar tutorial aún).
  coopLevels: ['playground', 'mundo-1', 'mundo-2', 'mundo-3'],
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
  actionSlots: 12, // MUST match rules $seq /^[0-9]$|^1[01]$/ (0..11)
  reliableActionSlots: 6, // 0–5
  lossyActionSlot: 6,     // shoot/atk coalesce here (2P)
  maxChatMessages: 200,
  actionRetentionMs: 20000,
  buildActionMaxPerSec: 8,
  maxBenchesPerPlayer: 4,
  staleRoomMs: 900000, // 15 min sin latido: sala abandonada
  // Sync feature flags (PR5+). Interim: guest AI+damage local ON until syncCombat.
  syncMobs: true,        // PR5a: host publica/adopta mobs; guest NO renderiza puppets
  syncCombat: true,      // PR5b: puppets + hurt; AI local OFF (implica path mobs)
  shootOriginTolM: 2.0,
  shootEyeTolM: 1.5,
  shootAimTolDeg: 25,
  shootRangeM: 80,
  gunDamage: 15,
  atkDamageDefault: 8,
  syncLoot: true,        // PR6: harvest/loot/drop host-authoritative
  syncChests: true,      // PR7: live chest/dispenser + door toggle
  syncStruct: true,      // PR8: stairs/door struct intents + events
  syncCraft: true,       // PR8: shared craft consume chest/bench via host
  craftMaxPerSec: 3,
  harvestMaxPerSec: 5,
  lootMaxPerSec: 4,
  deathLootChance: 0.55,
  chestMaxPerSec: 4,
  portalDoorsInCoop: false,
  friendlyFire: true,    // producto: FF on
  poseHzRoomMoving: 4,   // salas ≤3 (producto)
  poseHzRoomMovingLarge: 2, // salas 4–5: eco pose
  poseHzRoomSmallMax: 3, // umbral small vs large
  buildAckTimeoutMs: 2000, // guest place/destroy: rollback si el host no ACK
  mobsHzCombat: 2,
  mobsHzIdle: 0.5,
  mobsHzCombatLarge: 1,  // eco mobs en salas 4–5
  mobsHzIdleLarge: 0.35,
  mobsInterestRadius: 48,
  hostAdoptMobsOnClaim: true
};

// Action classes for slot QoS (PR4).
var ONLINE_RELIABLE_ACTIONS = {
  build: 1, bench: 1, loot: 1, drop: 1, harvest: 1, chest: 1, door: 1, struct: 1, craft: 1, revive: 1
};
var ONLINE_LOSSY_ACTIONS = { shoot: 1, atk: 1 };
try {
  if (window.LAGRIETA_ONLINE_CONFIG && typeof window.LAGRIETA_ONLINE_CONFIG === 'object') {
    Object.assign(ONLINE_CONFIG, window.LAGRIETA_ONLINE_CONFIG);
  }
} catch (e) {}

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
  lastChatPrune: 0,
  pendingBuild: {}, // onlineGridKey -> { rm, t, r, cost, at, timer, s } (guest ACK/rollback)
  pendingBySeq: {}, // actionSeq -> { kind, key, at, timer, meta } for nack rollback
  craftRate: {},
  roomProtocol: 1,
  reliableSeq: 0,
  actionSlotBusy: {}, // slot -> { s, at, k }
  actionsRejected: 0,
  // PR5a/PR5b mobs mirror + guest puppets + combat
  lastMobsPub: 0,
  mobsCache: null,
  mobsPubKeys: {},
  eidSeq: 0,
  adoptingMobs: false,
  puppets: {},
  remoteHp: {},
  lastActionSeqByUid: {},
  shotSeq: 0,
  claimedIids: {},
  pendingLoot: {},
  lootRate: {},
  harvestRate: {},
  dropSeq: 0
};

// NPC AI state → compact st byte for mobs/{eid}[4]
var ONLINE_MOB_ST = {
  idle: 0,
  wandering: 1,
  chasing: 2,
  attacking: 3,
  fleeing: 4,
  dead: 5
};
var ONLINE_MOB_ST_NAME = ['idle', 'wandering', 'chasing', 'attacking', 'fleeing', 'dead'];

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
// Sólo mundos coop allow-list: tutorial/user/shared quedan fuera (PR2 client guard).
function onlineCoopLevelAllowed(id) {
  const list = ONLINE_CONFIG.coopLevels || ['playground', 'mundo-1', 'mundo-2', 'mundo-3'];
  return list.indexOf(id) !== -1;
}
function onlineSafeLevelId(id) {
  if (!id || id === 'tutorial' || !onlineCoopLevelAllowed(id)) return ONLINE_CONFIG.defaultLevel;
  try {
    const def = (typeof LEVEL !== 'undefined' && LEVEL.defs) ? LEVEL.defs[id] : null;
    if (def && def.kind !== 'user' && !def.shared && def.kind !== 'tutorial') return id;
  } catch (e) {}
  return ONLINE_CONFIG.defaultLevel;
}
function onlineDisableCreatorForCoop() {
  try {
    if (typeof creatorMode !== 'undefined' && creatorMode && typeof setCreatorMode === 'function') {
      setCreatorMode(false);
    }
  } catch (e) {}
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
function onlineRoomIsSmall() {
  return !!(onlineIsActive() && onlinePlayerCount() <= (ONLINE_CONFIG.poseHzRoomSmallMax || 3));
}
function onlineEffectivePoseMovingHz() {
  if (!onlineIsActive()) return null;
  if (onlineRoomIsSmall()) return Number(ONLINE_CONFIG.poseHzRoomMoving) || 4;
  return (ONLINE_CONFIG.poseHzRoomMovingLarge != null)
    ? Number(ONLINE_CONFIG.poseHzRoomMovingLarge) : 2;
}
function onlineEffectiveMobsHz(alive) {
  const large = onlineIsActive() && !onlineRoomIsSmall();
  if (alive > 0) {
    return large
      ? (ONLINE_CONFIG.mobsHzCombatLarge || 1)
      : (ONLINE_CONFIG.mobsHzCombat || 2);
  }
  return large
    ? (ONLINE_CONFIG.mobsHzIdleLarge || 0.35)
    : (ONLINE_CONFIG.mobsHzIdle || 0.5);
}
function onlineFlagsSummary() {
  return 'sync M/C/L/Ch/S/Cr ' +
    (ONLINE_CONFIG.syncMobs ? '1' : '0') +
    (ONLINE_CONFIG.syncCombat ? '1' : '0') +
    (ONLINE_CONFIG.syncLoot ? '1' : '0') +
    (ONLINE_CONFIG.syncChests ? '1' : '0') +
    (ONLINE_CONFIG.syncStruct ? '1' : '0') +
    (ONLINE_CONFIG.syncCraft ? '1' : '0') +
    ' FF:' + (ONLINE_CONFIG.friendlyFire ? 'on' : 'off') +
    ' pose:' + (onlineEffectivePoseMovingHz() || '-') + 'Hz';
}
function onlineNetStat(key, delta) {
  try {
    if (typeof netStats === 'undefined' || !netStats) return;
    const d = (delta == null) ? 1 : Number(delta);
    if (!isFinite(d)) return;
    netStats[key] = (Number(netStats[key]) || 0) + d;
  } catch (e) {}
}
function onlineNoteRttSample(ms) {
  if (!(ms >= 0) || !isFinite(ms) || ms > 15000) return;
  try {
    if (typeof netStats === 'undefined' || !netStats) return;
    const prev = Number(netStats.rttEstimate) || 0;
    netStats.rttEstimate = prev > 0 ? (prev * 0.7 + ms * 0.3) : ms;
  } catch (e) {}
}
function onlineOtherUids() {
  const me = onlineUser();
  const now = onlineServerNowMs();
  return Object.keys(ONLINE.info).filter(function (uid) {
    return (!me || uid !== me.uid) && !onlineIsStale(uid, now);
  });
}
// ---------------------------------------------------------------------------
// Grid keys — bijection with getGridKey (js/08-build.js)
//   Local Map (blockGrid): getGridKey → "1.5|0|2"  (half-unit floats, '|')
//   RTDB path-safe:        onlineGridKey → "3_0_4" (ints = round(n*2), '_')
// Same snap: ix = Math.round(x*2), iy = Math.round(y*2), iz = Math.round(z*2).
// Convert: online "3_0_4" ↔ local "1.5|0|2"  (ix/2, iy/2, iz/2).
// Do NOT migrate blockGrid to underscore keys; onlineGridKey is RTDB-only.
// ---------------------------------------------------------------------------
function onlineGridKey(x, y, z) {
  return Math.round(Number(x) * 2) + '_' + Math.round(Number(y) * 2) + '_' + Math.round(Number(z) * 2);
}
/** @deprecated alias — prefer onlineGridKey for new code */
function onlineBlockKey(x, y, z) {
  return onlineGridKey(x, y, z);
}
function onlineLocalKeyFromGrid(gridKey) {
  if (!gridKey || typeof gridKey !== 'string') return null;
  const p = gridKey.split('_');
  if (p.length !== 3) return null;
  const ix = Number(p[0]), iy = Number(p[1]), iz = Number(p[2]);
  if (!isFinite(ix) || !isFinite(iy) || !isFinite(iz)) return null;
  return (ix / 2) + '|' + (iy / 2) + '|' + (iz / 2);
}
function onlineGridKeyFromLocal(localKey) {
  if (!localKey || typeof localKey !== 'string') return null;
  const p = localKey.split('|');
  if (p.length !== 3) return null;
  const x = Number(p[0]), y = Number(p[1]), z = Number(p[2]);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
  return onlineGridKey(x, y, z);
}
function onlineServerNow() {
  try {
    if (window.firebase && firebase.database && firebase.database.ServerValue) {
      return firebase.database.ServerValue.TIMESTAMP;
    }
  } catch (e) {}
  return Date.now();
}
// Hora estimada del servidor: offset cacheado desde .info/serverTimeOffset.
// Reference.val() no existe — hay que suscribirse a 'value' y leer el snapshot.
var onlineServerTimeOffsetMs = 0;
var onlineServerTimeOffsetWired = false;
function onlineEnsureServerTimeOffset() {
  if (onlineServerTimeOffsetWired) return;
  try {
    const db = onlineDb();
    if (!db) return;
    onlineServerTimeOffsetWired = true;
    db.ref('.info/serverTimeOffset').on('value', function (snap) {
      onlineServerTimeOffsetMs = Number(snap.val()) || 0;
    });
  } catch (e) {
    onlineServerTimeOffsetWired = false;
  }
}
function onlineServerNowMs() {
  onlineEnsureServerTimeOffset();
  return Date.now() + onlineServerTimeOffsetMs;
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
function onlineProtocolAccepted(v) {
  const n = Number(v || 0);
  // Client v2 joins rooms v1|v2 during transition (PR4).
  if (ONLINE_CONFIG.protocolVersion >= 2) return n === 1 || n === 2;
  return n === ONLINE_CONFIG.protocolVersion;
}
function onlineRoomSupportsV2() {
  return Number(ONLINE.roomProtocol || (ONLINE.meta && ONLINE.meta.v) || 0) >= 2;
}
function onlinePickActionSlot(k) {
  if (!ONLINE.actionSlotBusy) ONLINE.actionSlotBusy = {};
  const now = Date.now();
  if (ONLINE_LOSSY_ACTIONS[k]) {
    // Lossy combat: always coalesce onto one slot (overwrite OK).
    return String(ONLINE_CONFIG.lossyActionSlot != null ? ONLINE_CONFIG.lossyActionSlot : 6);
  }
  // Reliable: ring 0..reliableActionSlots-1; avoid overwriting pending < 2s.
  const n = Math.max(1, Math.min(6, ONLINE_CONFIG.reliableActionSlots || 6));
  if (typeof ONLINE.reliableSeq !== 'number') ONLINE.reliableSeq = 0;
  for (let i = 0; i < n; i++) {
    const cand = String((ONLINE.reliableSeq + i) % n);
    const busy = ONLINE.actionSlotBusy[cand];
    if (!busy || (now - Number(busy.at || 0)) > 2000) {
      ONLINE.reliableSeq = (Number(cand) + 1) % n;
      return cand;
    }
  }
  return null;
}
// Los invitados no escriben build directamente: mandan una acción al host.
function onlineSendAction(action) {
  if (!ONLINE.roomId || !ONLINE.refs || !ONLINE.refs.actions || !action) return false;
  const me = onlineUser();
  if (!me) return false;
  const k = action.k;
  if (!k) return false;
  const isLegacy = (k === 'revive' || k === 'build' || k === 'bench');
  const isKnown = !!(isLegacy || ONLINE_RELIABLE_ACTIONS[k] || ONLINE_LOSSY_ACTIONS[k]);
  if (!isKnown) return false;
  // New action kinds need room protocol v2 (rules + host).
  if (!isLegacy && !onlineRoomSupportsV2()) {
    try { ONLINE.actionsRejected = (ONLINE.actionsRejected || 0) + 1; } catch (e) {}
    try { onlineNetStat('actionsRejected'); } catch (e) {}
    return false;
  }
  const slot = onlinePickActionSlot(k);
  if (slot == null) {
    try { ONLINE.actionsRejected = (ONLINE.actionsRejected || 0) + 1; } catch (e) {}
    try { onlineNetStat('actionsRejected'); } catch (e) {}
    try { onlineToast('Servidor ocupado, reintentá'); } catch (e) {}
    return false;
  }
  const seq = ++ONLINE.actionSeq;
  const ref = ONLINE.refs.actions.child(me.uid).child(slot);
  try {
    ref.set(Object.assign({ at: onlineServerNow(), by: me.uid, s: seq }, action));
    ONLINE.actionSlotBusy[slot] = { s: seq, at: Date.now(), k: k };
    try { onlineNetStat('actionsOut'); } catch (e) {}
    if (!ONLINE.rttSentAt) ONLINE.rttSentAt = {};
    ONLINE.rttSentAt[seq] = Date.now();
    // El dueño limpia su acción; el host también poda las vencidas.
    setTimeout(function () {
      try {
        ref.once('value').then(function (snap) {
          const v = snap.val();
          if (v && Number(v.s) === seq) ref.remove();
          if (ONLINE.actionSlotBusy && ONLINE.actionSlotBusy[slot] && Number(ONLINE.actionSlotBusy[slot].s) === seq) {
            delete ONLINE.actionSlotBusy[slot];
          }
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
    if (!onlineProtocolAccepted(meta.v)) throw new Error('Versión incompatible');
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
  ONLINE.roomProtocol = Number((opts.meta && opts.meta.v) || ONLINE_CONFIG.protocolVersion) || 1;
  ONLINE.reliableSeq = 0;
  ONLINE.actionSlotBusy = {};
  // PR2: creator/tutorial fuera de coop — apagar creador al entrar a la sala.
  onlineDisableCreatorForCoop();
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
  ONLINE.pendingBuild = {};
  ONLINE.pendingBySeq = {};
  ONLINE.craftRate = {};
  ONLINE.rttSentAt = {};
  ONLINE.lastActionPrune = 0;
  ONLINE.lastChatPrune = 0;
  ONLINE.applyingWorld = false;
  ONLINE.applyingRemoteBench = false;
  ONLINE.lastBenchSync = 0;
  ONLINE.lastMobsPub = 0;
  ONLINE.mobsCache = null;
  ONLINE.mobsPubKeys = {};
  ONLINE.eidSeq = 0;
  ONLINE.adoptingMobs = false;
  ONLINE.puppets = {};
  ONLINE.remoteHp = {};
  ONLINE.lastActionSeqByUid = {};
  ONLINE.shotSeq = 0;
  ONLINE.claimedIids = {};
  ONLINE.pendingLoot = {};
  ONLINE.lootRate = {};
  ONLINE.harvestRate = {};
  ONLINE.dropSeq = 0;
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
      mobs: db.ref('rooms/' + ONLINE.roomId + '/mobs'),
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
  onlineEnsureServerTimeOffset();
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
    ONLINE.roomProtocol = Number(m.v || ONLINE.roomProtocol || 1) || 1;
    ONLINE.lastHostMetaAt = Date.now();
    ONLINE.roomLevel = onlineSafeLevelId(m.levelId || ONLINE.roomLevel);
    if (m.seed) ONLINE.seed = Number(m.seed) >>> 0;
    const uid = onlineUser() && onlineUser().uid;
    const wasHost = ONLINE.isHost;
    ONLINE.isHost = !!(uid && m.host === uid);
    if (ONLINE.isHost && !wasHost) {
      onlineToast('Ahora sos el host de la sala');
      ONLINE.lastHostBeat = 0;
      onlineClearPuppets();
      onlineListenActions();
      Promise.resolve(onlineReapplyWorld()).then(function () {
        try { return onlineAdoptMobsFromRtdb(); } catch (e) { return null; }
      }).catch(function () {});
    } else if (!ONLINE.isHost && wasHost) {
      onlineStopActions();
      ONLINE.mobsPubKeys = {};
      ONLINE.lastMobsPub = 0;
      // Dejamos de simular AI: pasamos a puppets si syncCombat.
      try { onlineOnBecameGuestCombat(); } catch (e) {}
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
      // PR5b syncCombat: guest NO spawnea AI local (puppets desde mobs).
      // Pre-PR5b / syncMobs only: catch-up wave spawn local.
      if (isFinite(w) && w > ONLINE.spawnedWave && ONLINE.worldStamp && !onlineCombatSync()) {
        try { onlineSpawnWave(w); } catch (e) {}
      } else if (isFinite(w) && onlineCombatSync()) {
        ONLINE.spawnedWave = Math.max(ONLINE.spawnedWave || 0, w);
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
    onlineListenMobsCache();
  } catch (e) {}
}
function onlineDetach() {
  const refs = ONLINE.refs;
  const subs = ONLINE.subs;
  onlineStopActions();
  try { onlineClearAllGuestBuildPending(false); } catch (e) { ONLINE.pendingBuild = {}; }
  try { onlineClearAllPendingBySeq(false); } catch (e) { ONLINE.pendingBySeq = {}; }
  ONLINE.craftRate = {};
  if (refs && subs) {
    try { refs.meta.off('value', subs.onMeta); } catch (e) {}
    try { refs.info.off('child_added', subs.onInfo); } catch (e) {}
    try { refs.info.off('child_changed', subs.onInfo); } catch (e) {}
    try { refs.info.off('child_removed', subs.onInfoRem); } catch (e) {}
    try { refs.state.off('value', subs.onState); } catch (e) {}
    try { if (refs.build && subs.onBuild) { refs.build.off('child_added', subs.onBuild); refs.build.off('child_changed', subs.onBuild); } } catch (e) {}
    try { if (refs.events && subs.onEvent) refs.events.off('child_added', subs.onEvent); } catch (e) {}
    try { if (refs.connected && subs.onConn) refs.connected.off('value', subs.onConn); } catch (e) {}
    try { if (refs.mobs && subs.onMobs) refs.mobs.off('value', subs.onMobs); } catch (e) {}
  }
  ONLINE.refs = null;
  ONLINE.subs = null;
  try { onlineClearPuppets(); } catch (e) {}
  ONLINE.mobsCache = null;
  ONLINE.mobsPubKeys = {};
  ONLINE.lastMobsPub = 0;
  ONLINE.eidSeq = 0;
  ONLINE.adoptingMobs = false;
  ONLINE.puppets = {};
  ONLINE.remoteHp = {};
  ONLINE.lastActionSeqByUid = {};
  ONLINE.shotSeq = 0;
  ONLINE.claimedIids = {};
  ONLINE.pendingLoot = {};
  ONLINE.lootRate = {};
  ONLINE.harvestRate = {};
  ONLINE.dropSeq = 0;
  if (ONLINE.heartbeatTimer) { clearInterval(ONLINE.heartbeatTimer); ONLINE.heartbeatTimer = 0; }
  ONLINE.roomId = null;
  ONLINE.code = null;
  ONLINE.isHost = false;
  ONLINE.meta = null;
  ONLINE.state = null;
  ONLINE.info = {};
  ONLINE.ready = false;
  ONLINE.roomProtocol = 1;
  ONLINE.actionSlotBusy = {};
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
  // Downed players cannot shoot/atk.
  if ((a.k === 'shoot' || a.k === 'atk') && ONLINE.info[fromUid].down) return;
  // Lossy coalesce: ignore stale seq per uid.
  if (ONLINE_LOSSY_ACTIONS[a.k] && a.s != null) {
    const prev = Number((ONLINE.lastActionSeqByUid && ONLINE.lastActionSeqByUid[fromUid]) || 0);
    const s = Number(a.s) || 0;
    if (s && s <= prev) return;
    if (!ONLINE.lastActionSeqByUid) ONLINE.lastActionSeqByUid = {};
    ONLINE.lastActionSeqByUid[fromUid] = s;
  }
  if (a.k === 'revive') {
    if (!a.target || a.target === fromUid) return;
    const target = ONLINE.info[a.target];
    if (!target || !target.down) return;
    onlinePublishEvent({ k: 'revive', target: a.target, by: fromUid });
    return;
  }
  if (a.k === 'build') onlineHandleBuildAction(a, fromUid);
  else if (a.k === 'bench') onlineHandleBenchAction(a, fromUid);
  else if (a.k === 'shoot') onlineHandleShootAction(a, fromUid);
  else if (a.k === 'atk') onlineHandleAtkAction(a, fromUid);
  else if (a.k === 'harvest') onlineHandleHarvestAction(a, fromUid);
  else if (a.k === 'loot') onlineHandleLootAction(a, fromUid);
  else if (a.k === 'drop') onlineHandleDropAction(a, fromUid);
  else if (a.k === 'chest') onlineHandleChestAction(a, fromUid);
  else if (a.k === 'door') onlineHandleDoorAction(a, fromUid);
  else if (a.k === 'struct') onlineHandleStructAction(a, fromUid);
  else if (a.k === 'craft') onlineHandleCraftAction(a, fromUid);
}
// El host valida y escribe los bloques que piden los invitados. Así un
// invitado no puede inundar rooms/{id}/build ni colocar tipos arbitrarios.
function onlineHandleBuildAction(a, fromUid) {
  if (!ONLINE.isHost || !ONLINE.refs || !ONLINE.refs.build) return;
  const d = a && a.d;
  if (!d || !onlineAllowBuild(fromUid)) return onlineRejectAction(a, fromUid, 'build-rate');
  const x = Number(d.x), y = Number(d.y), z = Number(d.z);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return onlineRejectAction(a, fromUid, 'build-pos');
  if (x < -10000 || x > 10000 || y < -1000 || y > 1000 || z < -10000 || z > 10000) return onlineRejectAction(a, fromUid, 'build-bounds');
  const rm = !!d.rm;
  const key = onlineBlockKey(x, y, z);
  let existing = null;
  try { existing = (typeof blockGrid !== 'undefined') ? blockGrid.get(getGridKey(x, y, z)) : null; } catch (e) {}
  if (rm) {
    // No se puede borrar algo que el host no tiene: evita deltas fantasma.
    if (!existing) return onlineRejectAction(a, fromUid, 'no-block');
  } else {
    if (existing) return onlineRejectAction(a, fromUid, 'occupied');
    if (!onlineBlockTypeAllowed(d.t)) return onlineRejectAction(a, fromUid, 'bad-type');
  }
  if (!ONLINE.buildKeys[key] && ONLINE.buildCount >= ONLINE_CONFIG.maxBuildDeltas) return onlineRejectAction(a, fromUid, 'build-cap');
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
  try {
    ONLINE.refs.events.push(payload);
    if (payload.k === 'hurt') { try { onlineNetStat('hurtEvents'); } catch (e2) {} }
    return true;
  } catch (e) { return false; }
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
    // PR5b: guest con syncCombat no spawnea AI (puppets).
    if (onlineCombatSync() && !ONLINE.isHost) {
      ONLINE.spawnedWave = w;
      ONLINE.pendingWave = 0;
      if (typeof showMessage === 'function') showMessage('¡Oleada ' + w + '!');
      return;
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
  if (ev.k === 'hurt') {
    onlineApplyHurtEvent(ev);
    return;
  }
  if (ev.k === 'node') {
    onlineApplyNodeEvent(ev);
    return;
  }
  if (ev.k === 'loot') {
    onlineApplyLootEvent(ev);
    return;
  }
  if (ev.k === 'chest') {
    onlineApplyChestEvent(ev);
    return;
  }
  if (ev.k === 'door') {
    onlineApplyDoorEvent(ev);
    return;
  }
  if (ev.k === 'struct') {
    onlineApplyStructEvent(ev);
    return;
  }
  if (ev.k === 'nack') {
    onlineApplyNackEvent(ev);
    return;
  }
  if (ev.k === 'fx' && ev.fk === 'craft') {
    const me2 = onlineUser();
    if (me2 && ev.by === me2.uid && !ONLINE.isHost && ONLINE.pendingBySeq) {
      const keys = Object.keys(ONLINE.pendingBySeq);
      for (let i = 0; i < keys.length; i++) {
        const p = ONLINE.pendingBySeq[keys[i]];
        if (p && p.kind === 'craft') { onlineClearPendingBySeq(keys[i], false); break; }
      }
    }
    // Bench built-in dispenser stock (no world cid).
    if (!ONLINE.isHost && typeof ev.amount === 'number') {
      const wbFx = onlineBenchAt(Number(ev.x), Number(ev.y), Number(ev.z));
      if (wbFx) {
        wbFx.dispenserStock = Math.max(0, Number(ev.amount));
        try {
          if (typeof currentBench !== 'undefined' && currentBench === wbFx && typeof renderBenchBaseUI === 'function') {
            renderBenchBaseUI(wbFx);
          }
        } catch (e) {}
      }
    }
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
  const x = Number(d.x), y = Number(d.y), z = Number(d.z);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
  if (!d.rm && !onlineBlockTypeAllowed(d.t)) return;
  const key = onlineBlockKey(x, y, z);
  // Guest ACK: el host escribió nuestro delta → limpiar pending, no re-aplicar.
  if (!force && me && d.by === me.uid) {
    onlineAckGuestBuild(key);
    onlineTrackBuildKey(key);
    return;
  }
  // Cualquier verdad del host en esta celda cancela nuestro pending (sin double-rollback).
  if (ONLINE.pendingBuild && ONLINE.pendingBuild[key]) {
    onlineAckGuestBuild(key);
  }
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
  if (!d) return onlineRejectAction(a, fromUid, 'bench-d');
  const x = Number(d.x), y = Number(d.y), z = Number(d.z);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return onlineRejectAction(a, fromUid, 'bench-pos');
  if (x < -10000 || x > 10000 || y < -1000 || y > 1000 || z < -10000 || z > 10000) return onlineRejectAction(a, fromUid, 'bench-bounds');
  const existing = onlineBenchAt(x, y, z);
  if (d.rm) {
    // Sólo podés retirar tu propia mesa.
    if (!existing) return onlineRejectAction(a, fromUid, 'no-bench');
    if (!existing.ownerUid || existing.ownerUid !== fromUid) return onlineRejectAction(a, fromUid, 'not-owner');
  } else {
    if (existing) return onlineRejectAction(a, fromUid, 'occupied');
    if (!onlineAllowBuild(fromUid)) return onlineRejectAction(a, fromUid, 'build-rate');
    let owned = 0;
    try {
      const list = (typeof workbenches !== 'undefined' && workbenches) ? workbenches : [];
      for (const w of list) if (w && w.ownerUid === fromUid) owned++;
    } catch (e) {}
    if (owned >= ONLINE_CONFIG.maxBenchesPerPlayer) return onlineRejectAction(a, fromUid, 'bench-cap');
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
// --- Guest build pending / ACK / rollback (PR3) ---
function onlineClearGuestBuildPending(key, doRollback) {
  if (!ONLINE.pendingBuild) ONLINE.pendingBuild = {};
  const p = ONLINE.pendingBuild[key];
  if (!p) return null;
  try { if (p.timer) clearTimeout(p.timer); } catch (e) {}
  delete ONLINE.pendingBuild[key];
  if (p.s) onlineClearPendingBySeq(p.s, false);
  if (doRollback) {
    try { onlineNetStat('buildRollbacks'); } catch (e) {}
    onlineRollbackGuestBuildEntry(key, p);
  }
  return p;
}
function onlineAckGuestBuild(key) {
  const p = ONLINE.pendingBuild && ONLINE.pendingBuild[key];
  if (p && p.s && ONLINE.rttSentAt && ONLINE.rttSentAt[p.s]) {
    onlineNoteRttSample(Date.now() - ONLINE.rttSentAt[p.s]);
    delete ONLINE.rttSentAt[p.s];
  }
  onlineClearGuestBuildPending(key, false);
}
function onlineCoordsFromBuildKey(key) {
  const local = (typeof onlineLocalKeyFromGrid === 'function') ? onlineLocalKeyFromGrid(key) : null;
  if (!local) return null;
  const p = local.split('|');
  if (p.length !== 3) return null;
  const x = Number(p[0]), y = Number(p[1]), z = Number(p[2]);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
  return { x: x, y: y, z: z };
}
function onlineRollbackGuestBuildEntry(key, p) {
  if (!p) return;
  const pos = onlineCoordsFromBuildKey(key);
  if (!pos) return;
  ONLINE.applyingRemote = true;
  try {
    if (p.rm) {
      // Host rejected destroy → restore block.
      if (p.t && typeof rebuildBlock === 'function') {
        try { rebuildBlock(p.t, pos.x, pos.y, pos.z, Number(p.r) || 0); } catch (e) {}
      }
      try { onlineToast('El host rechazó destruir el bloque'); } catch (e) {}
    } else {
      // Host rejected place → remove optimistic block + refund.
      let removed = false;
      try {
        const block = (typeof blockGrid !== 'undefined') ? blockGrid.get(getGridKey(pos.x, pos.y, pos.z)) : null;
        if (block && typeof destroyBlock === 'function') {
          destroyBlock(block, true);
          removed = true;
        } else if (typeof onlineRemoveBlockAt === 'function') {
          removed = !!onlineRemoveBlockAt(pos.x, pos.y, pos.z);
        }
      } catch (e) {}
      if (p.cost > 0 && p.t && typeof player !== 'undefined' && player && player.inventory && player.inventory.resources) {
        try {
          player.inventory.resources[p.t] = (player.inventory.resources[p.t] || 0) + p.cost;
          if (typeof updateResourceHUD === 'function') updateResourceHUD();
        } catch (e) {}
      }
      try { onlineToast(removed ? 'El host rechazó el bloque (reembolsado)' : 'Construcción rechazada'); } catch (e) {}
    }
  } finally {
    ONLINE.applyingRemote = false;
  }
}
function onlineMarkGuestBuildPending(base, opts) {
  if (!base || ONLINE.isHost || ONLINE.applyingRemote) return;
  if (!ONLINE.meta || ONLINE.meta.status !== 'playing') return;
  if (!ONLINE.pendingBuild) ONLINE.pendingBuild = {};
  const key = onlineGridKey(base.x, base.y, base.z);
  onlineClearGuestBuildPending(key, false);
  const entry = {
    rm: !!base.rm,
    t: base.rm ? ((opts && opts.t) || null) : (base.t || null),
    r: Number((opts && opts.r != null) ? opts.r : base.r) || 0,
    cost: Math.max(0, Number(opts && opts.cost) || 0),
    at: Date.now(),
    s: Number(ONLINE.actionSeq) || 0,
    timer: null
  };
  const ms = ONLINE_CONFIG.buildAckTimeoutMs || 2000;
  entry.timer = setTimeout(function () {
    if (!ONLINE.pendingBuild || !ONLINE.pendingBuild[key]) return;
    onlineClearGuestBuildPending(key, true);
  }, ms);
  ONLINE.pendingBuild[key] = entry;
  if (entry.s) onlineTrackPendingBySeq(entry.s, { kind: 'build', key: key });
}
function onlineClearAllGuestBuildPending(rollback) {
  if (!ONLINE.pendingBuild) { ONLINE.pendingBuild = {}; return; }
  const keys = Object.keys(ONLINE.pendingBuild);
  keys.forEach(function (k) { onlineClearGuestBuildPending(k, !!rollback); });
}

function onlineBroadcastBlock(delta, opts) {
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
  // Host autoritativo: escribe directo. Invitado: pide al host por actions + pending ACK.
  if (!ONLINE.isHost) {
    onlineSendAction({ k: 'build', d: base });
    onlineMarkGuestBuildPending(base, opts || {});
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
  // PR5b syncCombat: guest never spawns local AI (puppets from mobs).
  // Host (and pre-combat guests) still spawn local simulators here.
  if (onlineCombatSync() && !ONLINE.isHost) {
    ONLINE.pendingWave = 0;
    ONLINE.spawnedWave = wave | 0;
    return false;
  }
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

// --- PR5a/PR5b: mobs publish / puppets / combat ---
function onlineSyncMobsEnabled() {
  return !!(ONLINE_CONFIG.syncMobs || ONLINE_CONFIG.syncCombat);
}
function onlineCombatSync() {
  return !!(ONLINE_CONFIG.syncCombat && onlineIsActive() && ONLINE.meta && ONLINE.meta.status === 'playing');
}
function onlineIsGuestCombat() {
  return onlineCombatSync() && !ONLINE.isHost;
}
function onlineOnBecameGuestCombat() {
  if (!ONLINE_CONFIG.syncCombat) return;
  onlineClearLocalNpcsSilent();
  onlineClearPuppets();
  if (ONLINE.mobsCache) onlineApplyMobsToPuppets(ONLINE.mobsCache);
}
function onlineNextEid() {
  ONLINE.eidSeq = (ONLINE.eidSeq || 0) + 1;
  return 'm' + ONLINE.eidSeq;
}
function onlineEnsureNpcEid(npc) {
  if (!npc) return null;
  if (npc.eid) return npc.eid;
  npc.eid = onlineNextEid();
  return npc.eid;
}
function onlinePackMob(npc) {
  if (!npc || !npc.container) return null;
  const p = npc.container.position;
  const yawRaw = ((npc.container.rotation.y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const st = ONLINE_MOB_ST[npc.state] != null ? ONLINE_MOB_ST[npc.state] : 0;
  return [
    Math.round(p.x * 10),
    Math.round(p.z * 10),
    Math.round((yawRaw / (Math.PI * 2)) * 16) % 16,
    Math.max(0, Math.round(Number(npc.health) || 0)),
    st | 0
  ];
}
function onlineClearLocalNpcsSilent() {
  try {
    if (typeof npcs === 'undefined' || !npcs) return;
    npcs.slice().forEach(function (n) {
      try {
        if (!n) return;
        n._deadCounted = true;
        n.state = 'dead';
        if (n.mesh) {
          const ci = collidableObjects.indexOf(n.mesh);
          if (ci > -1) collidableObjects.splice(ci, 1);
        }
        if (n.container && n.container.parent) scene.remove(n.container);
        else if (n.mesh && n.mesh.parent) scene.remove(n.mesh);
      } catch (e) {}
    });
    npcs.length = 0;
  } catch (e) {}
}
function onlineSpawnAdoptedMob(eid, arr) {
  // RTDB may deliver arrays as objects {"0":…,"1":…}; require indices 0..4.
  if (typeof spawnRobot !== 'function' || !arr || typeof arr !== 'object') return null;
  if (arr[0] == null || arr[1] == null || arr[3] == null) return null;
  const x = Number(arr[0]) / 10;
  const z = Number(arr[1]) / 10;
  if (!isFinite(x) || !isFinite(z)) return null;
  let npc = null;
  try { npc = spawnRobot(new THREE.Vector3(x, 0, z)); } catch (e) { return null; }
  if (!npc) return null;
  npc.eid = String(eid);
  const hp = Math.max(1, Math.min(100000, Math.round(Number(arr[3]) || 100)));
  npc.health = hp;
  try {
    if (npc.mesh) {
      npc.mesh.health = hp;
      npc.mesh.userData.health = hp;
    }
  } catch (e) {}
  const yaw16 = Number(arr[2]) || 0;
  try { npc.container.rotation.y = (yaw16 / 16) * Math.PI * 2; } catch (e) {}
  const stIdx = Number(arr[4]) || 0;
  if (ONLINE_MOB_ST_NAME[stIdx]) npc.state = ONLINE_MOB_ST_NAME[stIdx];
  const num = parseInt(String(eid).replace(/^m/i, ''), 10);
  if (isFinite(num) && num >= (ONLINE.eidSeq || 0)) ONLINE.eidSeq = num;
  return npc;
}
function onlineListenMobsCache() {
  // Cache for claim/adopt. With syncCombat, guests also render puppets (never AI∥puppets).
  if (!ONLINE.refs || !ONLINE.refs.mobs) return;
  if (!onlineSyncMobsEnabled()) return;
  if (ONLINE.subs && ONLINE.subs.onMobs) return;
  const onMobs = function (snap) {
    ONLINE.mobsCache = snap.exists() ? (snap.val() || {}) : {};
    if (onlineIsGuestCombat()) {
      try { onlineApplyMobsToPuppets(ONLINE.mobsCache); } catch (e) {}
    }
  };
  try {
    ONLINE.refs.mobs.on('value', onMobs);
    if (ONLINE.subs) ONLINE.subs.onMobs = onMobs;
  } catch (e) {}
}
function onlineClearPuppets() {
  const map = ONLINE.puppets || {};
  for (const eid in map) {
    try { onlineDestroyPuppet(eid); } catch (e) {}
  }
  ONLINE.puppets = {};
}
function onlineDestroyPuppet(eid) {
  const p = ONLINE.puppets && ONLINE.puppets[eid];
  if (!p) return;
  try {
    if (p.mesh) {
      const ci = collidableObjects.indexOf(p.mesh);
      if (ci > -1) collidableObjects.splice(ci, 1);
    }
  } catch (e) {}
  try {
    if (p.npc) {
      const ni = npcs.indexOf(p.npc);
      if (ni > -1) npcs.splice(ni, 1);
      p.npc.isPuppet = true;
      p.npc._deadCounted = true;
      if (p.npc.container && p.npc.container.parent) scene.remove(p.npc.container);
    } else if (p.group && p.group.parent) {
      scene.remove(p.group);
    }
  } catch (e) {}
  delete ONLINE.puppets[eid];
}
function onlineEnsurePuppet(eid, arr) {
  if (!ONLINE.puppets) ONLINE.puppets = {};
  let p = ONLINE.puppets[eid];
  const x = Number(arr[0]) / 10;
  const z = Number(arr[1]) / 10;
  const yaw16 = Number(arr[2]) || 0;
  const hp = Math.max(0, Math.round(Number(arr[3]) || 0));
  const yaw = (yaw16 / 16) * Math.PI * 2;
  if (!p) {
    if (typeof spawnRobot !== 'function') return null;
    let npc = null;
    try { npc = spawnRobot(new THREE.Vector3(x, 0, z)); } catch (e) { return null; }
    if (!npc) return null;
    npc.isPuppet = true;
    npc.eid = String(eid);
    npc.state = 'idle';
    // Puppets never chase/attack; AI skipped in loop.
    p = ONLINE.puppets[eid] = {
      eid: String(eid),
      npc: npc,
      mesh: npc.mesh,
      tx: x,
      tz: z,
      tyaw: yaw,
      hp: hp
    };
  }
  p.tx = x;
  p.tz = z;
  p.tyaw = yaw;
  p.hp = hp;
  if (p.npc) {
    p.npc.eid = String(eid);
    p.npc.isPuppet = true;
    p.npc.health = Math.max(1, hp);
    try {
      if (p.npc.mesh) {
        p.npc.mesh.health = p.npc.health;
        p.npc.mesh.userData.health = p.npc.health;
      }
    } catch (e) {}
  }
  return p;
}
function onlineApplyMobsToPuppets(data) {
  if (!onlineIsGuestCombat()) return;
  // Never keep local AI sims alongside puppets.
  try {
    if (typeof npcs !== 'undefined' && npcs) {
      for (let i = npcs.length - 1; i >= 0; i--) {
        const n = npcs[i];
        if (n && !n.isPuppet) {
          try {
            n._deadCounted = true;
            n.state = 'dead';
            if (n.mesh) {
              const ci = collidableObjects.indexOf(n.mesh);
              if (ci > -1) collidableObjects.splice(ci, 1);
            }
            if (n.container && n.container.parent) scene.remove(n.container);
          } catch (e) {}
          npcs.splice(i, 1);
        }
      }
    }
  } catch (e) {}
  data = data || {};
  const seen = {};
  let px = 0, pz = 0;
  try {
    if (typeof player !== 'undefined' && player && player.container) {
      px = player.container.position.x;
      pz = player.container.position.z;
    }
  } catch (e) {}
  const interest = Number(ONLINE_CONFIG.mobsInterestRadius) || 48;
  const interestSq = interest * interest;
  for (const eid in data) {
    if (!Object.prototype.hasOwnProperty.call(data, eid)) continue;
    const arr = data[eid];
    if (!arr || typeof arr !== 'object') continue;
    const hp = Number(arr[3]);
    if (!(hp > 0)) continue;
    const x = Number(arr[0]) / 10;
    const z = Number(arr[1]) / 10;
    if (!isFinite(x) || !isFinite(z)) continue;
    const dx = x - px, dz = z - pz;
    if (dx * dx + dz * dz > interestSq) {
      if (ONLINE.puppets && ONLINE.puppets[eid]) onlineDestroyPuppet(eid);
      continue;
    }
    onlineEnsurePuppet(eid, arr);
    seen[eid] = 1;
  }
  const map = ONLINE.puppets || {};
  for (const eid in map) {
    if (!seen[eid]) onlineDestroyPuppet(eid);
  }
}
function onlineUpdatePuppets(delta) {
  if (!onlineIsGuestCombat()) return;
  const map = ONLINE.puppets || {};
  const k = Math.min(1, (delta || 0.016) * 8);
  for (const eid in map) {
    const p = map[eid];
    if (!p || !p.npc || !p.npc.container) continue;
    const c = p.npc.container;
    c.position.x += (p.tx - c.position.x) * k;
    c.position.z += (p.tz - c.position.z) * k;
    // Keep ground-snapped Y from spawn.
    let dy = p.tyaw - c.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    c.rotation.y += dy * k;
    try { p.npc.updateColliderPosition(); p.npc.updateColliderBox(); } catch (e) {}
  }
}
function onlinePublishMobs(now) {
  if (!ONLINE.isHost || !ONLINE.refs || !ONLINE.refs.mobs) return;
  if (!onlineSyncMobsEnabled()) return;
  if (!ONLINE.meta || ONLINE.meta.status !== 'playing') return;
  if (ONLINE.adoptingMobs) return;
  now = now || Date.now();
  let alive = 0;
  let list = [];
  try {
    if (typeof npcs !== 'undefined' && npcs) {
      list = npcs;
      for (let i = 0; i < npcs.length; i++) {
        if (npcs[i] && npcs[i].health > 0) alive++;
      }
    }
  } catch (e) {}
  const hz = onlineEffectiveMobsHz(alive);
  const interval = 1000 / Math.max(0.1, hz);
  if (now - (ONLINE.lastMobsPub || 0) < interval) return;
  ONLINE.lastMobsPub = now;
  const updates = {};
  const seen = {};
  for (let i = 0; i < list.length; i++) {
    const npc = list[i];
    if (!npc || !(npc.health > 0) || !npc.container) continue;
    const eid = onlineEnsureNpcEid(npc);
    const packed = onlinePackMob(npc);
    if (!eid || !packed) continue;
    updates[eid] = packed;
    seen[eid] = 1;
  }
  const prev = ONLINE.mobsPubKeys || {};
  for (const eid in prev) {
    if (!seen[eid]) updates[eid] = null;
  }
  ONLINE.mobsPubKeys = seen;
  if (!Object.keys(updates).length) return;
  try {
    let bytes = 64;
    try { bytes = JSON.stringify(updates).length + 32; } catch (e2) {}
    onlineNetStat('mobsBytes', bytes);
  } catch (e) {}
  try { ONLINE.refs.mobs.update(updates); } catch (e) {}
}
async function onlineAdoptMobsFromRtdb() {
  if (!ONLINE.isHost || !onlineSyncMobsEnabled()) return false;
  if (!ONLINE_CONFIG.hostAdoptMobsOnClaim) return false;
  if (ONLINE.adoptingMobs) return false;
  ONLINE.adoptingMobs = true;
  try {
    onlineClearPuppets();
    let data = ONLINE.mobsCache;
    if (ONLINE.refs && ONLINE.refs.mobs) {
      try {
        const snap = await ONLINE.refs.mobs.get();
        data = snap.exists() ? snap.val() : null;
      } catch (e) { /* keep cache */ }
    }
    ONLINE.mobsCache = data || {};
    const entries = [];
    if (data && typeof data === 'object') {
      for (const eid in data) {
        if (!Object.prototype.hasOwnProperty.call(data, eid)) continue;
        const arr = data[eid];
        if (!arr || typeof arr !== 'object') continue;
        const hp = Number(arr[3]);
        if (!(hp > 0)) continue;
        entries.push({ eid: eid, a: arr });
      }
    }
    if (entries.length) {
      onlineClearLocalNpcsSilent();
      const pubKeys = {};
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const npc = onlineSpawnAdoptedMob(e.eid, e.a);
        if (npc) pubKeys[e.eid] = 1;
      }
      ONLINE.mobsPubKeys = pubKeys;
      ONLINE.lastMobsPub = 0;
      const w = Number(ONLINE.state && ONLINE.state.w) || 0;
      if (w > 0) {
        ONLINE.spawnedWave = w;
        try { if (typeof waveNumber !== 'undefined') waveNumber = Math.max(waveNumber || 0, w); } catch (e) {}
      }
      onlineToast('Adoptaste ' + entries.length + ' enemigos del host anterior');
      return true;
    }
    // mobs vacío: si la oleada estaba activa, restart (producto)
    const st = ONLINE.state || {};
    const w = Number(st.w) || 0;
    const left = Number(st.left) || 0;
    if (w > 0 && left > 0) {
      onlineClearLocalNpcsSilent();
      try { waveNumber = w; } catch (e) {}
      ONLINE.spawnedWave = Math.max(0, w - 1);
      ONLINE.mobsPubKeys = {};
      ONLINE.lastMobsPub = 0;
      onlineSpawnWave(w);
      try { onlinePublishEvent({ k: 'wave', w: w }); } catch (e) {}
      onlineToast('Oleada ' + w + ' reiniciada (sin mobs en RTDB)');
      return true;
    }
    onlineClearLocalNpcsSilent();
    ONLINE.mobsPubKeys = {};
    if (w > 0) ONLINE.spawnedWave = w;
    return false;
  } finally {
    ONLINE.adoptingMobs = false;
  }
}

function onlineRejectAction(aOrReason, fromUid, reason) {
  // Host: onlineRejectAction(action, fromUid, reason) → event nack by seq.
  // Legacy: onlineRejectAction('reason') solo incrementa contador.
  let a = null, uid = null, why = 'reject';
  if (typeof aOrReason === 'string' && arguments.length < 2) {
    why = aOrReason;
  } else {
    a = aOrReason;
    uid = fromUid;
    why = reason || 'reject';
  }
  try { ONLINE.actionsRejected = (ONLINE.actionsRejected || 0) + 1; } catch (e) {}
  try { onlineNetStat('actionsRejected'); } catch (e) {}
  if (a && uid && ONLINE.isHost) {
    const s = Number(a.s);
    if (isFinite(s) && s >= 0) {
      try {
        onlinePublishEvent({
          k: 'nack',
          s: s,
          target: String(uid),
          reason: String(why || 'reject').slice(0, 32)
        });
      } catch (e) {}
    }
  }
  return false;
}
function onlineTrackPendingBySeq(seq, info) {
  if (!seq || ONLINE.isHost) return;
  if (!ONLINE.pendingBySeq) ONLINE.pendingBySeq = {};
  const s = Number(seq);
  if (!isFinite(s)) return;
  const prev = ONLINE.pendingBySeq[s];
  if (prev && prev.timer) { try { clearTimeout(prev.timer); } catch (e) {} }
  const entry = Object.assign({ at: Date.now(), timer: null }, info || {});
  const ms = ONLINE_CONFIG.buildAckTimeoutMs || 2000;
  entry.timer = setTimeout(function () {
    if (!ONLINE.pendingBySeq || !ONLINE.pendingBySeq[s]) return;
    onlineClearPendingBySeq(s, true);
  }, ms);
  ONLINE.pendingBySeq[s] = entry;
}
function onlineClearPendingBySeq(seq, doRollback) {
  if (!ONLINE.pendingBySeq) ONLINE.pendingBySeq = {};
  const s = Number(seq);
  const p = ONLINE.pendingBySeq[s];
  if (!p) return null;
  try { if (p.timer) clearTimeout(p.timer); } catch (e) {}
  delete ONLINE.pendingBySeq[s];
  if (doRollback) onlineRollbackPendingBySeq(s, p);
  return p;
}
function onlineClearAllPendingBySeq(rollback) {
  if (!ONLINE.pendingBySeq) { ONLINE.pendingBySeq = {}; return; }
  Object.keys(ONLINE.pendingBySeq).forEach(function (k) {
    onlineClearPendingBySeq(k, !!rollback);
  });
}
function onlineRollbackPendingBySeq(seq, p) {
  if (!p) return;
  if (p.kind === 'build' && p.key) {
    if (ONLINE.pendingBuild && ONLINE.pendingBuild[p.key]) {
      onlineClearGuestBuildPending(p.key, true);
    }
    return;
  }
  if (p.kind === 'struct') {
    try { onlineRollbackGuestStruct(p); } catch (e) {}
    return;
  }
  if (p.kind === 'craft') {
    try { onlineToast('El host rechazó el craft (' + (p.op || '') + ')'); } catch (e) {}
    return;
  }
  if (p.kind === 'chest' || p.kind === 'loot' || p.kind === 'harvest') {
    try { onlineToast('Acción rechazada' + (p.reason ? ': ' + p.reason : '')); } catch (e) {}
  }
}
function onlineApplyNackEvent(ev) {
  if (!ev) return;
  const me = onlineUser();
  if (!me || String(ev.target) !== me.uid) return;
  if (ONLINE.isHost) return;
  const s = Number(ev.s);
  if (!isFinite(s)) return;
  if (ONLINE.rttSentAt && ONLINE.rttSentAt[s]) {
    onlineNoteRttSample(Date.now() - ONLINE.rttSentAt[s]);
    delete ONLINE.rttSentAt[s];
  }
  const p = ONLINE.pendingBySeq && ONLINE.pendingBySeq[s];
  if (p) {
    p.reason = ev.reason || p.reason;
    onlineClearPendingBySeq(s, true);
    return;
  }
  if (ONLINE.pendingBuild) {
    for (const key in ONLINE.pendingBuild) {
      const b = ONLINE.pendingBuild[key];
      if (b && Number(b.s) === s) {
        onlineClearGuestBuildPending(key, true);
        return;
      }
    }
  }
  try {
    if (ev.reason) onlineToast('Rechazado: ' + String(ev.reason).slice(0, 32));
  } catch (e) {}
}
function onlineGetRemotePose(uid) {
  try {
    if (typeof remotes !== 'undefined' && remotes && remotes[uid]) {
      const r = remotes[uid];
      return {
        x: r.tx, y: r.ty, z: r.tz, yaw: r.yaw,
        hp: (typeof r.hp === 'number') ? r.hp : null
      };
    }
  } catch (e) {}
  return null;
}
function onlineEnsureRemoteHp(uid) {
  if (!ONLINE.remoteHp) ONLINE.remoteHp = {};
  if (ONLINE.remoteHp[uid] == null) {
    const pose = onlineGetRemotePose(uid);
    ONLINE.remoteHp[uid] = (pose && pose.hp != null) ? Math.max(0, Number(pose.hp)) : 100;
  }
  return ONLINE.remoteHp[uid];
}
function onlineHostDamagePlayer(uid, amount, src) {
  if (!ONLINE.isHost || !uid || !(amount > 0)) return false;
  const me = onlineUser();
  // Self-hit on host uses local player HP path; still publish hurt for consistency when damaging remotes only.
  if (me && uid === me.uid) {
    if (typeof player === 'undefined' || !player) return false;
    player.health = Math.max(0, (player.health || 0) - amount);
    try { player.applyDamageEffect(); player.updateStatsHUD(); } catch (e) {}
    try { playSound('damage-taken'); } catch (e) {}
    const hp = Math.max(0, Math.round(player.health));
    onlinePublishEvent({
      k: 'hurt', target: uid, hp: hp, down: hp <= 0, src: src || 'env'
    });
    if (hp <= 0) {
      try { if (typeof showGameOver === 'function') showGameOver(); } catch (e) {}
    }
    return true;
  }
  if (!ONLINE.info[uid]) return false;
  let hp = onlineEnsureRemoteHp(uid);
  hp = Math.max(0, Math.round(hp - amount));
  ONLINE.remoteHp[uid] = hp;
  onlinePublishEvent({
    k: 'hurt', target: uid, hp: hp, down: hp <= 0, src: src || 'env'
  });
  return true;
}
function onlineApplyHurtEvent(ev) {
  if (!ev) return;
  const me = onlineUser();
  if (!me || ev.target !== me.uid) return;
  if (typeof player === 'undefined' || !player) return;
  try { onlineNetStat('hurtEvents'); } catch (e) {}
  const next = Math.max(0, Math.round(Number(ev.hp)));
  if (!isFinite(next)) return;
  // Fuente de verdad de daño entrante: no subir HP vía hurt (revive usa event revive).
  const cur = Math.max(0, Math.round(player.health || 0));
  if (next > cur) return;
  player.health = next;
  try { player.applyDamageEffect(); player.updateStatsHUD(); } catch (e) {}
  try { playSound('damage-taken'); } catch (e) {}
  if (ev.down || next <= 0) {
    try { if (typeof showGameOver === 'function') showGameOver(); } catch (e) {}
  }
}
function onlinePackShootIntent(origin, dir, pitch) {
  ONLINE.shotSeq = (ONLINE.shotSeq || 0) + 1;
  return {
    k: 'shoot',
    d: {
      x: Math.round(origin.x * 10),
      y: Math.round(origin.y * 10),
      z: Math.round(origin.z * 10),
      dx: Math.round(dir.x * 1000),
      dy: Math.round(dir.y * 1000),
      dz: Math.round(dir.z * 1000),
      pitch: Math.round((pitch || 0) * 100),
      seq: ONLINE.shotSeq
    }
  };
}
function onlineSendShootIntent(origin, dir, pitch) {
  if (!onlineIsGuestCombat()) return false;
  return onlineSendAction(onlinePackShootIntent(origin, dir, pitch));
}
function onlineSendAtkIntent(opts) {
  if (!onlineIsGuestCombat()) return false;
  opts = opts || {};
  const d = {};
  if (opts.eid) d.eid = String(opts.eid);
  if (opts.targetUid) d.targetUid = String(opts.targetUid);
  if (opts.x != null) d.x = Math.round(Number(opts.x) * 10);
  if (opts.y != null) d.y = Math.round(Number(opts.y) * 10);
  if (opts.z != null) d.z = Math.round(Number(opts.z) * 10);
  return onlineSendAction({ k: 'atk', d: d });
}
function onlineValidateShootOrigin(fromUid, d) {
  const pose = onlineGetRemotePose(fromUid);
  if (!pose) return null;
  const ox = Number(d.x) / 10, oy = Number(d.y) / 10, oz = Number(d.z) / 10;
  if (!isFinite(ox) || !isFinite(oy) || !isFinite(oz)) return null;
  const distXZ = Math.hypot(ox - pose.x, oz - pose.z);
  if (distXZ > (ONLINE_CONFIG.shootOriginTolM || 2)) return null;
  const eyeY = pose.y + 1.4;
  if (Math.abs(oy - eyeY) > (ONLINE_CONFIG.shootEyeTolM || 1.5)) return null;
  return { ox: ox, oy: oy, oz: oz, pose: pose };
}
function onlineRebuildShootDir(d, pose) {
  let dx = Number(d.dx) / 1000, dy = Number(d.dy) / 1000, dz = Number(d.dz) / 1000;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0.001)) return null;
  dx /= len; dy /= len; dz /= len;
  const pitch = Number(d.pitch) / 100;
  const yaw = pose.yaw || 0;
  // Forward from pose yaw (game faces -Z at yaw 0) + pitch from intent.
  const fwdX = -Math.sin(yaw);
  const fwdZ = -Math.cos(yaw);
  const cp = Math.cos(pitch || 0);
  const sp = Math.sin(pitch || 0);
  const refX = fwdX * cp;
  const refY = sp;
  const refZ = fwdZ * cp;
  const rlen = Math.hypot(refX, refY, refZ) || 1;
  const rx = refX / rlen, ry = refY / rlen, rz = refZ / rlen;
  const dot = Math.max(-1, Math.min(1, dx * rx + dy * ry + dz * rz));
  const ang = Math.acos(dot) * (180 / Math.PI);
  if (ang > (ONLINE_CONFIG.shootAimTolDeg || 25)) return null;
  return { x: dx, y: dy, z: dz };
}
function onlineHostHitscan(origin, dir, range, fromUid) {
  if (typeof THREE === 'undefined') return null;
  const ray = new THREE.Raycaster(
    new THREE.Vector3(origin.x, origin.y, origin.z),
    new THREE.Vector3(dir.x, dir.y, dir.z).normalize(),
    0,
    range || ONLINE_CONFIG.shootRangeM || 80
  );
  const targets = [];
  try {
    if (typeof npcs !== 'undefined' && npcs) {
      for (let i = 0; i < npcs.length; i++) {
        const n = npcs[i];
        if (n && n.health > 0 && n.mesh && !n.isPuppet) targets.push(n.mesh);
      }
    }
  } catch (e) {}
  // Friendly fire: remotes hittable (not shooter).
  if (ONLINE_CONFIG.friendlyFire) {
    try {
      if (typeof remotes !== 'undefined' && remotes) {
        for (const uid in remotes) {
          if (uid === fromUid) continue;
          const r = remotes[uid];
          if (r && r.mesh) targets.push(r.mesh);
        }
      }
    } catch (e) {}
  }
  // Host can also be hit by guest FF via local player mesh.
  if (ONLINE_CONFIG.friendlyFire) {
    try {
      const me = onlineUser();
      if (me && fromUid !== me.uid && typeof player !== 'undefined' && player) {
        if (player.mesh) targets.push(player.mesh);
        if (player.collider) targets.push(player.collider);
      }
    } catch (e) {}
  }
  if (!targets.length) return { kind: 'miss' };
  const hits = ray.intersectObjects(targets, true);
  if (!hits.length) return { kind: 'miss' };
  const hit = hits[0];
  let anc = hit.object;
  while (anc) {
    if (anc.userData && anc.userData.parentCharacter && anc.userData.parentCharacter.health > 0 &&
        !anc.userData.parentCharacter.isPuppet) {
      return { kind: 'npc', npc: anc.userData.parentCharacter, point: hit.point };
    }
    if (anc.userData && anc.userData.isRemotePlayer && anc.userData.remoteUid) {
      return { kind: 'player', uid: anc.userData.remoteUid, point: hit.point };
    }
    if (typeof player !== 'undefined' && player &&
        (anc === player.mesh || anc === player.collider || anc === player.container)) {
      const me = onlineUser();
      if (me) return { kind: 'player', uid: me.uid, point: hit.point };
    }
    anc = anc.parent;
  }
  return { kind: 'miss' };
}
function onlineHandleShootAction(a, fromUid) {
  if (!ONLINE.isHost || !onlineCombatSync()) return;
  const d = a && a.d;
  if (!d) return onlineRejectAction(a, fromUid, 'no-d');
  const validated = onlineValidateShootOrigin(fromUid, d);
  if (!validated) return onlineRejectAction(a, fromUid, 'origin');
  const dir = onlineRebuildShootDir(d, validated.pose);
  if (!dir) return onlineRejectAction(a, fromUid, 'aim');
  const hit = onlineHostHitscan(
    { x: validated.ox, y: validated.oy, z: validated.oz },
    dir,
    ONLINE_CONFIG.shootRangeM || 80,
    fromUid
  );
  const dmg = ONLINE_CONFIG.gunDamage || 15;
  if (!hit || hit.kind === 'miss') return;
  if (hit.kind === 'npc' && hit.npc) {
    try { hit.npc.takeDamage(dmg); } catch (e) {}
    return;
  }
  if (hit.kind === 'player' && hit.uid && hit.uid !== fromUid) {
    onlineHostDamagePlayer(hit.uid, dmg, 'player:' + fromUid);
  }
}
function onlineHandleAtkAction(a, fromUid) {
  if (!ONLINE.isHost || !onlineCombatSync()) return;
  const d = a && a.d;
  if (!d) return onlineRejectAction(a, fromUid, 'no-d');
  const pose = onlineGetRemotePose(fromUid);
  if (!pose) return onlineRejectAction(a, fromUid, 'no-pose');
  const dmg = ONLINE_CONFIG.atkDamageDefault || 8;
  const reach = 2.6;
  if (d.eid) {
    let npc = null;
    try {
      if (typeof npcs !== 'undefined' && npcs) {
        for (let i = 0; i < npcs.length; i++) {
          if (npcs[i] && npcs[i].eid === String(d.eid) && npcs[i].health > 0) {
            npc = npcs[i];
            break;
          }
        }
      }
    } catch (e) {}
    if (!npc || !npc.container) return onlineRejectAction(a, fromUid, 'no-npc');
    const dist = Math.hypot(
      npc.container.position.x - pose.x,
      npc.container.position.z - pose.z
    );
    if (dist > reach + 1.5) return onlineRejectAction(a, fromUid, 'atk-range');
    try { npc.takeDamage(dmg); } catch (e) {}
    return;
  }
  if (d.targetUid && ONLINE_CONFIG.friendlyFire) {
    const tid = String(d.targetUid);
    if (tid === fromUid) return onlineRejectAction(a, fromUid, 'self');
    const tpose = onlineGetRemotePose(tid);
    const me = onlineUser();
    let tx, tz;
    if (tpose) { tx = tpose.x; tz = tpose.z; }
    else if (me && tid === me.uid && player && player.container) {
      tx = player.container.position.x;
      tz = player.container.position.z;
    } else return onlineRejectAction(a, fromUid, 'no-target');
    const dist = Math.hypot(tx - pose.x, tz - pose.z);
    if (dist > reach + 1.5) return onlineRejectAction(a, fromUid, 'atk-range');
    onlineHostDamagePlayer(tid, dmg, 'player:' + fromUid);
  }
}

// --- PR6: loot / harvest / drop ---
function onlineLootSync() {
  return !!(ONLINE_CONFIG.syncLoot && onlineIsActive() && ONLINE.meta && ONLINE.meta.status === 'playing');
}
function onlineAllowRate(bucketName, uid, maxPerSec) {
  if (!uid) return false;
  const now = Date.now();
  if (!ONLINE[bucketName]) ONLINE[bucketName] = {};
  let bucket = ONLINE[bucketName][uid];
  if (!bucket || now - bucket.t > 1000) {
    bucket = ONLINE[bucketName][uid] = { t: now, n: 0 };
  }
  if (bucket.n >= (maxPerSec || 4)) return false;
  bucket.n++;
  return true;
}
function onlineFindNodeByNid(nid) {
  if (!nid) return null;
  try {
    if (typeof resourceNodes !== 'undefined' && resourceNodes) {
      for (let i = 0; i < resourceNodes.length; i++) {
        const n = resourceNodes[i];
        if (!n) continue;
        const id = n.nid || (n.userData && n.userData.nid);
        if (id === nid) return n;
      }
    }
  } catch (e) {}
  return null;
}
function onlineFindItemByIid(iid) {
  if (!iid) return null;
  try {
    if (typeof worldItems !== 'undefined' && worldItems) {
      for (let i = 0; i < worldItems.length; i++) {
        const it = worldItems[i];
        if (!it) continue;
        const id = it.iid || (it.userData && it.userData.iid);
        if (id === iid) return it;
      }
    }
  } catch (e) {}
  try {
    if (typeof collidableObjects !== 'undefined' && collidableObjects) {
      for (let i = 0; i < collidableObjects.length; i++) {
        const it = collidableObjects[i];
        if (!it || (!it.isPickupable && !it.isCollectible)) continue;
        const id = it.iid || (it.userData && it.userData.iid);
        if (id === iid) return it;
      }
    }
  } catch (e) {}
  return null;
}
function onlineRemoveWorldItem(item) {
  if (!item) return false;
  try {
    if (item.parent) item.parent.remove(item);
    else if (typeof scene !== 'undefined') scene.remove(item);
  } catch (e) {}
  try {
    const ci = collidableObjects.indexOf(item);
    if (ci > -1) collidableObjects.splice(ci, 1);
  } catch (e) {}
  try {
    if (typeof worldItems !== 'undefined') {
      const wi = worldItems.indexOf(item);
      if (wi > -1) worldItems.splice(wi, 1);
    }
  } catch (e) {}
  try { item.userData = item.userData || {}; item.userData.collected = true; } catch (e) {}
  return true;
}
function onlineDepleteNodeVisual(node) {
  if (!node) return;
  try {
    node.health = 0;
    node.isHarvested = true;
    node.visible = false;
    const ci = collidableObjects.indexOf(node);
    if (ci > -1) collidableObjects.splice(ci, 1);
  } catch (e) {}
}
function onlineGrantLootToLocal(ev) {
  if (!ev || typeof player === 'undefined' || !player || !player.inventory) return false;
  const id = ev.id || ev.k;
  const amount = Math.max(1, Number(ev.amount) || 1);
  const inv = player.inventory;
  try {
    if (ev.ammoType || (id && String(id).indexOf('ammo') >= 0)) {
      const ammoType = ev.ammoType || 'pistol';
      if (typeof inv.addAmmo === 'function') inv.addAmmo(ammoType, amount);
      else if (typeof inv.addAmmoAmount === 'function') inv.addAmmoAmount(ammoType, amount);
      try { inv.updateAmmoUI(); } catch (e) {}
      try { playSound('ammo-pickup'); } catch (e) {}
      return true;
    }
    if (ev.res || ev.resourceKey) {
      const key = ev.res || ev.resourceKey;
      const added = inv.addResource(key, amount);
      try { updateResourceHUD(); } catch (e) {}
      try { playSound('pickup'); } catch (e) {}
      return added > 0;
    }
    if (typeof ITEM_DEFINITIONS !== 'undefined' && ITEM_DEFINITIONS[id]) {
      const def = ITEM_DEFINITIONS[id];
      if (def.type === 'ammo') {
        const ammoType = def.ammoType || 'pistol';
        const amt = amount || def.amount || 12;
        if (typeof inv.addAmmo === 'function') inv.addAmmo(ammoType, amt);
        try { inv.updateAmmoUI(); } catch (e) {}
        try { playSound('ammo-pickup'); } catch (e) {}
        return true;
      }
      if (def.type === 'resource') {
        const key = def.resourceKey || def.id;
        inv.addResource(key, amount);
        try { updateResourceHUD(); } catch (e) {}
        try { playSound('pickup'); } catch (e) {}
        return true;
      }
      if (def.type === 'key') {
        inv.addKey(def.keyId || def.id, def.name);
        try { playSound('key-pickup'); } catch (e) {}
        return true;
      }
      const entry = { ...def, quantity: 1 };
      if (inv.addItem(entry)) {
        try { playSound('pickup'); } catch (e) {}
        try {
          if (player.updateToolHUD) player.updateToolHUD();
          if (inv.updateQuickSlotUI) inv.updateQuickSlotUI();
        } catch (e) {}
        return true;
      }
    }
  } catch (e) {}
  return false;
}
function onlineSendHarvestIntent(nid, tool) {
  if (!onlineLootSync() || ONLINE.isHost) return false;
  if (!ONLINE.worldStamp) return false;
  if (!nid) return false;
  return onlineSendAction({ k: 'harvest', d: { nid: String(nid), tool: String(tool || '') } });
}
function onlineSendLootIntent(iid) {
  if (!onlineLootSync() || ONLINE.isHost) return false;
  if (!ONLINE.worldStamp) return false;
  if (!iid) return false;
  if (ONLINE.pendingLoot && ONLINE.pendingLoot[iid]) return false;
  if (!ONLINE.pendingLoot) ONLINE.pendingLoot = {};
  ONLINE.pendingLoot[iid] = Date.now();
  const ok = onlineSendAction({ k: 'loot', d: { iid: String(iid) } });
  if (!ok) delete ONLINE.pendingLoot[iid];
  return ok;
}
function onlineSendDropIntent(payload) {
  if (!onlineLootSync() || ONLINE.isHost) return false;
  payload = payload || {};
  return onlineSendAction({
    k: 'drop',
    d: {
      id: String(payload.id || 'food'),
      x: Math.round(Number(payload.x) * 10) / 10,
      y: Math.round(Number(payload.y) * 10) / 10,
      z: Math.round(Number(payload.z) * 10) / 10,
      amount: Math.max(1, Number(payload.amount) || 1)
    }
  });
}
function onlineHostPublishNodeHit(node, gainedRes, gainedQ, byUid) {
  if (!node) return false;
  try { if (typeof ensureNodeStableId === 'function') ensureNodeStableId(node); } catch (e) {}
  const nid = node.nid || (node.userData && node.userData.nid);
  if (!nid) return false;
  const hp = Math.max(0, Math.round(Number(node.health) || 0));
  const rm = !!(node.isHarvested || hp <= 0);
  const ev = { k: 'node', nid: nid, hp: hp, rm: rm };
  if (gainedRes && gainedQ > 0) {
    ev.gained = { res: String(gainedRes), q: Math.max(1, Math.min(20, Math.round(gainedQ))) };
  }
  if (byUid) ev.by = byUid;
  return onlinePublishEvent(ev);
}
function onlineHostPublishLootRemove(item, byUid) {
  if (!item) return false;
  try { if (typeof ensureItemStableId === 'function') ensureItemStableId(item); } catch (e) {}
  const iid = item.iid || (item.userData && item.userData.iid);
  if (!iid) return false;
  if (!ONLINE.claimedIids) ONLINE.claimedIids = {};
  ONLINE.claimedIids[iid] = byUid || 1;
  const key = (item.userData && item.userData.itemKey) || item.name || 'item';
  const amount = (item.userData && item.userData.amount) || 1;
  const p = item.position || { x: 0, y: 0, z: 0 };
  return onlinePublishEvent({
    k: 'loot',
    iid: iid,
    id: key,
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100,
    z: Math.round(p.z * 100) / 100,
    amount: amount,
    rm: true,
    by: byUid || null
  });
}
function onlineHostSpawnLootAt(id, pos, amount) {
  if (!ONLINE.isHost || !onlineLootSync()) return null;
  if (typeof placeWorldItem !== 'function') return null;
  const key = String(id || 'food');
  if (typeof ITEM_DEFINITIONS === 'undefined' || !ITEM_DEFINITIONS[key]) return null;
  const model = placeWorldItem(key, pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z));
  if (!model) return null;
  if (amount != null) {
    try { model.userData.amount = amount; } catch (e) {}
  }
  try { if (typeof ensureItemStableId === 'function') ensureItemStableId(model); } catch (e) {}
  // Unique drop iid: append seq so death/drop don't collide on same grid cell.
  ONLINE.dropSeq = (ONLINE.dropSeq || 0) + 1;
  let base = model.iid;
  if (!base && typeof makeItemId === 'function') {
    try { base = makeItemId(model.position.x, model.position.y, model.position.z, key); } catch (e) {}
  }
  model.iid = (base || ('i_drop_' + key)) + '_d' + ONLINE.dropSeq;
  try { model.userData.iid = model.iid; } catch (e) {}
  onlinePublishEvent({
    k: 'loot',
    iid: model.iid,
    id: key,
    x: Math.round(model.position.x * 100) / 100,
    y: Math.round(model.position.y * 100) / 100,
    z: Math.round(model.position.z * 100) / 100,
    amount: amount || 1,
    rm: false
  });
  return model;
}
function onlineHostDeathLoot(npc) {
  if (!ONLINE.isHost || !onlineLootSync() || !npc || !npc.container) return;
  if (Math.random() > (ONLINE_CONFIG.deathLootChance != null ? ONLINE_CONFIG.deathLootChance : 0.55)) return;
  const p = npc.container.position;
  const pos = new THREE.Vector3(
    p.x + (Math.random() - 0.5) * 1.2,
    (typeof groundTopY === 'function' ? groundTopY(p.x, p.z) : 0) + 0.35,
    p.z + (Math.random() - 0.5) * 1.2
  );
  const pool = [];
  try {
    if (typeof ITEM_DEFINITIONS !== 'undefined') {
      if (ITEM_DEFINITIONS.food) pool.push('food');
      if (ITEM_DEFINITIONS.pistol_ammo) pool.push('pistol_ammo');
      if (ITEM_DEFINITIONS.toxin) pool.push('toxin');
    }
  } catch (e) {}
  if (!pool.length) return;
  const id = pool[(Math.random() * pool.length) | 0];
  onlineHostSpawnLootAt(id, pos, id === 'pistol_ammo' ? 8 : 1);
}
function onlineHandleHarvestAction(a, fromUid) {
  if (!ONLINE.isHost || !onlineLootSync()) return;
  const d = a && a.d;
  if (!d || !d.nid) return onlineRejectAction(a, fromUid, 'no-nid');
  if (!ONLINE.worldStamp) return onlineRejectAction(a, fromUid, 'no-world');
  if (!onlineAllowRate('harvestRate', fromUid, ONLINE_CONFIG.harvestMaxPerSec || 5)) {
    return onlineRejectAction(a, fromUid, 'rate');
  }
  const node = onlineFindNodeByNid(String(d.nid));
  if (!node || node.isHarvested) return onlineRejectAction(a, fromUid, 'no-node');
  const pose = onlineGetRemotePose(fromUid);
  if (pose) {
    const dist = Math.hypot(node.position.x - pose.x, node.position.z - pose.z);
    if (dist > 4.5) return onlineRejectAction(a, fromUid, 'range');
  }
  const tool = String(d.tool || '');
  let required = '';
  if (node.type === 'wood') required = (typeof TOOLS !== 'undefined' ? TOOLS.AXE : 'axe');
  else if (node.type === 'stone' || node.type === 'metal') required = (typeof TOOLS !== 'undefined' ? TOOLS.PICKAXE : 'pickaxe');
  if (required && tool && tool !== String(required)) return onlineRejectAction(a, fromUid, 'tool');
  const efficiency = 1;
  let gained = 0;
  try { gained = node.harvest(efficiency); } catch (e) { return onlineRejectAction(a, fromUid, 'harvest'); }
  if (!(gained > 0)) return;
  let amount = gained;
  try {
    if (node.userData && node.userData.pollinatedUntil && performance.now() < node.userData.pollinatedUntil) {
      amount += 1;
    }
  } catch (e) {}
  // Guest grant via event; host does not add to guest bag locally.
  onlineHostPublishNodeHit(node, node.type, amount, fromUid);
}
function onlineHandleLootAction(a, fromUid) {
  if (!ONLINE.isHost || !onlineLootSync()) return;
  const d = a && a.d;
  if (!d || !d.iid) return onlineRejectAction(a, fromUid, 'no-iid');
  if (!ONLINE.worldStamp) return onlineRejectAction(a, fromUid, 'no-world');
  if (!onlineAllowRate('lootRate', fromUid, ONLINE_CONFIG.lootMaxPerSec || 4)) {
    return onlineRejectAction(a, fromUid, 'rate');
  }
  const iid = String(d.iid);
  if (!ONLINE.claimedIids) ONLINE.claimedIids = {};
  if (ONLINE.claimedIids[iid]) return onlineRejectAction(a, fromUid, 'dupe');
  const item = onlineFindItemByIid(iid);
  if (!item || (item.userData && item.userData.collected)) return onlineRejectAction(a, fromUid, 'no-item');
  const pose = onlineGetRemotePose(fromUid);
  if (pose && item.position) {
    const dist = Math.hypot(item.position.x - pose.x, item.position.z - pose.z);
    if (dist > 4.5) return onlineRejectAction(a, fromUid, 'range');
  }
  ONLINE.claimedIids[iid] = fromUid;
  onlineHostPublishLootRemove(item, fromUid);
  onlineRemoveWorldItem(item);
}
function onlineHandleDropAction(a, fromUid) {
  if (!ONLINE.isHost || !onlineLootSync()) return;
  const d = a && a.d;
  if (!d || !d.id) return onlineRejectAction(a, fromUid, 'no-id');
  if (!onlineAllowRate('lootRate', fromUid, ONLINE_CONFIG.lootMaxPerSec || 4)) {
    return onlineRejectAction(a, fromUid, 'rate');
  }
  const x = Number(d.x), y = Number(d.y), z = Number(d.z);
  if (!isFinite(x) || !isFinite(z)) return onlineRejectAction(a, fromUid, 'pos');
  const pose = onlineGetRemotePose(fromUid);
  if (pose) {
    const dist = Math.hypot(x - pose.x, z - pose.z);
    if (dist > 5) return onlineRejectAction(a, fromUid, 'range');
  }
  const pos = new THREE.Vector3(x, isFinite(y) ? y : 0.4, z);
  onlineHostSpawnLootAt(String(d.id), pos, Number(d.amount) || 1);
}
function onlineApplyNodeEvent(ev) {
  if (!ev || !ev.nid) return;
  const me = onlineUser();
  const mine = !!(me && ev.by === me.uid);
  // Host already applied local harvest for own swings; still sync guest-driven hits.
  const node = onlineFindNodeByNid(ev.nid);
  if (node && !(ONLINE.isHost && mine)) {
    if (typeof ev.hp === 'number') node.health = Math.max(0, Number(ev.hp));
    if (ev.rm || node.health <= 0) onlineDepleteNodeVisual(node);
    else {
      try {
        const origin = node.position.clone();
        origin.y += 0.5;
        createHarvestEffect(origin);
      } catch (e) {}
    }
  }
  // Grant only to the actor guest (host granted locally on own harvest).
  if (mine && !ONLINE.isHost && ev.gained && ev.gained.res && typeof player !== 'undefined' && player && player.inventory) {
    const q = Math.max(1, Math.min(20, Number(ev.gained.q) || 1));
    try {
      const added = player.inventory.addResource(ev.gained.res, q);
      if (added > 0) {
        try { updateResourceHUD(); } catch (e) {}
        try { playSound('harvest'); } catch (e) {}
        try {
          showMessage('+' + added + ' ' + ((typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[ev.gained.res]) || ev.gained.res));
        } catch (e) {}
      }
    } catch (e) {}
  }
}
function onlineApplyLootEvent(ev) {
  if (!ev || !ev.iid) return;
  const me = onlineUser();
  const mine = !!(me && ev.by === me.uid);
  const iid = String(ev.iid);
  if (ONLINE.pendingLoot) delete ONLINE.pendingLoot[iid];
  if (ev.rm) {
    if (!ONLINE.claimedIids) ONLINE.claimedIids = {};
    ONLINE.claimedIids[iid] = ev.by || 1;
    const item = onlineFindItemByIid(iid);
    if (item) onlineRemoveWorldItem(item);
    // Bag grant only for the picker; host already picked locally.
    if (mine && !ONLINE.isHost) onlineGrantLootToLocal(ev);
    return;
  }
  // Spawn (drop / death loot): host already spawned if publisher.
  if (ONLINE.isHost && mine) return;
  if (onlineFindItemByIid(iid)) return;
  if (typeof placeWorldItem !== 'function') return;
  const key = ev.id || 'food';
  if (typeof ITEM_DEFINITIONS === 'undefined' || !ITEM_DEFINITIONS[key]) return;
  const pos = new THREE.Vector3(Number(ev.x) || 0, Number(ev.y) || 0.4, Number(ev.z) || 0);
  const model = placeWorldItem(key, pos);
  if (!model) return;
  model.iid = iid;
  try {
    model.userData.iid = iid;
    if (ev.amount != null) model.userData.amount = ev.amount;
  } catch (e) {}
}

// --- PR8: struct stairs/door + shared craft consume ---
function onlineStructSync() {
  return !!(ONLINE_CONFIG.syncStruct && onlineIsActive() && ONLINE.meta && ONLINE.meta.status === 'playing');
}
function onlineCraftSync() {
  return !!(ONLINE_CONFIG.syncCraft && onlineIsActive() && ONLINE.meta && ONLINE.meta.status === 'playing');
}
function onlineFindStairsAt(x, y, z) {
  try {
    if (typeof placedStairs === 'undefined' || !placedStairs) return null;
    for (let i = 0; i < placedStairs.length; i++) {
      const gr = placedStairs[i];
      if (!gr || !gr.position) continue;
      if (Math.abs(gr.position.x - x) < 0.3 && Math.abs(gr.position.z - z) < 0.3) return gr;
    }
  } catch (e) {}
  return null;
}
function onlineRemoveStairsAt(x, y, z) {
  const gr = onlineFindStairsAt(x, y, z);
  if (!gr) return false;
  try {
    gr.traverse(function (o) {
      if (o.isMesh) {
        const i = collidableObjects.indexOf(o);
        if (i > -1) collidableObjects.splice(i, 1);
      }
    });
    scene.remove(gr);
    const j = placedStairs.indexOf(gr);
    if (j > -1) placedStairs.splice(j, 1);
  } catch (e) { return false; }
  return true;
}
function onlineRemoveDoorAt(x, y, z) {
  try {
    if (typeof placedDoors === 'undefined' || !placedDoors) return false;
    for (let i = placedDoors.length - 1; i >= 0; i--) {
      const d = placedDoors[i];
      if (!d || !d.position) continue;
      if (Math.abs(d.position.x - x) < 0.35 && Math.abs(d.position.z - z) < 0.35) {
        try { scene.remove(d); } catch (e) {}
        try {
          const ci = collidableObjects.indexOf(d);
          if (ci > -1) collidableObjects.splice(ci, 1);
        } catch (e) {}
        placedDoors.splice(i, 1);
        return true;
      }
    }
  } catch (e) {}
  return false;
}
function onlineBroadcastStruct(delta) {
  if (!delta || !onlineStructSync()) return false;
  if (ONLINE.applyingRemote || ONLINE.applyingWorld) return false;
  const t = String(delta.t || '');
  if (t !== 'stairs' && t !== 'door') return false;
  const x = Number(delta.x), y = Number(delta.y), z = Number(delta.z);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return false;
  const rm = !!delta.rm;
  const r = Number(delta.r) || 0;
  const base = { t: t, x: x, y: y, z: z, rm: rm, r: r };
  if (!ONLINE.isHost) {
    const ok = onlineSendAction({ k: 'struct', d: base });
    if (ok) {
      onlineTrackPendingBySeq(ONLINE.actionSeq, {
        kind: 'struct', t: t, x: x, y: y, z: z, rm: rm, r: r
      });
    }
    return ok;
  }
  return onlinePublishStructEvent(base, onlineUser() && onlineUser().uid);
}
function onlinePublishStructEvent(base, byUid) {
  if (!ONLINE.isHost || !base) return false;
  return onlinePublishEvent({
    k: 'struct',
    t: String(base.t),
    x: Number(base.x),
    y: Number(base.y),
    z: Number(base.z),
    rm: !!base.rm,
    r: Number(base.r) || 0,
    by: byUid || null
  });
}
function onlineHandleStructAction(a, fromUid) {
  if (!ONLINE.isHost || !onlineStructSync()) return;
  const d = a && a.d;
  if (!d || !d.t) return onlineRejectAction(a, fromUid, 'struct-d');
  const t = String(d.t);
  if (t !== 'stairs' && t !== 'door') return onlineRejectAction(a, fromUid, 'bad-type');
  const x = Number(d.x), y = Number(d.y), z = Number(d.z);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return onlineRejectAction(a, fromUid, 'struct-pos');
  if (x < -10000 || x > 10000 || y < -1000 || y > 1000 || z < -10000 || z > 10000) {
    return onlineRejectAction(a, fromUid, 'struct-bounds');
  }
  const rm = !!d.rm;
  const r = Number(d.r) || 0;
  if (rm) {
    const exists = (t === 'stairs') ? onlineFindStairsAt(x, y, z) : onlineFindDoorByApprox(x, z);
    if (!exists) return onlineRejectAction(a, fromUid, 'no-struct');
  } else {
    if (t === 'stairs' && onlineFindStairsAt(x, y, z)) return onlineRejectAction(a, fromUid, 'occupied');
    if (t === 'door' && onlineFindDoorByApprox(x, z)) return onlineRejectAction(a, fromUid, 'occupied');
  }
  // Host applies locally then publishes (guests apply from event; host skips self via applying flag).
  ONLINE.applyingRemote = true;
  try {
    onlineApplyStructLocal(t, x, y, z, rm, r);
  } finally {
    ONLINE.applyingRemote = false;
  }
  onlinePublishStructEvent({ t: t, x: x, y: y, z: z, rm: rm, r: r }, fromUid);
}
function onlineFindDoorByApprox(x, z) {
  try {
    if (typeof placedDoors === 'undefined' || !placedDoors) return null;
    for (let i = 0; i < placedDoors.length; i++) {
      const d = placedDoors[i];
      if (!d || !d.position) continue;
      if (Math.abs(d.position.x - x) < 0.35 && Math.abs(d.position.z - z) < 0.35) return d;
    }
  } catch (e) {}
  return null;
}
function onlineApplyStructLocal(t, x, y, z, rm, r) {
  if (rm) {
    if (t === 'stairs') onlineRemoveStairsAt(x, y, z);
    else onlineRemoveDoorAt(x, y, z);
    return;
  }
  const pos = new THREE.Vector3(x, y, z);
  if (t === 'stairs') {
    if (onlineFindStairsAt(x, y, z)) return;
    if (typeof placeStairs === 'function') placeStairs(pos, r);
  } else if (t === 'door') {
    if (onlineFindDoorByApprox(x, z)) return;
    if (typeof placeDoor === 'function') {
      const door = placeDoor(pos, r);
      try { if (typeof ensureDoorStableId === 'function') ensureDoorStableId(door); } catch (e) {}
    }
  }
}
function onlineApplyStructEvent(ev) {
  if (!ev || !onlineStructSync()) return;
  const me = onlineUser();
  const mine = !!(me && ev.by === me.uid);
  // Guest ACK: clear pending for our own struct place.
  if (mine && !ONLINE.isHost) {
    const sKeys = ONLINE.pendingBySeq ? Object.keys(ONLINE.pendingBySeq) : [];
    for (let i = 0; i < sKeys.length; i++) {
      const p = ONLINE.pendingBySeq[sKeys[i]];
      if (p && p.kind === 'struct' && p.t === ev.t &&
          Math.abs(Number(p.x) - Number(ev.x)) < 0.2 &&
          Math.abs(Number(p.z) - Number(ev.z)) < 0.2) {
        onlineClearPendingBySeq(sKeys[i], false);
        break;
      }
    }
    // Host already applied for guest intents on host; guest still needs local apply
    // unless they already optimistic-placed (we do optimistic place).
    if (!ev.rm) return;
  }
  if (ONLINE.isHost && mine) return;
  ONLINE.applyingRemote = true;
  try {
    onlineApplyStructLocal(
      String(ev.t),
      Number(ev.x), Number(ev.y), Number(ev.z),
      !!ev.rm,
      Number(ev.r) || 0
    );
  } finally {
    ONLINE.applyingRemote = false;
  }
}
function onlineRollbackGuestStruct(p) {
  if (!p) return;
  ONLINE.applyingRemote = true;
  try {
    if (p.rm) {
      // Rejected destroy → re-place.
      onlineApplyStructLocal(p.t, p.x, p.y, p.z, false, p.r || 0);
      try { onlineToast('El host rechazó quitar la estructura'); } catch (e) {}
    } else {
      onlineApplyStructLocal(p.t, p.x, p.y, p.z, true, p.r || 0);
      try { onlineToast('El host rechazó la estructura'); } catch (e) {}
    }
  } finally {
    ONLINE.applyingRemote = false;
  }
}

function onlineEnsureBenchCid(wb) {
  if (!wb || !wb.pos) return null;
  if (wb.cid) return wb.cid;
  try {
    if (typeof makeContainerId === 'function') {
      wb.cid = makeContainerId(wb.pos.x, wb.pos.y, wb.pos.z, 'bench');
    }
  } catch (e) {}
  return wb.cid || null;
}
function onlinePublishBenchStorageSlots(wb, byUid) {
  if (!ONLINE.isHost || !wb) return;
  const cid = onlineEnsureBenchCid(wb);
  if (!cid || !Array.isArray(wb.storage)) return;
  for (let i = 0; i < wb.storage.length; i++) {
    const s = wb.storage[i];
    if (!s) {
      onlinePublishChestEvent({ cid: cid, op: 'put', slot: i, id: '', q: 0, by: byUid || null });
    } else {
      onlinePublishChestEvent({
        cid: cid, op: 'put', slot: i, id: s.id, q: s.quantity || 1, by: byUid || null
      });
    }
  }
}
function onlinePublishLinkedChestSlots(wb, byUid) {
  if (!ONLINE.isHost || !wb) return;
  let chests = [];
  try {
    chests = (typeof linkedChestsFor === 'function') ? linkedChestsFor(wb) : [];
  } catch (e) {}
  for (let c = 0; c < chests.length; c++) {
    const ref = chests[c];
    if (!ref || !ref.cid || !ref.slots) continue;
    for (let i = 0; i < ref.slots.length; i++) {
      const s = ref.slots[i];
      if (!s) {
        onlinePublishChestEvent({ cid: ref.cid, op: 'put', slot: i, id: '', q: 0, by: byUid || null });
      } else {
        onlinePublishChestEvent({
          cid: ref.cid, op: 'put', slot: i, id: s.id, q: s.quantity || 1, by: byUid || null
        });
      }
    }
  }
}
function onlineFindBenchByPos(x, y, z) {
  return onlineBenchAt(x, y, z);
}
function onlineSendCraftAmmoIntent(wb, dispenserCid) {
  if (!onlineCraftSync() || ONLINE.isHost || !wb || !wb.pos) return false;
  const d = {
    op: 'ammo',
    x: Number(wb.pos.x),
    y: Number(wb.pos.y),
    z: Number(wb.pos.z)
  };
  if (dispenserCid) d.cid = String(dispenserCid);
  const ok = onlineSendAction({ k: 'craft', d: d });
  if (ok) {
    onlineTrackPendingBySeq(ONLINE.actionSeq, { kind: 'craft', op: 'ammo' });
  }
  return ok;
}
function onlineHandleCraftAction(a, fromUid) {
  if (!ONLINE.isHost || !onlineCraftSync()) return;
  const d = a && a.d;
  if (!d || !d.op) return onlineRejectAction(a, fromUid, 'craft-d');
  if (!onlineAllowRate('craftRate', fromUid, ONLINE_CONFIG.craftMaxPerSec || 3)) {
    return onlineRejectAction(a, fromUid, 'rate');
  }
  const op = String(d.op);
  const x = Number(d.x), y = Number(d.y), z = Number(d.z);
  if (!isFinite(x) || !isFinite(z)) return onlineRejectAction(a, fromUid, 'craft-pos');
  const wb = onlineFindBenchByPos(x, y, z);
  if (!wb) return onlineRejectAction(a, fromUid, 'no-bench');
  if (op === 'ammo') {
    const cost = (typeof BENCH_AMMO_COST !== 'undefined') ? BENCH_AMMO_COST : { metal: 2, wood: 1 };
    const batch = (typeof BENCH_AMMO_BATCH !== 'undefined') ? BENCH_AMMO_BATCH : 12;
    if (typeof benchConsumeBase !== 'function' || !benchConsumeBase(wb, cost)) {
      return onlineRejectAction(a, fromUid, 'no-mats');
    }
    // Prefer world dispenser by cid; else bench built-in dispenser stock.
    let ref = null;
    if (d.cid) ref = onlineFindContainerByCid(String(d.cid));
    let stockAmt = null;
    if (ref && ref.mode === 'dispenser' && ref.stock) {
      ref.stock.amount = (ref.stock.amount || 0) + batch;
      stockAmt = ref.stock.amount;
      onlinePublishChestEvent({
        cid: ref.cid, op: 'put', id: ref.stock.id || 'pistol_ammo',
        q: batch, amount: ref.stock.amount, by: fromUid
      });
    } else {
      const cap = wb.dispenserCap || 240;
      wb.dispenserStock = Math.min(cap, (wb.dispenserStock || 0) + batch);
      stockAmt = wb.dispenserStock;
    }
    onlinePublishBenchStorageSlots(wb, fromUid);
    onlinePublishLinkedChestSlots(wb, fromUid);
    try {
      onlinePublishEvent({
        k: 'fx', fk: 'craft', x: x, y: y, z: z, amount: stockAmt, by: fromUid
      });
    } catch (e) {}
    return;
  }
  return onlineRejectAction(a, fromUid, 'bad-op');
}
function onlineHostCraftConsume(wb, cost, dispenserRef) {
  // Host-local shared craft consume + publish storage deltas.
  if (!onlineCraftSync() || !ONLINE.isHost || !wb) return false;
  if (typeof benchConsumeBase !== 'function') return false;
  if (!benchConsumeBase(wb, cost)) return false;
  const batch = (typeof BENCH_AMMO_BATCH !== 'undefined') ? BENCH_AMMO_BATCH : 12;
  let stockAmt = null;
  if (dispenserRef && dispenserRef.mode === 'dispenser' && dispenserRef.stock) {
    dispenserRef.stock.amount = (dispenserRef.stock.amount || 0) + batch;
    stockAmt = dispenserRef.stock.amount;
    onlinePublishChestEvent({
      cid: dispenserRef.cid, op: 'put', id: dispenserRef.stock.id || 'pistol_ammo',
      q: batch, amount: dispenserRef.stock.amount
    });
  } else {
    const cap = wb.dispenserCap || 240;
    wb.dispenserStock = Math.min(cap, (wb.dispenserStock || 0) + batch);
    stockAmt = wb.dispenserStock;
  }
  onlinePublishBenchStorageSlots(wb, onlineUser() && onlineUser().uid);
  onlinePublishLinkedChestSlots(wb, onlineUser() && onlineUser().uid);
  try {
    onlinePublishEvent({
      k: 'fx', fk: 'craft',
      x: wb.pos.x, y: wb.pos.y, z: wb.pos.z,
      amount: stockAmt,
      by: onlineUser() && onlineUser().uid
    });
  } catch (e) {}
  return true;
}

// --- PR7: chests / dispensers / doors ---
function onlineChestsSync() {
  return !!(ONLINE_CONFIG.syncChests && onlineIsActive() && ONLINE.meta && ONLINE.meta.status === 'playing');
}
function onlineFindContainerByCid(cid) {
  if (!cid) return null;
  try {
    if (typeof worldContainers !== 'undefined' && worldContainers) {
      for (let i = 0; i < worldContainers.length; i++) {
        const c = worldContainers[i];
        if (c && c.cid === cid) return c;
      }
    }
  } catch (e) {}
  // Bench built-in storage exposed as synthetic container for craft sync.
  try {
    if (typeof workbenches !== 'undefined' && workbenches) {
      for (let i = 0; i < workbenches.length; i++) {
        const w = workbenches[i];
        if (!w) continue;
        onlineEnsureBenchCid(w);
        if (w.cid === cid) {
          if (!Array.isArray(w.storage)) w.storage = new Array(w.storageCapacity || 12).fill(null);
          return { cid: w.cid, mode: 'storage', slots: w.storage, pos: w.pos, _bench: w };
        }
      }
    }
  } catch (e) {}
  return null;
}
function onlineFindDoorByDid(did) {
  if (!did) return null;
  const lists = [];
  try { if (typeof placedDoors !== 'undefined' && placedDoors) lists.push(placedDoors); } catch (e) {}
  try { if (typeof roomObjects !== 'undefined' && roomObjects) lists.push(roomObjects); } catch (e) {}
  for (let li = 0; li < lists.length; li++) {
    const arr = lists[li];
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i];
      if (!d || !d.userData || !d.userData.isDoor) continue;
      const id = d.did || d.userData.did;
      if (id === did) return d;
    }
  }
  return null;
}
function onlineSendChestIntent(d) {
  if (!onlineChestsSync() || ONLINE.isHost) return false;
  if (!ONLINE.worldStamp) return false;
  if (!d || !d.cid || !d.op) return false;
  return onlineSendAction({ k: 'chest', d: d });
}
function onlineSendDoorIntent(did, open) {
  if (!onlineChestsSync() || ONLINE.isHost) return false;
  if (!did) return false;
  return onlineSendAction({ k: 'door', d: { did: String(did), open: !!open } });
}
function onlinePublishChestEvent(ev) {
  if (!ONLINE.isHost) return false;
  return onlinePublishEvent(Object.assign({ k: 'chest' }, ev || {}));
}
function onlinePublishDoorEvent(did, open, byUid) {
  if (!ONLINE.isHost) return false;
  return onlinePublishEvent({
    k: 'door',
    did: String(did),
    open: !!open,
    by: byUid || null
  });
}
function onlineChestSlotEntry(id, q) {
  const def = (typeof resolveContainerDef === 'function') ? resolveContainerDef(id) : { id: id, name: id, type: 'item' };
  const entry = {
    id: id,
    name: def.name || id,
    type: def.type || 'item',
    quantity: Math.max(1, Number(q) || 1),
    stackable: !!(def.stackable || def.type === 'resource' || def.type === 'ammo')
  };
  if (def.ammoType) entry.ammoType = def.ammoType;
  if (def.type === 'ammo' && !entry.ammoType) {
    entry.ammoType = (String(id).indexOf('pistol') >= 0) ? 'pistol' : 'pistol';
  }
  if (def.toolType) entry.toolType = def.toolType;
  if (def.healAmount) entry.healAmount = def.healAmount;
  if (def.efficiency) entry.efficiency = def.efficiency;
  if (def.magazineSize) entry.magazineSize = def.magazineSize;
  if (entry.type === 'ammo') entry.amount = entry.quantity;
  return entry;
}
function onlineApplyChestSlotState(ref, slotIdx, id, q) {
  if (!ref || ref.mode !== 'storage' || !ref.slots) return;
  const i = Number(slotIdx);
  if (!isFinite(i) || i < 0 || i >= ref.slots.length) return;
  const qty = Math.max(0, Number(q) || 0);
  if (!id || qty <= 0) {
    ref.slots[i] = null;
  } else {
    ref.slots[i] = onlineChestSlotEntry(id, qty);
  }
  try {
    if (typeof containerOpen !== 'undefined' && containerOpen && currentContainer === ref) {
      refreshContainerModal();
    }
  } catch (e) {}
}
function onlineGrantChestTakeToLocal(id, q) {
  if (!id || typeof player === 'undefined' || !player || !player.inventory) return false;
  const inv = player.inventory;
  const qty = Math.max(1, Number(q) || 1);
  const def = (typeof resolveContainerDef === 'function') ? resolveContainerDef(id) : null;
  const type = (def && def.type) || 'item';
  try {
    if (type === 'resource' || id === 'wood' || id === 'stone' || id === 'metal') {
      const added = inv.addResource(id, qty);
      try { updateResourceHUD(); } catch (e) {}
      return added > 0;
    }
    if (type === 'ammo' || (def && def.ammoType)) {
      const ammoType = (def && def.ammoType) || 'pistol';
      if (typeof inv.addAmmoAmount === 'function') return inv.addAmmoAmount(ammoType, qty) > 0;
      return !!inv.addAmmo(ammoType, qty);
    }
    const entry = Object.assign({}, def || {}, {
      id: id,
      name: (def && def.name) || id,
      type: type,
      quantity: 1
    });
    try {
      if (def && def.createModel && (type === 'weapon' || type === 'tool')) {
        entry.model = def.createModel();
      }
    } catch (e) {}
    let moved = 0;
    for (let k = 0; k < qty; k++) {
      if (!inv.addItem(Object.assign({}, entry, { quantity: 1 }))) break;
      moved++;
    }
    try { inv.updateInventoryUI(); inv.updateQuickSlotUI(); } catch (e) {}
    return moved > 0;
  } catch (e) { return false; }
}
function onlineHandleChestAction(a, fromUid) {
  if (!ONLINE.isHost || !onlineChestsSync()) return;
  const d = a && a.d;
  if (!d || !d.cid || !d.op) return onlineRejectAction(a, fromUid, 'chest-d');
  if (!ONLINE.worldStamp) return onlineRejectAction(a, fromUid, 'no-world');
  if (!onlineAllowRate('lootRate', fromUid, ONLINE_CONFIG.chestMaxPerSec || 4)) {
    return onlineRejectAction(a, fromUid, 'rate');
  }
  const ref = onlineFindContainerByCid(String(d.cid));
  if (!ref) return onlineRejectAction(a, fromUid, 'no-chest');
  const op = String(d.op);
  if (op === 'put') {
    if (ref.mode !== 'storage') return onlineRejectAction(a, fromUid, 'mode');
    const id = String(d.id || '');
    const q = Math.max(1, Math.min(200, Number(d.q) || 1));
    if (!id) return onlineRejectAction(a, fromUid, 'no-id');
    let slot = (d.slot != null) ? Number(d.slot) : -1;
    const entry = onlineChestSlotEntry(id, q);
    if (!(slot >= 0 && slot < ref.slots.length)) {
      slot = (typeof findFreeOrStackSlot === 'function') ? findFreeOrStackSlot(ref, entry) : -1;
    }
    if (!(slot >= 0)) return onlineRejectAction(a, fromUid, 'full');
    if (ref.slots[slot] && ref.slots[slot].id === entry.id &&
        (ref.slots[slot].ammoType || null) === (entry.ammoType || null)) {
      ref.slots[slot].quantity = (ref.slots[slot].quantity || 0) + q;
      if (ref.slots[slot].type === 'ammo') ref.slots[slot].amount = ref.slots[slot].quantity;
    } else {
      ref.slots[slot] = entry;
    }
    const outQ = ref.slots[slot].quantity || q;
    onlinePublishChestEvent({
      cid: ref.cid, op: 'put', slot: slot, id: id, q: outQ, by: fromUid
    });
    try {
      if (typeof containerOpen !== 'undefined' && containerOpen && currentContainer === ref) {
        refreshContainerModal();
      }
    } catch (e) {}
    return;
  }
  if (op === 'take') {
    // Dispenser take (no slot / stock)
    if (ref.mode === 'dispenser') {
      if (!ref.stock || (ref.stock.amount || 0) <= 0) return onlineRejectAction(a, fromUid, 'empty');
      const id = ref.stock.id || d.id || 'pistol_ammo';
      ref.stock.amount = Math.max(0, (ref.stock.amount || 0) - 1);
      onlinePublishChestEvent({
        cid: ref.cid, op: 'take', id: id, q: 1, amount: ref.stock.amount, by: fromUid
      });
      try {
        if (typeof containerOpen !== 'undefined' && containerOpen && currentContainer === ref) {
          refreshContainerModal();
        }
      } catch (e) {}
      return;
    }
    if (ref.mode !== 'storage') return onlineRejectAction(a, fromUid, 'mode');
    const slot = Number(d.slot);
    if (!(slot >= 0) || slot >= ref.slots.length || !ref.slots[slot]) return onlineRejectAction(a, fromUid, 'empty');
    const cur = ref.slots[slot];
    const want = Math.max(1, Math.min(Number(d.q) || (cur.quantity || 1), cur.quantity || 1));
    const id = cur.id;
    cur.quantity = (cur.quantity || 1) - want;
    if (cur.type === 'ammo') cur.amount = cur.quantity;
    const left = cur.quantity;
    if (left <= 0) ref.slots[slot] = null;
    onlinePublishChestEvent({
      cid: ref.cid,
      op: 'take',
      slot: slot,
      id: id,
      q: want,
      amount: Math.max(0, left),
      by: fromUid
    });
    try {
      if (typeof containerOpen !== 'undefined' && containerOpen && currentContainer === ref) {
        refreshContainerModal();
      }
    } catch (e) {}
  }
}
function onlineHandleDoorAction(a, fromUid) {
  if (!ONLINE.isHost || !onlineChestsSync()) return;
  const d = a && a.d;
  if (!d || !d.did || typeof d.open !== 'boolean') return onlineRejectAction(a, fromUid, 'door-d');
  const door = onlineFindDoorByDid(String(d.did));
  if (!door || !door.userData) return onlineRejectAction(a, fromUid, 'no-door');
  // Portals may open visually but goThroughDoor stays blocked.
  onlineApplyDoorState(door, !!d.open);
  onlinePublishDoorEvent(door.did || door.userData.did, !!d.open, fromUid);
}
function onlineApplyDoorState(door, open) {
  if (!door || !door.userData) return;
  door.userData.open = !!open;
  if (open) {
    door.userData.locked = false;
    try {
      door.material.transparent = true;
      door.material.opacity = 0.3;
      door.material.color.setHex(0x00FF00);
    } catch (e) {}
    try {
      const index = collidableObjects.indexOf(door);
      if (index > -1) collidableObjects.splice(index, 1);
    } catch (e) {}
    try { playSound('door_open'); } catch (e) {}
  } else {
    try {
      door.material.transparent = false;
      door.material.opacity = 1;
      door.material.color.setHex(0x8B4513);
    } catch (e) {}
    try {
      if (collidableObjects.indexOf(door) === -1) collidableObjects.push(door);
    } catch (e) {}
    try { playSound('door_close'); } catch (e) {}
  }
}
function onlineApplyChestEvent(ev) {
  if (!ev || !ev.cid) return;
  const me = onlineUser();
  const mine = !!(me && ev.by === me.uid);
  const ref = onlineFindContainerByCid(String(ev.cid));
  if (!ref) return;
  const op = String(ev.op || '');
  if (ref.mode === 'dispenser' && op === 'take') {
    if (!(ONLINE.isHost && mine)) {
      if (ref.stock && typeof ev.amount === 'number') ref.stock.amount = Math.max(0, Number(ev.amount));
      else if (ref.stock) ref.stock.amount = Math.max(0, (ref.stock.amount || 0) - (Number(ev.q) || 1));
    }
    if (mine && !ONLINE.isHost) {
      onlineGrantChestTakeToLocal(ev.id || (ref.stock && ref.stock.id), Number(ev.q) || 1);
      try { playSound('pickup'); } catch (e) {}
    }
    try {
      if (typeof containerOpen !== 'undefined' && containerOpen && currentContainer === ref) {
        refreshContainerModal();
      }
    } catch (e) {}
    return;
  }
  if (op === 'put') {
    // Dispenser stock refill (craft ammo) uses amount, not slots.
    if (ref.mode === 'dispenser' && ref.stock && typeof ev.amount === 'number') {
      if (!(ONLINE.isHost && mine)) {
        ref.stock.amount = Math.max(0, Number(ev.amount));
      }
      try {
        if (typeof containerOpen !== 'undefined' && containerOpen && currentContainer === ref) {
          refreshContainerModal();
        }
        if (typeof currentBench !== 'undefined' && currentBench && typeof renderBenchBaseUI === 'function') {
          renderBenchBaseUI(currentBench);
        }
      } catch (e) {}
      return;
    }
    if (!(ONLINE.isHost && mine)) {
      onlineApplyChestSlotState(ref, ev.slot, ev.id, ev.q);
    }
    try {
      if (typeof containerOpen !== 'undefined' && containerOpen && currentContainer === ref) {
        refreshContainerModal();
      }
      if (ref._bench && typeof renderBenchBaseUI === 'function') {
        renderBenchBaseUI(ref._bench);
      }
    } catch (e) {}
    return;
  }
  if (op === 'take') {
    // Update slot for everyone except host actor (already mutated).
    if (!(ONLINE.isHost && mine)) {
      const left = (typeof ev.amount === 'number') ? ev.amount : 0;
      onlineApplyChestSlotState(ref, ev.slot, left > 0 ? ev.id : null, left);
    }
    if (mine && !ONLINE.isHost) {
      onlineGrantChestTakeToLocal(ev.id, Number(ev.q) || 1);
      try { playSound('pickup'); } catch (e) {}
    }
    try {
      if (typeof containerOpen !== 'undefined' && containerOpen && currentContainer === ref) {
        refreshContainerModal();
      }
    } catch (e) {}
  }
}
function onlineApplyDoorEvent(ev) {
  if (!ev || !ev.did) return;
  const me = onlineUser();
  const mine = !!(me && ev.by === me.uid);
  // Host already applied local/remote intent.
  if (ONLINE.isHost && mine) return;
  if (ONLINE.isHost && !mine) return; // host applied in handleDoorAction
  const door = onlineFindDoorByDid(String(ev.did));
  if (!door) return;
  onlineApplyDoorState(door, !!ev.open);
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
        const children = ['playersInfo', 'players', 'actions', 'events', 'build', 'mobs', 'state', 'world', 'chat', 'meta'];
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
    // v:2 includes stable nid/iid/cid (+ optional node hp) for coop round-trip (PR2).
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
/** Acceptance helper PR2: ids present after snapshot (call from console). */
function onlineStableIdReport(snap) {
  const s = snap || (typeof snapshotScene === 'function' ? snapshotScene() : null);
  if (!s) return null;
  return {
    nodes: (s.nodes || []).map(function (n) { return n.nid || null; }),
    items: (s.items || []).map(function (i) { return i.iid || null; }),
    containers: (s.containers || []).map(function (c) { return c.cid || null; })
  };
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
    if (onlineIsGuestCombat()) {
      // PR5b: guest never local-spawns; clear any level AI and hydrate puppets.
      ONLINE.pendingWave = 0;
      const wv = Number(ONLINE.state && ONLINE.state.w);
      if (isFinite(wv) && wv > 0) ONLINE.spawnedWave = Math.max(ONLINE.spawnedWave || 0, wv);
      try { onlineOnBecameGuestCombat(); } catch (e) {}
      if (ONLINE.mobsCache) {
        try { onlineApplyMobsToPuppets(ONLINE.mobsCache); } catch (e) {}
      }
    } else if (ONLINE.pendingWave) {
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
      try { await onlineAdoptMobsFromRtdb(); } catch (e) {}
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
  // PR5a: host mirror de NPCs vivos → rooms/.../mobs @ 2 Hz (combat) / 0.5 Hz idle.
  if (ONLINE.isHost && ONLINE.meta && ONLINE.meta.status === 'playing') {
    try { onlinePublishMobs(now); } catch (e) {}
  }
  // PR5b: guest puppets lerp.
  if (onlineIsGuestCombat()) {
    try { onlineUpdatePuppets(delta); } catch (e) {}
  }
  // PR6: clear stale pending loot intents (host reject / lost event).
  if (ONLINE.pendingLoot) {
    for (const iid in ONLINE.pendingLoot) {
      if (now - Number(ONLINE.pendingLoot[iid] || 0) > 3000) delete ONLINE.pendingLoot[iid];
    }
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
