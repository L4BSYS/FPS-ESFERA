// js/17-net.js (part 17). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// FASE 1 multijugador: presencia + avatares remotos interpolados + chat de sector.
// Liviano: se publica a 8Hz solo si algo cambió (si no, latido cada 2s) y
// cada cliente escucha únicamente su sector 3x3. Sin sesión no hace nada.

// Cambiá a tu instancia regional cuando exista, ej:
// window.LAGRIETA_DB_URL = 'https://jugandoenlagrieta-saouth.firebaseio.com';
var NET_SECTOR = 64;
var netOn = false;
var netUid = null;
var netName = 'Jugador';
var netColor = '#33ff66';
var netAcc = 0;
var netLastSent = 0;
var netLastPayload = '';
var netSector = null;
var netPlayerRef = null;
var netPresRef = null;
var netSubs = {}; // sector -> { playersRef, cbs }
var netChatSector = null;
var netChatRef = null;
var netChatLastSend = 0;
var remotes = {}; // uid -> {mesh, tag, tx,ty,tz, yaw, last, name}
var netCapsuleGeo = null;
var netChatOpen = false;
var netGhostsVisible = true;
try { netGhostsVisible = localStorage.getItem('lagrieta_ghosts') !== '0'; } catch (e) {}
var netError = '';

function netDb() {
  try {
    if (window.LAGRIETA_DB_URL) return firebase.app().database(window.LAGRIETA_DB_URL);
    return firebase.database();
  } catch (e) { return null; }
}
function netSectorOf(x, z) {
  return Math.floor(x / NET_SECTOR) + '_' + Math.floor(z / NET_SECTOR);
}
function netColorFor(uid) {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) % 360;
  return 'hsl(' + h + ',90%,60%)';
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
    netUid = user.uid;
    netName = user.displayName || (user.email ? user.email.split('@')[0] : null) || 'Jugador';
    netColor = netColorFor(netUid);
    netOn = true;
    netSector = null;
    const db = netDb();
    if (!db) return;
    netPresRef = db.ref('presence/' + netUid);
    try { netPresRef.onDisconnect().remove(); } catch (e) {}
    console.log('Net: sesión como ' + netName);
  } catch (e) { console.error(e); }
}
function netStop() {
  try {
    if (netPlayerRef) { try { netPlayerRef.onDisconnect().cancel(); } catch (e) {} try { netPlayerRef.remove(); } catch (e) {} }
    if (netPresRef) { try { netPresRef.onDisconnect().cancel(); } catch (e) {} try { netPresRef.remove(); } catch (e) {} }
    for (const k in netSubs) netUnsub(k);
    netChatOff();
    for (const uid in remotes) netRemoveAvatar(uid);
  } catch (e) {}
  netOn = false; netUid = null; netSector = null; netPlayerRef = null; netPresRef = null;
}
function netUnsub(k) {
  const s = netSubs[k];
  if (!s) return;
  try { s.playersRef.off('child_added', s.onAdd); } catch (e) {}
  try { s.playersRef.off('child_changed', s.onChg); } catch (e) {}
  try { s.playersRef.off('child_removed', s.onRem); } catch (e) {}
  delete netSubs[k];
}
function netEnsureSectors(cx, cz) {
  const need = {};
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) need[(cx + dx) + '_' + (cz + dz)] = 1;
  for (const k in netSubs) if (!need[k]) netUnsub(k);
  const db = netDb();
  if (!db) return;
  for (const k in need) {
    if (netSubs[k]) continue;
    const ref = db.ref('sectors/' + k + '/players');
    const onAdd = (snap) => { try { netError = ''; } catch (e) {} if (snap.key !== netUid) netAvatar(snap.key, snap.val()); };
    const onChg = (snap) => { try { netError = ''; } catch (e) {} if (snap.key !== netUid) netAvatar(snap.key, snap.val()); };
    const onRem = (snap) => netRemoveAvatar(snap.key);
    const onErr = (err) => { try { netError = (err && err.code) || 'error-red'; } catch (e) {} };
    try {
      ref.on('child_added', onAdd, onErr);
      ref.on('child_changed', onChg, onErr);
      ref.on('child_removed', onRem, onErr);
      netSubs[k] = { playersRef: ref, onAdd, onChg, onRem };
    } catch (e) {}
  }
}
function netAvatar(uid, d) {
  if (!d || typeof player === 'undefined') return null;
  let r = remotes[uid];
  if (!r) {
      if (!netCapsuleGeo) { try { netCapsuleGeo = new THREE.CapsuleGeometry(0.35, 1.0, 4, 8); } catch (e) { return null; } }
      const mat = new THREE.MeshStandardMaterial({ color: d.c || '#33ff66', roughness: 0.6, transparent: true, opacity: 0.92 });
      const mesh = new THREE.Mesh(netCapsuleGeo, mat);
      mesh.raycast = function () {};
      const tag = netNameTag(d.n || 'Jugador', d.c || '#33ff66');
      try { scene.add(mesh); scene.add(tag); } catch (e) { return null; }
      r = remotes[uid] = { mesh, tag, tx: 0, ty: 0, tz: 0, yaw: 0, last: 0, name: null };
  }
  if (typeof d.x === 'number') { r.tx = d.x; r.ty = d.y || 0; r.tz = d.z; }
  if (typeof d.yaw === 'number') r.yaw = d.yaw;
  r.last = Date.now();
  if (d.n && r.name !== d.n) { r.name = d.n; netRetag(r, d.n, d.c); }
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
      scene.add(fresh);
      r.tag = fresh;
  } catch (e) {}
}
function netRemoveAvatar(uid) {
  const r = remotes[uid];
  if (!r) return;
  try { scene.remove(r.mesh); } catch (e) {}
  try { scene.remove(r.tag); } catch (e) {}
  delete remotes[uid];
}
function netNeighborCount() {
  try { return Object.keys(remotes).length; } catch (e) { return 0; }
}
// --- Loop: publicar (8Hz si cambió, latido 2s) + interpolar + sectores ---
function netUpdate(delta) {
  if (!netOn || !netUid) return;
  if (typeof player === 'undefined' || !player || !player.container) return;
  // interpolar remotos siempre
  try {
      const now = Date.now();
      const k = Math.min(1, (delta || 0.016) * 10);
      for (const uid in remotes) {
          const r = remotes[uid];
          if (typeof netGhostsVisible !== 'undefined' && !netGhostsVisible) { r.mesh.visible = false; r.tag.visible = false; continue; }
          if (now - r.last > 6000) { r.mesh.visible = false; r.tag.visible = false; continue; }
          r.mesh.position.x += (r.tx - r.mesh.position.x) * k;
          r.mesh.position.z += (r.tz - r.mesh.position.z) * k;
          r.mesh.position.y += ((r.ty + 0.9) - r.mesh.position.y) * k;
          r.mesh.rotation.y = r.yaw;
          r.tag.position.set(r.mesh.position.x, r.mesh.position.y + 1.5, r.mesh.position.z);
      }
  } catch (e) {}
  // publicar propio (throttle)
  netAcc += (delta || 0.016);
  if (netAcc < 0.125) return;
  netAcc = 0;
  try {
      const p = player.container.position;
      const sector = netSectorOf(p.x, p.z);
      if (sector !== netSector) {
          const db = netDb();
          if (db) {
              if (netPlayerRef) { try { netPlayerRef.remove(); } catch (e) {} }
              netPlayerRef = db.ref('sectors/' + sector + '/players/' + netUid);
              try { netPlayerRef.onDisconnect().remove(); } catch (e) {}
          }
          netSector = sector;
          const cx = Math.floor(p.x / NET_SECTOR), cz = Math.floor(p.z / NET_SECTOR);
          netEnsureSectors(cx, cz);
          netEnsureChat(sector);
          if (netPresRef) { try { netPresRef.update({ s: sector }); } catch (e) {} }
          netLastPayload = '';
      }
      const payload = JSON.stringify([
          Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100,
          Math.round(player.container.rotation.y * 100) / 100,
          Math.max(0, Math.round(player.health || 0)),
          player.currentTool || 'hands'
      ]);
      const nowMs = Date.now();
      if ((payload !== netLastPayload || nowMs - netLastSent > 2000) && netPlayerRef) {
          netLastPayload = payload;
          netLastSent = nowMs;
          const a = JSON.parse(payload);
          netPlayerRef.set({
              x: a[0], y: a[1], z: a[2], yaw: a[3], hp: a[4], w: a[5],
              n: netName, c: netColor, t: firebase.database.ServerValue.TIMESTAMP
          });
          if (netPresRef) {
              try { netPresRef.set({ n: netName, c: netColor, s: netSector, t: firebase.database.ServerValue.TIMESTAMP }); } catch (e) {}
          }
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
  const db = netDb();
  if (!db) return;
  try {
      netChatRef = db.ref('sectors/' + sector + '/chat').limitToLast(25);
      netChatRef.on('child_added', (snap) => {
          const d = snap.val();
          if (!d || typeof d.m !== 'string') return;
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
      '<input id="netChatInput" maxlength="140" placeholder="T: hablar · Enter: enviar" autocomplete="off">';
  document.body.appendChild(panel);
  const input = document.getElementById('netChatInput');
  input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') netChatSend();
  });
}
function netChatLine(name, msg, mine) {
  const box = document.getElementById('netChatLog');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'rg-chatline' + (mine ? ' mine' : '');
  div.innerHTML = '<b></b><span></span>';
  div.querySelector('b').textContent = String(name).slice(0, 16) + ': ';
  div.querySelector('span').textContent = String(msg).slice(0, 140);
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
  const input = document.getElementById('netChatInput');
  if (!input) return;
  const text = (input.value || '').trim().slice(0, 140);
  if (!text) return;
  const now = Date.now();
  if (now - netChatLastSend < 2000) return;
  netChatLastSend = now;
  input.value = '';
  const db = netDb();
  if (!db) return;
  try {
      db.ref('sectors/' + netChatSector + '/chat').push({
          u: netUid, n: netName, m: text, t: firebase.database.ServerValue.TIMESTAMP
      });
  } catch (e) {}
}
wireNetAuth();
