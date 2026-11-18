// js/17-net.js (part 17). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// FASE 0: presencia + avatares remotos interpolados + chat de sector, con tráfico medido.
// - Pose adaptativa: 3 Hz sector / 4 Hz sala ≤3 / 2 Hz sala 4–5; 0.2 Hz quieto; 0 oculto.
// - Payload compacto: array de enteros + metadatos (nombre/color) en un nodo aparte.
// - Sin escritura de presencia duplicada en cada pose.
// - Contadores netStats (pose + actions/mobs/hurt/rollbacks) + panel F3.
// Sin sesión no hace nada.

// Cambiá a tu instancia regional cuando exista, ej:
// window.LAGRIETA_DB_URL = 'https://jugandoenlagrieta-saouth.firebaseio.com';

var NET_SECTOR = 64;

var NET_CONFIG = {
  mode: 'auto',                 // auto | full | eco | off
  poseHzMoving: 3,              // sector / sin sala; en sala usa ONLINE_CONFIG.poseHzRoom*
  poseHzIdle: 0.2,              // 1 pose cada 5 s quieto
  poseHzEco: 1.5,               // modo ahorro (NET_CONFIG.mode==='eco')
  poseHzHidden: 0,              // pestaña oculta: no publicar
  poseHeartbeatMs: 5000,        // repetir pose aunque no cambie
  interestRadius: 48,           // sólo animar remotos dentro de este radio
  remoteHideMs: 12000,          // ocultar avatares sin pose (idle = 5s, margen amplio)
  sectorSize: NET_SECTOR,
  sectorRadius: 1,              // 1 = 3x3 sectores
  maxPlayers: 5,
  chatMaxChars: 140,
  chatCooldownMs: 2000,
  chatHistory: 25,
  // La presencia/chat por sectores es legado: el multijugador ahora vive en
  // salas. Apagado por defecto para no generar tráfico ni superficie de abuso.
  sectorPresence: false,
  debug: false
};
// Override opcional para pruebas o para inyectar Remote Config antes de cargar este script.
try { if (window.LAGRIETA_NET_CONFIG) Object.assign(NET_CONFIG, window.LAGRIETA_NET_CONFIG); } catch (e) {}

var netOn = false;
var netUid = null;
var netName = 'Jugador';
var netColor = '#33ff66';
var netAcc = 0;
var netLastSent = 0;
var netLastPayload = '';
var netSector = null;
var netLevel = null;   // escena/nivel actual: la red se aísla por nivel
var netPlayerRef = null;
var netPlayerMetaRef = null;
var netSubs = {}; // sector -> { playersRef, metaRef, ... }
var netRoomId = null;       // Fase 1: si hay sala, la pose va a rooms/{id}/players
var netRoomSubs = null;     // suscripción única a players/playersInfo de la sala
var netRoomSubscribedFor = null;
var netMeta = {}; // uid -> { n, c }
var netChatSector = null;
var netChatRef = null;
var netChatLastSend = 0;
var netPoseSeq = 0;
var remotes = {}; // uid -> {mesh, tag, tx,ty,tz, yaw, last, name, color, sector, state}
var remoteColliders = []; // meshes used by Character.resolveCollisions (PR3 P–P)
var netCapsuleGeo = null;
var NET_REMOTE_COLLIDER_R = 0.4; // ≈ design soft cylinder radius
var netChatOpen = false;
var netGhostsVisible = true;
try { netGhostsVisible = localStorage.getItem('lagrieta_ghosts') !== '0'; } catch (e) {}
var netError = '';

var netStats = {
  sessionStart: Date.now(),
  posesOut: 0,
  snapshotsIn: 0,
  eventsOut: 0,
  eventsIn: 0,
  bytesOut: 0,
  bytesIn: 0,
  outRate: 0,
  inRate: 0,
  lastOut: 0,
  lastIn: 0,
  lastSample: 0,
  // PR9 telemetry
  actionsOut: 0,
  actionsRejected: 0,
  buildRollbacks: 0,
  mobsBytes: 0,
  hurtEvents: 0,
  rttEstimate: 0
};

function netApplyConfig(overrides) {
  try { if (overrides && typeof overrides === 'object') Object.assign(NET_CONFIG, overrides); } catch (e) {}
}
function netDb() {
  try {
    if (window.LAGRIETA_DB_URL) return firebase.app().database(window.LAGRIETA_DB_URL);
    return firebase.database();
  } catch (e) { return null; }
}
// Raíz de la red para la escena actual. Los jugadores sólo comparten presencia/chat
// con quienes están en el MISMO nivel (evita que mundos distintos se pisen).
function netBase() {
  return netLevel ? ('levels/' + netLevel) : 'global';
}
// Llamado por loadLevel/teardown. Si cambia de escena, se desuscribe y limpia avatares.
function netSetLevel(id) {
  const next = id || null;
  if (next === netLevel) return;
  netLevel = next;
  netLastPayload = '';
  netLastSent = 0;
  netAcc = 0;
  netPoseSeq = 0;
  // En una sala la pose se publica en rooms/{id}; no hay que desarmar la sala
  // cada vez que el nivel cambia (los clientes cargan el mismo levelId).
  if (netRoomId) return;
  netSector = null;
  netRemovePlayerNodes();
  for (const k in netSubs) netUnsub(k);
  Object.keys(remotes).forEach(netRemoveAvatar);
  netMeta = {};
  netChatOff();
  netEnsureChat(null); // recolocar panel de chat
}
// Entrar/salir de una sala de Fase 1. La pose deja de usar sectores.
function netSetRoom(roomId) {
  const next = roomId || null;
  if (next === netRoomId) return;
  netRoomId = next;
  netSector = null;
  netLastPayload = '';
  netLastSent = 0;
  netAcc = 0;
  netPoseSeq = 0;
  netRemovePlayerNodes();
  for (const k in netSubs) netUnsub(k);
  netRoomOff();
  Object.keys(remotes).forEach(netRemoveAvatar);
  netMeta = {};
  netChatOff();
  if (netRoomId) {
    netRoomSubscribe();
    netEnsureChat('room');
  } else {
    netEnsureChat(null);
  }
}
function netRoomOff() {
  const s = netRoomSubs;
  netRoomSubs = null;
  netRoomSubscribedFor = null;
  if (!s) return;
  try { s.playersRef.off('child_added', s.onAdd); } catch (e) {}
  try { s.playersRef.off('child_changed', s.onChg); } catch (e) {}
  try { s.playersRef.off('child_removed', s.onRem); } catch (e) {}
  try { s.infoRef.off('child_added', s.onInfoAdd); } catch (e) {}
  try { s.infoRef.off('child_changed', s.onInfoChg); } catch (e) {}
  try { s.infoRef.off('child_removed', s.onInfoRem); } catch (e) {}
}
function netRoomSubscribe() {
  if (!netRoomId || netRoomSubs || netRoomSubscribedFor === netRoomId) return;
  const db = netDb();
  if (!db) return;
  const room = netRoomId;
  const playersRef = db.ref('rooms/' + room + '/players');
  const infoRef = db.ref('rooms/' + room + '/playersInfo');
  const onErr = (err) => { try { netError = (err && err.code) || 'error-sala'; } catch (e) {} };
  const onAdd = (snap) => {
    try { netError = ''; } catch (e) {}
    if (snap.key === netUid) return;
    const d = snap.val();
    netTrackIn(d, 'pose');
    netAvatar(snap.key, d, 'room');
  };
  const onChg = onAdd;
  const onRem = (snap) => netRemoveAvatar(snap.key);
  const onInfoAdd = (snap) => {
    if (snap.key === netUid) return;
    const d = snap.val();
    netTrackIn(d, 'meta');
    if (d) netApplyMeta(snap.key, d);
  };
  const onInfoChg = onInfoAdd;
  const onInfoRem = (snap) => { delete netMeta[snap.key]; };
  try {
    playersRef.on('child_added', onAdd, onErr);
    playersRef.on('child_changed', onChg, onErr);
    playersRef.on('child_removed', onRem, onErr);
    infoRef.on('child_added', onInfoAdd, onErr);
    infoRef.on('child_changed', onInfoChg, onErr);
    infoRef.on('child_removed', onInfoRem, onErr);
    netRoomSubs = { playersRef, infoRef, onAdd, onChg, onRem, onInfoAdd, onInfoChg, onInfoRem };
    netRoomSubscribedFor = room;
  } catch (e) {}
}
function netRoomEnsureRefs() {
  if (!netRoomId || !netUid) return;
  netRoomSubscribe();
  if (netPlayerRef) return;
  const db = netDb();
  if (!db) return;
  netPlayerRef = db.ref('rooms/' + netRoomId + '/players/' + netUid);
  try { netPlayerRef.onDisconnect().remove(); } catch (e) {}
}
function netRemovePlayerNodes() {
  try { if (netPlayerRef) { try { netPlayerRef.onDisconnect().cancel(); } catch (e) {} try { netPlayerRef.remove(); } catch (e) {} } } catch (e) {}
  try { if (netPlayerMetaRef) { try { netPlayerMetaRef.onDisconnect().cancel(); } catch (e) {} try { netPlayerMetaRef.remove(); } catch (e) {} } } catch (e) {}
  netPlayerRef = null;
  netPlayerMetaRef = null;
}
function netSectorOf(x, z) {
  const s = NET_CONFIG.sectorSize || NET_SECTOR;
  return Math.floor(x / s) + '_' + Math.floor(z / s);
}
function netColorFor(uid) {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) % 360;
  return 'hsl(' + h + ',90%,60%)';
}
function netBytes(obj) {
  try { return JSON.stringify(obj).length + 32; } catch (e) { return 64; }
}
function netStatsReset() {
  netStats.sessionStart = Date.now();
  netStats.posesOut = 0;
  netStats.snapshotsIn = 0;
  netStats.eventsOut = 0;
  netStats.eventsIn = 0;
  netStats.bytesOut = 0;
  netStats.bytesIn = 0;
  netStats.outRate = 0;
  netStats.inRate = 0;
  netStats.lastOut = 0;
  netStats.lastIn = 0;
  netStats.lastSample = 0;
  netStats.actionsOut = 0;
  netStats.actionsRejected = 0;
  netStats.buildRollbacks = 0;
  netStats.mobsBytes = 0;
  netStats.hurtEvents = 0;
  netStats.rttEstimate = 0;
}
function netTrackOut(obj, kind) {
  netStats.bytesOut += netBytes(obj);
  if (kind === 'pose') netStats.posesOut++;
  else netStats.eventsOut++;
}
function netTrackIn(obj, kind) {
  netStats.bytesIn += netBytes(obj);
  if (kind === 'pose') netStats.snapshotsIn++;
  else netStats.eventsIn++;
}
function netIsMoving() {
  try {
    const v = player && player.velocity;
    if (!v) return true;
    return Math.sqrt(v.x * v.x + v.z * v.z) > 0.6;
  } catch (e) { return true; }
}
function netPoseState() {
  // Compact poseId → int for array poses (backward compatible 0–3; 4+ = crouch family).
  // 0 idle · 1 walk · 2 sprint · 3 jump/fall · 4 crouch · 5 crouch_walk
  try {
    if (player && typeof player.getPoseId === 'function') {
      const id = player.getPoseId();
      if (id === 'crouch_walk') return 5;
      if (id === 'crouch') return 4;
      if (id === 'jump' || id === 'fall') return 3;
      if (id === 'sprint') return 2;
      if (id === 'walk') return 1;
      return 0;
    }
    if (player && player.isOnGround === false) return 3;
    if (netIsMoving()) return (player && player.isSprinting) ? 2 : 1;
  } catch (e) {}
  return 0;
}
function netPoseHz() {
  if (NET_CONFIG.mode === 'off') return 0;
  if (typeof document !== 'undefined' && document.hidden) return NET_CONFIG.poseHzHidden || 0;
  if (NET_CONFIG.mode === 'eco') return netIsMoving() ? NET_CONFIG.poseHzEco : NET_CONFIG.poseHzIdle;
  // Sala coop: 4 Hz si ≤3 jugadores; 2 Hz si 4–5 (ONLINE_CONFIG).
  if (netRoomId && typeof onlineEffectivePoseMovingHz === 'function') {
    const roomHz = onlineEffectivePoseMovingHz();
    if (roomHz != null && isFinite(roomHz)) {
      return netIsMoving() ? roomHz : (NET_CONFIG.poseHzIdle || 0.2);
    }
  }
  return netIsMoving() ? NET_CONFIG.poseHzMoving : NET_CONFIG.poseHzIdle;
}
function wireNetAuth() {
  if (netOn) return;
  if (!window.firebase || !firebase.auth || !firebase.database) { setTimeout(wireNetAuth, 500); return; }
  try {
    firebase.auth().onAuthStateChanged((user) => {
      if (user) netStart(user);
      else netStop();
    });
  } catch (e) { setTimeout(wireNetAuth, 1000); }
}
function netStart(user) {
  try {
    // Idempotente: un refresh de token no debe desarmar la sala ni la presencia.
    if (netOn && netUid === user.uid) return;
    if (netOn) netStop();
    netUid = user.uid;
    netName = String(user.displayName || (user.email ? user.email.split('@')[0] : null) || 'Jugador').slice(0, 16);
    netColor = netColorFor(netUid);
    netOn = true;
    netSector = null;
    netMeta = {};
    netPoseSeq = 0;
    netStatsReset();
    // Sincronizar la escena activa para publicar en la red correcta
    try { if (typeof LEVEL !== 'undefined' && LEVEL.current) netLevel = LEVEL.current; } catch (e) {}
    const db = netDb();
    if (!db) return;
    // La presencia global no la lee nadie: no escribimos presence/{uid}.
    // La presencia real vive en levels/{nivel}/sectors/... y rooms/{id}/playersInfo.
    console.log('Net: sesión como ' + netName);
  } catch (e) { console.error(e); }
}
function netStop() {
  try {
    netRemovePlayerNodes();
    for (const k in netSubs) netUnsub(k);
    netRoomOff();
    netChatOff();
    Object.keys(remotes).forEach(netRemoveAvatar);
  } catch (e) {}
  netOn = false; netUid = null; netSector = null; netLevel = null;
  netRoomId = null;
  netMeta = {};
  netPoseSeq = 0;
}
function netUnsub(k) {
  const s = netSubs[k];
  if (!s) return;
  try { s.playersRef.off('child_added', s.onAdd); } catch (e) {}
  try { s.playersRef.off('child_changed', s.onChg); } catch (e) {}
  try { s.playersRef.off('child_removed', s.onRem); } catch (e) {}
  try { s.metaRef.off('child_added', s.onMetaAdd); } catch (e) {}
  try { s.metaRef.off('child_changed', s.onMetaChg); } catch (e) {}
  try { s.metaRef.off('child_removed', s.onMetaRem); } catch (e) {}
  // Limpiar avatares que pertenecían a este sector.
  try {
    const doomed = [];
    for (const uid in remotes) {
      if (remotes[uid] && remotes[uid].sector === k) doomed.push(uid);
    }
    for (let i = 0; i < doomed.length; i++) netRemoveAvatar(doomed[i]);
  } catch (e) {}
  delete netSubs[k];
}
function netEnsureSectors(cx, cz) {
  if (!NET_CONFIG.sectorPresence) return;
  const radius = Math.max(0, NET_CONFIG.sectorRadius || 0);
  const need = {};
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      need[(cx + dx) + '_' + (cz + dz)] = 1;
    }
  }
  for (const k in netSubs) if (!need[k]) netUnsub(k);
  const db = netDb();
  if (!db) return;
  for (const k in need) {
    if (netSubs[k]) continue;
    const playersRef = db.ref(netBase() + '/sectors/' + k + '/players');
    const metaRef = db.ref(netBase() + '/sectors/' + k + '/playersMeta');
    const onErr = (err) => { try { netError = (err && err.code) || 'error-red'; } catch (e) {} };
    const onAdd = (snap) => {
      try { netError = ''; } catch (e) {}
      if (snap.key === netUid) return;
      const d = snap.val();
      netTrackIn(d, 'pose');
      netAvatar(snap.key, d, k);
    };
    const onChg = (snap) => {
      try { netError = ''; } catch (e) {}
      if (snap.key === netUid) return;
      const d = snap.val();
      netTrackIn(d, 'pose');
      netAvatar(snap.key, d, k);
    };
    const onRem = (snap) => netRemoveAvatar(snap.key);
    const onMetaAdd = (snap) => {
      if (snap.key === netUid) return;
      const d = snap.val();
      netTrackIn(d, 'meta');
      netApplyMeta(snap.key, d);
    };
    const onMetaChg = (snap) => {
      if (snap.key === netUid) return;
      const d = snap.val();
      netTrackIn(d, 'meta');
      netApplyMeta(snap.key, d);
    };
    const onMetaRem = (snap) => { delete netMeta[snap.key]; };
    try {
      playersRef.on('child_added', onAdd, onErr);
      playersRef.on('child_changed', onChg, onErr);
      playersRef.on('child_removed', onRem, onErr);
      metaRef.on('child_added', onMetaAdd, onErr);
      metaRef.on('child_changed', onMetaChg, onErr);
      metaRef.on('child_removed', onMetaRem, onErr);
      netSubs[k] = { playersRef, metaRef, onAdd, onChg, onRem, onMetaAdd, onMetaChg, onMetaRem };
    } catch (e) {}
  }
}
function netUnpackPose(d) {
  if (!d) return null;
  if (Array.isArray(d)) {
    const x = Number(d[1]);
    const y = Number(d[2]);
    const z = Number(d[3]);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
    return {
      seq: Number(d[0]) || 0,
      x: x / 10, y: y / 10, z: z / 10,
      yaw: ((Number(d[4]) || 0) / 16) * Math.PI * 2,
      state: Number(d[5]) || 0,
      hp: isFinite(Number(d[6])) ? Number(d[6]) : 100,
      n: null, c: null
    };
  }
  if (typeof d.x !== 'number' || typeof d.z !== 'number') return null;
  return {
    seq: Number(d.seq) || 0,
    x: d.x, y: d.y || 0, z: d.z,
    yaw: Number(d.yaw) || 0,
    state: Number(d.st) || 0,
    hp: (typeof d.hp === 'number') ? d.hp : 100,
    n: d.n || null,
    c: d.c || null
  };
}
function netApplyMeta(uid, meta) {
  if (!meta) return;
  const n = String(meta.n || 'Jugador').slice(0, 16);
  const c = meta.c || netColorFor(uid);
  netMeta[uid] = { n: n, c: c };
  const r = remotes[uid];
  if (!r) return;
  if (r.name !== n || r.color !== c) {
    r.name = n;
    r.color = c;
    try { r.mesh.material.color.set(c); } catch (e) {}
    netRetag(r, n, c);
  }
}
function netAvatar(uid, d, sector) {
  // ONLINE_BODY_PLACEHOLDER — Fase F freeze.
  // Remotes stay CapsuleGeometry. Do NOT mount createBody here until a dedicated online-body
  // plan replaces this block AND sets PLAYER_CONFIG.onlineBody = true.
  // Checklist when that lands:
  //   1) createBody({ mode:'npc', mountOnCharacter:true }) parented under remote root
  //   2) each tick: body.update(dt, flags from r.poseId / crouch ints; optional hasGun)
  //   3) optional tool/holster in payload — bump net schema only with compat notes
  //   4) keep netPoseState ints 0–5 backward-compatible (idle/walk/sprint/fall/crouch/crouch_walk)
  // See BODY_DEF.portNotes.deferred.onlineBody.
  if (typeof PLAYER_CONFIG !== 'undefined' && PLAYER_CONFIG.onlineBody && !netAvatar._onlineBodyWarned) {
    netAvatar._onlineBodyWarned = true;
    try {
      console.warn('[netAvatar] PLAYER_CONFIG.onlineBody=true but ONLINE_BODY_PLACEHOLDER is still active — remotes stay capsules.');
    } catch (e) {}
  }
  const pose = netUnpackPose(d);
  if (!pose || typeof player === 'undefined') return null;
  // Compatibilidad con clientes viejos que mandaban n/c dentro del payload.
  if (pose.n || pose.c) {
    const prev = netMeta[uid] || {};
    netMeta[uid] = { n: pose.n || prev.n || 'Jugador', c: pose.c || prev.c || netColorFor(uid) };
  }
  const meta = netMeta[uid] || { n: 'Jugador', c: netColorFor(uid) };
  let r = remotes[uid];
  if (!r) {
    if (!netCapsuleGeo) { try { netCapsuleGeo = new THREE.CapsuleGeometry(0.35, 1.0, 4, 8); } catch (e) { return null; } }
    const mat = new THREE.MeshStandardMaterial({ color: meta.c || '#33ff66', roughness: 0.6, transparent: true, opacity: 0.92 });
    const mesh = new THREE.Mesh(netCapsuleGeo, mat);
    // Keep default raycast so host hitscan/FF can hit remotes (PR5b).
    mesh.userData = mesh.userData || {};
    mesh.userData.solid = true;
    mesh.userData.isRemotePlayer = true;
    mesh.userData.remoteUid = uid;
    const tag = netNameTag(meta.n, meta.c);
    try { scene.add(mesh); scene.add(tag); } catch (e) { return null; }
    r = remotes[uid] = {
      mesh, tag, tx: pose.x, ty: pose.y, tz: pose.z, yaw: pose.yaw,
      hp: (typeof pose.hp === 'number') ? pose.hp : 100,
      last: 0, name: meta.n, color: meta.c, sector: sector || null, seq: 0, state: 0
    };
    if (remoteColliders.indexOf(mesh) === -1) remoteColliders.push(mesh);
  }
  r.tx = pose.x;
  r.ty = pose.y;
  r.tz = pose.z;
  r.yaw = pose.yaw;
  r.state = pose.state || 0;
  // poseId hint for future remote bodies (0 idle … 5 crouch_walk)
  r.poseId = ({ 0: 'idle', 1: 'walk', 2: 'sprint', 3: 'fall', 4: 'crouch', 5: 'crouch_walk' })[r.state] || 'idle';
  r.hp = (typeof pose.hp === 'number') ? pose.hp : r.hp;
  r.last = Date.now();
  r.seq = pose.seq;
  r.state = pose.state;
  if (sector) r.sector = sector;
  if (r.name !== meta.n || r.color !== meta.c) {
    r.name = meta.n;
    r.color = meta.c;
    try { r.mesh.material.color.set(meta.c); } catch (e) {}
    netRetag(r, meta.n, meta.c);
  }
  // Caído = casi transparente (feedback barato sin lógica de combate)
  try { r.mesh.material.opacity = (pose.hp <= 0) ? 0.3 : 0.92; } catch (e) {}
  r.mesh.visible = true;
  r.tag.visible = true;
  return r;
}
function netNameTag(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 8, 256, 48);
  g.strokeStyle = color || '#33ff66';
  g.lineWidth = 3;
  g.strokeRect(2, 10, 252, 44);
  g.fillStyle = '#fff';
  g.font = 'bold 26px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(name).slice(0, 16), 128, 33);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.4, 0.6, 1);
  sp.raycast = function () {};
  return sp;
}
function netRetag(r, name, color) {
  try {
    const fresh = netNameTag(name, color);
    fresh.position.copy(r.tag.position);
    fresh.visible = r.tag.visible;
    scene.remove(r.tag);
    try {
      if (r.tag.material) {
        if (r.tag.material.map) r.tag.material.map.dispose();
        r.tag.material.dispose();
      }
    } catch (e) {}
    scene.add(fresh);
    r.tag = fresh;
  } catch (e) {}
}
function netRemoveAvatar(uid) {
  const r = remotes[uid];
  if (!r) return;
  try {
    const i = remoteColliders.indexOf(r.mesh);
    if (i > -1) remoteColliders.splice(i, 1);
  } catch (e) {}
  try { scene.remove(r.mesh); } catch (e) {}
  try { scene.remove(r.tag); } catch (e) {}
  try { if (r.mesh && r.mesh.material) r.mesh.material.dispose(); } catch (e) {}
  try {
    if (r.tag && r.tag.material) {
      if (r.tag.material.map) r.tag.material.map.dispose();
      r.tag.material.dispose();
    }
  } catch (e) {}
  delete remotes[uid];
}
function netNeighborCount() {
  try { return Object.keys(remotes).length; } catch (e) { return 0; }
}
// --- Loop: publicar (pose adaptativa) + interpolar + sectores ---
function netUpdate(delta) {
  if (!netOn || !netUid) return;
  if (typeof player === 'undefined' || !player || !player.container) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  // Sin tráfico mientras el juego está pausado o hay un menú abierto.
  if (typeof isGamePaused !== 'undefined' && isGamePaused) return;
  if (typeof LEVEL !== 'undefined' && LEVEL && LEVEL.menuOpen) return;

  // Interpolar remotos siempre (sólo los que están dentro del radio de interés).
  try {
    const now = Date.now();
    const k = Math.min(1, (delta || 0.016) * 10);
    const px = player.container.position.x;
    const pz = player.container.position.z;
    const maxDist = NET_CONFIG.interestRadius || 48;
    const maxDist2 = maxDist * maxDist;
    for (const uid in remotes) {
      const r = remotes[uid];
      if (!r) continue;
      if (typeof netGhostsVisible !== 'undefined' && !netGhostsVisible) {
        r.mesh.visible = false;
        r.tag.visible = false;
        continue;
      }
      if (now - r.last > (NET_CONFIG.remoteHideMs || 12000)) {
        r.mesh.visible = false;
        r.tag.visible = false;
        continue;
      }
      const dx = r.tx - px;
      const dz = r.tz - pz;
      if (dx * dx + dz * dz > maxDist2) {
        r.mesh.visible = false;
        r.tag.visible = false;
        continue;
      }
      r.mesh.visible = true;
      r.tag.visible = true;
      r.mesh.position.x += (r.tx - r.mesh.position.x) * k;
      r.mesh.position.z += (r.tz - r.mesh.position.z) * k;
      r.mesh.position.y += ((r.ty + 0.9) - r.mesh.position.y) * k;
      r.mesh.rotation.y = r.yaw;
      r.tag.position.set(r.mesh.position.x, r.mesh.position.y + 1.5, r.mesh.position.z);
    }
  } catch (e) {}

  if (!netLevel && !netRoomId) return;
  // Fuera de una sala no publicamos poses por sectores (legado apagado).
  if (!netRoomId && !NET_CONFIG.sectorPresence) return;

  // Publicar propio con tasa adaptativa.
  const hz = netPoseHz();
  if (hz <= 0) return;
  netAcc += (delta || 0.016);
  if (netAcc < (1 / hz)) return;
  netAcc = 0;

  try {
    const p = player.container.position;
    if (netRoomId) {
      netRoomEnsureRefs();
    } else if (NET_CONFIG.sectorPresence) {
      const sector = netSectorOf(p.x, p.z);
      if (sector !== netSector) {
        const db = netDb();
        netRemovePlayerNodes();
        if (db) {
          netPlayerRef = db.ref(netBase() + '/sectors/' + sector + '/players/' + netUid);
          netPlayerMetaRef = db.ref(netBase() + '/sectors/' + sector + '/playersMeta/' + netUid);
          try { netPlayerRef.onDisconnect().remove(); } catch (e) {}
          try { netPlayerMetaRef.onDisconnect().remove(); } catch (e) {}
          try { netPlayerMetaRef.set({ n: netName, c: netColor }); } catch (e) {}
        }
        netSector = sector;
        const s = NET_CONFIG.sectorSize || NET_SECTOR;
        const cx = Math.floor(p.x / s);
        const cz = Math.floor(p.z / s);
        netEnsureSectors(cx, cz);
        netEnsureChat(sector);
        netLastPayload = '';
        netLastSent = 0;
      }
    }

    const yaw = ((player.container.rotation.y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const body = [
      Math.round(p.x * 10),
      Math.round(p.y * 10),
      Math.round(p.z * 10),
      Math.round((yaw / (Math.PI * 2)) * 16) % 16,
      netPoseState(),
      Math.max(0, Math.round(player.health || 0))
    ];
    const payload = JSON.stringify(body);
    const nowMs = Date.now();
    if ((payload !== netLastPayload || nowMs - netLastSent > NET_CONFIG.poseHeartbeatMs) && netPlayerRef) {
      netPoseSeq++;
      const full = [netPoseSeq].concat(body);
      netPlayerRef.set(full);
      netTrackOut(full, 'pose');
      netLastPayload = payload;
      netLastSent = nowMs;
    }
  } catch (e) {}
}
// --- Chat de sector (liviano: últimos 25, 140 caracteres) ---
function netEnsureChat(sector) {
  if (netChatSector === sector) return;
  netChatOff();
  netChatSector = sector;
  renderNetChat();
  const box = document.getElementById('netChatLog');
  if (box) box.innerHTML = '';
  if (!sector) return; // sin escena: solo dejamos el panel listo
  if (sector !== 'room' && !NET_CONFIG.sectorPresence) { netChatSector = null; return; }
  const db = netDb();
  if (!db) return;
  try {
    const chatPath = netRoomId
      ? ('rooms/' + netRoomId + '/chat')
      : (netBase() + '/sectors/' + sector + '/chat');
    netChatRef = db.ref(chatPath).limitToLast(NET_CONFIG.chatHistory || 25);
    netChatRef.on('child_added', (snap) => {
      const d = snap.val();
      if (!d || typeof d.m !== 'string') return;
      netTrackIn(d, 'event');
      netChatLine(d.n || '?', d.m, d.u === netUid);
    });
  } catch (e) { netChatRef = null; }
}
function netChatOff() {
  try { if (netChatRef) netChatRef.off('child_added'); } catch (e) {}
  netChatRef = null;
  netChatSector = null;
}
function renderNetChat() {
  let panel = document.getElementById('netChat');
  if (panel) return;
  panel = document.createElement('div');
  panel.id = 'netChat';
  panel.style.display = 'none';
  panel.innerHTML = '<div id="netChatLog"></div>' +
      '<div id="netChatEmotes"></div>' +
      '<input id="netChatInput" maxlength="140" placeholder="T: hablar · Enter: enviar" autocomplete="off">';
  document.body.appendChild(panel);
  const emotes = document.getElementById('netChatEmotes');
  [['👋', 'saluda'], ['❤️', 'manda cariño'], ['⚠️', 'avisa peligro'], ['🤝', 'quiere cooperar'], ['🆘', 'pide ayuda']]
    .forEach(function (e) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rg-emote';
      b.textContent = e[0];
      b.title = e[1];
      b.addEventListener('click', function () { netEmote(e[0]); });
      emotes.appendChild(b);
    });
  const input = document.getElementById('netChatInput');
  input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') netChatSend();
  });
}
// Emote rápido: mensaje corto sin gastar teclado. Barato para el servidor.
function netEmote(text) {
  if (!netOn || !netChatSector) return;
  if (!netRoomId && !NET_CONFIG.sectorPresence) return;
  const now = Date.now();
  if (now - netChatLastSend < 700) return;
  netChatLastSend = now;
  const db = netDb();
  if (!db) return;
  try {
    const msg = { u: netUid, n: netName, m: text, t: firebase.database.ServerValue.TIMESTAMP };
    netTrackOut(msg, 'event');
    db.ref(netRoomId ? ('rooms/' + netRoomId + '/chat') : (netBase() + '/sectors/' + netChatSector + '/chat')).push(msg);
  } catch (e) {}
}
function netChatLine(name, msg, mine) {
  const box = document.getElementById('netChatLog');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'rg-chatline' + (mine ? ' mine' : '');
  div.innerHTML = '<b></b><span></span>';
  div.querySelector('b').textContent = String(name).slice(0, 16) + ': ';
  div.querySelector('span').textContent = String(msg).slice(0, NET_CONFIG.chatMaxChars || 140);
  box.appendChild(div);
  while (box.children.length > 30) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}
function toggleNetChat(force) {
  renderNetChat();
  const panel = document.getElementById('netChat');
  if (!panel) return;
  const show = (typeof force === 'boolean') ? force : (panel.style.display === 'none');
  panel.style.display = show ? 'block' : 'none';
  netChatOpen = show;
  if (show) {
      const input = document.getElementById('netChatInput');
      if (input) setTimeout(() => { try { input.focus(); } catch (e) {} }, 50);
  }
}
function netChatSend() {
  if (!netOn || !netChatSector) return;
  if (!netRoomId && !NET_CONFIG.sectorPresence) return;
  const input = document.getElementById('netChatInput');
  if (!input) return;
  const text = (input.value || '').trim().slice(0, NET_CONFIG.chatMaxChars || 140);
  if (!text) return;
  const now = Date.now();
  if (now - netChatLastSend < NET_CONFIG.chatCooldownMs) return;
  netChatLastSend = now;
  input.value = '';
  const db = netDb();
  if (!db) return;
  try {
    const msg = { u: netUid, n: netName, m: text, t: firebase.database.ServerValue.TIMESTAMP };
    netTrackOut(msg, 'event');
    db.ref(netRoomId ? ('rooms/' + netRoomId + '/chat') : (netBase() + '/sectors/' + netChatSector + '/chat')).push(msg);
  } catch (e) {}
}

// --- Panel de debug (F3) ---
var netDebugEl = null;
var netDebugVisible = false;
function netToggleDebug(force) {
  netDebugEnsure();
  const show = (typeof force === 'boolean') ? force : !netDebugVisible;
  netDebugVisible = show;
  if (netDebugEl) netDebugEl.style.display = show ? 'block' : 'none';
  if (show) netDebugRender();
}
function netDebugEnsure() {
  if (netDebugEl || typeof document === 'undefined' || !document.body) return;
  netDebugEl = document.createElement('div');
  netDebugEl.id = 'netDebug';
  netDebugEl.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;background:rgba(0,0,0,.78);' +
      'color:#9f9;font:12px/1.45 monospace;padding:8px 10px;border:1px solid #3f6;border-radius:6px;' +
      'pointer-events:none;display:none;white-space:pre;max-width:320px;';
  document.body.appendChild(netDebugEl);
}
function netDebugRender() {
  if (!netDebugVisible) return;
  netDebugEnsure();
  if (!netDebugEl) return;
  try {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const dt = (now - (netStats.lastSample || now)) / 1000;
    if (dt > 0.2) {
      netStats.outRate = (netStats.bytesOut - (netStats.lastOut || 0)) / dt;
      netStats.inRate = (netStats.bytesIn - (netStats.lastIn || 0)) / dt;
      netStats.lastOut = netStats.bytesOut;
      netStats.lastIn = netStats.bytesIn;
      netStats.lastSample = now;
    }
    const secs = Math.max(0, (Date.now() - netStats.sessionStart) / 1000);
    const mm = Math.floor(secs / 60);
    const ss = Math.floor(secs % 60);
    let roomLine = '';
    try {
      if (typeof onlineIsActive === 'function' && onlineIsActive()) {
        const pc = (typeof onlinePlayerCount === 'function') ? onlinePlayerCount() : '?';
        const flags = (typeof onlineFlagsSummary === 'function') ? onlineFlagsSummary() : '';
        roomLine = 'sala: ' + (typeof ONLINE !== 'undefined' && ONLINE.code ? ONLINE.code : '?') +
          ' · p' + pc + (flags ? '\n' + flags : '') + '\n';
      }
    } catch (e2) {}
    const rtt = Math.round(Number(netStats.rttEstimate) || 0);
    netDebugEl.textContent =
      'NET ' + (netOn ? 'ON' : 'OFF') + ' · ' + (NET_CONFIG.mode || 'auto') + '\n' +
      'nivel: ' + (netLevel || '-') + ' · sector: ' + (netSector || '-') + '\n' +
      roomLine +
      'vecinos: ' + netNeighborCount() + ' · pose: ' + netPoseHz().toFixed(2) + ' Hz\n' +
      '↑ ' + Math.round(netStats.outRate) + ' B/s · poses ' + netStats.posesOut + '\n' +
      '↓ ' + Math.round(netStats.inRate) + ' B/s · snaps ' + netStats.snapshotsIn + '\n' +
      'act ↑' + (netStats.actionsOut || 0) + ' rej ' + (netStats.actionsRejected || 0) +
        ' rb ' + (netStats.buildRollbacks || 0) + '\n' +
      'mobs ' + Math.round((netStats.mobsBytes || 0) / 1024) + ' KB · hurt ' + (netStats.hurtEvents || 0) +
        ' · rtt~' + rtt + 'ms\n' +
      'total ↑' + (netStats.bytesOut / 1024).toFixed(1) + ' KB · ↓' + (netStats.bytesIn / 1024).toFixed(1) + ' KB\n' +
      'sesión: ' + mm + 'm ' + ss + 's' + (netError ? '\nerror: ' + netError : '');
  } catch (e) {}
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', function (e) {
    if (e.key === 'F3') {
      e.preventDefault();
      netToggleDebug();
    }
  });
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      netAcc = 1;
      netLastSent = 0;
      netLastPayload = '';
    }
  });
}
if (typeof setInterval !== 'undefined') setInterval(netDebugRender, 500);

wireNetAuth();
