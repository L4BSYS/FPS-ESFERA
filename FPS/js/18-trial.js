// js/18-trial.js (part 18). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// Trials estilo puzzle/speedrun: spawn -> llave -> puerta -> siguiente.
// Lineal, timer arranca al primer movimiento, best local. Fantasmas = avatares net (ya existen).

const TRIALS = [
  {
    id: 'trial-1',
    name: 'El Despertar',
    spawn: { x: 0, y: 2, z: 5 },
    keyNeed: 'golden_key',
    door: { x: 3, y: 2, z: 27 },
    checkpoints: [{ x: 0, z: 14, r: 3.5 }, { x: 0, z: 23, r: 3.5 }],
    par: 180
  }
];
var trialActive = null; // {def, startTs, started, keyGot, cpsHit:[], finished, doorMesh}
var trialMarkers = [];

function trialById(id) {
  for (const t of TRIALS) if (t.id === id) return t;
  return null;
}
function trialBest(id) {
  try { return JSON.parse(localStorage.getItem('lagrieta_best_' + id) || 'null'); } catch (e) { return null; }
}
function trialHud() {
  let el = document.getElementById('trialHud');
  if (!el) {
      el = document.createElement('div');
      el.id = 'trialHud';
      document.body.appendChild(el);
  }
  return el;
}
function trialFmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}
function trialObjective() {
  if (!trialActive || trialActive.finished) return '';
  if (!trialActive.keyGot) return '👉 Agarrá la llave dorada';
  return '👉 Llegá a la puerta';
}
function trialDraw() {
  const el = trialHud();
  if (!trialActive) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const t = trialActive.started ? (Date.now() - trialActive.startTs) : 0;
  const best = trialBest(trialActive.def.id);
  el.innerHTML = '';
  const tm = document.createElement('div');
  tm.className = 'rg-trial-time';
  tm.textContent = trialFmt(t);
  el.appendChild(tm);
  const ob = document.createElement('div');
  ob.className = 'rg-trial-obj';
  ob.textContent = trialActive.def.name + ' · ' + trialObjective() + (best ? ' · best ' + trialFmt(best) : '');
  el.appendChild(ob);
}
function trialClearMarkers() {
  for (const m of trialMarkers) { try { scene.remove(m); } catch (e) {} }
  trialMarkers = [];
}
function trialBuildMarkers() {
  trialClearMarkers();
  if (!trialActive) return;
  for (const cp of trialActive.def.checkpoints) {
      try {
          const m = new THREE.Mesh(
              new THREE.OctahedronGeometry(0.3),
              new THREE.MeshStandardMaterial({ color: 0x33ff66, emissive: 0x0e3a1a, roughness: 0.4 })
          );
          m.position.set(cp.x, 1.2, cp.z);
          m.raycast = function () {};
          scene.add(m);
          trialMarkers.push(m);
      } catch (e) {}
  }
}
function trialFindDoor() {
  try {
      let best = null, bestD = Infinity;
      for (const d of placedDoors) {
          const dd = Math.hypot(d.position.x - trialActive.def.door.x, d.position.z - trialActive.def.door.z);
          if (dd < bestD) { bestD = dd; best = d; }
      }
      if (best && bestD < 4) return best;
  } catch (e) {}
  return null;
}
function trialStart(id) {
  const def = trialById(id || 'trial-1');
  if (!def || typeof player === 'undefined' || !player) return;
  trialStop(true);
  trialActive = { def, startTs: 0, started: false, keyGot: false, cpsHit: [], finished: false, doorMesh: null };
  try {
      player.container.position.set(def.spawn.x, def.spawn.y, def.spawn.z);
      player.container.rotation.y = Math.PI;
      player.velocity.set(0, 0, 0);
      playerSpawnPos = player.container.position.clone();
      player.updateColliderPosition();
      player.updateColliderBox();
  } catch (e) {}
  trialActive.doorMesh = trialFindDoor();
  trialBuildMarkers();
  trialDraw();
  try { showMessage(def.name + ': ¡movéte para arrancar el timer!'); } catch (e) {}
  try { refreshTrialBox(); } catch (e) {}
}
function trialStop(silent) {
  if (trialActive && trialActive.doorMesh) {
      try { trialActive.doorMesh.material.emissive.setHex(0x000000); } catch (e) {}
  }
  trialClearMarkers();
  trialActive = null;
  try {
      const el = document.getElementById('trialHud');
      if (el) el.style.display = 'none';
  } catch (e) {}
  if (!silent) { try { setPauseStatus('Trial terminado (modo libre)'); } catch (e) {} }
  try { refreshTrialBox(); } catch (e) {}
}
function trialHasKey() {
  try {
      const keys = player.inventory.resources.keys || [];
      for (const k of keys) { if ((k.id || k) === trialActive.def.keyNeed || (k.name || '') === trialActive.def.keyNeed) return true; }
      for (const k of keys) { if ((k.id || k.keyId || '') === 'golden_key' || (k.name || '').toLowerCase().includes('dorada')) return true; }
  } catch (e) {}
  return false;
}
function trialFinish() {
  if (!trialActive || trialActive.finished) return;
  trialActive.finished = true;
  const ms = Date.now() - trialActive.startTs;
  const prev = trialBest(trialActive.def.id);
  const isBest = !prev || ms < prev;
  if (isBest) { try { localStorage.setItem('lagrieta_best_' + trialActive.def.id, JSON.stringify(ms)); } catch (e) {} }
  trialDraw();
  try { showTrialModal(ms, isBest); } catch (e) {}
  try { playSound('health-regen'); } catch (e) {}
}
function trialUpdate() {
  if (!trialActive || trialActive.finished) return;
  if (typeof player === 'undefined' || !player || !player.container) return;
  // arranca con el primer movimiento (teclado o táctil)
  if (!trialActive.started) {
      let moved = false;
      try {
          moved = !!(keys['w'] || keys['a'] || keys['s'] || keys['d'] || keys[' '] || player.touchMoveActive);
      } catch (e) {}
      if (moved) {
          trialActive.started = true;
          trialActive.startTs = Date.now();
      } else {
          trialDraw();
          return;
      }
  }
  const p = player.container.position;
  // llave?
  if (!trialActive.keyGot && trialHasKey()) {
      trialActive.keyGot = true;
      try {
          if (trialActive.doorMesh) trialActive.doorMesh.material.emissive.setHex(0x0e5c1a);
      } catch (e) {}
      try { showMessage('¡Llave conseguida! Andá a la puerta'); playSound('key-pickup'); } catch (e) {}
  }
  // checkpoints
  trialActive.def.checkpoints.forEach((cp, i) => {
      if (trialActive.cpsHit.includes(i)) return;
      if (Math.hypot(p.x - cp.x, p.z - cp.z) < (cp.r || 3)) {
          trialActive.cpsHit.push(i);
          try {
              playerSpawnPos = player.container.position.clone();
              showMessage('Checkpoint ✓');
              playSound('health-regen');
          } catch (e) {}
      }
  });
  // puerta?
  if (trialActive.keyGot) {
      const d = trialActive.def.door;
      if (Math.hypot(p.x - d.x, p.z - d.z) < 1.8 && Math.abs(p.y - d.y) < 2.5) {
          trialFinish();
          return;
      }
  }
  trialDraw();
}
// --- Panel fin de trial ---
function showTrialModal(ms, isBest) {
  let m = document.getElementById('trialModal');
  if (!m) {
      m = document.createElement('div');
      m.id = 'trialModal';
      m.className = 'rg-overlay';
      m.style.justifyContent = 'center';
      m.style.alignItems = 'center';
      m.innerHTML = '<div class="rg-panel rg-modalbox narrow" style="text-align:center;">' +
          '<h2 class="rg-title">🏁 ¡NIVEL COMPLETO!</h2>' +
          '<div id="trialModalStats" class="rg-stats"></div>' +
          '<div><button id="trialRetry" class="rg-btn rg-btn-primary">Reintentar</button> ' +
          '<button id="trialFree" class="rg-btn">Seguir explorando</button></div></div>';
      document.body.appendChild(m);
      document.getElementById('trialRetry').addEventListener('click', () => {
          m.style.display = 'none';
          isGamePaused = false;
          trialStart(trialActive ? trialActive.def.id : 'trial-1');
          lockPointer();
      });
      document.getElementById('trialFree').addEventListener('click', () => {
          m.style.display = 'none';
          isGamePaused = false;
          trialStop();
          lockPointer();
      });
  }
  const st = document.getElementById('trialModalStats');
  if (st) st.textContent = 'Tiempo ' + trialFmt(ms) + (isBest ? ' ¡RÉCORD! 🏆' : '');
  const wasPaused = isGamePaused;
  isGamePaused = true;
  try { document.exitPointerLock(); } catch (e) {}
  m.style.display = 'flex';
}
// --- Caja del trial en pestaña Mundo ---
function refreshTrialBox() {
  const box = document.getElementById('trialBox');
  if (!box) return;
  box.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'rg-hint';
  if (!trialActive) {
      title.textContent = 'Trial: El Despertar — spawn, llave, puerta. Timer desde el primer paso.';
      box.appendChild(title);
      const b = document.createElement('button');
      b.textContent = 'Jugar trial';
      b.className = 'rg-btn rg-btn-small rg-btn-primary';
      b.addEventListener('click', () => trialStart('trial-1'));
      box.appendChild(b);
  } else {
      const best = trialBest(trialActive.def.id);
      title.textContent = trialActive.def.name + (trialActive.finished ? ' ✓' : trialActive.started ? ' ⏱' : ' (movéte para arrancar)') +
          (best ? ' · best ' + trialFmt(best) : '');
      box.appendChild(title);
      const r = document.createElement('button');
      r.textContent = 'Reiniciar';
      r.className = 'rg-btn rg-btn-small';
      r.addEventListener('click', () => trialStart(trialActive.def.id));
      box.appendChild(r);
      const q = document.createElement('button');
      q.textContent = 'Abandonar';
      q.className = 'rg-btn rg-btn-small';
      q.addEventListener('click', () => trialStop());
      box.appendChild(q);
  }
}
