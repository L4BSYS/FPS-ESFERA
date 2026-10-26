// js/31-world-signs.js — Carteles y tótems (extraído de 02-systems.js).
// --- Tótems de info (E para leer modal) ---
let totems = [];
// --- Carteles: texto visible en el mundo (CanvasTexture), sin modal ---
let carteles = [];
function escHtml(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function makeCartelTexture(lines) {
  const cols = Array.isArray(lines) ? lines.slice(0, 6).map(function (l) { return String(l == null ? '' : l); }) : [];
  const w = 1024, h = 640;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2a2218';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c4a574';
  ctx.lineWidth = 18;
  ctx.strokeRect(16, 16, w - 32, h - 32);
  ctx.strokeStyle = '#6b542e';
  ctx.lineWidth = 6;
  ctx.strokeRect(36, 36, w - 72, h - 72);
  ctx.fillStyle = '#f0e2c0';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const fontSize = cols.length > 4 ? 58 : (cols.length > 3 ? 66 : 72);
  ctx.font = 'bold ' + fontSize + 'px VT323, "Courier New", monospace';
  const padX = 88;
  const top = 110;
  const bottom = h - 110;
  const span = Math.max(1, cols.length - 1);
  for (let i = 0; i < cols.length; i++) {
    const y = cols.length === 1 ? h / 2 : top + (bottom - top) * (i / span);
    ctx.fillText(cols[i], padX, y, w - padX * 2);
  }
  // Pie sutil: hay más info con E
  ctx.fillStyle = '#a89070';
  ctx.font = 'bold 36px VT323, "Courier New", monospace';
  ctx.textAlign = 'right';
  ctx.fillText('E · más', w - 56, h - 48);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  if (typeof renderer !== 'undefined' && renderer && renderer.capabilities) {
    try { tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); } catch (e) {}
  }
  return tex;
}

// lines: cara breve; opts.detail: texto expandido del modal (E).
// opts: { x, y, z, rotY, width, height, style: 'pared'|'poste', detail: string[] }
function placeCartel(lines, opts) {
  opts = opts || {};
  const width = (typeof opts.width === 'number') ? opts.width : 2.2;
  const height = (typeof opts.height === 'number') ? opts.height : 1.35;
  const x = (typeof opts.x === 'number') ? opts.x : 0;
  const z = (typeof opts.z === 'number') ? opts.z : 0;
  const rotY = (typeof opts.rotY === 'number') ? opts.rotY : 0;
  const style = opts.style || 'pared';
  const y = (typeof opts.y === 'number') ? opts.y : (style === 'poste' ? 0 : 1.7);
  const detail = Array.isArray(opts.detail) ? opts.detail.slice(0, 14).map(function (l) { return String(l == null ? '' : l); }) : null;

  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x5c3d1e, roughness: 0.88, metalness: 0.05 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9, metalness: 0.02 });

  const tex = makeCartelTexture(lines);
  const faceMat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.75,
    metalness: 0.0,
    emissive: 0x1a1510,
    emissiveIntensity: 0.25
  });

  // Poste detrás de la placa (local −Z): no atraviesa el texto.
  let plateY = 0;
  if (style === 'poste') {
    plateY = 1.65;
    const boardBottom = plateY - height / 2;
    const poleBack = -0.14;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, boardBottom, 8), poleMat);
    pole.position.set(0, boardBottom / 2, poleBack);
    pole.castShadow = true;
    g.add(pole);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.12, 10), frameMat);
    base.position.set(0, 0.06, poleBack);
    base.castShadow = true;
    g.add(base);
    // Travesaño detrás, une poste con el borde inferior del cartel
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.2), poleMat);
    brace.position.set(0, boardBottom - 0.02, poleBack / 2);
    brace.castShadow = true;
    g.add(brace);
  }

  const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.12, height + 0.12, 0.08), frameMat);
  frame.position.set(0, plateY, 0);
  frame.castShadow = true;
  frame.receiveShadow = true;
  g.add(frame);

  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), faceMat);
  face.position.set(0, plateY, 0.045);
  g.add(face);

  g.position.set(x, y, z);
  g.rotation.y = rotY;
  g.name = 'Cartel';
  g.isStatic = true;
  g.userData.isCartel = true;
  g.userData.solid = true;
  try { g.updateMatrixWorld(true); g.userData.worldBoundingBox = new THREE.Box3().setFromObject(g, true); } catch (e) {}

  const ref = {
    lines: (lines || []).slice(0, 6),
    detail: detail,
    mesh: g,
    texture: tex,
    face: face,
    faceMat: faceMat,
    pos: new THREE.Vector3(x, y, z),
    style: style
  };
  g.userData.cartelRef = ref;
  g.userData.isCartel = true;
  scene.add(g);
  if (typeof collidableObjects !== 'undefined' && collidableObjects.indexOf(g) === -1) collidableObjects.push(g);
  carteles.push(ref);
  return ref;
}

// Cambia cara y, opcionalmente, el modal (detail).
function updateCartelLines(ref, lines, detail) {
  if (!ref || !ref.faceMat) return null;
  const next = Array.isArray(lines) ? lines.slice(0, 6) : [];
  const tex = makeCartelTexture(next);
  try { if (ref.texture) ref.texture.dispose(); } catch (e) {}
  try { if (ref.faceMat.map) ref.faceMat.map.dispose(); } catch (e) {}
  ref.faceMat.map = tex;
  ref.faceMat.needsUpdate = true;
  ref.texture = tex;
  ref.lines = next;
  if (detail !== undefined) {
    ref.detail = Array.isArray(detail) && detail.length
      ? detail.slice(0, 14).map(function (l) { return String(l == null ? '' : l); })
      : null;
  }
  return ref;
}

// Copy reutilizable: cartel de un paso aún no desbloqueado.
function cartelLinesLater(currentHint) {
  return [
    'Volvé más tarde',
    'Completá antes:',
    currentHint || 'el paso actual'
  ];
}

function cartelDetailLater(currentHint) {
  return [
    'Este sector todavía no está activo.',
    'Completá antes: ' + (currentHint || 'el paso actual') + '.',
    'Cuando lo hagas, este cartel se actualiza solo.',
    'La cara muestra lo esencial; E abre más detalle.'
  ];
}

var currentCartel = null;
var cartelOpen = false;
function toggleCartel(open, ref) {
  const modal = document.getElementById('totemModal');
  if (!modal) return;
  if (open) {
    currentCartel = ref || currentCartel;
    if (!currentCartel) return;
    if (typeof invOpen !== 'undefined' && invOpen) toggleInventory();
    if (typeof benchOpen !== 'undefined' && benchOpen) toggleBench(false);
    if (typeof pauseMenu !== 'undefined' && pauseMenu) pauseMenu.style.display = 'none';
    isGamePaused = true;
    try { document.exitPointerLock(); } catch (e) {}
    const title = modal.querySelector('.rg-title');
    if (title) title.textContent = '📋 Cartel';
    const body = document.getElementById('totemBody');
    const block = (currentCartel.detail && currentCartel.detail.length)
      ? currentCartel.detail
      : (currentCartel.lines || []);
    if (body) {
      body.innerHTML = block.map(function (l) { return '<div>' + escHtml(l) + '</div>'; }).join('');
    }
    modal.style.display = 'flex';
    cartelOpen = true;
    openModal = 'cartel';
    try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (e) {}
  } else {
    modal.style.display = 'none';
    cartelOpen = false;
    currentCartel = null;
    if (typeof openModal !== 'undefined' && openModal === 'cartel') openModal = null;
    const title = modal.querySelector('.rg-title');
    if (title) title.textContent = '🗿 Tótem de info';
    try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (e) {}
    if ((typeof invOpen === 'undefined' || !invOpen) && (typeof benchOpen === 'undefined' || !benchOpen)) {
      isGamePaused = false;
      lockPointer();
    }
  }
}

function tryOpenCartel() {
  if (typeof player === 'undefined' || !player || !carteles.length) return false;
  const o = new THREE.Vector3(); camera.getWorldPosition(o);
  const d = camera.getWorldDirection(new THREE.Vector3());
  const ray = new THREE.Raycaster(o, d, 0.1, 4.2);
  const hits = ray.intersectObjects(carteles.map(function (c) { return c.mesh; }), true);
  for (let i = 0; i < hits.length; i++) {
    let p = hits[i].object, ref = null;
    while (p) {
      if (p.userData && p.userData.cartelRef) { ref = p.userData.cartelRef; break; }
      p = p.parent;
    }
    if (ref) {
      if (cartelOpen && currentCartel === ref) toggleCartel(false);
      else toggleCartel(true, ref);
      return true;
    }
  }
  return false;
}

function cartelLookPrompt() {
  if (typeof camera === 'undefined' || !camera || !carteles.length) return '';
  const o = new THREE.Vector3(); camera.getWorldPosition(o);
  const d = camera.getWorldDirection(new THREE.Vector3());
  const ray = new THREE.Raycaster(o, d, 0.1, 4.2);
  const hits = ray.intersectObjects(carteles.map(function (c) { return c.mesh; }), true);
  if (!hits.length) return '';
  let p = hits[0].object;
  while (p) {
    if (p.userData && p.userData.cartelRef) return '[E] Leer cartel';
    p = p.parent;
  }
  return '';
}

function clearCarteles() {
  [...carteles].forEach(function (c) {
    try {
      scene.remove(c.mesh);
      const i = collidableObjects.indexOf(c.mesh);
      if (i > -1) collidableObjects.splice(i, 1);
      if (c.texture) c.texture.dispose();
      c.mesh.traverse(function (o) {
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
        if (o.geometry) o.geometry.dispose();
      });
    } catch (e) {}
  });
  carteles.length = 0;
}
// lines, x, z [, opts]
// opts: { role, zoneId, onActivate, detail, label, waveSpawns:[{x,z}] }
function placeTotem(lines, x, z, opts) {
  opts = opts || {};
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6f6f73, roughness: 0.95 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: 0x4a4a4e, roughness: 0.95 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x9a7b46, roughness: 0.9 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.26, 12), stoneMat);
  base.position.y = 0.13;
  const baseStep = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.16, 12), stoneDark);
  baseStep.position.y = 0.34;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.7, 9), woodMat);
  pole.position.y = 1.2;
  const rope1 = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 12), ropeMat);
  rope1.rotation.x = Math.PI / 2; rope1.position.y = 1.05;
  const rope2 = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 12), ropeMat);
  rope2.rotation.x = Math.PI / 2; rope2.position.y = 1.3;
  const runeMat = new THREE.MeshStandardMaterial({ color: 0x4CAF50, emissive: 0x1a5c1a, emissiveIntensity: 0.7, roughness: 0.4 });
  const runeL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.05), runeMat);
  runeL.position.set(-0.5, 1.5, 0);
  const runeR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.05), runeMat);
  runeR.position.set(0.5, 1.5, 0);
  const top = new THREE.Mesh(new THREE.OctahedronGeometry(0.26),
      new THREE.MeshStandardMaterial({ color: 0x66e06a, emissive: 0x2fbf3a, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.2 }));
  top.position.y = 2.35;
  const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 16),
      new THREE.MeshStandardMaterial({ color: 0xffcf6b, metalness: 0.85, roughness: 0.3 }));
  topRing.rotation.x = Math.PI / 2; topRing.position.y = 2.1;

  [base, baseStep, pole, rope1, rope2, runeL, runeR, top, topRing].forEach(m => { m.castShadow = true; g.add(m); });
  g.position.set(x, 0, z);
  const role = opts.role || (opts.zoneId != null ? 'zone_switch' : (opts.onActivate ? 'key' : 'lore'));
  const waveSpawns = Array.isArray(opts.waveSpawns)
    ? opts.waveSpawns.filter(function (p) { return p && typeof p.x === 'number' && typeof p.z === 'number'; })
        .map(function (p) { return { x: p.x, z: p.z }; })
    : null;
  const tb = {
    lines: (lines || []).slice(0, 4),
    detail: Array.isArray(opts.detail) ? opts.detail.slice(0, 12) : null,
    mesh: g,
    top: top,
    pos: new THREE.Vector3(x, 0, z),
    role: role,
    zoneId: opts.zoneId != null ? opts.zoneId : null,
    label: opts.label || null,
    onActivate: typeof opts.onActivate === 'function' ? opts.onActivate : null,
    waveSpawns: waveSpawns,
    _waveSpawnsRegistered: false
  };
  g.userData.isTotem = true;
  g.userData.totemRef = tb;
  g.userData.solid = true;
  g.isStatic = true;
  try { g.updateMatrixWorld(true); g.userData.worldBoundingBox = new THREE.Box3().setFromObject(g, true); } catch (e) {}
  scene.add(g);
  if (typeof collidableObjects !== 'undefined' && collidableObjects.indexOf(g) === -1) collidableObjects.push(g);
  totems.push(tb);
  tintTotemByRole(tb);
  return tb;
}

function tintTotemByRole(tb) {
  if (!tb || !tb.top || !tb.top.material) return;
  try {
    if (tb.role === 'zone_switch') {
      const z = (typeof findWorldZoneById === 'function') ? findWorldZoneById(tb.zoneId) : null;
      const mode = z ? z.mode : 'damage';
      const on = z ? !!z.enabled : false;
      if (mode === 'heal') {
        tb.top.material.color.setHex(on ? 0x4caf50 : 0x3a4a3a);
        tb.top.material.emissive.setHex(0x1b5e20);
      } else if (mode === 'spawn') {
        tb.top.material.color.setHex(on ? 0xff9800 : 0x5a4030);
        tb.top.material.emissive.setHex(0xe65100);
      } else {
        tb.top.material.color.setHex(on ? 0xf44336 : 0x4a3030);
        tb.top.material.emissive.setHex(0xb71c1c);
      }
      tb.top.material.emissiveIntensity = on ? 0.95 : 0.15;
    } else if (tb.role === 'key') {
      tb.top.material.color.setHex(0xffd54f);
      tb.top.material.emissive.setHex(0xff8f00);
      tb.top.material.emissiveIntensity = 0.9;
    }
  } catch (e) {}
}

// opts-style wrapper: placeTotemBeacon({ x, z, lines, role, zoneId, waveSpawns, ... })
function placeTotemBeacon(opts) {
  opts = opts || {};
  const x = (typeof opts.x === 'number') ? opts.x : 0;
  const z = (typeof opts.z === 'number') ? opts.z : 0;
  const lines = opts.lines || ['Tótem', 'E — prender', ''];
  return placeTotem(lines, x, z, opts);
}

// Registra enemySpawns del tótem la primera vez que se prende (arma oleadas sin flag global).
function ensureTotemWaveSpawns(tb) {
  if (!tb || tb._waveSpawnsRegistered) return false;
  const pts = tb.waveSpawns;
  if (!pts || !pts.length) return false;
  for (let i = 0; i < pts.length; i++) {
    addEnemySpawn(pts[i].x, pts[i].z, false);
  }
  tb._waveSpawnsRegistered = true;
  try {
    if (typeof showMessage === 'function') showMessage('Oleadas activadas');
  } catch (e) {}
  return true;
}

function fillTotemModalBody(tb) {
  const body = document.getElementById('totemBody');
  if (!body || !tb) return;
  // Modal solo para lore / puzzle. zone_switch no abre modal: E = toggle.
  const lines = (tb.detail && tb.detail.length) ? tb.detail : (tb.lines || []);
  body.innerHTML = lines.map(function (l) { return '<div>' + escHtml(l) + '</div>'; }).join('');
}

var currentTotem = null;
var totemOpen = false;
function toggleTotem(open, tb) {
  const modal = document.getElementById('totemModal');
  if (!modal) return;
  if (open) {
      currentTotem = tb || currentTotem;
      if (!currentTotem) return;
      if (typeof cartelOpen !== 'undefined' && cartelOpen) toggleCartel(false);
      if (typeof invOpen !== 'undefined' && invOpen) toggleInventory();
      if (typeof benchOpen !== 'undefined' && benchOpen) toggleBench(false);
      if (typeof pauseMenu !== 'undefined' && pauseMenu) pauseMenu.style.display = 'none';
      isGamePaused = true;
      try { document.exitPointerLock(); } catch (e) {}
      const title = modal.querySelector('.rg-title');
      if (title) {
        if (currentTotem.role === 'key') title.textContent = '🗿 Tótem puzzle';
        else title.textContent = '🗿 Tótem';
      }
      fillTotemModalBody(currentTotem);
      modal.style.display = 'flex';
      totemOpen = true;
      openModal = 'totem';
      try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (e) {}
  } else {
      modal.style.display = 'none';
      totemOpen = false;
      currentTotem = null;
      if (typeof openModal !== 'undefined' && openModal === 'totem') openModal = null;
      try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (e) {}
      if ((typeof invOpen === 'undefined' || !invOpen) && (typeof benchOpen === 'undefined' || !benchOpen)) { isGamePaused = false; lockPointer(); }
  }
}
function tryOpenTotem() {
  if (typeof player === 'undefined' || !player || !totems.length) return false;
  const o = new THREE.Vector3(); camera.getWorldPosition(o);
  const d = camera.getWorldDirection(new THREE.Vector3());
  const ray = new THREE.Raycaster(o, d, 0.1, 3.4);
  const hits = ray.intersectObjects(totems.map(t => t.mesh), true);
  for (const h of hits) {
      let p = h.object, tb = null;
      while (p) {
          if (p.userData && p.userData.totemRef) { tb = p.userData.totemRef; break; }
          p = p.parent;
      }
      if (tb) {
          // Zona: E = toggle. Si trae waveSpawns, al prender registra puntos de oleada.
          if (tb.role === 'zone_switch') {
              try {
                  toggleWorldZoneEnabled(tb.zoneId);
                  const z = findWorldZoneById(tb.zoneId);
                  if (z && z.enabled) ensureTotemWaveSpawns(tb);
                  tintTotemByRole(tb);
                  if (z) {
                      const tag = z.enabled ? 'ON' : 'OFF';
                      const hint = z.enabled ? 'E — apagar' : 'E — prender';
                      tb.lines = ['Tótem', tag, hint];
                  }
              } catch (e) {}
              return true;
          }
          if (typeof tb.onActivate === 'function') {
              try { tb.onActivate(tb); } catch (e) {}
              return true;
          }
          if (totemOpen && currentTotem === tb) toggleTotem(false);
          else toggleTotem(true, tb);
          return true;
      }
  }
  return false;
}

