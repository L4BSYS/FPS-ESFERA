// js/19-levels.js (part 19). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// ============================================================
//  Gestor de niveles / escenas
//  - Un nivel = "celda" cuadrada cerrada por 4 muros.
//  - Cada muro puede tener una PUERTA-PORTAL que lleva a otro nivel.
//  - Los niveles built-in se definen acá; los del usuario y los
//    compartidos se guardan/cargan de Firestore (snapshotScene).
// ============================================================

var LEVEL = {
  defs: {},              // id -> definición de nivel
  userLevels: [],
  sharedLevels: [],
  current: null,
  working: null,         // nivel que se está editando
  transitioning: false,
  loading: false,        // true mientras loadLevel reconstruye la escena
  transientWorld: false, // mundo de sala coop: nunca se guarda en el snapshot local
  menuOpen: false,
  menuView: 'home',
  menuBusy: false,
  tutorialDone: false
};


// DIRECTOR + tutorial steps: js/26-tutorial-director.js


var roomObjects = [];    // muros + puertas-portal de la celda actual
var roomGround = null;   // GroundTerrain de la celda actual
var levelHudEl = null;

function lvEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function lvBtn(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = 'rg-btn ' + (cls || '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
// Aviso flotante autónomo (showMessage del loop es local, no siempre disponible).
function lvToast(text) {
  try {
    const hud = document.getElementById('hud');
    if (!hud) return;
    const msg = document.createElement('div');
    msg.className = 'hud-message';
    msg.textContent = text;
    hud.appendChild(msg);
    setTimeout(function () { msg.remove(); }, 2200);
  } catch (e) {}
}

// ------------------------------------------------------------
//  Registro de niveles
// ------------------------------------------------------------
function registerLevel(def) {
  if (!def || !def.id) return def;
  LEVEL.defs[def.id] = def;
  return def;
}
function resolveLevelDef(id) {
  if (!id) return null;
  if (LEVEL.defs[id]) return LEVEL.defs[id];
  for (const l of LEVEL.userLevels) if (l.id === id) return l;
  for (const l of LEVEL.sharedLevels) if (l.id === id) return l;
  return null;
}
function defFromDoc(id, data) {
  return {
    id: id,
    name: (data && data.name) || id,
    kind: (data && data.kind) || 'user',
    size: (data && data.size) || 100,
    spawn: (data && data.spawn) || { x: 0, z: 0, rot: Math.PI },
    doors: (data && data.doors) || {},
    resetInventory: !data || data.resetInventory !== false,
    env: (data && data.env) || null,
    resourceLevel: (data && data.resourceLevel) || null,
    content: (data && data.content) || null,
    owner: data && data.owner,
    shared: !!(data && data.shared)
  };
}

// ------------------------------------------------------------
//  Construcción de la celda (piso + muros + puertas-portal)
// ------------------------------------------------------------
function buildRoom(def) {
  const size = def.size || 100;
  const wallHeight = 6, wallThickness = 1, gap = 4;
  const half = size / 2;

  roomGround = new GroundTerrain(scene, collidableObjects, { size: size + 24, color: 0x558855 });
  groundMesh = roomGround.collider;

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.8, metalness: 0.2 });
  const addBox = function (w, h, d, x, y, z, rotY, name) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat.clone());
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY || 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    mesh.userData.allowBuildingOnTop = true;
    mesh.isStatic = true;
    mesh.geometry.computeBoundingBox();
    mesh.updateMatrixWorld(true);
    mesh.userData.worldBoundingBox = new THREE.Box3().setFromObject(mesh);
    scene.add(mesh);
    collidableObjects.push(mesh);
    roomObjects.push(mesh);
    return mesh;
  };

  const doors = def.doors || {};
  ['north', 'south', 'east', 'west'].forEach(function (side) {
    const hasDoor = !!doors[side];
    const horizontal = (side === 'north' || side === 'south');
    const fixed = (side === 'north') ? -half - wallThickness / 2
      : (side === 'south') ? half + wallThickness / 2
        : (side === 'west') ? -half - wallThickness / 2
          : half + wallThickness / 2;

    if (!hasDoor) {
      if (horizontal) addBox(size + wallThickness * 2, wallHeight, wallThickness, 0, wallHeight / 2, fixed, 0, 'Wall_' + side);
      else addBox(wallThickness, wallHeight, size, fixed, wallHeight / 2, 0, 0, 'Wall_' + side);
      return;
    }

    const segLen = half - gap / 2;
    const segCenter = (half + gap / 2) / 2;
    if (horizontal) {
      addBox(segLen, wallHeight, wallThickness, -segCenter, wallHeight / 2, fixed, 0, 'Wall_' + side + '_L');
      addBox(segLen, wallHeight, wallThickness, segCenter, wallHeight / 2, fixed, 0, 'Wall_' + side + '_R');
      addPortalDoor(side, 0, fixed, 0, doors[side]);
    } else {
      addBox(wallThickness, wallHeight, segLen, fixed, wallHeight / 2, -segCenter, 0, 'Wall_' + side + '_L');
      addBox(wallThickness, wallHeight, segLen, fixed, wallHeight / 2, segCenter, 0, 'Wall_' + side + '_R');
      addPortalDoor(side, fixed, 0, Math.PI / 2, doors[side]);
    }
  });
}

function addPortalDoor(side, x, z, rotY, spec) {
  if (!spec || !spec.to) return null;
  spec = (typeof spec === 'string') ? { to: spec } : spec;
  const door = createLockedDoor(new THREE.Vector3(x, 3, z));
  // La puerta base es 2x4x0.2; la escalamos a 4x6x1 para que selle la abertura
  // (gap=4 de ancho, wallHeight=6) y que el grosor coincida con el muro.
  door.scale.set(2, 1.5, 5);
  door.updateMatrixWorld(true);
  door.rotation.y = rotY || 0;
  door.userData.portal = true;
  door.userData.doorSide = side;
  door.userData.target = { to: spec.to, spawn: spec.spawn || null };
  door.userData.targetName = spec.name || spec.to;
  if (spec.locked) {
    door.userData.locked = true;
    door.userData.requiredKey = spec.key || 'golden_key';
  } else {
    door.userData.locked = false;
    door.userData.requiredKey = null;
    try { door.material.color.setHex(0x2a7be0); } catch (e) {}
  }
  roomObjects.push(door);
  return door;
}

function createLevelItem(itemDef, x, z, y) {
  if (!itemDef || !itemDef.createModel) return null;
  const item = Object.assign({}, itemDef);
  const model = itemDef.createModel();
  model.position.set(x, (typeof y === 'number' ? y : 1), z);
  model.rotation.y = Math.PI / 4;
  model.scale.set(0.5, 0.5, 0.5);
  model.isPickupable = true;
  model.name = itemDef.id;
  model.userData = Object.assign({}, model.userData, {
    collected: false,
    itemData: item,
    itemKey: itemDef.key || itemDef.id,
    healAmount: itemDef.healAmount,
    damageAmount: itemDef.damageAmount
  });
  if (itemDef.type === 'consumable') {
    model.isCollectible = true;
    model.inContact = true;
    model.type = itemDef.id;
  }
  if (itemDef.type === 'key' && typeof decorateGoldenKey === 'function') decorateGoldenKey(model);
  scene.add(model);
  collidableObjects.push(model);
  if (typeof worldItems !== 'undefined' && !worldItems.includes(model)) worldItems.push(model);
  return model;
}

// ------------------------------------------------------------
//  Contenido de niveles built-in
// ------------------------------------------------------------
// Tutorial (DIRECTOR + pasos): js/26-tutorial-director.js
// Playground layout: js/25-playground.js

function buildWorldLevel(def) {
  const s = def.size || 160;
  const b = Math.max(24, s / 2 - 10);
  try {
    if (typeof generateWorldResources === 'function') generateWorldResources(def);
  } catch (e) { console.warn('resources', e); }

  // Referencia del spawn para orientar el tótem
  const spawn = def.spawn || { x: 0, z: 0, rot: Math.PI };
  const rot = typeof spawn.rot === 'number' ? spawn.rot : Math.PI;
  const fx = -Math.sin(rot), fz = -Math.cos(rot);
  const sx = spawn.x || 0, sz = spawn.z || 0;

  try {
    for (let i = 0; i < 4; i++) {
      addEnemySpawn(THREE.MathUtils.randFloat(-b, b), THREE.MathUtils.randFloat(-b, b), true);
    }
    spawnRobot(); spawnRobot();
  } catch (e) {}

  placeTotem(['La Grieta', 'construí tu base', 'y defendela'], sx + fx * 8, sz + fz * 8);
}

// ------------------------------------------------------------
//  Limpieza / carga de niveles
// ------------------------------------------------------------
function teardownLevel() {
  try { if (typeof clearWorldContainers === 'function') clearWorldContainers(); } catch (e) {}
  try { if (typeof clearWorldZones === 'function') clearWorldZones(); } catch (e) {}
  try { if (typeof clearNeuralFauna === 'function') clearNeuralFauna(); } catch (e) {}
  try { if (typeof cancelPlacement === 'function') cancelPlacement(true); } catch (e) {}
  try { if (typeof decayingBlocks !== 'undefined' && decayingBlocks) decayingBlocks.length = 0; } catch (e) {}
  try { clearBlocks(); } catch (e) {}
  try { clearWorldProps(); } catch (e) {}
  try { workbenches.slice().forEach(function (w) { destroyBench(w, true); }); } catch (e) {}
  try { clearStructures(); } catch (e) {}
  try {
    placedStatics.slice().forEach(function (x) {
      scene.remove(x.mesh);
      const i = collidableObjects.indexOf(x.mesh);
      if (i > -1) collidableObjects.splice(i, 1);
    });
    placedStatics.length = 0;
  } catch (e) {}
  try {
    npcs.slice().forEach(function (n) { try { n.die(); } catch (e) {} });
    npcs.length = 0;
  } catch (e) {}
  roomObjects.slice().forEach(function (o) {
    try { scene.remove(o); } catch (e) {}
    const i = collidableObjects.indexOf(o);
    if (i > -1) collidableObjects.splice(i, 1);
  });
  roomObjects = [];
  if (roomGround) {
    try {
      const i = collidableObjects.indexOf(roomGround.collider);
      if (i > -1) collidableObjects.splice(i, 1);
      roomGround.dispose();
    } catch (e) {}
    roomGround = null;
  }
  try { updateSpatialPartition(); } catch (e) {}
}

function placePlayerAt(sp) {
  if (typeof player === 'undefined' || !player) return;
  const y = player.halfHeight + 2;
  const x = (sp && typeof sp.x === 'number') ? sp.x : 0;
  const z = (sp && typeof sp.z === 'number') ? sp.z : 0;
  player.container.position.set(x, y, z);
  player.container.rotation.y = (sp && typeof sp.rot === 'number') ? sp.rot : Math.PI;
  player.velocity.set(0, 0, 0);
  player.updateColliderPosition();
  player.updateColliderBox();
  try { playerSpawnPos = player.container.position.clone(); } catch (e) {}
}

function resetPlayerInventory() {
  if (typeof player === 'undefined' || !player || !player.inventory) return;
  const inv = player.inventory;
  if (typeof inv.resetAll === 'function') inv.resetAll();
  else {
    inv.slots = new Array(INV_MAX_BAG_SLOTS).fill(null);
    inv.quickSlots = [null, null, null, null, null];
    inv.bagTier = 0;
    inv.equippedItem = null;
    inv.selectedSlot = 0;
    inv.craftedFlags = {};
    inv._keys = [];
  }
  try { player.heldItem = null; } catch (e) {}
  try { if (typeof detachOrphanToolModels === 'function') detachOrphanToolModels(); } catch (e) {}
  try { player.currentTool = TOOLS.HANDS; } catch (e) {}
  try { player.updateToolModelVisibility(); } catch (e) {}
  try { player.updateToolHUD(); } catch (e) {}
  try { inv.updateQuickSlotUI(); } catch (e) {}
  try { inv.updateAmmoUI(); } catch (e) {}
  try { inv.updateWeaponHUD(); } catch (e) {}
  try { updateResourceHUD(); } catch (e) {}
  try { updateActionButton(); } catch (e) {}
}

function updateLevelHUD(def) {
  if (!levelHudEl) {
    levelHudEl = document.createElement('div');
    levelHudEl.id = 'levelHud';
    levelHudEl.className = 'level-hud';
    document.body.appendChild(levelHudEl);
  }
  levelHudEl.textContent = '🗺 ' + (def.name || def.id);
  levelHudEl.style.display = 'block';
}

function fadeLevelTransition(cb) {
  let f = document.getElementById('levelFade');
  if (!f) {
    f = document.createElement('div');
    f.id = 'levelFade';
    f.className = 'level-fade';
    document.body.appendChild(f);
  }
  f.style.display = 'block';
  // force reflow then fade in
  void f.offsetWidth;
  f.style.opacity = '1';
  setTimeout(function () {
    try { cb(); } catch (e) { console.error(e); }
    setTimeout(function () {
      f.style.opacity = '0';
      setTimeout(function () { f.style.display = 'none'; }, 420);
    }, 80);
  }, 340);
}

// ------------------------------------------------------------
//  Snapshots por nivel de campaña (base, cofres y recursos)
//  Se guardan al salir de un mundo y al cerrar la pestaña para que
//  la base vuelva a aparecer al regresar por una puerta.
// ------------------------------------------------------------
function levelSnapshotKey(id) {
  return 'lagrieta_level_snapshot_' + id;
}
function levelSnapshotEligible(def) {
  return !!(def && def.kind === 'campaign' && def.id);
}
function saveLevelSnapshot(id) {
  if (!id || typeof snapshotScene !== 'function') return false;
  // Los mundos de sala coop son efímeros: jamás deben pisar la partida local.
  if (typeof LEVEL !== 'undefined' && LEVEL && LEVEL.transientWorld) return false;
  if (typeof tutorialDone === 'function' && !tutorialDone()) return false;
  const def = resolveLevelDef(id);
  if (!levelSnapshotEligible(def)) return false;
  try {
    const data = snapshotScene();
    localStorage.setItem(levelSnapshotKey(id), JSON.stringify({ v: 1, ts: Date.now(), data: data }));
    return true;
  } catch (e) {
    console.warn('No pude guardar el snapshot del nivel', id, e);
    return false;
  }
}
function restoreLevelSnapshot(id) {
  if (!id || typeof applySceneData !== 'function') return false;
  if (typeof tutorialDone === 'function' && !tutorialDone()) return false;
  const def = resolveLevelDef(id);
  if (!levelSnapshotEligible(def)) return false;
  let raw = null;
  try { raw = localStorage.getItem(levelSnapshotKey(id)); } catch (e) { return false; }
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw);
    if (!saved || saved.v !== 1 || !saved.data) return false;
    applySceneData(saved.data);
    return true;
  } catch (e) {
    console.warn('No pude restaurar el snapshot del nivel', id, e);
    return false;
  }
}
function _installLevelSnapshotHooks() {
  if (typeof window === 'undefined' || window.__lagrietaLevelSnapshotHooked) return;
  window.__lagrietaLevelSnapshotHooked = true;
  window.addEventListener('beforeunload', function () {
    try {
      if (typeof LEVEL !== 'undefined' && LEVEL && LEVEL.current) saveLevelSnapshot(LEVEL.current);
    } catch (e) {}
  });
}

function loadLevel(id, opts) {
  opts = opts || {};
  const def = resolveLevelDef(id);
  if (!def) { try { lvToast('No encontré el mundo: ' + id); } catch (e) {} return; }
  LEVEL.transitioning = false;
  LEVEL.loading = true;
  // Semilla determinista para salas coop: todos los clientes generan el mismo mundo.
  const seedNum = (opts.seed != null && isFinite(Number(opts.seed))) ? (Number(opts.seed) >>> 0) : null;
  let restoreRandom = null;
  if (seedNum != null) {
    const originalRandom = Math.random;
    let s = seedNum || 1;
    Math.random = function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    restoreRandom = function () { Math.random = originalRandom; };
  }
  try {
    // Guardamos cómo quedó el mundo anterior (base, cofres, recursos) sólo si era local.
    if (LEVEL.current && !LEVEL.transientWorld) saveLevelSnapshot(LEVEL.current);
    LEVEL.transientWorld = !!opts.transientWorld;
    try { if (typeof resetDirector === 'function') resetDirector(); } catch (e) {}
    teardownLevel();
    buildRoom(def);
    if (typeof def.build === 'function') {
      try { def.build(def); } catch (e) { console.error('build level ' + def.id, e); }
    } else if (def.content) {
      try { applySceneData(def.content); } catch (e) { console.error('apply content ' + def.id, e); }
    }
    // Si ya visitamos este mundo de campaña, volvemos a poner lo construido.
    // En una sala coop el mundo lo manda el host: opts.skipRestore evita mezclar la base local.
    if (!opts.skipRestore) {
      try { restoreLevelSnapshot(def.id); } catch (e) { console.warn('restore snapshot', e); }
    }
    // Ambiente (cielo / luz / oscuridad) y fauna neuronal del mundo
    try { if (typeof applyLevelAmbience === 'function') applyLevelAmbience(def); } catch (e) {}
    // Tutorial paso 0: patio apagado — sin fauna hasta que el director la prenda.
    if (!(def.kind === 'tutorial' || DIRECTOR.active)) {
      try { if (typeof spawnNeuralFauna === 'function') spawnNeuralFauna(def); } catch (e) {}
    }
    placePlayerAt(opts.spawn || def.spawn);

    const carryInventory = opts.preserveInventory === true;
    if (!carryInventory && def.resetInventory !== false) resetPlayerInventory();
    // Al recargar la página después del tutorial, recuperamos la mochila guardada.
    if (!carryInventory && def.kind !== 'tutorial' && typeof player !== 'undefined' && player &&
        player.inventory && typeof player.inventory.restoreProfile === 'function') {
      try { player.inventory.restoreProfile(); } catch (e) {}
    }

    LEVEL.current = def.id;
    try { if (typeof netSetLevel === 'function') netSetLevel(def.id); } catch (e) {}
    try { localStorage.setItem('lagrieta_last_level', def.id); } catch (e) {}
    updateLevelHUD(def);

    isGamePaused = false;
    hideMainMenu();
    try { if (typeof pauseMenu !== 'undefined' && pauseMenu) pauseMenu.style.display = 'none'; } catch (e) {}
    try { if (typeof refreshBuildBarVisibility === 'function') refreshBuildBarVisibility(); } catch (e) {}
    try { updateResourceHUD(); } catch (e) {}
    try { lockPointer(); } catch (e) {}
    try { lvToast('📍 ' + def.name); } catch (e) {}
  } finally {
    LEVEL.loading = false;
    if (restoreRandom) restoreRandom();
  }
  // Recién acá la mochila queda marcada como persistente y se guarda.
  if (opts.from === 'tutorial' && def.id !== 'tutorial') markTutorialDone();
}

// Inicia la PARTIDA en un mundo: desactiva modo creador y estado de edición.
function playLevel(id, opts) {
  try { if (typeof creatorMode !== 'undefined' && creatorMode && typeof setCreatorMode === 'function') setCreatorMode(false); } catch (e) {}
  LEVEL.working = null;
  loadLevel(id, opts);
}

// Al llegar por una puerta, aparece del otro lado de ESA puerta mirando al
// centro del mundo, para que se entienda por dónde entró y ver la próxima.
function arrivalSpawn(def, fromId) {
  if (!def) return null;
  const half = (def.size || 100) / 2;
  const inset = 3;
  const doors = def.doors || {};
  let side = null;
  ['north', 'south', 'east', 'west'].forEach(function (s) {
    if (side || !doors[s]) return;
    const d = doors[s];
    const to = (typeof d === 'string') ? d : d.to;
    if (to === fromId) side = s;
  });
  // Si no hay puerta que conecte con el origen, usar una puerta al azar.
  if (!side) {
    side = ['north', 'south', 'east', 'west'].filter(function (s) { return !!doors[s]; })[0] || null;
  }
  if (!side) return null;
  if (side === 'north') return { x: 0, z: -(half - inset), rot: Math.PI };
  if (side === 'south') return { x: 0, z: (half - inset), rot: 0 };
  if (side === 'west') return { x: -(half - inset), z: 0, rot: -Math.PI / 2 };
  return { x: (half - inset), z: 0, rot: Math.PI / 2 }; // east
}

function goThroughDoor(door) {
  if (LEVEL.transitioning) return;
  const spec = door && door.userData && door.userData.target;
  if (!spec || !spec.to) return;
  LEVEL.transitioning = true;
  const from = LEVEL.current;
  const dest = spec.to;
  const spawn = spec.spawn || arrivalSpawn(resolveLevelDef(dest), from) || null;
  try { playSound('door_open'); } catch (e) {}
  fadeLevelTransition(function () {
    loadLevel(dest, { spawn: spawn, from: from, preserveInventory: true });
  });
}

// ------------------------------------------------------------
//  Progreso (tutorial → login → crear mundo)
// ------------------------------------------------------------
function tutorialDone() {
  try { return localStorage.getItem('lagrieta_tutorial_done') === '1'; } catch (e) { return false; }
}
function markTutorialDone() {
  try { localStorage.setItem('lagrieta_tutorial_done', '1'); } catch (e) {}
  LEVEL.tutorialDone = true;
  // A partir de acá la mochila y las herramientas sobreviven a los cambios de mundo.
  try {
    if (typeof player !== 'undefined' && player && player.inventory &&
        typeof player.inventory.saveProfile === 'function') player.inventory.saveProfile();
  } catch (e) {}
  setTimeout(function () { try { showTutorialReward(); } catch (e) {} }, 900);
}
function showTutorialReward() {
  let m = document.getElementById('tutorialReward');
  if (!m) {
    m = document.createElement('div');
    m.id = 'tutorialReward';
    m.className = 'rg-overlay';
    document.body.appendChild(m);
  }
  m.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'rg-panel rg-modalbox narrow';
  panel.style.textAlign = 'center';
  const h = document.createElement('h2');
  h.className = 'rg-title';
  h.textContent = '🎉 ¡COMPLETASTE EL TUTORIAL!';
  panel.appendChild(h);

  const user = currentUser();
  const p = document.createElement('div');
  p.className = 'rg-hint';
  p.style.margin = '10px 0';
  p.textContent = user
    ? ('Sesión: ' + (user.displayName || user.email || 'tu cuenta') + '. Elegí cómo seguir.')
    : 'Ingresá con Google para guardar y publicar tus mundos, o seguí explorando sin cuenta.';
  panel.appendChild(p);

  const close = function () {
    m.style.display = 'none';
    isGamePaused = false;
    try { lockPointer(); } catch (e) {}
  };
  const play = function (id) {
    m.style.display = 'none';
    isGamePaused = false;
    playLevel(id);
  };

  const row = document.createElement('div');
  row.className = 'rg-menubtns';
  row.appendChild(lvBtn('▶ Continuar (La Grieta)', 'rg-btn-primary', function () { play('mundo-1'); }));
  row.appendChild(lvBtn('🗺 Mis mundos', '', function () {
    m.style.display = 'none';
    isGamePaused = true;
    showMainMenu('mine');
  }));
  row.appendChild(lvBtn('➕ Crear mundo', '', function () {
    m.style.display = 'none';
    isGamePaused = true;
    showMainMenu('create');
  }));
  panel.appendChild(row);

  const row2 = document.createElement('div');
  row2.className = 'rg-menubtns';
  row2.style.marginTop = '10px';
  if (!user) {
    row2.appendChild(lvBtn('Ingresar con Google', 'rg-btn-primary', function () { lvLogin(); }));
  }
  row2.appendChild(lvBtn('Seguir explorando', user ? '' : 'rg-btn-primary', close));
  panel.appendChild(row2);

  m.appendChild(panel);
  isGamePaused = true;
  try { document.exitPointerLock(); } catch (e) {}
  m.style.display = 'flex';
}

// ------------------------------------------------------------
//  Firestore
// ------------------------------------------------------------
function fbReady() {
  return !!(window.firebase && firebase.auth && firebase.firestore && firebase.apps && firebase.apps.length);
}
function currentUser() {
  try { return (fbReady() && firebase.auth().currentUser) || null; } catch (e) { return null; }
}
function fpsLevelsCol(uid) {
  return firebase.firestore().collection('fps').doc('levels').collection(uid);
}
function fpsSharedLevelsCol() {
  return firebase.firestore().collection('fpsSharedLevels');
}
function lvLogin() {
  if (!fbReady()) { try { lvToast('El login se está cargando...'); } catch (e) {} return; }
  const provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider).catch(function (e) {
    console.error('login popup', e);
    try { firebase.auth().signInWithRedirect(provider); } catch (err) {}
  });
}
function lvLogout() {
  if (fbReady() && firebase.auth) firebase.auth().signOut().catch(function (e) { console.error(e); });
}
async function fsListUserLevels() {
  const user = currentUser();
  if (!user) return [];
  const snap = await fpsLevelsCol(user.uid).orderBy('updatedAt', 'desc').limit(50).get();
  const out = [];
  snap.forEach(function (doc) { out.push(defFromDoc(doc.id, doc.data())); });
  return out;
}
async function fsListSharedLevels() {
  const snap = await fpsSharedLevelsCol().orderBy('updatedAt', 'desc').limit(50).get();
  const out = [];
  snap.forEach(function (doc) { out.push(defFromDoc(doc.id, doc.data())); });
  return out;
}
async function fsSaveWorking() {
  const user = currentUser();
  if (!user) throw new Error('login');
  const w = LEVEL.working;
  if (!w) throw new Error('sin nivel');
  w.content = snapshotScene();
  const total = objectCount(w.content);
  if (total > 2000) throw new Error('muy grande (máx 2000)');
  await fpsLevelsCol(user.uid).doc(w.id).set({
    name: w.name, kind: 'user', size: w.size, spawn: w.spawn, doors: w.doors,
    resetInventory: w.resetInventory !== false, env: w.env || null, resourceLevel: w.resourceLevel || null, content: w.content,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(), owner: user.uid
  }, { merge: true });
  registerLevel(w);
  return w;
}
async function fsPublishWorking() {
  const user = currentUser();
  if (!user) throw new Error('login');
  const w = LEVEL.working;
  if (!w) throw new Error('sin nivel');
  w.content = snapshotScene();
  const total = objectCount(w.content);
  if (total > 2000) throw new Error('muy grande (máx 2000)');
  await fpsSharedLevelsCol().doc(w.id).set({
    name: w.name, kind: 'shared', size: w.size, spawn: w.spawn, doors: w.doors,
    resetInventory: w.resetInventory !== false, env: w.env || null, resourceLevel: w.resourceLevel || null, content: w.content, shared: true,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(), owner: user.uid,
    updatedByName: user.displayName || (user.email ? user.email.split('@')[0] : 'alguien')
  }, { merge: true });
  return w;
}
async function fsDownloadShared(id) {
  const snap = await fpsSharedLevelsCol().doc(id).get();
  if (!snap.exists) throw new Error('no existe');
  const def = defFromDoc(id, snap.data());
  registerLevel(def);
  if (!LEVEL.sharedLevels.find(function (l) { return l.id === id; })) LEVEL.sharedLevels.push(def);
  return def;
}
function objectCount(snap) {
  if (!snap) return 0;
  return (snap.blocks || []).length + (snap.items || []).length + (snap.nodes || []).length +
    (snap.benches || []).length + (snap.stairs || []).length + (snap.doors || []).length +
    (snap.spawns || []).length + (snap.statics || []).length + (snap.totems || []).length;
}

// ------------------------------------------------------------
//  Menú principal / gestor de niveles
// ------------------------------------------------------------
function mainMenuEl() {
  let m = document.getElementById('mainMenu');
  if (!m) {
    m = document.createElement('div');
    m.id = 'mainMenu';
    m.className = 'rg-overlay';
    document.body.appendChild(m);
  }
  return m;
}
function showMainMenu(view) {
  LEVEL.menuOpen = true;
  LEVEL.menuView = view || 'home';
  isGamePaused = true;
  try { document.exitPointerLock(); } catch (e) {}
  try { if (typeof pauseMenu !== 'undefined' && pauseMenu) pauseMenu.style.display = 'none'; } catch (e) {}
  mainMenuEl().style.display = 'flex';
  renderMainMenu();
  refreshMenuLevels();
}
function hideMainMenu() {
  LEVEL.menuOpen = false;
  const m = document.getElementById('mainMenu');
  if (m) m.style.display = 'none';
}
function renderMainMenu() {
  const m = mainMenuEl();
  m.innerHTML = '';
  const shell = document.createElement('div');
  shell.className = 'rg-panel rg-shell rg-menu-shell';

  // ---- Barra lateral de opciones ----
  const rail = document.createElement('aside');
  rail.className = 'rg-rail';
  const brand = document.createElement('div');
  brand.className = 'rg-rail-brand';
  brand.textContent = 'LA GRIETA';
  rail.appendChild(brand);
  const sub = document.createElement('div');
  sub.className = 'rg-rail-sub';
  sub.textContent = 'FPS · SUPERVIVENCIA';
  rail.appendChild(sub);

  const nav = document.createElement('nav');
  nav.className = 'rg-rail-nav';
  [
    ['home', '▶', 'Jugar'],
    ['mine', '🗺', 'Mis mundos'],
    ['online', '👥', 'Con amigos'],
    ['community', '🌐', 'Comunidad'],
    ['create', '➕', 'Crear mundo']
  ].forEach(function (item) {
    const view = item[0], icon = item[1], label = item[2];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rg-rail-btn' + (LEVEL.menuView === view || (view === 'home' && LEVEL.menuView === 'start') || (view === 'mine' && LEVEL.menuView === 'editorial') ? ' on' : '');
    b.innerHTML = '<span class="rg-rail-ico">' + icon + '</span><span>' + label + '</span>';
    b.addEventListener('click', function () {
      LEVEL.menuView = view;
      renderMainMenu();
      if (view === 'mine' || view === 'community') refreshMenuLevels();
    });
    nav.appendChild(b);
  });
  rail.appendChild(nav);

  const foot = document.createElement('div');
  foot.className = 'rg-rail-foot';
  const u = currentUser();
  const who = document.createElement('div');
  who.className = 'rg-rail-user';
  who.textContent = u ? ('👤 ' + (u.displayName || u.email || u.uid)) : 'Modo invitado';
  foot.appendChild(who);
  const authBtn = document.createElement('button');
  authBtn.type = 'button';
  authBtn.className = 'rg-rail-btn' + (u ? '' : ' rg-rail-primary');
  authBtn.innerHTML = '<span class="rg-rail-ico">' + (u ? '⎋' : '🔑') + '</span><span>' + (u ? 'Cerrar sesión' : 'Ingresar') + '</span>';
  authBtn.addEventListener('click', function () { if (u) lvLogout(); else lvLogin(); });
  foot.appendChild(authBtn);
  rail.appendChild(foot);
  shell.appendChild(rail);

  // ---- Contenido ----
  const main = document.createElement('main');
  main.className = 'rg-shell-main';
  main.appendChild(mainMenuHeader());
  const body = document.createElement('div');
  body.id = 'mainMenuBody';
  body.className = 'rg-shell-body';
  main.appendChild(body);
  shell.appendChild(main);
  m.appendChild(shell);

  if (LEVEL.menuView === 'mine') renderMine(body);
  else if (LEVEL.menuView === 'online') renderOnlineMenu(body);
  else if (LEVEL.menuView === 'community') renderCommunity(body);
  else if (LEVEL.menuView === 'create') renderCreateForm(body);
  else if (LEVEL.menuView === 'editorial') renderEditorView(body);
  else renderHome(body);
}
function mainMenuHeader() {
  const head = document.createElement('div');
  head.className = 'rg-shell-head';
  const title = document.createElement('h2');
  title.className = 'rg-title';
  const labels = { home: 'Jugar', start: 'Jugar', mine: 'Mis mundos', online: 'Jugar con amigos', community: 'Comunidad', create: 'Crear mundo', editorial: 'Editar mundo' };
  title.textContent = labels[LEVEL.menuView] || 'LA GRIETA';
  head.appendChild(title);
  const who = document.createElement('div');
  who.className = 'rg-hint';
  const u = currentUser();
  who.textContent = u ? ('Sesión: ' + (u.displayName || u.email || u.uid)) : 'Modo invitado · podés jugar el tutorial';
  head.appendChild(who);
  return head;
}
function renderHome(body) {
  const hero = document.createElement('div');
  hero.className = 'rg-home-hero';
  const kicker = document.createElement('div');
  kicker.className = 'rg-home-kicker';
  kicker.textContent = 'La Grieta · FPS de supervivencia';
  hero.appendChild(kicker);
  const title = document.createElement('div');
  title.className = 'rg-home-title';
  title.textContent = 'SOBREVIVÍ. CONSTRUÍ. DEFENDÉ.';
  hero.appendChild(title);
  const desc = document.createElement('div');
  desc.className = 'rg-home-desc';
  desc.textContent = 'Explorá mundos abiertos, juntá recursos, crafteá herramientas y levantá tu base antes de que caiga la noche.';
  hero.appendChild(desc);

  const actions = document.createElement('div');
  actions.className = 'rg-home-actions';
  actions.appendChild(lvBtn('▶ Jugar solo', 'rg-btn-primary', function () { playLevel('mundo-1'); }));
  actions.appendChild(lvBtn('👥 Jugar con amigos', 'rg-btn-primary', function () {
    if (typeof onlineOpenMenu === 'function') onlineOpenMenu();
    else try { lvToast('El modo online se está cargando…'); } catch (e) {}
  }));
  actions.appendChild(lvBtn('🗺 Mis mundos', '', function () { showMainMenu('mine'); }));
  actions.appendChild(lvBtn('🎓 Tutorial', '', function () { playLevel('tutorial'); }));
  actions.appendChild(lvBtn('🧪 Playground', '', function () { playLevel('playground'); }));
  hero.appendChild(actions);

  const modeNote = document.createElement('div');
  modeNote.className = 'rg-hint';
  modeNote.style.marginTop = '12px';
  modeNote.innerHTML = '<b>Jugar solo</b> usa tu partida y tus mundos guardados en este navegador. ' +
    '<b>Jugar con amigos</b> abre una sala coop de 2 a 5 jugadores con código o link de invitación.';
  hero.appendChild(modeNote);
  body.appendChild(hero);

  const grid = document.createElement('div');
  grid.className = 'rg-home-grid';

  const last = getLastLevelId();
  const lastDef = last ? resolveLevelDef(last) : null;
  if (lastDef) {
    const card = document.createElement('div');
    card.className = 'rg-home-card';
    card.innerHTML = '<h3>Último mundo</h3><p>' + lvEsc(lastDef.name) + '</p>';
    grid.appendChild(card);
  }
  if (LEVEL.working) {
    const w = LEVEL.working;
    const card = document.createElement('div');
    card.className = 'rg-home-card';
    card.innerHTML = '<h3>En edición</h3><p>' + lvEsc(w.name || 'Sin nombre') + '</p>';
    const row = document.createElement('div');
    row.className = 'rg-menubtns';
    row.style.justifyContent = 'flex-start';
    row.appendChild(lvBtn('💾 Guardar', 'rg-btn-small rg-btn-primary', function () { saveWorkingFromPause(false); }));
    row.appendChild(lvBtn('✎ Editar', 'rg-btn-small', function () { LEVEL.menuView = 'editorial'; renderMainMenu(); }));
    card.appendChild(row);
    grid.appendChild(card);
  }
  const help = document.createElement('div');
  help.className = 'rg-home-card';
  help.innerHTML = '<h3>Progresión</h3><p>Martillo → mesa → pico → pistola. El árbol de tecnología del menú de pausa muestra el camino completo.</p>';
  grid.appendChild(help);
  body.appendChild(grid);

  if (!tutorialDone()) {
    const note = document.createElement('div');
    note.className = 'rg-hint';
    note.style.marginTop = '12px';
    note.textContent = 'Tip: el tutorial te enseña a juntar recursos, craftear y levantar tu primera base.';
    body.appendChild(note);
  }
}
// Entrada única al multijugador: crear sala, unirse por código o gestionar
// la sala activa. Vive en el menú principal (no en el menú de pausa) para que
// "Jugar con amigos" sea un destino claro y no un truco de pausa.
function renderOnlineMenu(body) {
  const hero = document.createElement('div');
  hero.className = 'rg-home-hero';
  const kicker = document.createElement('div');
  kicker.className = 'rg-home-kicker';
  kicker.textContent = 'Multijugador cooperativo';
  hero.appendChild(kicker);
  const title = document.createElement('div');
  title.className = 'rg-home-title';
  title.textContent = 'JUGÁ CON AMIGOS';
  hero.appendChild(title);
  const desc = document.createElement('div');
  desc.className = 'rg-home-desc';
  desc.innerHTML = 'Creá una sala y compartí el <b>código</b> o el <b>link</b>. ' +
    'La partida corre en el mundo del host y se sincroniza por Firebase: no hace falta servidor dedicado. ' +
    'Para jugar solo, volvé a <b>Jugar</b> o <b>Mis mundos</b>.';
  hero.appendChild(desc);
  body.appendChild(hero);

  // --- Estado de sesión ---
  const auth = document.createElement('div');
  auth.id = 'mmOnlineAuth';
  auth.className = 'rg-section';
  auth.style.marginTop = '12px';
  const authHint = document.createElement('div');
  authHint.id = 'mmOnlineAuthHint';
  authHint.className = 'rg-hint';
  auth.appendChild(authHint);
  const authBtn = document.createElement('button');
  authBtn.id = 'mmOnlineLoginBtn';
  authBtn.type = 'button';
  authBtn.className = 'rg-btn rg-btn-small rg-btn-primary';
  authBtn.textContent = 'Ingresar con Google';
  authBtn.addEventListener('click', function () { lvLogin(); });
  auth.appendChild(authBtn);
  body.appendChild(auth);

  // --- Crear / unirse ---
  const setup = document.createElement('div');
  setup.id = 'mmOnlineSetup';
  setup.className = 'rg-home-grid';
  setup.style.marginTop = '14px';

  const createCard = document.createElement('div');
  createCard.className = 'rg-home-card';
  const createTitle = document.createElement('h3');
  createTitle.textContent = 'Crear sala';
  createCard.appendChild(createTitle);
  const createDesc = document.createElement('p');
  createDesc.textContent = 'Vos sos el host. Elegí el mundo, creá la sala y pasale el código a tus amigos.';
  createCard.appendChild(createDesc);
  const levelRow = document.createElement('div');
  levelRow.className = 'rg-menubtns';
  levelRow.style.justifyContent = 'flex-start';
  levelRow.style.marginTop = '8px';
  const levelSel = document.createElement('select');
  levelSel.id = 'mmOnlineLevel';
  levelSel.className = 'rg-select';
  const defs = (typeof LEVEL !== 'undefined' && LEVEL.defs) ? LEVEL.defs : {};
  Object.keys(defs).forEach(function (id) {
    const def = defs[id];
    if (!def || def.kind === 'user' || def.shared || def.kind === 'tutorial') return;
    const o = document.createElement('option');
    o.value = id;
    o.textContent = def.name || id;
    levelSel.appendChild(o);
  });
  if (!levelSel.options.length) {
    const o = document.createElement('option');
    o.value = 'mundo-1';
    o.textContent = 'La Grieta';
    levelSel.appendChild(o);
  }
  levelSel.value = 'mundo-1';
  levelRow.appendChild(levelSel);
  createCard.appendChild(levelRow);
  const createRow = document.createElement('div');
  createRow.className = 'rg-menubtns';
  createRow.style.justifyContent = 'flex-start';
  const createBtn = document.createElement('button');
  createBtn.id = 'mmOnlineCreateBtn';
  createBtn.type = 'button';
  createBtn.className = 'rg-btn rg-btn-small rg-btn-primary';
  createBtn.textContent = 'Crear sala';
  createBtn.addEventListener('click', function () {
    const id = levelSel.value || 'mundo-1';
    try { onlineCreateRoom({ levelId: id }); } catch (e) {}
  });
  createRow.appendChild(createBtn);
  createCard.appendChild(createRow);
  setup.appendChild(createCard);

  const joinCard = document.createElement('div');
  joinCard.className = 'rg-home-card';
  const joinTitle = document.createElement('h3');
  joinTitle.textContent = 'Unirme a una sala';
  joinCard.appendChild(joinTitle);
  const joinDesc = document.createElement('p');
  joinDesc.textContent = 'Pegá el código de 6 caracteres que te pasó el host, o abrí el link de invitación.';
  joinCard.appendChild(joinDesc);
  const joinRow = document.createElement('div');
  joinRow.className = 'rg-menubtns';
  joinRow.style.justifyContent = 'flex-start';
  joinRow.style.marginTop = '8px';
  const joinInput = document.createElement('input');
  joinInput.id = 'mmOnlineJoinCode';
  joinInput.type = 'text';
  joinInput.maxLength = 6;
  joinInput.placeholder = 'CÓDIGO';
  joinInput.autocomplete = 'off';
  joinInput.className = 'rg-select';
  joinInput.style.width = '130px';
  joinInput.style.textTransform = 'uppercase';
  joinInput.addEventListener('keydown', function (ev) {
    ev.stopPropagation();
    if (ev.key === 'Enter') { try { onlineJoinFromMenuInput(); } catch (e) {} }
  });
  const joinBtn = document.createElement('button');
  joinBtn.id = 'mmOnlineJoinBtn';
  joinBtn.type = 'button';
  joinBtn.className = 'rg-btn rg-btn-small';
  joinBtn.textContent = 'Unirme';
  joinBtn.addEventListener('click', function () { try { onlineJoinFromMenuInput(); } catch (e) {} });
  joinRow.appendChild(joinInput);
  joinRow.appendChild(joinBtn);
  joinCard.appendChild(joinRow);
  setup.appendChild(joinCard);
  body.appendChild(setup);

  // --- Sala activa ---
  const panel = document.createElement('div');
  panel.id = 'mmOnlinePanel';
  panel.className = 'rg-home-card';
  panel.style.display = 'none';
  panel.style.marginTop = '14px';
  const panelTitle = document.createElement('h3');
  panelTitle.textContent = 'Tu sala';
  panel.appendChild(panelTitle);
  const codeRow = document.createElement('div');
  codeRow.className = 'rg-stats';
  codeRow.innerHTML = 'Código: <b id="mmOnlineCode">—</b> ';
  const copyCode = document.createElement('button');
  copyCode.type = 'button';
  copyCode.className = 'rg-btn rg-btn-small';
  copyCode.textContent = 'Copiar código';
  copyCode.addEventListener('click', function () { try { onlineCopyCode(); } catch (e) {} });
  codeRow.appendChild(copyCode);
  const copyInvite = document.createElement('button');
  copyInvite.type = 'button';
  copyInvite.className = 'rg-btn rg-btn-small rg-btn-primary';
  copyInvite.textContent = 'Copiar link';
  copyInvite.addEventListener('click', function () { try { onlineCopyInvite(); } catch (e) {} });
  codeRow.appendChild(copyInvite);
  panel.appendChild(codeRow);
  const roleEl = document.createElement('div');
  roleEl.id = 'mmOnlineRole';
  roleEl.className = 'rg-hint';
  panel.appendChild(roleEl);
  const stateEl = document.createElement('div');
  stateEl.id = 'mmOnlineState';
  stateEl.className = 'rg-stats';
  panel.appendChild(stateEl);
  const playersEl = document.createElement('div');
  playersEl.id = 'mmOnlinePlayers';
  playersEl.className = 'rg-hint';
  panel.appendChild(playersEl);
  const actionsRow = document.createElement('div');
  actionsRow.className = 'rg-menubtns';
  actionsRow.style.justifyContent = 'flex-start';
  actionsRow.style.marginTop = '10px';
  const readyBtn = document.createElement('button');
  readyBtn.id = 'mmOnlineReadyBtn';
  readyBtn.type = 'button';
  readyBtn.className = 'rg-btn rg-btn-small';
  readyBtn.textContent = 'Estoy listo';
  readyBtn.addEventListener('click', function () { try { onlineSetReady(); } catch (e) {} });
  const startBtn = document.createElement('button');
  startBtn.id = 'mmOnlineStartBtn';
  startBtn.type = 'button';
  startBtn.className = 'rg-btn rg-btn-small rg-btn-primary';
  startBtn.textContent = 'Iniciar partida';
  startBtn.addEventListener('click', function () { try { onlineStartGame(); } catch (e) {} });
  const enterBtn = document.createElement('button');
  enterBtn.id = 'mmOnlineEnterBtn';
  enterBtn.type = 'button';
  enterBtn.className = 'rg-btn rg-btn-small rg-btn-primary';
  enterBtn.textContent = 'Volver al juego';
  enterBtn.style.display = 'none';
  enterBtn.addEventListener('click', function () { try { onlineEnterGame(); } catch (e) {} });
  const leaveBtn = document.createElement('button');
  leaveBtn.id = 'mmOnlineLeaveBtn';
  leaveBtn.type = 'button';
  leaveBtn.className = 'rg-btn rg-btn-small rg-btn-danger';
  leaveBtn.textContent = 'Salir de la sala';
  leaveBtn.addEventListener('click', function () { try { onlineLeaveRoom(); } catch (e) {} });
  actionsRow.appendChild(readyBtn);
  actionsRow.appendChild(startBtn);
  actionsRow.appendChild(enterBtn);
  actionsRow.appendChild(leaveBtn);
  panel.appendChild(actionsRow);
  body.appendChild(panel);

  const footNote = document.createElement('div');
  footNote.className = 'rg-hint';
  footNote.style.marginTop = '12px';
  footNote.textContent = 'Mientras esperás en el lobby podés seguir en el menú. Cuando el host inicia, todos entran juntos al mismo mundo.';
  body.appendChild(footNote);

  setTimeout(function () { try { onlineRefreshUI(); } catch (e) {} }, 60);
}

function renderMine(body) {
  const localHint = document.createElement('div');
  localHint.className = 'rg-hint';
  localHint.style.marginBottom = '8px';
  localHint.innerHTML = 'Tus mundos guardados para jugar solo. Para una sala coop en vivo, usá <b>Con amigos</b>.';
  body.appendChild(localHint);
  if (!currentUser()) {
    const h = document.createElement('div');
    h.className = 'rg-hint';
    h.textContent = 'Ingresá con Google para ver y guardar tus mundos.';
    body.appendChild(h);
    body.appendChild(lvBtn('Ingresar con Google', 'rg-btn-primary', function () { lvLogin(); }));
    return;
  }
  const tools = document.createElement('div');
  tools.className = 'rg-menubtns';
  tools.appendChild(lvBtn('➕ Crear mundo', 'rg-btn-primary', function () { LEVEL.menuView = 'create'; renderMainMenu(); }));
  tools.appendChild(lvBtn('🔄 Actualizar', 'rg-btn-small', function () { refreshMenuLevels(true); }));
  body.appendChild(tools);

  const list = document.createElement('div');
  list.id = 'mineList';
  body.appendChild(list);
  if (LEVEL.menuBusy) { list.textContent = 'Cargando...'; return; }

  // Mundo en edición sin guardar (para que no "desaparezca")
  let hasAny = false;
  if (LEVEL.working && !LEVEL.userLevels.some(function (l) { return l.id === LEVEL.working.id; })) {
      const w = LEVEL.working;
      const card = document.createElement('div');
      card.className = 'rg-card';
      const name = document.createElement('span');
      name.className = 'rg-card-name';
      name.textContent = '🆕 ' + (w.name || 'sin nombre') + ' · sin guardar';
      card.appendChild(name);
      card.appendChild(lvBtn('💾 Guardar', 'rg-btn-small rg-btn-primary', function () { saveWorkingFromPause(false); }));
      card.appendChild(lvBtn('✎', 'rg-btn-small', function () { LEVEL.menuView = 'editorial'; renderMainMenu(); }));
      list.appendChild(card);
      hasAny = true;
  }

  LEVEL.userLevels.forEach(function (def) { list.appendChild(levelCard(def, 'user')); hasAny = true; });
  if (!hasAny) list.innerHTML = '<div class="rg-hint">Todavía no tenés mundos. Creá uno.</div>';
}
function renderCommunity(body) {
  const communityHint = document.createElement('div');
  communityHint.className = 'rg-hint';
  communityHint.style.marginBottom = '8px';
  communityHint.innerHTML = 'Mundos publicados para jugar cuando quieras. Para salas coop en vivo, usá <b>Con amigos</b>.';
  body.appendChild(communityHint);
  if (!fbReady()) {
    const h = document.createElement('div');
    h.className = 'rg-hint';
    h.textContent = 'Los servicios online se están cargando...';
    body.appendChild(h);
    return;
  }
  if (!currentUser()) {
    const h = document.createElement('div');
    h.className = 'rg-hint';
    h.textContent = 'Ingresá con Google para ver y jugar mundos de la Comunidad.';
    body.appendChild(h);
    body.appendChild(lvBtn('Ingresar con Google', 'rg-btn-primary', function () { lvLogin(); }));
    return;
  }
  const tools = document.createElement('div');
  tools.className = 'rg-menubtns';
  tools.appendChild(lvBtn('🔄 Actualizar', 'rg-btn-small', function () { refreshMenuLevels(true); }));
  body.appendChild(tools);
  const list = document.createElement('div');
  list.id = 'sharedList';
  body.appendChild(list);
  if (LEVEL.menuBusy) { list.textContent = 'Cargando...'; return; }
  if (!LEVEL.sharedLevels.length) { list.innerHTML = '<div class="rg-hint">Nadie publicó niveles todavía. ¡Sé el primero!</div>'; return; }
  LEVEL.sharedLevels.forEach(function (def) { list.appendChild(levelCard(def, 'shared')); });
}
// Borra un mundo por completo: doc propio + copia pública + datos de red (RTDB).
function deleteWorld(def) {
  if (!def || !def.id) return;
  if (!confirm('¿Borrar "' + def.name + '"? Se elimina de tus mundos y de la Comunidad.')) return;
  const u = currentUser();
  if (!u) { alert('Ingresá con Google para borrar mundos.'); return; }
  Promise.all([
    fpsLevelsCol(u.uid).doc(def.id).delete(),
    // Si nunca se publicó, el doc no existe y la regla puede negarlo: lo ignoramos.
    fpsSharedLevelsCol().doc(def.id).delete().catch(function () {})
  ]).then(function () {
    // Only the owner's own player node can be removed (RTDB no longer allows wiping the level tree).
    try {
      if (typeof netPlayerRef !== 'undefined' && netPlayerRef && LEVEL.current === def.id) netPlayerRef.remove();
    } catch (e) {}
    LEVEL.userLevels = LEVEL.userLevels.filter(function (l) { return l.id !== def.id; });
    LEVEL.sharedLevels = LEVEL.sharedLevels.filter(function (l) { return l.id !== def.id; });
    delete LEVEL.defs[def.id];
    if (LEVEL.working && LEVEL.working.id === def.id) LEVEL.working = null;
    try { lvToast('Mundo eliminado'); } catch (e) {}
    if (LEVEL.current === def.id) { try { playLevel('playground'); return; } catch (e) {} }
    renderMainMenu();
  }).catch(function (e) { alert('No se pudo borrar: ' + e.message); });
}
function levelCard(def, kind) {
  const card = document.createElement('div');
  card.className = 'rg-card';
  const name = document.createElement('span');
  name.className = 'rg-card-name';
  let extra = '';
  try { if (def.resourceLevel && typeof resourceLevelLabel === 'function') extra = ' · ' + resourceLevelLabel(def.resourceLevel); } catch (e) {}
  name.textContent = def.name + ' · ' + (def.size || 100) + '²' + extra;
  card.appendChild(name);
  if (kind === 'user') {
    card.appendChild(lvBtn('▶', 'rg-btn-small rg-btn-primary', function () { playLevel(def.id); }));
    card.appendChild(lvBtn('✎', 'rg-btn-small', function () { LEVEL.working = def; LEVEL.menuView = 'editorial'; renderMainMenu(); }));
    card.appendChild(lvBtn('📤', 'rg-btn-small', function () {
      LEVEL.working = def;
      fsPublishWorking().then(function () { try { lvToast('Publicado'); } catch (e) {} })
        .catch(function (e) { alert('No se pudo publicar: ' + e.message); });
    }));
    card.appendChild(lvBtn('🗑', 'rg-btn-small rg-btn-danger', function () { deleteWorld(def); }));
  } else {
    card.appendChild(lvBtn('▶ Jugar', 'rg-btn-small rg-btn-primary', function () {
      fsDownloadShared(def.id).then(function (d) { playLevel(d.id); })
        .catch(function (e) { alert('No se pudo bajar: ' + e.message); });
    }));
    card.appendChild(lvBtn('➕ Clonar', 'rg-btn-small', function () {
      fsDownloadShared(def.id).then(function (d) {
        LEVEL.working = {
          id: 'lv_' + Date.now().toString(36), name: d.name + ' (copia)', kind: 'user',
          size: d.size, spawn: d.spawn, doors: d.doors, resetInventory: d.resetInventory, env: d.env || null, resourceLevel: d.resourceLevel || null, content: d.content
        };
        registerLevel(LEVEL.working);
        loadLevel(LEVEL.working.id);
        try { if (typeof setCreatorMode === 'function') setCreatorMode(true); } catch (e) {}
        try { if (typeof grantCreatorHammer === 'function') grantCreatorHammer(); } catch (e) {}
      }).catch(function (e) { alert('No se pudo clonar: ' + e.message); });
    }));
    const u = currentUser();
    if (u && def.owner === u.uid) {
      card.appendChild(lvBtn('🗑', 'rg-btn-small rg-btn-danger', function () { deleteWorld(def); }));
    }
  }
  return card;
}
const ENV_OPTIONS = [
  ['', 'Ciclo día/noche (auto)'],
  ['day', 'Día claro'],
  ['dawn', 'Amanecer'],
  ['dusk', 'Atardecer'],
  ['night', 'Noche cerrada (oscuro)'],
  ['blood', 'Cielo de sangre'],
  ['void', 'Surreal (vacío)']
];
function renderEnvSelector(parent, value) {
  const row = document.createElement('div');
  row.className = 'rg-keys-row';
  const label = document.createElement('span');
  label.className = 'rg-rownote';
  label.textContent = 'Ambiente';
  const sel = document.createElement('select');
  sel.className = 'rg-select';
  ENV_OPTIONS.forEach(function (o) {
    const opt = document.createElement('option');
    opt.value = o[0];
    opt.textContent = o[1];
    sel.appendChild(opt);
  });
  sel.value = value || '';
  row.appendChild(label);
  row.appendChild(sel);
  parent.appendChild(row);
  return sel;
}
const RESOURCE_LEVEL_OPTIONS = [
  ['none', 'Sin recursos'],
  ['low', 'Pocos'],
  ['normal', 'Normal'],
  ['high', 'Abundantes'],
  ['abundant', 'Exuberantes']
];
function renderResourceSelector(parent, value, getSize) {
  const row = document.createElement('div');
  row.className = 'rg-keys-row';
  const label = document.createElement('span');
  label.className = 'rg-rownote';
  label.textContent = 'Recursos';
  const sel = document.createElement('select');
  sel.className = 'rg-select';
  RESOURCE_LEVEL_OPTIONS.forEach(function (o) {
    const opt = document.createElement('option');
    opt.value = o[0];
    opt.textContent = o[1];
    sel.appendChild(opt);
  });
  sel.value = value || 'none';
  const info = document.createElement('span');
  info.className = 'rg-rownote';
  function refresh() {
    const s = (typeof getSize === 'function' && getSize()) || 100;
    let n = 0;
    try { n = (typeof resourceTargetCount === 'function') ? resourceTargetCount(s, sel.value) : 0; } catch (e) {}
    info.textContent = n > 0 ? ('≈ ' + n + ' nodos + sueltos') : '';
  }
  sel.addEventListener('change', refresh);
  refresh();
  row.appendChild(label);
  row.appendChild(sel);
  row.appendChild(info);
  parent.appendChild(row);
  return sel;
}
function renderCreateForm(body) {
  const hint = document.createElement('div');
  hint.className = 'rg-hint';
  hint.textContent = 'Elegí el tamaño y las puertas. Después entrás al modo creador: construí y guardá desde el menú de pausa (pestaña "Jugar" → 💾 Guardar mundo).';
  body.appendChild(hint);

  const nameRow = document.createElement('div');
  nameRow.className = 'rg-keys-row';
  const nl = document.createElement('span'); nl.className = 'rg-rownote'; nl.textContent = 'Nombre';
  const nameIn = document.createElement('input'); nameIn.className = 'rg-input'; nameIn.value = 'Mi mundo';
  nameRow.appendChild(nl); nameRow.appendChild(nameIn);
  body.appendChild(nameRow);

  const sizeRow = document.createElement('div');
  sizeRow.className = 'rg-keys-row';
  const sl = document.createElement('span'); sl.className = 'rg-rownote'; sl.textContent = 'Tamaño';
  const sizeSel = document.createElement('select'); sizeSel.className = 'rg-select';
  [['60', 'Chico 60²'], ['100', 'Mediano 100²'], ['160', 'Grande 160²'], ['220', 'Enorme 220²']]
    .forEach(function (o) { const opt = document.createElement('option'); opt.value = o[0]; opt.textContent = o[1]; sizeSel.appendChild(opt); });
  sizeSel.value = '160';
  sizeRow.appendChild(sl); sizeRow.appendChild(sizeSel);
  body.appendChild(sizeRow);

  const doorSelects = renderDoorSelectors(body, {});
  const envSel = renderEnvSelector(body, '');
  const resourceSel = renderResourceSelector(body, 'normal', function () { return parseInt(sizeSel.value, 10) || 100; });
  sizeSel.addEventListener('change', function () { try { resourceSel.dispatchEvent(new Event('change')); } catch (e) {} });

  const resetRow = document.createElement('label');
  resetRow.className = 'rg-rownote';
  resetRow.style.display = 'block';
  const resetChk = document.createElement('input'); resetChk.type = 'checkbox'; resetChk.checked = true;
  resetRow.appendChild(resetChk);
  resetRow.appendChild(document.createTextNode(' Empezar con inventario vacío'));
  body.appendChild(resetRow);

  const row = document.createElement('div');
  row.className = 'rg-menubtns';
  row.appendChild(lvBtn('Crear y editar', 'rg-btn-primary', function () {
    const doors = collectDoorTargets(doorSelects);
    createNewWorldFromForm(nameIn.value.trim() || 'Mi mundo', parseInt(sizeSel.value, 10) || 100, doors, resetChk.checked, envSel.value || null, resourceSel.value || 'normal');
  }));
  body.appendChild(row);
}
function renderEditorView(body) {
  const def = LEVEL.working;
  if (!def) {
    body.innerHTML = '<div class="rg-hint">No hay nivel en edición.</div>';
    return;
  }
  const hint = document.createElement('div');
  hint.className = 'rg-hint';
  hint.textContent = 'Cambiá el tamaño o las puertas y aplicá. El contenido que construiste se conserva.';
  body.appendChild(hint);

  const nameRow = document.createElement('div');
  nameRow.className = 'rg-keys-row';
  const nl = document.createElement('span'); nl.className = 'rg-rownote'; nl.textContent = 'Nombre';
  const nameIn = document.createElement('input'); nameIn.className = 'rg-input'; nameIn.value = def.name || 'Mi mundo';
  nameRow.appendChild(nl); nameRow.appendChild(nameIn);
  body.appendChild(nameRow);

  const sizeRow = document.createElement('div');
  sizeRow.className = 'rg-keys-row';
  const sl = document.createElement('span'); sl.className = 'rg-rownote'; sl.textContent = 'Tamaño';
  const sizeSel = document.createElement('select'); sizeSel.className = 'rg-select';
  [60, 100, 160, 220].forEach(function (n) {
    const opt = document.createElement('option'); opt.value = String(n); opt.textContent = n + '²';
    if ((def.size || 100) === n) opt.selected = true;
    sizeSel.appendChild(opt);
  });
  sizeRow.appendChild(sl); sizeRow.appendChild(sizeSel);
  body.appendChild(sizeRow);

  const doorSelects = renderDoorSelectors(body, def.doors || {});
  const envSel = renderEnvSelector(body, def.env || '');
  const resourceSel = renderResourceSelector(body, def.resourceLevel || 'none', function () { return parseInt(sizeSel.value, 10) || def.size || 100; });
  sizeSel.addEventListener('change', function () { try { resourceSel.dispatchEvent(new Event('change')); } catch (e) {} });

  const resetRow = document.createElement('label');
  resetRow.className = 'rg-rownote';
  resetRow.style.display = 'block';
  const resetChk = document.createElement('input'); resetChk.type = 'checkbox'; resetChk.checked = def.resetInventory !== false;
  resetRow.appendChild(resetChk);
  resetRow.appendChild(document.createTextNode(' Empezar con inventario vacío'));
  body.appendChild(resetRow);

  const row = document.createElement('div');
  row.className = 'rg-menubtns';
  row.appendChild(lvBtn('💾 Guardar', 'rg-btn-primary', function () {
    def.name = nameIn.value.trim() || def.name;
    def.size = parseInt(sizeSel.value, 10) || def.size;
    def.doors = collectDoorTargets(doorSelects);
    def.resetInventory = resetChk.checked;
    def.env = envSel.value || null;
    def.resourceLevel = resourceSel.value || 'none';
    LEVEL.working = def;
    fsSaveWorking().then(function () {
      try { lvToast('Nivel guardado'); } catch (e) {}
      hideMainMenu(); isGamePaused = false;
      loadLevel(def.id);
    }).catch(function (e) {
      alert(e.message === 'login' ? 'Ingresá con Google para guardar' : ('No se pudo guardar: ' + e.message));
    });
  }));
  row.appendChild(lvBtn('💾 Aplicar al mundo', '', function () {
    def.name = nameIn.value.trim() || def.name;
    def.size = parseInt(sizeSel.value, 10) || def.size;
    def.doors = collectDoorTargets(doorSelects);
    def.resetInventory = resetChk.checked;
    def.env = envSel.value || null;
    def.resourceLevel = resourceSel.value || 'none';
    LEVEL.working = def;
    applyWorkingRoom(def);
    hideMainMenu(); isGamePaused = false;
    try { lockPointer(); } catch (e) {}
  }));
  row.appendChild(lvBtn('📤 Publicar', 'rg-btn-warn', function () {
    def.name = nameIn.value.trim() || def.name;
    def.size = parseInt(sizeSel.value, 10) || def.size;
    def.doors = collectDoorTargets(doorSelects);
    def.resetInventory = resetChk.checked;
    def.env = envSel.value || null;
    def.resourceLevel = resourceSel.value || 'none';
    LEVEL.working = def;
    fsSaveWorking().then(function () { return fsPublishWorking(); }).then(function () {
      try { lvToast('Publicado en Comunidad'); } catch (e) {}
    }).catch(function (e) {
      alert(e.message === 'login' ? 'Ingresá con Google para publicar' : ('No se pudo publicar: ' + e.message));
    });
  }));
  row.appendChild(lvBtn('🎯 Spawn acá', 'rg-btn-small', function () {
    if (typeof player === 'undefined' || !player) return;
    def.spawn = { x: Math.round(player.container.position.x * 100) / 100, z: Math.round(player.container.position.z * 100) / 100, rot: player.container.rotation.y };
    LEVEL.working = def;
    try { lvToast('Spawn fijado en tu posición'); } catch (e) {}
  }));
  row.appendChild(lvBtn('♻ Recursos', 'rg-btn-small', function () {
    def.size = parseInt(sizeSel.value, 10) || def.size;
    def.resourceLevel = resourceSel.value || 'none';
    LEVEL.working = def;
    let gen = { nodes: 0, loose: 0 };
    try { if (typeof generateWorldResources === 'function') gen = generateWorldResources(def, { clear: true }) || gen; } catch (e) {}
    try {
      lvToast(gen.nodes > 0
        ? ('Recursos regenerados: ' + gen.nodes + ' nodos + ' + gen.loose + ' sueltos')
        : 'Recursos automáticos quitados');
    } catch (e) {}
  }));
  body.appendChild(row);

  const note = document.createElement('div');
  note.className = 'rg-hint';
  note.style.marginTop = '6px';
  note.textContent = 'Tip: usá el Modo Creador (pestaña Crear del menú de pausa) para poner bloques y objetos.';
  body.appendChild(note);
}
function renderDoorSelectors(body, doors) {
  const wrap = document.createElement('div');
  wrap.className = 'rg-doorwrap';
  const sides = [['north', 'Norte ↑'], ['south', 'Sur ↓'], ['east', 'Este →'], ['west', 'Oeste ←']];
  const out = {};
  sides.forEach(function (s) {
    const side = s[0];
    const row = document.createElement('div');
    row.className = 'rg-keys-row';
    const lab = document.createElement('span'); lab.className = 'rg-rownote'; lab.textContent = 'Puerta ' + s[1];
    const sel = document.createElement('select'); sel.className = 'rg-select';
    const none = document.createElement('option'); none.value = ''; none.textContent = '— sin puerta —'; sel.appendChild(none);
    const pg = document.createElement('option'); pg.value = 'playground'; pg.textContent = 'Playground'; sel.appendChild(pg);
    const tut = document.createElement('option'); tut.value = 'tutorial'; tut.textContent = 'Tutorial'; sel.appendChild(tut);
    Object.keys(LEVEL.defs).forEach(function (id) {
      if (id === 'playground' || id === 'tutorial' || id === 'mundo-1' || id === 'mundo-2') return;
      const o = document.createElement('option'); o.value = id; o.textContent = (LEVEL.defs[id].name || id); sel.appendChild(o);
    });
    const cur = doors[side];
    if (cur && cur.to) sel.value = cur.to;
    row.appendChild(lab); row.appendChild(sel);
    wrap.appendChild(row);
    out[side] = sel;
  });
  body.appendChild(wrap);
  return out;
}
function collectDoorTargets(selects) {
  const doors = {};
  Object.keys(selects).forEach(function (side) {
    const v = selects[side].value;
    if (v) doors[side] = { to: v };
  });
  return doors;
}
function createNewWorldFromForm(name, size, doors, resetInventory, env, resourceLevel) {
  LEVEL.working = {
    id: 'lv_' + Date.now().toString(36), name: name, kind: 'user',
    size: size, spawn: { x: 0, z: 0, rot: Math.PI }, doors: doors,
    resetInventory: resetInventory, env: env || null, resourceLevel: resourceLevel || 'normal', content: null
  };
  registerLevel(LEVEL.working);
  loadLevel(LEVEL.working.id);
  let gen = { nodes: 0, loose: 0 };
  try {
    if (typeof generateWorldResources === 'function') gen = generateWorldResources(LEVEL.working, { clear: true }) || gen;
  } catch (e) {}
  try { if (typeof setCreatorMode === 'function') setCreatorMode(true); } catch (e) {}
  try { if (typeof grantCreatorHammer === 'function') grantCreatorHammer(); } catch (e) {}
  try {
    lvToast((gen.nodes > 0 ? ('Recursos: ' + gen.nodes + ' nodos + ' + gen.loose + ' sueltos. ') : '') +
      'Para guardar: ESC → pestaña "Jugar" → 💾 Guardar mundo.');
  } catch (e) {}
}
function applyWorkingRoom(def) {
  const content = snapshotScene();
  teardownLevel();
  buildRoom(def);
  try { applySceneData(content); } catch (e) { console.error(e); }
  try { if (typeof applyLevelAmbience === 'function') applyLevelAmbience(def); } catch (e) {}
  placePlayerAt(def.spawn);
  updateLevelHUD(def);
  registerLevel(def);
}
async function refreshMenuLevels(force) {
  LEVEL.menuBusy = true;
  if (LEVEL.menuView === 'mine' || LEVEL.menuView === 'community') renderMainMenu();
  try {
    if (fbReady() && currentUser()) {
      LEVEL.userLevels = await fsListUserLevels();
      if (LEVEL.menuView === 'community' || force) LEVEL.sharedLevels = await fsListSharedLevels();
    }
  } catch (e) { console.warn('No pude listar niveles', e); }
  LEVEL.menuBusy = false;
  if (LEVEL.menuOpen) renderMainMenu();
}
function getLastLevelId() {
  try { return localStorage.getItem('lagrieta_last_level'); } catch (e) { return null; }
}

// ------------------------------------------------------------
//  Panel compacto dentro del menú de pausa (pestaña Niveles)
// ------------------------------------------------------------
function renderLevelsPanel() {
  const box = document.getElementById('levelsPanel');
  if (!box) return;
  box.innerHTML = '';
  const cur = LEVEL.current ? resolveLevelDef(LEVEL.current) : null;
  const info = document.createElement('div');
  info.className = 'rg-hint';
  info.textContent = cur ? ('Mundo actual: ' + cur.name + (cur.kind ? ' (' + cur.kind + ')' : '')) : 'Sin mundo cargado.';
  box.appendChild(info);

  // Si estás creando/editando, el guardado va primero y bien visible.
  if (LEVEL.working) {
      const w = LEVEL.working;
      const wInfo = document.createElement('div');
      wInfo.className = 'rg-hint';
      wInfo.textContent = 'Editando «' + (w.name || 'sin nombre') + '». Guardá para que aparezca en "Mis mundos".';
      box.appendChild(wInfo);
      const saveRow = document.createElement('div');
      saveRow.className = 'rg-menubtns';
      saveRow.appendChild(lvBtn('💾 Guardar mundo', 'rg-btn-primary', function () { saveWorkingFromPause(false); }));
      saveRow.appendChild(lvBtn('📤 Guardar y publicar', 'rg-btn-small', function () { saveWorkingFromPause(true); }));
      saveRow.appendChild(lvBtn('✎ Nombre / puertas', 'rg-btn-small', function () { LEVEL.menuView = 'editorial'; showMainMenu('editorial'); }));
      box.appendChild(saveRow);
      const status = document.createElement('div');
      status.className = 'rg-hint';
      status.id = 'levelsSaveStatus';
      if (!currentUser()) status.textContent = 'Ingresá con Google (pestaña Cuenta) para guardar.';
      box.appendChild(status);
  }

  const row = document.createElement('div');
  row.className = 'rg-menubtns';
  row.appendChild(lvBtn('🗺 Mis mundos', 'rg-btn-primary', function () { showMainMenu('mine'); }));
  row.appendChild(lvBtn('▶ Playground', 'rg-btn-small', function () { playLevel('playground'); }));
  row.appendChild(lvBtn('Tutorial', 'rg-btn-small', function () { playLevel('tutorial'); }));
  if (tutorialDone()) row.appendChild(lvBtn('➕ Crear mundo', 'rg-btn-small', function () { showMainMenu('create'); }));
  box.appendChild(row);
}

// Guarda (y opcionalmente publica) el mundo en edición, refresca la lista y da feedback.
function saveWorkingFromPause(publish) {
  const st = document.getElementById('levelsSaveStatus');
  const set = function (t) { if (st) st.textContent = t; try { setPauseStatus(t); } catch (e) {} };
  if (!LEVEL.working) { set('No hay mundo para guardar. Creá uno desde "Mis mundos".'); return; }
  if (!currentUser()) { set('Ingresá con Google (pestaña Cuenta) para guardar.'); return; }
  set('Guardando…');
  fsSaveWorking()
    .then(function () { return publish ? fsPublishWorking() : null; })
    .then(function () {
      set(publish ? 'Guardado y publicado ✓' : 'Mundo guardado ✓');
      try { lvToast(publish ? 'Mundo guardado y publicado ✓' : 'Mundo guardado ✓'); } catch (e) {}
      return refreshMenuLevels(true);
    })
    .then(function () { try { renderLevelsPanel(); } catch (e) {} })
    .catch(function (e) {
      const m = (e && e.message) || 'error';
      set(m === 'login' ? 'Ingresá con Google para guardar.' : ('No se pudo guardar: ' + m));
    });
}

// ------------------------------------------------------------
//  Init
// ------------------------------------------------------------
function initLevels() {
  _installLevelSnapshotHooks();
  registerLevel({
    id: 'playground', name: 'Playground', kind: 'playground', size: 100,
    spawn: { x: 0, z: 0, rot: Math.PI }, resetInventory: true, env: 'day',
    doors: { south: { to: 'mundo-1', locked: true, key: 'golden_key' } },
    build: buildPlaygroundLevel
  });
  // Mirando al sur (+Z) hacia el cartel del vestíbulo. Patio apagado hasta el director.
  registerLevel({
    id: 'tutorial', name: 'Tutorial', kind: 'tutorial', size: 100,
    spawn: { x: 0, z: 0, rot: Math.PI }, resetInventory: true, env: 'day',
    doors: { south: { to: 'mundo-1', locked: true, key: 'golden_key' } },
    build: buildTutorialLevel
  });
  registerLevel({
    id: 'mundo-1', name: 'La Grieta', kind: 'campaign', size: 160,
    spawn: { x: 0, z: -77, rot: Math.PI }, resetInventory: true, env: 'cycle', resourceLevel: 'normal',
    doors: { north: { to: 'playground' }, east: { to: 'mundo-2' } },
    build: buildWorldLevel
  });
  registerLevel({
    id: 'mundo-2', name: 'La Grieta — Frontera', kind: 'campaign', size: 220,
    spawn: { x: -107, z: 0, rot: -Math.PI / 2 }, resetInventory: true, env: 'dusk', resourceLevel: 'high',
    doors: { west: { to: 'mundo-1' }, east: { to: 'mundo-3' } },
    build: buildWorldLevel
  });
  registerLevel({
    id: 'mundo-3', name: 'La Grieta — Las Profundidades', kind: 'campaign', size: 200,
    spawn: { x: -97, z: 0, rot: -Math.PI / 2 }, resetInventory: true, env: 'night', resourceLevel: 'low',
    doors: { west: { to: 'mundo-2' } },
    build: function (def) {
      buildWorldLevel(def);
      // Antorchas para sobrevivir en la oscuridad
      try {
        const sp = def.spawn || { x: 0, z: 0, rot: -Math.PI / 2 };
        const rot = typeof sp.rot === 'number' ? sp.rot : -Math.PI / 2;
        const fx = -Math.sin(rot), fz = -Math.cos(rot);
        const rx = Math.cos(rot), rz = -Math.sin(rot);
        const at = function (a, b) {
          return new THREE.Vector3(sp.x + fx * b + rx * a, 0.35, sp.z + fz * b + rz * a);
        };
        placeWorldItem('torch', at(0, 3));
        placeWorldItem('torch', at(2, 6));
        placeWorldItem('torch', new THREE.Vector3(0, 0.35, 0));
      } catch (e) {}
    }
  });
  LEVEL.tutorialDone = tutorialDone();

  // Reflejar estado de sesión en el menú (con reintentos hasta que Firebase esté listo)
  (function wireAuth() {
    try {
      if (!window.firebase || !firebase.auth || !firebase.apps.length) { setTimeout(wireAuth, 400); return; }
      firebase.auth().onAuthStateChanged(function (u) {
        if (LEVEL.menuOpen) renderMainMenu();
        const m = document.getElementById('tutorialReward');
        if (m && m.style.display && m.style.display !== 'none') { try { showTutorialReward(); } catch (e) {} }
      });
    } catch (e) { setTimeout(wireAuth, 600); }
  })();

  try { renderLevelsPanel(); } catch (e) {}
}
