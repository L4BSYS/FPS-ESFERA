// js/02-systems.js (part 2/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Wave respawn system: new wave spawns a few seconds after all enemies die ---
const ENEMY_SPAWN_POINTS = [
  new THREE.Vector3(20, 0, 30),
  new THREE.Vector3(25, 0, 25),
  new THREE.Vector3(30, 0, 20)
];
let waveNumber = 0;
let waveRespawnAt = 0;

// --- Creator mode: god building (fly, free placement, place props, passive enemies) ---
let creatorMode = false;
let creatorPlaceMode = { kind: 'block', id: 'wood' };
let worldItems = [];    // placed pickup/item models (creator + scene)
let resourceNodes = []; // placed resource nodes (creator + scene)
let creatorBaseReach = null;

// --- Carteles / tótems → js/31-world-signs.js ---
// --- Mesas / placement / base HUD → js/27-workbench.js ---
function updateObjectiveHUD() {
  const el = document.getElementById('objectiveHud');
  if (!el) return;
  if (isGamePaused) { el.style.display = 'none'; return; }
  let txt = '';

  // Tutorial: prompteo alineado al director (cara de carteles / pasos).
  if (typeof DIRECTOR !== 'undefined' && DIRECTOR.active) {
    if (DIRECTOR.step < 1) {
      txt = '🔑 Agarrá la llave y abrí la puerta norte';
    } else if (!DIRECTOR.step1Done) {
      txt = '🪓 Norte: agarrá el hacha y picá un árbol';
    } else if (!DIRECTOR.step2Done) {
      txt = DIRECTOR.step2Revealed
        ? '⛏ Noroeste: agarrá el pico y picá piedra o metal'
        : '⛏ Andá al noroeste — el cartel se actualizó';
    } else if (!DIRECTOR.step3Done) {
      if (!DIRECTOR.invUnlocked) {
        txt = '🎒 Oeste: tomá la mochila del pedestal (E)';
      } else {
        txt = '🔨 Q → craft: martillo (piedra + piedra)';
      }
    } else if (!DIRECTOR.step4Done) {
      if (typeof pendingPlacement !== 'undefined' && pendingPlacement) {
        txt = '📍 Colocá la mesa dentro del círculo azul (suroeste)';
      } else {
        txt = '🛠 Suroeste: craft mesa (Q) y colocala en el círculo';
      }
    } else if (!DIRECTOR.step5Done) {
      txt = '🔫 Sureste: pistola · R recarga · derribá al robot';
    } else if (!DIRECTOR.step6Done) {
      txt = '🍎 Este: comida te cura — ¡no comas la toxina!';
    } else if (!DIRECTOR.step7Done) {
      txt = DIRECTOR.step7KeySpawned
        ? '🔑 Agarrá la llave del pedestal (noreste)'
        : '🗿 Noreste: E en el tótem para liberar la llave';
    } else {
      txt = '🚪 Puerta sur: usá la llave y salí del tutorial';
    }
  } else {
    // Playground / campaign: guía genérica de base.
    const inv = (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
    const hasHammer = inv && inv.items.some(i => i.toolType === 'hammer');
    const res = inv ? inv.resources : null;
    const resTotal = res ? ((res.wood || 0) + (res.stone || 0)) : 0;
    if (!hasHammer) {
      txt = resTotal < 6
        ? '🪓 Cosechá madera y piedra (hacha y pico)'
        : '🔨 Crafteá un martillo (Q → Crafteo)';
    } else if (typeof pendingPlacement !== 'undefined' && pendingPlacement) {
      txt = '📍 Apuntá y hacé clic para colocar tu base';
    } else if (!workbenches.length) {
      txt = '🛠 Crafteá y colocá tu mesa de trabajo (Q → Crafteo)';
    } else {
      txt = '🛡 Defendé tu base: construí alrededor y reparala con E';
    }
  }

  if (el.textContent !== txt) el.textContent = txt;
  el.style.display = 'block';
}

// --- Creador: estructuras, spawns, barra en el mundo, fantasma ---
let placedStairs = [];
let placedDoors = [];
let placedStatics = []; // {kind, mesh, w,h,d,color}
function placeStaticBox(kind, pos, rotY, dims, color) {
  const defs = {
      platform: { w: 15, h: 1, d: 15, color: 0x8888ff },
      cube: { w: 3, h: 3, d: 3, color: 0x999999 },
      wall: { w: 5, h: 3, d: 1, color: 0xbbbbbb }
  };
  const def = defs[kind] || {};
  const w = (dims && dims.w) || def.w, h = (dims && dims.h) || def.h, d = (dims && dims.d) || def.d;
  const c = (typeof color !== 'undefined') ? color : def.color;
  if (!w || !h || !d || typeof c === 'undefined') return null;
  const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.1 })
  );
  mesh.position.copy(pos);
  mesh.rotation.y = rotY || 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'Static_' + kind;
  const entry = { kind, mesh, w, h, d, color: c };
  mesh.userData = { staticProp: true, kind, staticRef: entry, allowBuildingOnTop: true };
  mesh.geometry.computeBoundingBox();
  mesh.updateMatrixWorld(true);
  scene.add(mesh);
  collidableObjects.push(mesh);
  placedStatics.push(entry);
  return mesh;
}
let enemySpawns = []; // {x, z, marker}
var creatorBarBtns = [];
var paletteOpen = false;
var paletteHold = false;
let creatorGhost = null;
let creatorGhostKey = '';
let creatorGhostMats = [];

function addEnemySpawn(x, z, withMarker) {
  const sp = { x, z, marker: null };
  if (withMarker) {
      const m = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.4, 0.8, 4, 8),
          new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.5 })
      );
      m.position.set(x, 0.9, z);
      m.raycast = function () {};
      m.userData.isSpawnMarker = true;
      m.visible = (typeof creatorMode !== 'undefined' && creatorMode);
      scene.add(m);
      sp.marker = m;
      m.userData.spawnRef = sp;
  }
  enemySpawns.push(sp);
  return sp;
}
function placeStairs(pos, rotY) {
  const gr = createStaircase({
      position: new THREE.Vector3(pos.x, 0.5, pos.z),
      stepCount: 8, width: 3, height: 0.5, rise: 0.4, spacing: 1,
      material: new THREE.MeshStandardMaterial({ color: 0x8B4513 })
  });
  gr.rotation.y = rotY || 0;
  gr.userData.isStairs = true;
  scene.add(gr);
  placedStairs.push(gr);
  return gr;
}
function placeDoor(pos, rotY) {
  const door = createLockedDoor(new THREE.Vector3(pos.x, 2, pos.z));
  door.rotation.y = rotY || 0;
  placedDoors.push(door);
  return door;
}
function placeEnemySpawn(pos) {
  const x = Math.round(pos.x * 100) / 100, z = Math.round(pos.z * 100) / 100;
  addEnemySpawn(x, z, true);
  try { spawnRobot(new THREE.Vector3(x, 0, z)); } catch (e) {}
  showPlacementMessage('Puse: spawn de enemigos (las oleadas salen de acá)');
}
function clearStructures() {
  [...placedStairs].forEach(gr => {
      try {
          gr.traverse(o => { if (o.isMesh) { const i = collidableObjects.indexOf(o); if (i > -1) collidableObjects.splice(i, 1); } });
          scene.remove(gr);
      } catch (e) {}
  });
  placedStairs.length = 0;
  [...placedDoors].forEach(d => {
      try { scene.remove(d); const i = collidableObjects.indexOf(d); if (i > -1) collidableObjects.splice(i, 1); } catch (e) {}
  });
  placedDoors.length = 0;
  [...enemySpawns].forEach(sp => { try { if (sp.marker) scene.remove(sp.marker); } catch (e) {} });
  enemySpawns.length = 0;
  waveNumber = 0;
  waveRespawnAt = 0;
  [...totems].forEach(t => { try { scene.remove(t.mesh); const i = collidableObjects.indexOf(t.mesh); if (i > -1) collidableObjects.splice(i, 1); } catch (e) {} });
  totems.length = 0;
  try { clearCarteles(); } catch (e) {}
}
function clearWorld() {
  try {
      try { cancelPlacement(true); } catch (e) {}
      try { if (typeof decayingBlocks !== 'undefined' && decayingBlocks) decayingBlocks.length = 0; } catch (e) {}
      clearBlocks();
      clearWorldProps();
      [...workbenches].forEach(w => destroyBench(w, true));
      clearStructures(); // también limpia totems, carteles, enemySpawns
      [...placedStatics].forEach(x => {
          try { scene.remove(x.mesh); const i = collidableObjects.indexOf(x.mesh); if (i > -1) collidableObjects.splice(i, 1); } catch (e) {}
      });
      placedStatics.length = 0;
      try { if (typeof clearWorldZones === 'function') clearWorldZones(); } catch (e) {}
      try { if (typeof clearWorldContainers === 'function') clearWorldContainers(); } catch (e) {}
      [...npcs].forEach(n => { try { n.die(); } catch (e) {} });
      updateSpatialPartition();
      try { if (typeof grantCreatorHammer === 'function') grantCreatorHammer(); } catch (e) {}
      showPlacementMessage('Mundo vaciado. Martillo en mano: mantené clic derecho para construir.');
  } catch (e) { console.error(e); }
}
function snappedYaw() {
  const y = (typeof player !== 'undefined' && player) ? player.container.rotation.y : 0;
  return Math.round(y / (Math.PI / 2)) * (Math.PI / 2);
}
function creatorTargetPose() {
  const mode = creatorPlaceMode;
  const p = creatorAimPoint();
  const r2 = (v) => Math.round(v * 100) / 100;
  let rotY = 0;
  if (mode.kind === 'struct') {
      rotY = snappedYaw();
      const py = (mode.id === 'door') ? 2 : (mode.id === 'stairs' ? 0.5 : Math.round(p.y * 2) / 2);
      p.set(Math.round(p.x * 2) / 2, py, Math.round(p.z * 2) / 2);
  } else if (mode.kind === 'enemy') {
      p.set(r2(p.x), 0, r2(p.z));
  } else if (mode.kind === 'item') {
      p.y = Math.max(p.y, 0.6);
      p.set(r2(p.x), r2(p.y), r2(p.z));
  } else if (mode.kind === 'node') {
      const gy = (typeof groundTopY === 'function') ? groundTopY(p.x, p.z) : 0;
      p.set(r2(p.x), gy, r2(p.z));
  } else if (mode.kind === 'prop') {
      const gy = (typeof groundTopY === 'function') ? groundTopY(p.x, p.z) : 0;
      p.set(r2(p.x), gy + 0.02, r2(p.z));
  }
  return { pos: p, rotY };
}
// --- Fantasma de vista previa ---
function clearCreatorGhost() {
  if (creatorGhost) { try { scene.remove(creatorGhost); } catch (e) {} }
  creatorGhost = null; creatorGhostKey = ''; creatorGhostMats = [];
}
function ghostMaterial(color) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false });
  creatorGhostMats.push(m);
  return m;
}
function ghostifyModel(model) {
  model.traverse(o => {
      if (o.isMesh) {
          o.material = ghostMaterial(0x00ff00);
          o.castShadow = false; o.receiveShadow = false;
          o.raycast = function () {};
      }
  });
  return model;
}
function buildCreatorGhost() {
  clearCreatorGhost();
  const mode = creatorPlaceMode;
  creatorGhostKey = mode.kind + ':' + mode.id;
  if (mode.kind === 'block' || mode.kind === 'erase') return; // blockPreview se encarga / borrar no muestra
  const g = new THREE.Group();
  const addBox = (w, h, d, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ghostMaterial(0x00ff00));
      m.position.y = y || 0; m.raycast = function () {};
      g.add(m);
  };
  if (mode.kind === 'item') {
      const def = ITEM_DEFINITIONS[mode.id];
      if (def && def.createModel) g.add(ghostifyModel(def.createModel()));
      else addBox(0.5, 0.5, 0.5, 0.3);
  } else if (mode.kind === 'node') {
      if (typeof buildResourceNodeModel === 'function') g.add(ghostifyModel(buildResourceNodeModel(mode.id)));
      else {
          const geo = (BLOCK_MATERIALS[mode.id] && BLOCK_MATERIALS[mode.id].geometry) || new THREE.BoxGeometry(1, 1, 1);
          const m = new THREE.Mesh(geo.clone(), ghostMaterial(0x00ff00));
          m.raycast = function () {}; m.position.y = 0.5;
          g.add(m);
      }
  } else if (mode.kind === 'prop') {
      if (typeof buildWorkbenchGhost === 'function') g.add(ghostifyModel(buildWorkbenchGhost(false)));
      else addBox(1.8, 1.1, 1.1, 0.55);
  } else if (mode.kind === 'struct' && mode.id === 'stairs') {
      addBox(8, 3.4, 2, 1.7);
  } else if (mode.kind === 'struct' && mode.id === 'door') {
      addBox(2, 4, 0.2, 2);
  } else if (mode.kind === 'struct' && mode.id === 'platform') {
      addBox(15, 1, 15, 0.5);
  } else if (mode.kind === 'struct' && mode.id === 'cube') {
      addBox(3, 3, 3, 1.5);
  } else if (mode.kind === 'struct' && mode.id === 'wall') {
      addBox(5, 3, 1, 1.5);
  } else if (mode.kind === 'enemy') {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.8, 4, 8), ghostMaterial(0xff3333));
      m.raycast = function () {};
      m.position.y = 0.9;
      g.add(m);
  } else {
      return;
  }
  g.visible = false;
  scene.add(g);
  creatorGhost = g;
}
function ghostRadius() {
  const mode = creatorPlaceMode;
  if (mode.kind === 'item') return 0.5;
  if (mode.kind === 'node') return 0.8;
  if (mode.kind === 'prop') return 1.4;
  if (mode.kind === 'struct' && mode.id === 'stairs') return 4.2;
  if (mode.kind === 'struct' && mode.id === 'door') return 1.2;
  if (mode.kind === 'struct' && mode.id === 'platform') return 4;
  if (mode.kind === 'struct' && mode.id === 'cube') return 2;
  if (mode.kind === 'struct' && mode.id === 'wall') return 2.5;
  if (mode.kind === 'enemy') return 0.8;
  return 0.5;
}
function ghostFits(pos, r) {
  const dxz = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  try {
      for (const b of placedBlocks) { if (dxz(b.position.x, b.position.z, pos.x, pos.z) < r + 0.7 && Math.abs(b.position.y - pos.y) < 2.5) return false; }
      for (const w of workbenches) { if (dxz(w.pos.x, w.pos.z, pos.x, pos.z) < r + 1.2) return false; }
      for (const gr of placedStairs) { if (dxz(gr.position.x, gr.position.z, pos.x, pos.z) < r + 4) return false; }
      for (const d of placedDoors) { if (dxz(d.position.x, d.position.z, pos.x, pos.z) < r + 1.2) return false; }
      for (const sp of enemySpawns) { if (Math.hypot(sp.x - pos.x, sp.z - pos.z) < r + 0.5) return false; }
  } catch (e) {}
  return true;
}
function setGhostTint(ok) {
  const c = ok ? 0x00ff00 : 0xff0000;
  creatorGhostMats.forEach(m => m.color.setHex(c));
}
function updateCreatorGhost() {
  const active = (typeof creatorMode !== 'undefined' && creatorMode) && !isGamePaused &&
      typeof player !== 'undefined' && player;
  if (!active) { if (creatorGhost) creatorGhost.visible = false; return; }
  const mode = creatorPlaceMode;
  if (mode.kind === 'block') { if (creatorGhost) creatorGhost.visible = false; return; }
  const key = mode.kind + ':' + mode.id;
  if (!creatorGhost || creatorGhostKey !== key) buildCreatorGhost();
  if (!creatorGhost) return;
  const pose = creatorTargetPose();
  creatorGhost.position.copy(pose.pos);
  creatorGhost.rotation.y = (mode.kind === 'struct') ? pose.rotY : 0;
  setGhostTint(ghostFits(pose.pos, ghostRadius()));
  creatorGhost.visible = true;
}
// --- Barra de creación en el mundo (sin pausa) ---
function renderCreatorBar() {
  let bar = document.getElementById('creatorBar');
  if (!bar) {
      bar = document.createElement('div');
      bar.id = 'creatorBar';
      document.body.appendChild(bar);
  }
  if (bar.dataset.built) return;
  bar.dataset.built = '1';
  const groups = [
      ['Bloques', [['block:wood', '🟫', 'Madera'], ['block:stone', '⬜', 'Piedra'], ['block:metal', '⬛', 'Metal']]],
      ['Objetos', [['item:pistol', '🔫', 'Pistola'], ['item:hammer', '🔨', 'Martillo'], ['item:axe', '🪓', 'Hacha'], ['item:pickaxe', '⛏️', 'Pico'], ['item:food', '🍎', 'Comida'], ['item:pistolAmmo', '📦', 'Balas'], ['item:key_golden', '🔑', 'Llave'], ['item:toxin', '☠️', 'Toxina']]],
      ['Nodos', [['node:wood', '🪵', 'Madera'], ['node:stone', '🪨', 'Piedra'], ['node:metal', '🔩', 'Metal']]],
      ['Base', [['prop:workbench', '🛠', 'Mesa']]],
      ['Estructuras', [['struct:stairs', '🪜', 'Escalera'], ['struct:door', '🚪', 'Puerta'], ['struct:platform', '🛖', 'Plataforma'], ['struct:cube', '🧱', 'Cubo'], ['struct:wall', '🚧', 'Muro']]],
      ['Enemigos', [['enemy:spawn', '👾', 'Spawn']]],
      ['Borrar', [['erase:erase', '❌', 'Sacar']]],
  ];
  groups.forEach(([glabel, opts]) => {
      const wrap = document.createElement('span');
      wrap.className = 'rg-pickgroup';
      const lab = document.createElement('span');
      lab.className = 'rg-picklabel';
      lab.textContent = glabel;
      wrap.appendChild(lab);
      opts.forEach(([v, icon, title]) => {
          const b = document.createElement('button');
          b.textContent = icon; b.title = title;
          b.dataset.pick = v;
          b.className = 'rg-pick';
          const pickIt = () => {
              const [kind, id] = v.split(':');
              creatorPlaceMode = { kind, id };
              refreshCreatorBar();
          };
          b.addEventListener('click', pickIt);
          b.addEventListener('mouseenter', () => {
              if (typeof paletteOpen !== 'undefined' && paletteOpen) pickIt();
          });
          wrap.appendChild(b);
          creatorBarBtns.push(b);
      });
      bar.appendChild(wrap);
  });
  const clr = document.createElement('button');
  clr.textContent = '🧹'; clr.title = 'Vaciar mundo';
  clr.className = 'rg-pick rg-pick-danger';
  clr.addEventListener('click', () => { if (confirm('¿Vaciar todo el mundo (bloques, objetos, base, enemigos)?')) clearWorld(); });
  bar.appendChild(clr);
  const hint = document.createElement('div');
  hint.id = 'creatorHint';
  hint.className = 'rg-hint';
  bar.appendChild(hint);
  refreshCreatorBar();
}
function renderCreatorFab() {
  let fab = document.getElementById('creatorFab');
  if (!fab) {
      fab = document.createElement('button');
      fab.id = 'creatorFab';
      fab.textContent = '🧱';
      fab.title = 'Crear';
      fab.className = 'rg-fab';
      fab.style.right = '12px';
      fab.style.bottom = '150px';
      fab.addEventListener('click', () => { if (typeof creatorMode !== 'undefined' && creatorMode) togglePalette(); });
      document.body.appendChild(fab);
  }
  const touch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
  fab.style.display = (touch && typeof creatorMode !== 'undefined' && creatorMode) ? 'block' : 'none';
}
function refreshCreatorBar() {
  const cur = creatorPlaceMode.kind + ':' + creatorPlaceMode.id;
  (creatorBarBtns || []).forEach(b => {
      b.classList.toggle('on', b.dataset.pick === cur);
  });
  const hint = document.getElementById('creatorHint');
  if (hint) {
      const b = (creatorBarBtns || []).find(x => x.dataset.pick === cur);
      hint.textContent = b ? ((creatorPlaceMode.kind === 'erase')
          ? 'A sacar: elegí, soltá y hacé clic donde apuntes'
          : ('A poner: ' + b.title + ' — elegí, soltá y hacé clic para poner' +
          (creatorPlaceMode.kind === 'block' ? ' (con el martillo)' : ''))) : '';
  }
}
function togglePalette(force) {
  paletteOpen = (typeof force === 'boolean') ? force : !paletteOpen;
  if (!paletteOpen) paletteHold = false;
  renderCreatorBar();
  refreshCreatorBar();
  const bar = document.getElementById('creatorBar');
  const show = paletteOpen && (typeof creatorMode !== 'undefined' && creatorMode) && !isGamePaused;
  if (bar) bar.style.display = show ? 'flex' : 'none';
  if (paletteOpen && !isGamePaused) {
      try { document.exitPointerLock(); } catch (e) {}
  } else if (!paletteOpen && !isGamePaused) {
      lockPointer();
  }
}
// --- Run stats (session kills, current run timer/spawn) ---
let enemiesKilled = 0;
let runStartTs = 0;
let playerSpawnPos = null;
function fmtRunTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

const PROP_ES = { wood: 'madera', stone: 'piedra', metal: 'metal', pistol: 'pistola', hammer: 'martillo', axe: 'hacha', pickaxe: 'pico', food: 'comida', toxin: 'toxina', pistol_ammo: 'balas', golden_key: 'llave dorada', workbench: 'mesa', stairs: 'escalera', door: 'puerta', spawn: 'spawn', platform: 'plataforma', cube: 'cubo', wall: 'muro', custom: 'bloque' };
function esPropName(id) { return PROP_ES[id] || id; }
function registerExistingProps() {
  // Adopt scene/default props placed at init so save/load replaces them cleanly
  try {
    collidableObjects.forEach(o => {
      if ((o.isPickupable || o.isCollectible) && !worldItems.includes(o)) {
        if (!o.userData) o.userData = {};
        if (!o.userData.itemKey) {
          let key = null;
          for (const k in ITEM_DEFINITIONS) { if (ITEM_DEFINITIONS[k].id === o.name) { key = k; break; } }
          o.userData.itemKey = key || o.name;
        }
        worldItems.push(o);
      }
      if (o.isResourceNode && !resourceNodes.includes(o)) resourceNodes.push(o);
    });
  } catch (e) {}
}
// Los modelos crafteados/regalados no están en la escena: hay que colgarlos de la cámara como hace el pickup
function attachToolModel(entry, def) {
  try {
      if (!entry) return;
      if (!entry.model && def && def.createModel) entry.model = def.createModel();
      if (entry.model) entry.model.userData.isToolModel = true;
      if (entry.model && typeof player !== 'undefined' && player && player.camera &&
          entry.model.parent !== player.camera) {
          player.camera.add(entry.model);
          if (player.heldItemOffset) entry.model.position.copy(player.heldItemOffset);
          entry.model.rotation.set(0, 0, 0);
      }
  } catch (e) {}
}
// Descolgar del camera cualquier modelo de herramienta que ya no esté en la mochila.
// Evita el "martillo trabado" cuando se resetea el inventario o se sale del modo creador.
function detachOrphanToolModels() {
  try {
      if (typeof player === 'undefined' || !player || !player.camera) return;
      const keep = new Set();
      const inv = player.inventory;
      (inv && inv.items ? inv.items : []).forEach(function (it) { if (it && it.model) keep.add(it.model); });
      if (inv && inv.equippedItem && inv.equippedItem.model) keep.add(inv.equippedItem.model);
      player.camera.children.slice().forEach(function (ch) {
          if (!ch) return;
          const isTool = (ch.userData && ch.userData.isToolModel) || ch.isToolModel;
          if (isTool && !keep.has(ch)) {
              try { player.camera.remove(ch); } catch (e) {}
          }
      });
  } catch (e) {}
}
function grantCreatorHammer() {
  try {
      if (typeof player === 'undefined' || !player || !player.inventory) return;
      const inv = player.inventory;
      let entry = inv.items.find(i => i.toolType === 'hammer');
      let granted = false;
      if (!entry) {
          const def = ITEM_DEFINITIONS.hammer;
          entry = { ...def, quantity: 1 };
          if (!inv.addItem(entry)) return;
          entry = inv.items.find(i => i.toolType === 'hammer') || entry;
          granted = true;
      }
      if (granted) entry.creatorOnly = true;
      attachToolModel(entry, ITEM_DEFINITIONS.hammer);
      player.setTool('hammer');
  } catch (e) { console.error(e); }
}
function placeWorldItem(key, position) {
  const itemDef = ITEM_DEFINITIONS[key];
  if (!itemDef || !itemDef.createModel) return null;
  const item = { ...itemDef };
  const model = itemDef.createModel();
  model.position.copy(position);
  model.rotation.y = Math.PI / 4;
  model.scale.set(0.5, 0.5, 0.5);
  model.isPickupable = true;
  model.name = itemDef.id;
  model.userData = Object.assign({}, model.userData, { collected: false, itemData: item, itemKey: key, creatorPlaced: true });
  if (itemDef.type === 'consumable') { model.isCollectible = true; model.type = itemDef.id; }
  if (itemDef.type === 'key' && typeof decorateGoldenKey === 'function') decorateGoldenKey(model);
  scene.add(model);
  collidableObjects.push(model);
  if (!worldItems.includes(model)) worldItems.push(model);
  return model;
}
function placeResourceNode(type, pos) {
  const node = createResourceNode(type, pos);
  if (!node) return null;
  scene.add(node);
  collidableObjects.push(node);
  return node;
}
function removeWorldProp(root) {
  scene.remove(root);
  let i = collidableObjects.indexOf(root); if (i > -1) collidableObjects.splice(i, 1);
  i = worldItems.indexOf(root); if (i > -1) worldItems.splice(i, 1);
  i = resourceNodes.indexOf(root); if (i > -1) resourceNodes.splice(i, 1);
  showPlacementMessage('Saqué: ' + esPropName(root.name || 'objeto'));
}
function creatorAimPoint() {
  const o = new THREE.Vector3(); camera.getWorldPosition(o);
  const d = camera.getWorldDirection(new THREE.Vector3());
  const reach = (typeof PLAYER_CONFIG !== 'undefined' && PLAYER_CONFIG.blockReach) || 6;
  const ray = new THREE.Raycaster(o, d, 0.1, reach * 2);
  const hits = ray.intersectObjects([groundMesh, ...placedBlocks], false);
  if (hits.length) {
      const h = hits[0];
      const n = (h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0)).transformDirection(h.object.matrixWorld);
      return h.point.clone().add(n.multiplyScalar(0.4));
  }
  return o.clone().add(d.multiplyScalar(3));
}
// Altura del suelo/estructura apuntando hacia abajo (para apoyar props sin que floten)
function groundTopY(x, z) {
  try {
      const origin = new THREE.Vector3(x, 30, z);
      const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, 60);
      const hits = ray.intersectObjects([groundMesh, ...placedBlocks], false);
      if (hits.length) return hits[0].point.y;
  } catch (e) {}
  return 0;
}
function creatorPlace() {
  if (typeof player === 'undefined' || !player) return;
  const mode = creatorPlaceMode;
  if (mode.kind === 'erase') { creatorDelete(); return; }
  const pose = creatorTargetPose();
  const p = pose.pos;
  if (mode.kind === 'block') {
      if (player.currentTool !== TOOLS.HAMMER) {
          setPauseStatus('Equipá el martillo para poner bloques');
          showPlacementMessage('Equipá el martillo para construir');
          return;
      }
      currentBlockType = mode.id;
      placeBlock();
      updateSpatialPartition();
  } else if (mode.kind === 'item') {
      if (placeWorldItem(mode.id, p)) showPlacementMessage('Puse: ' + esPropName(mode.id));
  } else if (mode.kind === 'node') {
      if (placeResourceNode(mode.id, p)) showPlacementMessage('Puse: ' + esPropName(mode.id));
  } else if (mode.kind === 'prop' && mode.id === 'workbench') {
      if (placeWorkbench(p)) showPlacementMessage('Puse: mesa de trabajo (tu base)');
  } else if (mode.kind === 'struct' && mode.id === 'stairs') {
      placeStairs(p, pose.rotY);
      showPlacementMessage('Puse: escalera');
  } else if (mode.kind === 'struct' && mode.id === 'door') {
      placeDoor(p, pose.rotY);
      showPlacementMessage('Puse: puerta (llave dorada)');
  } else if (mode.kind === 'struct' && (mode.id === 'platform' || mode.id === 'cube' || mode.id === 'wall')) {
      placeStaticBox(mode.id, p, pose.rotY);
      showPlacementMessage('Puse: ' + esPropName(mode.id));
  } else if (mode.kind === 'enemy') {
      placeEnemySpawn(p);
  }
}
function creatorDelete() {
  const o = new THREE.Vector3(); camera.getWorldPosition(o);
  const d = camera.getWorldDirection(new THREE.Vector3());
  const reach = (typeof PLAYER_CONFIG !== 'undefined' && PLAYER_CONFIG.blockReach) || 6;
  const ray = new THREE.Raycaster(o, d, 0.1, reach * 2);
  const inCreator = (typeof creatorMode !== 'undefined' && creatorMode);
  const targets = inCreator
      ? [...placedBlocks, ...worldItems, ...resourceNodes, ...workbenches.map(w => w.mesh),
         ...placedStairs, ...placedDoors, ...placedStatics.map(x => x.mesh), ...totems.map(t => t.mesh)]
      : [...placedBlocks];
  const hits = ray.intersectObjects(targets, true);
  for (const h of hits) {
      let root = null, benchRef = null, spawnRef = null, staticRef = null, totemRef = null, p = h.object;
      while (p) {
          if (p.userData && p.userData.benchRef) { benchRef = p.userData.benchRef; break; }
          if (p.userData && p.userData.spawnRef) { spawnRef = p.userData.spawnRef; break; }
          if (p.userData && p.userData.staticRef) { staticRef = p.userData.staticRef; break; }
          if (p.userData && p.userData.totemRef) { totemRef = p.userData.totemRef; break; }
          if (placedBlocks.includes(p) || worldItems.includes(p) || resourceNodes.includes(p) ||
              placedStairs.includes(p) || placedDoors.includes(p)) { root = p; break; }
          p = p.parent;
      }
      if (benchRef) { destroyBench(benchRef, true); return; }
      if (staticRef) {
          try { scene.remove(staticRef.mesh); const i = collidableObjects.indexOf(staticRef.mesh); if (i > -1) collidableObjects.splice(i, 1); } catch (e) {}
          placedStatics.splice(placedStatics.indexOf(staticRef), 1);
          showPlacementMessage('Saqué: ' + esPropName(staticRef.kind));
          return;
      }
      if (totemRef) {
          try { scene.remove(totemRef.mesh); const i = collidableObjects.indexOf(totemRef.mesh); if (i > -1) collidableObjects.splice(i, 1); } catch (e) {}
          totems.splice(totems.indexOf(totemRef), 1);
          showPlacementMessage('Saqué: tótem');
          return;
      }
      if (spawnRef) {
          try { if (spawnRef.marker) scene.remove(spawnRef.marker); } catch (e) {}
          enemySpawns.splice(enemySpawns.indexOf(spawnRef), 1);
          showPlacementMessage('Saqué: spawn de enemigos');
          return;
      }
      if (!root) continue;
      if (placedStairs.includes(root)) {
          try {
              root.traverse(o => { if (o.isMesh) { const i = collidableObjects.indexOf(o); if (i > -1) collidableObjects.splice(i, 1); } });
              scene.remove(root);
          } catch (e) {}
          placedStairs.splice(placedStairs.indexOf(root), 1);
          showPlacementMessage('Saqué: escalera');
          return;
      }
      if (placedDoors.includes(root)) {
          try { scene.remove(root); const i = collidableObjects.indexOf(root); if (i > -1) collidableObjects.splice(i, 1); } catch (e) {}
          placedDoors.splice(placedDoors.indexOf(root), 1);
          showPlacementMessage('Saqué: puerta');
          return;
      }
      if (placedBlocks.includes(root)) { destroyBlock(root); return; }
      removeWorldProp(root);
      return;
  }
  showPlacementMessage('No hay nada para sacar');
}
// --- Scene snapshot with props (back-compat: old saves only have blocks) ---
function serializeProps(list, isNode) {
  return list.map(o => {
    const d = {
      k: isNode ? o.type : (o.userData && o.userData.itemKey),
      x: Math.round(o.position.x * 100) / 100,
      y: Math.round(o.position.y * 100) / 100,
      z: Math.round(o.position.z * 100) / 100
    };
    if (o.userData && o.userData.autoResource) d.a = 1;
    return d;
  }).filter(d => d.k);
}
function clearWorldProps() {
  [...worldItems, ...resourceNodes].forEach(o => {
      scene.remove(o);
      const i = collidableObjects.indexOf(o);
      if (i > -1) collidableObjects.splice(i, 1);
  });
  worldItems.length = 0;
  resourceNodes.length = 0;
}
function snapshotScene() {
  registerExistingProps();
  const benchData = workbenches.map(w => ({
    x: Math.round(w.pos.x * 100) / 100,
    y: Math.round(w.pos.y * 100) / 100,
    z: Math.round(w.pos.z * 100) / 100,
    hp: Math.round(w.hp),
    bench: (typeof serializedBenchUpgrades === 'function') ? serializedBenchUpgrades(w) : null
  }));
  const containerData = (typeof worldContainers !== 'undefined' ? worldContainers : []).map(function (c) {
    if (!c || !c.pos) return null;
    return {
      mode: c.mode === 'dispenser' ? 'dispenser' : 'storage',
      x: Math.round(c.pos.x * 100) / 100,
      y: Math.round(c.pos.y * 100) / 100,
      z: Math.round(c.pos.z * 100) / 100,
      rotY: c.mesh ? (Math.round((c.mesh.rotation.y || 0) * 100) / 100) : 0,
      label: c.label || null,
      slots: c.mode === 'storage' && Array.isArray(c.slots)
        ? c.slots.map(function (s) { return s ? Object.assign({}, s) : null; })
        : null,
      stock: c.stock ? Object.assign({}, c.stock) : null,
      stockMax: c.stockMax || 0,
      takeAmount: c.takeAmount || 10,
      cooldown: c.cooldown || 1.25
    };
  }).filter(Boolean);
  return {
    blocks: serializeBlocks(),
    items: serializeProps(worldItems, false),
    nodes: serializeProps(resourceNodes, true),
    benches: benchData,
    containers: containerData,
    stairs: placedStairs.map(gr => ({
      x: Math.round(gr.position.x * 100) / 100,
      y: Math.round(gr.position.y * 100) / 100,
      z: Math.round(gr.position.z * 100) / 100,
      rot: Math.round((gr.rotation.y || 0) * 100) / 100
    })),
    doors: placedDoors.map(d => ({
      x: Math.round(d.position.x * 100) / 100,
      y: Math.round(d.position.y * 100) / 100,
      z: Math.round(d.position.z * 100) / 100,
      rot: Math.round((d.rotation.y || 0) * 100) / 100
    })),
    spawns: enemySpawns.map(sp => ({ x: sp.x, z: sp.z })),
    zones: (typeof worldZones !== 'undefined' ? worldZones : []).map(function (z) {
      return {
        id: z.id,
        mode: z.mode,
        x: Math.round(z.x * 100) / 100,
        z: Math.round(z.z * 100) / 100,
        radius: z.radius,
        label: z.label || null,
        enabled: !!z.enabled,
        dps: z.dps,
        hps: z.hps,
        interval: z.interval,
        maxAlive: z.maxAlive,
        activateRange: z.activateRange,
        autoSpawn: z.autoSpawn !== false
      };
    }),
    totems: totems.map(function (t) {
      return {
        x: Math.round(t.pos.x * 100) / 100,
        z: Math.round(t.pos.z * 100) / 100,
        lines: t.lines,
        role: t.role || 'lore',
        zoneId: t.zoneId != null ? t.zoneId : null,
        label: t.label || null,
        detail: t.detail || null,
        waveSpawns: t.waveSpawns || null
      };
    }),
    statics: placedStatics.map(x => ({
      k: x.kind,
      x: Math.round(x.mesh.position.x * 100) / 100,
      y: Math.round(x.mesh.position.y * 100) / 100,
      z: Math.round(x.mesh.position.z * 100) / 100,
      rot: Math.round((x.mesh.rotation.y || 0) * 100) / 100,
      w: x.w, h: x.h, d: x.d, color: x.color
    }))
  };
}
function deserializeProps(items, nodes, benches, extras) {
  clearWorldProps();
  [...workbenches].forEach(w => destroyBench(w, true));
  (Array.isArray(benches) ? benches : []).slice(0, 20).forEach(d => {
      if (typeof d.x !== 'number' || typeof d.y !== 'number' || typeof d.z !== 'number') return;
      const wb = placeWorkbench(new THREE.Vector3(d.x, d.y, d.z));
      if (wb && typeof d.hp === 'number') { wb.hp = Math.max(1, Math.min(wb.maxHp, d.hp)); updateBenchBar(wb); }
      if (wb && d.bench && typeof applyBenchUpgradeData === 'function') {
          try { applyBenchUpgradeData(wb, d.bench); } catch (e) {}
      }
  });
  try { if (typeof clearWorldContainers === 'function') clearWorldContainers(); } catch (e) {}
  const ex = extras || {};
  (Array.isArray(ex.containers) ? ex.containers : []).slice(0, 40).forEach(function (d) {
      if (!d || typeof d.x !== 'number' || typeof d.z !== 'number') return;
      if (typeof placeWorldContainer !== 'function') return;
      try {
          placeWorldContainer({
              mode: d.mode === 'dispenser' ? 'dispenser' : 'storage',
              x: d.x,
              y: (typeof d.y === 'number') ? d.y : 0,
              z: d.z,
              rotY: d.rotY || 0,
              label: d.label || undefined,
              slots: 12,
              seed: Array.isArray(d.slots) ? d.slots : undefined,
              stock: d.stock || undefined,
              stockMax: d.stockMax,
              takeAmount: d.takeAmount,
              cooldown: d.cooldown
          });
      } catch (e) {}
  });
  clearStructures();
  (Array.isArray(ex.stairs) ? ex.stairs : []).slice(0, 30).forEach(d => {
      if (typeof d.x !== 'number') return;
      placeStairs(new THREE.Vector3(d.x, (typeof d.y === 'number' ? d.y : 0.5), d.z), d.rot || 0);
  });
  (Array.isArray(ex.doors) ? ex.doors : []).slice(0, 30).forEach(d => {
      if (typeof d.x !== 'number') return;
      placeDoor(new THREE.Vector3(d.x, (typeof d.y === 'number' ? d.y : 2), d.z), d.rot || 0);
  });
  (Array.isArray(ex.spawns) ? ex.spawns : []).slice(0, 30).forEach(d => {
      if (typeof d.x !== 'number' || typeof d.z !== 'number') return;
      addEnemySpawn(d.x, d.z, true);
  });
  try { if (typeof clearWorldZones === 'function') clearWorldZones(); } catch (e) {}
  (Array.isArray(ex.zones) ? ex.zones : []).slice(0, 30).forEach(function (d) {
      if (typeof d.x !== 'number' || typeof d.z !== 'number') return;
      if (typeof placeWorldZone !== 'function') return;
      placeWorldZone({
        id: d.id,
        mode: d.mode,
        x: d.x,
        z: d.z,
        radius: d.radius,
        label: d.label,
        enabled: !!d.enabled,
        dps: d.dps,
        hps: d.hps,
        interval: d.interval,
        maxAlive: d.maxAlive,
        activateRange: d.activateRange,
        autoSpawn: d.autoSpawn !== false
      });
  });
  (Array.isArray(ex.totems) ? ex.totems : []).slice(0, 30).forEach(t => {
      if (typeof t.x !== 'number' || typeof t.z !== 'number' || !Array.isArray(t.lines)) return;
      placeTotem(t.lines.slice(0, 4), t.x, t.z, {
        role: t.role || 'lore',
        zoneId: t.zoneId != null ? t.zoneId : null,
        label: t.label || null,
        detail: t.detail || null,
        waveSpawns: t.waveSpawns || null
      });
  });
  (Array.isArray(ex.statics) ? ex.statics : []).slice(0, 30).forEach(x => {
      if (!x.k || typeof x.x !== 'number') return;
      placeStaticBox(x.k, new THREE.Vector3(x.x, (typeof x.y === 'number' ? x.y : 1), x.z), x.rot || 0,
          (x.w && x.h && x.d) ? { w: x.w, h: x.h, d: x.d } : null, x.color);
  });
  let n = 0;
  (Array.isArray(items) ? items : []).slice(0, 500).forEach(d => {
      if (typeof d.x !== 'number' || typeof d.y !== 'number' || typeof d.z !== 'number') return;
      const item = placeWorldItem(d.k, new THREE.Vector3(d.x, d.y, d.z));
      if (item) {
          if (d.a) item.userData.autoResource = true;
          n++;
      }
  });
  (Array.isArray(nodes) ? nodes : []).slice(0, 500).forEach(d => {
      if (typeof d.x !== 'number' || typeof d.y !== 'number' || typeof d.z !== 'number') return;
      const node = placeResourceNode(d.k, new THREE.Vector3(d.x, d.y, d.z));
      if (node) {
          if (d.a) node.userData.autoResource = true;
          n++;
      }
  });
  return n;
}
// --- Crafting → js/28-craft.js ---
function setCreatorMode(on) {
  creatorMode = !!on;
  if (typeof PLAYER_CONFIG !== 'undefined') {
      if (creatorMode && creatorBaseReach === null) creatorBaseReach = PLAYER_CONFIG.blockReach;
      PLAYER_CONFIG.blockReach = creatorMode ? 14 : (creatorBaseReach !== null ? creatorBaseReach : PLAYER_CONFIG.blockReach);
  }
  if (pauseUI.creatorBtn) pauseUI.creatorBtn.textContent = 'Creador: ' + (creatorMode ? 'SÍ' : 'NO');
  if (pauseUI.creatorPalette) pauseUI.creatorPalette.style.display = creatorMode ? 'block' : 'none';
  if (pauseUI.flyBtn) pauseUI.flyBtn.style.display = creatorMode ? 'inline-block' : 'none';
  if (!creatorMode && typeof player !== 'undefined' && player) player.creatorFly = false;
  if (pauseUI.flyBtn && typeof player !== 'undefined' && player && typeof player.creatorFly !== 'undefined') {
      pauseUI.flyBtn.textContent = 'Volar: ' + (player.creatorFly ? 'SÍ' : 'NO');
  }
  if (creatorMode) {
      if (typeof player !== 'undefined' && player && typeof player.creatorFly === 'undefined') player.creatorFly = true;
      registerExistingProps();
      grantCreatorHammer();
  } else {
      // Al salir del modo creador: devolver el martillo prestado y limpiar modelos huérfanos
      try {
          if (typeof player !== 'undefined' && player && player.inventory) {
              const inv = player.inventory;
              const borrowed = inv.items.filter(function (i) { return i && i.creatorOnly; });
              borrowed.forEach(function (it) {
                  try { inv.removeItem(it, it.quantity || 1); } catch (e) {}
              });
              if (borrowed.length) {
                  try {
                      const stillHammer = inv.equippedItem && inv.equippedItem.toolType === TOOLS.HAMMER;
                      if (!stillHammer || !inv.items.some(function (i) { return i.toolType === TOOLS.HAMMER; })) {
                          player.currentTool = TOOLS.HANDS;
                          inv.unequipItem();
                      } else {
                          player.setTool(TOOLS.HAMMER);
                      }
                  } catch (e) {}
                  try { player.updateToolHUD(); } catch (e) {}
                  try { inv.updateQuickSlotUI(); } catch (e) {}
                  try { updateActionButton(); } catch (e) {}
              }
          }
      } catch (e) {}
      try { if (typeof player !== 'undefined' && player) player.updateToolModelVisibility(); } catch (e) {}
      try { if (typeof detachOrphanToolModels === 'function') detachOrphanToolModels(); } catch (e) {}
  }
  try {
      enemySpawns.forEach(sp => { if (sp.marker) sp.marker.visible = creatorMode; });
  } catch (e) {}
  if (!creatorMode && typeof paletteOpen !== 'undefined' && paletteOpen) togglePalette(false);
  if (creatorMode) { renderCreatorBar(); refreshCreatorBar(); }
  else { const bar = document.getElementById('creatorBar'); if (bar) bar.style.display = 'none'; }
  try {
      const qs = document.getElementById('quickSlots');
      if (qs) qs.style.display = creatorMode ? 'none' : '';
  } catch (e) {}
  try { renderCreatorFab(); } catch (e) {}
  if (creatorGhost) creatorGhost.visible = false;
  setPauseStatus(creatorMode ? 'Modo creador: volá + construí gratis. Enemigos quietos.' : '');
}
function updateWaveManager() {
  try {
      const t = performance.now() / 1000;
      for (const tb of totems) { if (tb && tb.top) tb.top.rotation.y = t * 1.2; }
  } catch (e) {}
  if (isGamePaused) return;
  if (typeof creatorMode !== 'undefined' && creatorMode) return;
  try {
    if (typeof player !== 'undefined' && player && player.health <= 0) return; // no respawn after game over
  } catch (e) {}
  // Sin puntos de spawn, no hay oleadas (Playground arma puntos al prender el tótem).
  if (typeof enemySpawns === 'undefined' || !enemySpawns.length) { waveRespawnAt = 0; return; }
  const alive = npcs.filter((n) => n && n.health > 0).length;
  if (alive > 0) { waveRespawnAt = 0; return; }
  if (!waveRespawnAt) {
      waveRespawnAt = performance.now() + 5000;
      if (typeof showMessage === 'function') {
          showMessage(waveNumber === 0
              ? 'Primera oleada en 5s...'
              : '¡Oleada superada! La próxima en 5s...');
      }
      return;
  }
  if (performance.now() >= waveRespawnAt) {
      waveRespawnAt = 0;
      waveNumber++;
      const count = Math.min(2 + waveNumber, 6);
      const pts = enemySpawns;
      for (let k = 0; k < count; k++) {
          const sp = pts[k % pts.length];
          spawnRobot(new THREE.Vector3(sp.x + (Math.random() - 0.5) * 4, 0, sp.z + (Math.random() - 0.5) * 4));
      }
      // De vez en cuando rebrota un cluster de recursos en un punto lejano del mapa
      try {
          if (typeof spawnResourceCluster === 'function' && Math.random() < 0.6) {
              const types = ['wood', 'stone', 'metal'];
              const t = types[(Math.random() * types.length) | 0];
              const a = Math.random() * Math.PI * 2;
              const rr = 22 + Math.random() * 12;
              spawnResourceCluster(t, Math.cos(a) * rr, Math.sin(a) * rr, 3 + ((Math.random() * 3) | 0));
          }
      } catch (e) {}
      if (typeof showMessage === 'function') showMessage('¡Oleada ' + waveNumber + ': ' + count + ' enemigos en camino!');
  }
}

