// js/26-tutorial-director.js — DIRECTOR del tutorial + pasos 0–7.
// Depende de: 19-levels (createLevelItem, lvToast, roomObjects), carteles, totems, zones.
// Cargar antes de 25-playground.js (pads / bag model reutilizados ahí).
// Director del tutorial (clon playground + pasos). Paso 0 = vestíbulo; 1 = hacha+madera en N.
var DIRECTOR = {
  active: false,
  step: 0,
  step1Built: false,
  step1Done: false,
  step2ZoneBuilt: false,
  step2Revealed: false,
  step2Done: false,
  step2Cartel: null,
  step3ZoneBuilt: false,
  step3Revealed: false,
  step3Done: false,
  step3Cartel: null,
  invUnlocked: false,
  step4ZoneBuilt: false,
  step4Revealed: false,
  step4Done: false,
  step4Cartel: null,
  benchSpot: null,
  benchSpotRadius: 3.5,
  step5ZoneBuilt: false,
  step5Revealed: false,
  step5Done: false,
  step5Cartel: null,
  step5Robot: null,
  step6ZoneBuilt: false,
  step6Revealed: false,
  step6Done: false,
  step6Cartel: null,
  step7ZoneBuilt: false,
  step7Revealed: false,
  step7Done: false,
  step7Cartel: null,
  step7Totem: null,
  step7KeySpawned: false
};

// Mochila/Q: en tutorial bloqueada hasta agarrar el kit del paso 3.
function canOpenInventory() {
  if (typeof DIRECTOR === 'undefined' || !DIRECTOR.active) return true;
  return !!DIRECTOR.invUnlocked;
}

function inventoryLockedMessage() {
  if (DIRECTOR.step3Revealed && !DIRECTOR.invUnlocked) {
    return 'Tomá la mochila del cartel oeste (E)';
  }
  if (DIRECTOR.step2Done || DIRECTOR.step >= 3) {
    return 'Tomá la mochila del cartel oeste (E)';
  }
  if (DIRECTOR.step1Done) {
    return 'Todavía no — terminá pico y piedra';
  }
  return 'Todavía no — terminá hacha y madera';
}

function tutorialCellSize(def) {
  return (def && def.size ? def.size : 100) / 3;
}

// Tutorial = clon playground + director. Paso 0: vestíbulo en C, patio apagado.
function buildTutorialLevel(def) {
  DIRECTOR.active = true;
  DIRECTOR.step = 0;
  buildTutorialStep0(def);
}

function buildTutorialStep0(def) {
  // Habitación cerrada en el centro (celda C). Norte = -Z (mismo convenio que buildRoom).
  const wallHeight = 6;
  const wallThickness = 0.6;
  const half = 6;          // cuarto ~12×12
  const gap = 3.2;         // ancho de la abertura norte
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.85, metalness: 0.15 });

  const addWall = function (w, h, d, x, y, z, name) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat.clone());
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name || 'VestibuleWall';
    mesh.isStatic = true;
    mesh.geometry.computeBoundingBox();
    mesh.updateMatrixWorld(true);
    mesh.userData.worldBoundingBox = new THREE.Box3().setFromObject(mesh);
    scene.add(mesh);
    collidableObjects.push(mesh);
    roomObjects.push(mesh);
    return mesh;
  };

  // Sur, este, oeste: muros enteros. Norte: dos segmentos + puerta local.
  addWall(half * 2, wallHeight, wallThickness, 0, wallHeight / 2, half, 'Vestibule_S');
  addWall(wallThickness, wallHeight, half * 2, -half, wallHeight / 2, 0, 'Vestibule_W');
  addWall(wallThickness, wallHeight, half * 2, half, wallHeight / 2, 0, 'Vestibule_E');

  const segLen = (half * 2 - gap) / 2;
  const segCenter = gap / 2 + segLen / 2;
  addWall(segLen, wallHeight, wallThickness, -segCenter, wallHeight / 2, -half, 'Vestibule_N_L');
  addWall(segLen, wallHeight, wallThickness, segCenter, wallHeight / 2, -half, 'Vestibule_N_R');

  const door = createLockedDoor(new THREE.Vector3(0, wallHeight / 2, -half));
  // Base door 2×4×0.2; escalar para tapar gap≈3.2 y altura 6.
  door.scale.set(gap / 2, wallHeight / 4, wallThickness / 0.2);
  door.updateMatrixWorld(true);
  door.rotation.y = 0;
  door.userData.portal = false;
  door.userData.locked = true;
  door.userData.requiredKey = 'golden_key';
  door.userData.consumeKey = true;
  door.userData.open = false;
  door.userData.onOpened = function () {
    DIRECTOR.step = 1;
    try { lvToast('Saliste al patio'); } catch (e) {}
    try { buildTutorialStep1(); } catch (e) { console.warn('tutorial step1', e); }
    // Zona NO viva desde la salida; texto/pico gated hasta completar madera.
    try { buildTutorialStep2Zone(); } catch (e) { console.warn('tutorial step2 zone', e); }
    try { buildTutorialStep3Zone(); } catch (e) { console.warn('tutorial step3 zone', e); }
    try { buildTutorialStep4Zone(); } catch (e) { console.warn('tutorial step4 zone', e); }
    try { buildTutorialStep5Zone(); } catch (e) { console.warn('tutorial step5 zone', e); }
    try { buildTutorialStep6Zone(); } catch (e) { console.warn('tutorial step6 zone', e); }
    try { buildTutorialStep7Zone(); } catch (e) { console.warn('tutorial step7 zone', e); }
  };
  roomObjects.push(door);

  // Llave sola en el piso, entre spawn y la puerta norte.
  createLevelItem(ITEM_DEFINITIONS.key_golden, 0, -2.2);

  // Cartel pared sur: cara breve + E modal. Cara hacia el centro (−Z).
  try {
    placeCartel(
      ['WASD  mover', 'Mouse mirar', 'E     agarrar / usar', 'Llave → abre la puerta'],
      {
        x: 0, y: 1.75, z: half - wallThickness / 2 - 0.06, rotY: Math.PI, width: 2.4, height: 1.45,
        detail: [
          'Movimiento: W A S D.',
          'Mirar: mové el mouse (click para capturar el cursor).',
          'E: agarrar objetos, abrir puertas, leer carteles.',
          'La llave dorada del piso abre la puerta norte.',
          'Al abrirla, la llave se consume — salís al patio tutorial.'
        ]
      }
    );
  } catch (e) { console.warn('cartel vestibulo', e); }
}

// Paso 1: al salir al norte — cartel cerca de los árboles + hacha destacada. Completa al picar un nodo.
function buildTutorialStep1() {
  if (DIRECTOR.step1Built) return;
  DIRECTOR.step1Built = true;

  const topY = function (x, z) {
    try { return (typeof groundTopY === 'function') ? groundTopY(x, z) : 0; } catch (e) { return 0; }
  };

  // Lejos de la casita (puerta ~ z=-6), junto al bosquecito. Cara al sur (+Z).
  const cartelZ = -22;
  try {
    placeCartel(
      ['E     agarrá el hacha', 'Click picá los árboles', 'Juntá madera'],
      {
        x: 0, z: cartelZ, rotY: 0, width: 2.5, height: 1.4, style: 'poste',
        detail: [
          'Agarrá el hacha del pedestal con E.',
          'Equipala desde el cinturón (1–5) si hace falta.',
          'Click izquierdo sobre un árbol (nodo) para picar.',
          'Las ramas del piso son opcionales: no cuentan para este paso.',
          'El paso termina cuando conseguís madera picando un nodo.'
        ]
      }
    );
  } catch (e) { console.warn('cartel paso1', e); }

  // Hacha prominente: pedestal luminoso + escala mayor.
  const axeX = 1.55, axeZ = cartelZ + 0.55;
  try { placeTutorialToolPad(axeX, axeZ, 'TutorialAxe'); } catch (e) {}
  const axe = createLevelItem(ITEM_DEFINITIONS.axe, axeX, axeZ, 1.15);
  if (axe) {
    axe.rotation.y = -Math.PI / 5;
    emphasizeTutorialTool(axe);
  }

  // Nodos justo detrás del cartel y más al fondo.
  const trees = [
    [-2.5, -25], [2.8, -25.5], [0, -26.5],
    [-6, -28], [5.5, -28.5], [-3.5, -31],
    [4, -31.5], [0.5, -33], [-7.5, -30], [7, -32]
  ];
  trees.forEach(function (c) {
    try {
      const n = createResourceNode('wood', new THREE.Vector3(c[0], topY(c[0], c[1]), c[1]));
      if (n) { scene.add(n); collidableObjects.push(n); }
    } catch (e) {}
  });

  // Ramas en el piso (decoración / loot opcional; NO completan el paso).
  [[-1.5, -23.5], [2.2, -24], [-4, -27], [3.8, -29], [-5.5, -31], [1.2, -32]].forEach(function (c) {
    try { placeWorldItem('branch', new THREE.Vector3(c[0], 0.35, c[1])); } catch (e) {}
  });
}

function directorOnWoodHarvested() {
  if (!DIRECTOR.active || DIRECTOR.step1Done) return;
  if (DIRECTOR.step < 1) return;
  DIRECTOR.step1Done = true;
  DIRECTOR.step = 2;
  try { lvToast('Madera lista'); } catch (e) {}
  try { revealTutorialStep2(); } catch (e) { console.warn('reveal step2', e); }
}

// Pedestal luminoso reutilizable para herramientas del tutorial.
function placeTutorialToolPad(x, z, namePrefix) {
  const padMat = new THREE.MeshStandardMaterial({
    color: 0xffc44a,
    emissive: 0xff9800,
    emissiveIntensity: 0.85,
    roughness: 0.45,
    metalness: 0.2,
    transparent: true,
    opacity: 0.9
  });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.08, 20), padMat);
  pad.position.set(x, 0.04, z);
  pad.receiveShadow = true;
  pad.name = (namePrefix || 'TutorialTool') + 'Pad';
  pad.userData.noCollide = true;
  scene.add(pad);
  if (typeof roomObjects !== 'undefined') roomObjects.push(pad);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.035, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0xffe082, emissive: 0xffb300, emissiveIntensity: 1.2, roughness: 0.4 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, 0.1, z);
  ring.name = (namePrefix || 'TutorialTool') + 'Ring';
  scene.add(ring);
  if (typeof roomObjects !== 'undefined') roomObjects.push(ring);
  return { pad: pad, ring: ring };
}

function emphasizeTutorialTool(model) {
  if (!model) return;
  model.scale.set(0.95, 0.95, 0.95);
  try {
    model.traverse(function (o) {
      if (o.isMesh && o.material && o.material.emissive) {
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(0x332200);
        o.material.emissiveIntensity = 0.35;
      }
    });
  } catch (e) {}
}

// Paso 2 zona (NO): nodos vivos + cartel "volvé más tarde". Sin pico hasta reveal.
function buildTutorialStep2Zone() {
  if (DIRECTOR.step2ZoneBuilt) return;
  DIRECTOR.step2ZoneBuilt = true;

  const topY = function (x, z) {
    try { return (typeof groundTopY === 'function') ? groundTopY(x, z) : 0; } catch (e) { return 0; }
  };

  // Noroeste; cara hacia el centro (0,0).
  const cx = -18;
  const cz = -20;
  const rotToCenter = Math.atan2(-cx, -cz);

  try {
    DIRECTOR.step2Cartel = placeCartel(
      cartelLinesLater('hacha y madera'),
      {
        x: cx, z: cz, rotY: rotToCenter, width: 2.5, height: 1.4, style: 'poste',
        detail: cartelDetailLater('hacha y madera')
      }
    );
  } catch (e) { console.warn('cartel paso2 locked', e); }

  // Piedra + algo de metal (mismo pico). Visibles desde la salida.
  const rocks = [
    [-21, -23], [-16, -24], [-19, -26],
    [-24, -25], [-14.5, -27], [-22, -29],
    [-17, -30], [-25, -28]
  ];
  rocks.forEach(function (c) {
    try {
      const n = createResourceNode('stone', new THREE.Vector3(c[0], topY(c[0], c[1]), c[1]));
      if (n) { scene.add(n); collidableObjects.push(n); }
    } catch (e) {}
  });
  [[-20, -32], [-15, -31]].forEach(function (c) {
    try {
      const n = createResourceNode('metal', new THREE.Vector3(c[0], topY(c[0], c[1]), c[1]));
      if (n) { scene.add(n); collidableObjects.push(n); }
    } catch (e) {}
  });

  // Piedras sueltas (decoración; no completan el paso).
  [[-17, -22], [-21.5, -24.5], [-15, -28], [-23, -30]].forEach(function (c) {
    try { placeWorldItem('pebble', new THREE.Vector3(c[0], 0.35, c[1])); } catch (e) {}
  });
}

// Al completar madera: texto de lección + pico destacado.
function revealTutorialStep2() {
  if (!DIRECTOR.active || DIRECTOR.step2Revealed) return;
  DIRECTOR.step2Revealed = true;

  try {
    updateCartelLines(DIRECTOR.step2Cartel, [
      'E     agarrá el pico',
      'Click picá piedra/metal',
      'Juntá recursos'
    ], [
      'El pico sirve para piedra y metal.',
      'Agarralo con E del pedestal luminoso.',
      'Click izquierdo sobre nodos grises (piedra) o metálicos.',
      'Con otra herramienta verás “herramienta equivocada”.',
      'El paso termina al picar piedra o metal (un golpe que sume recurso).'
    ]);
  } catch (e) { console.warn('update cartel step2', e); }

  const cx = -18;
  const cz = -20;
  const rotToCenter = Math.atan2(-cx, -cz);
  // Pico a la derecha del cartel visto de frente (offset en plano del cartel).
  const side = 1.55;
  const picoX = cx + Math.cos(rotToCenter) * side;
  const picoZ = cz - Math.sin(rotToCenter) * side;
  // Un poco delante del poste (hacia el centro).
  const fwd = 0.55;
  const x = picoX + Math.sin(rotToCenter) * fwd;
  const z = picoZ + Math.cos(rotToCenter) * fwd;

  try { placeTutorialToolPad(x, z, 'TutorialPickaxe'); } catch (e) {}
  const pico = createLevelItem(ITEM_DEFINITIONS.pickaxe, x, z, 1.15);
  if (pico) {
    pico.rotation.y = rotToCenter + Math.PI / 2;
    emphasizeTutorialTool(pico);
  }
  try { lvToast('Nuevo paso: pico'); } catch (e) {}
}

function directorOnPickaxeResourceHarvested() {
  if (!DIRECTOR.active || DIRECTOR.step2Done) return;
  if (!DIRECTOR.step2Revealed || DIRECTOR.step < 2) return;
  DIRECTOR.step2Done = true;
  DIRECTOR.step = 3;
  try { lvToast('Piedra/metal listos'); } catch (e) {}
  try { revealTutorialStep3(); } catch (e) { console.warn('reveal step3', e); }
}

function buildTutorialBagModel() {
  const g = new THREE.Group();
  const skin = (typeof BAG_SKIN !== 'undefined') ? BAG_SKIN : null;
  const cloth = new THREE.MeshStandardMaterial({
    color: skin ? skin.clothHex : 0x4a6b3a,
    roughness: 0.85,
    metalness: 0.05,
    emissive: skin ? skin.clothEmissiveHex : 0x1a2e1a,
    emissiveIntensity: 0.25
  });
  const strap = new THREE.MeshStandardMaterial({
    color: skin ? skin.strapHex : 0x6b4a2e,
    roughness: 0.9
  });
  const buckle = new THREE.MeshStandardMaterial({
    color: skin ? skin.buckleHex : 0xc4a574,
    metalness: 0.6,
    roughness: 0.4,
    emissive: skin ? skin.buckleEmissiveHex : 0x664400,
    emissiveIntensity: 0.3
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.28), cloth);
  body.position.y = 0.28;
  body.castShadow = true;
  g.add(body);
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.3), cloth);
  flap.position.set(0, 0.52, 0.02);
  g.add(flap);
  const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.04), strap);
  s1.position.set(-0.12, 0.35, -0.16);
  g.add(s1);
  const s2 = s1.clone();
  s2.position.x = 0.12;
  g.add(s2);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.04), buckle);
  b.position.set(0, 0.4, 0.15);
  g.add(b);
  g.name = 'TutorialBag';
  g.userData.bagSkin = true;
  return g;
}

// Paso 3 zona (Oeste): cartel locked desde la salida. Mochila solo al reveal.
function buildTutorialStep3Zone() {
  if (DIRECTOR.step3ZoneBuilt) return;
  DIRECTOR.step3ZoneBuilt = true;

  const cx = -22;
  const cz = -2;
  const rotToCenter = Math.atan2(-cx, -cz);

  try {
    DIRECTOR.step3Cartel = placeCartel(
      cartelLinesLater('pico y piedra'),
      {
        x: cx, z: cz, rotY: rotToCenter, width: 2.5, height: 1.4, style: 'poste',
        detail: cartelDetailLater('pico y piedra')
      }
    );
  } catch (e) { console.warn('cartel paso3 locked', e); }

  // Detalle vivo mínimo: cajones / leña (sin craft).
  try {
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 });
    [[-24, 2], [-25.5, -4], [-20, 3]].forEach(function (c, i) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), crateMat.clone());
      crate.position.set(c[0], 0.35, c[1]);
      crate.rotation.y = i * 0.4;
      crate.castShadow = true;
      crate.receiveShadow = true;
      crate.isStatic = true;
      crate.name = 'TutorialCrate';
      try {
        crate.updateMatrixWorld(true);
        crate.userData.worldBoundingBox = new THREE.Box3().setFromObject(crate);
        crate.userData.solid = true;
      } catch (e) {}
      scene.add(crate);
      collidableObjects.push(crate);
      roomObjects.push(crate);
    });
  } catch (e) {}
}

function revealTutorialStep3() {
  if (!DIRECTOR.active || DIRECTOR.step3Revealed) return;
  DIRECTOR.step3Revealed = true;

  try {
    updateCartelLines(DIRECTOR.step3Cartel, [
      'E     tomá la mochila',
      'Q     abrí el craft',
      'Martillo  piedra+piedra'
    ], [
      'Hasta tomar la mochila, Q y el craft están bloqueados.',
      'E en el kit del pedestal desbloquea la mochila.',
      'Q abre inventario / craft a mano.',
      'Crafteá el Martillo: piedra + piedra en A y B (4 piedra en total).',
      'Si te faltan recursos, volvé a picar al norte / noroeste.',
      'El martillo no aparece en el piso: solo sale del craft.'
    ]);
  } catch (e) { console.warn('update cartel step3', e); }

  const cx = -22;
  const cz = -2;
  const rotToCenter = Math.atan2(-cx, -cz);
  const side = 1.55;
  const fwd = 0.55;
  const x = cx + Math.cos(rotToCenter) * side + Math.sin(rotToCenter) * fwd;
  const z = cz - Math.sin(rotToCenter) * side + Math.cos(rotToCenter) * fwd;

  try { placeTutorialToolPad(x, z, 'TutorialBag'); } catch (e) {}

  const bag = buildTutorialBagModel();
  bag.position.set(x, 0.15, z);
  bag.rotation.y = rotToCenter + Math.PI;
  bag.scale.set(1.15, 1.15, 1.15);
  bag.isPickupable = true;
  bag.isStatic = false;
  bag.userData.collected = false;
  bag.userData.tutorialBag = true;
  bag.userData.solid = false;
  try {
    bag.updateMatrixWorld(true);
    bag.userData.worldBoundingBox = new THREE.Box3().setFromObject(bag, true);
  } catch (e) {}
  scene.add(bag);
  collidableObjects.push(bag);
  roomObjects.push(bag);
  DIRECTOR.step3Bag = bag;

  try { lvToast('Nuevo paso: mochila y craft'); } catch (e) {}
}

function directorPickupTutorialBag(mesh) {
  if (!DIRECTOR.active || DIRECTOR.invUnlocked) {
    // Ya desbloqueada: limpiar prop si quedó.
    try {
      if (mesh) {
        scene.remove(mesh);
        const i = collidableObjects.indexOf(mesh);
        if (i > -1) collidableObjects.splice(i, 1);
      }
    } catch (e) {}
    return;
  }
  DIRECTOR.invUnlocked = true;
  try {
    if (mesh) {
      mesh.userData.collected = true;
      scene.remove(mesh);
      const i = collidableObjects.indexOf(mesh);
      if (i > -1) collidableObjects.splice(i, 1);
      const r = roomObjects.indexOf(mesh);
      if (r > -1) roomObjects.splice(r, 1);
    }
  } catch (e) {}
  DIRECTOR.step3Bag = null;
  // La mochila física es una mejora real: suma espacios al inventario (Sebastian).
  try { if (player && player.inventory && typeof player.inventory.upgradeBackpack === 'function') player.inventory.upgradeBackpack(1); } catch (e) {}
  try { if (typeof unlockRecipe === 'function') unlockRecipe('backpack1'); } catch (e) {}
  try { if (typeof refreshTechTreeState === 'function') refreshTechTreeState(); } catch (e) {}
  try { playSound('pickup'); } catch (e) {}
  try { lvToast('Mochila de lona: +6 espacios · Q para craft'); } catch (e) {}
  try { showMessage('Mochila lista — Q para craft y distribuir cosas'); } catch (e) {}
}

function directorOnHammerCrafted() {
  if (!DIRECTOR.active || DIRECTOR.step3Done) return;
  if (!DIRECTOR.invUnlocked || DIRECTOR.step < 3) return;
  DIRECTOR.step3Done = true;
  DIRECTOR.step = 4;
  try { lvToast('Martillo listo'); } catch (e) {}
  try { revealTutorialStep4(); } catch (e) { console.warn('reveal step4', e); }
}

// Marcador de suelo: spot sugerido para la mesa (soft gate).
function placeTutorialBenchSpot(x, z, radius) {
  const g = new THREE.Group();
  g.position.set(x, 0.04, z);
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.55, radius * 0.6, 0.06, 28),
    new THREE.MeshStandardMaterial({
      color: 0x4a90d9,
      emissive: 0x1e88e5,
      emissiveIntensity: 0.7,
      transparent: true,
      opacity: 0.55,
      roughness: 0.6
    })
  );
  pad.receiveShadow = true;
  g.add(pad);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.06, 8, 40),
    new THREE.MeshStandardMaterial({ color: 0x90caf9, emissive: 0x42a5f5, emissiveIntensity: 1.1, roughness: 0.35 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  const inner = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.35, 0.04, 8, 28),
    new THREE.MeshStandardMaterial({ color: 0xe3f2fd, emissive: 0x81d4fa, emissiveIntensity: 0.9 })
  );
  inner.rotation.x = Math.PI / 2;
  inner.position.y = 0.06;
  g.add(inner);
  g.name = 'TutorialBenchSpot';
  g.userData.noCollide = true;
  scene.add(g);
  roomObjects.push(g);
  return g;
}

// Paso 4 zona (SO): contrarreloj tras el oeste. SUR queda libre.
function buildTutorialStep4Zone() {
  if (DIRECTOR.step4ZoneBuilt) return;
  DIRECTOR.step4ZoneBuilt = true;

  // Suroeste — no ocupar celda S (z positivo, x≈0).
  const cx = -18;
  const cz = 18;
  const rotToCenter = Math.atan2(-cx, -cz);
  const spotX = -14;
  const spotZ = 14;

  DIRECTOR.benchSpot = new THREE.Vector3(spotX, 0, spotZ);
  DIRECTOR.benchSpotRadius = 3.5;

  try {
    DIRECTOR.step4Cartel = placeCartel(
      cartelLinesLater('el martillo'),
      {
        x: cx, z: cz, rotY: rotToCenter, width: 2.5, height: 1.4, style: 'poste',
        detail: cartelDetailLater('el martillo')
      }
    );
  } catch (e) { console.warn('cartel paso4 locked', e); }

  // Spot visible desde la salida (zona viva); la lección espera al martillo.
  try { placeTutorialBenchSpot(spotX, spotZ, DIRECTOR.benchSpotRadius); } catch (e) {}
}

function revealTutorialStep4() {
  if (!DIRECTOR.active || DIRECTOR.step4Revealed) return;
  DIRECTOR.step4Revealed = true;

  try {
    updateCartelLines(DIRECTOR.step4Cartel, [
      'Q → craft → Mesa',
      'Colocala en el círculo',
      'Martillo equipado'
    ], [
      'La Mesa de trabajo exige tener un martillo en el inventario.',
      'Costo: madera + metal en A/B (6 madera + 4 metal en total).',
      'Al craftarla entra en modo colocación: click para confirmar.',
      'Tiene que ir dentro del círculo azul marcado.',
      'Fuera del círculo se rechaza y se te reintegra el craft.',
      'Más adelante: con el martillo también colocás bloques cerca de la mesa.'
    ]);
  } catch (e) { console.warn('update cartel step4', e); }

  try { lvToast('Nuevo paso: mesa en el círculo'); } catch (e) {}
}

function directorOnWorkbenchPlaced(wb) {
  if (!DIRECTOR.active || DIRECTOR.step4Done) return;
  if (!DIRECTOR.step4Revealed || DIRECTOR.step < 4) return;
  DIRECTOR.step4Done = true;
  DIRECTOR.step = 5;
  try { lvToast('Mesa lista — base reclamada'); } catch (e) {}
  try { revealTutorialStep5(); } catch (e) { console.warn('reveal step5', e); }
}

// Paso 5 zona (SE): combate. SUR (x≈0, z+) queda despejado.
function buildTutorialStep5Zone() {
  if (DIRECTOR.step5ZoneBuilt) return;
  DIRECTOR.step5ZoneBuilt = true;

  const cx = 18;
  const cz = 18;
  const rotToCenter = Math.atan2(-cx, -cz);

  try {
    DIRECTOR.step5Cartel = placeCartel(
      cartelLinesLater('la mesa'),
      {
        x: cx, z: cz, rotY: rotToCenter, width: 2.5, height: 1.4, style: 'poste',
        detail: cartelDetailLater('la mesa')
      }
    );
  } catch (e) { console.warn('cartel paso5 locked', e); }

  // Zona viva: chatarra atrás/lados — frente del cartel queda limpio para el arma.
  [[22, 24], [25, 20], [14, 24], [24, 14]].forEach(function (c) {
    try { placeWorldItem('scrap', new THREE.Vector3(c[0], 0.35, c[1])); } catch (e) {}
  });
}

function revealTutorialStep5() {
  if (!DIRECTOR.active || DIRECTOR.step5Revealed) return;
  DIRECTOR.step5Revealed = true;

  try {
    updateCartelLines(DIRECTOR.step5Cartel, [
      'E     agarrá la pistola',
      'Click dispara · R recarga',
      'Derribá al robot'
    ], [
      'Agarrá la pistola y las balas del frente del cartel.',
      'Click izquierdo dispara desde el cargador (12 balas).',
      'R recarga el cargador desde la reserva de balas.',
      'HUD: cargador/tamaño | reserva.',
      'Cargador vacío + reserva: R para recargar. Sin reserva: golpe de emergencia.',
      'Hay un robot hostil más atrás. El paso termina al derribarlo.'
    ]);
  } catch (e) { console.warn('update cartel step5', e); }

  const cx = 18;
  const cz = 18;
  const rotToCenter = Math.atan2(-cx, -cz);
  // Ejes locales del cartel: +Z hacia el centro (frente), +X a la derecha.
  const fx = Math.sin(rotToCenter);
  const fz = Math.cos(rotToCenter);
  const rx = Math.cos(rotToCenter);
  const rz = -Math.sin(rotToCenter);

  // Pistola centrada delante del cartel (prominente).
  const fwdGun = 2.15;
  const gunX = cx + fx * fwdGun;
  const gunZ = cz + fz * fwdGun;

  try { placeTutorialToolPad(gunX, gunZ, 'TutorialPistol'); } catch (e) {}
  const pistol = createLevelItem(ITEM_DEFINITIONS.pistol, gunX, gunZ, 1.25);
  if (pistol) {
    pistol.scale.set(1.25, 1.25, 1.25);
    pistol.rotation.y = rotToCenter + Math.PI / 2;
    emphasizeTutorialTool(pistol);
  }

  // Balas a ambos lados, un poco más adelante, con pedestal propio.
  const fwdAmmo = 2.35;
  const sideAmmo = 1.15;
  const ammoSpots = [
    { x: cx + fx * fwdAmmo + rx * sideAmmo, z: cz + fz * fwdAmmo + rz * sideAmmo },
    { x: cx + fx * fwdAmmo - rx * sideAmmo, z: cz + fz * fwdAmmo - rz * sideAmmo }
  ];
  ammoSpots.forEach(function (p, i) {
    try {
      placeTutorialToolPad(p.x, p.z, 'TutorialAmmo' + i);
      const ammo = createLevelItem(ITEM_DEFINITIONS.pistolAmmo, p.x, p.z, 1.2);
      if (ammo) ammo.scale.set(1.35, 1.35, 1.35);
    } catch (e) {}
  });

  // Un robot activo más al fondo SE (no en el pasillo sur).
  try {
    if (typeof spawnRobot === 'function') {
      const npc = spawnRobot(new THREE.Vector3(26, 0, 28));
      if (npc) {
        npc.tutorialCombat = true;
        npc.isHostile = true;
        npc.detectionRange = 22;
        DIRECTOR.step5Robot = npc;
      }
    }
  } catch (e) { console.warn('tutorial robot', e); }

  try { lvToast('Nuevo paso: combate'); } catch (e) {}
}

function directorOnTutorialRobotKilled() {
  if (!DIRECTOR.active || DIRECTOR.step5Done) return;
  if (!DIRECTOR.step5Revealed || DIRECTOR.step < 5) return;
  DIRECTOR.step5Done = true;
  DIRECTOR.step = 6;
  DIRECTOR.step5Robot = null;
  try { lvToast('Robot derribado'); } catch (e) {}
  try { revealTutorialStep6(); } catch (e) { console.warn('reveal step6', e); }
}

// Paso 6 (comida): celda E. Sur sigue libre. Completa al curarte o tener comida.
function buildTutorialStep6Zone() {
  if (DIRECTOR.step6ZoneBuilt) return;
  DIRECTOR.step6ZoneBuilt = true;

  // Este — cara al centro. No ocupar S ni SE de combate.
  const cx = 22;
  const cz = -2;
  const rotToCenter = Math.atan2(-cx, -cz);

  try {
    DIRECTOR.step6Cartel = placeCartel(
      cartelLinesLater('el robot'),
      {
        x: cx, z: cz, rotY: rotToCenter, width: 2.5, height: 1.4, style: 'poste',
        detail: cartelDetailLater('el robot')
      }
    );
  } catch (e) { console.warn('cartel paso6 locked', e); }
}

function revealTutorialStep6() {
  if (!DIRECTOR.active || DIRECTOR.step6Revealed) return;
  DIRECTOR.step6Revealed = true;

  try {
    updateCartelLines(DIRECTOR.step6Cartel, [
      'Comida  te cura',
      'E o caminá encima',
      'Toxina  ¡NO comas!'
    ], [
      'La comida del pedestal verde te cura vida.',
      'Podés caminar encima o agarrarla con E (y usarla desde Q).',
      'La toxina (pad rojo) hace daño: no la uses.',
      'Después de combatir, curarte es parte del loop de supervivencia.',
      'El paso termina al obtener o usar comida (no toxina).'
    ]);
  } catch (e) { console.warn('update cartel step6', e); }

  const cx = 22;
  const cz = -2;
  const rotToCenter = Math.atan2(-cx, -cz);
  const fx = Math.sin(rotToCenter);
  const fz = Math.cos(rotToCenter);
  const rx = Math.cos(rotToCenter);
  const rz = -Math.sin(rotToCenter);

  // Showcase delante del cartel: comida (premio) + toxina (aviso).
  const fwd = 2.2;
  const foodX = cx + fx * fwd;
  const foodZ = cz + fz * fwd;
  const toxX = foodX + rx * 1.4;
  const toxZ = foodZ + rz * 1.4;

  try { placeTutorialToolPad(foodX, foodZ, 'TutorialFood'); } catch (e) {}
  const food = createLevelItem(ITEM_DEFINITIONS.food, foodX, foodZ, 1.2);
  if (food) {
    food.scale.set(1.45, 1.45, 1.45);
    food.userData.tutorialFood = true;
    try { emphasizeTutorialTool(food); } catch (e) {}
  }

  // Toxina: contraste rojo, sin pedestal “premio”.
  try {
    const warn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.45, 0.06, 16),
      new THREE.MeshStandardMaterial({
        color: 0x4a1a1a,
        emissive: 0x880000,
        emissiveIntensity: 0.55,
        transparent: true,
        opacity: 0.75
      })
    );
    warn.position.set(toxX, 0.04, toxZ);
    warn.name = 'TutorialToxinPad';
    warn.userData.noCollide = true;
    scene.add(warn);
    roomObjects.push(warn);
    const toxin = createLevelItem(ITEM_DEFINITIONS.toxin, toxX, toxZ, 1.15);
    if (toxin) {
      toxin.scale.set(1.3, 1.3, 1.3);
      toxin.userData.tutorialToxin = true;
    }
  } catch (e) {}

  try { lvToast('Nuevo paso: comida (este)'); } catch (e) {}
}

function directorOnFoodLesson() {
  if (!DIRECTOR.active || DIRECTOR.step6Done) return;
  if (!DIRECTOR.step6Revealed || DIRECTOR.step < 6) return;
  DIRECTOR.step6Done = true;
  DIRECTOR.step = 7;
  try { lvToast('Comida lista — te cura'); } catch (e) {}
  try { revealTutorialStep7(); } catch (e) { console.warn('reveal step7', e); }
}

// Paso 7 (NE): tótem-puzzle. E → llave en pedestal ahí mismo. Sur sigue para el portal.
function buildTutorialStep7Zone() {
  if (DIRECTOR.step7ZoneBuilt) return;
  DIRECTOR.step7ZoneBuilt = true;

  const cx = 18;
  const cz = -18;
  const rotToCenter = Math.atan2(-cx, -cz);

  try {
    DIRECTOR.step7Cartel = placeCartel(
      cartelLinesLater('la comida'),
      {
        x: cx, z: cz, rotY: rotToCenter, width: 2.5, height: 1.4, style: 'poste',
        detail: cartelDetailLater('la comida')
      }
    );
  } catch (e) { console.warn('cartel paso7 locked', e); }

  // Tótem-baliza role key (puzzle salida).
  try {
    const tb = placeTotemBeacon({
      role: 'key',
      x: cx - 2.2,
      z: cz - 1.5,
      lines: ['Tótem', 'sellado…', ''],
      onActivate: function (t) { directorActivateKeyTotem(t); }
    });
    DIRECTOR.step7Totem = tb;
  } catch (e) { console.warn('totem NE', e); }
}

function revealTutorialStep7() {
  if (!DIRECTOR.active || DIRECTOR.step7Revealed) return;
  DIRECTOR.step7Revealed = true;

  try {
    updateCartelLines(DIRECTOR.step7Cartel, [
      'E     activá el tótem',
      'Aparece la llave',
      'Llevala a la puerta sur'
    ], [
      'El tótem de este sector no es solo lore: libera la salida.',
      'E en el tótem hace aparecer la llave dorada en el pedestal.',
      'Agarrá la llave con E.',
      'La puerta sur del level abre con esa llave (portal).',
      'Así cerrás el tutorial y salís al resto del juego.'
    ]);
  } catch (e) {}

  if (DIRECTOR.step7Totem) {
    DIRECTOR.step7Totem.lines = ['Tótem', 'E — liberar', 'la llave'];
  }
  try { lvToast('Nuevo paso: tótem NE'); } catch (e) {}
}

function directorActivateKeyTotem(tb) {
  if (!DIRECTOR.active) return;
  if (!DIRECTOR.step7Revealed) {
    try { lvToast(cartelLinesLater('la comida').join(' · ')); } catch (e) {
      try { lvToast('Volvé más tarde — completá la comida'); } catch (e2) {}
    }
    return;
  }
  if (DIRECTOR.step7KeySpawned) {
    try { lvToast('La llave ya está en el pedestal'); } catch (e) {}
    return;
  }
  DIRECTOR.step7KeySpawned = true;

  const tx = (tb && tb.pos) ? tb.pos.x : 16;
  const tz = (tb && tb.pos) ? tb.pos.z : -19.5;
  // Pedestal delante del tótem (hacia el centro).
  const toCenterX = -tx, toCenterZ = -tz;
  const len = Math.hypot(toCenterX, toCenterZ) || 1;
  const keyX = tx + (toCenterX / len) * 1.8;
  const keyZ = tz + (toCenterZ / len) * 1.8;

  try { placeTutorialToolPad(keyX, keyZ, 'TutorialKey'); } catch (e) {}
  const key = createLevelItem(ITEM_DEFINITIONS.key_golden, keyX, keyZ, 1.2);
  if (key) {
    key.scale.set(1.35, 1.35, 1.35);
    key.userData.tutorialExitKey = true;
    try { emphasizeTutorialTool(key); } catch (e) {}
  }
  if (tb) tb.lines = ['Tótem', 'Llave liberada', '→ puerta sur'];
  try { playSound('key-pickup'); } catch (e) {}
  try { lvToast('Llave liberada — agarrala'); } catch (e) {}
}

function directorOnTutorialKeyPicked() {
  if (!DIRECTOR.active || DIRECTOR.step7Done) return;
  if (!DIRECTOR.step7Revealed || DIRECTOR.step < 7) return;
  DIRECTOR.step7Done = true;
  DIRECTOR.step = 8;
  try { lvToast('Llave lista — puerta sur'); } catch (e) {}
}

function resetDirector() {
  if (typeof DIRECTOR === 'undefined') return;
  DIRECTOR.active = false;
  DIRECTOR.step = 0;
  DIRECTOR.step1Built = false;
  DIRECTOR.step1Done = false;
  DIRECTOR.step2ZoneBuilt = false;
  DIRECTOR.step2Revealed = false;
  DIRECTOR.step2Done = false;
  DIRECTOR.step2Cartel = null;
  DIRECTOR.step3ZoneBuilt = false;
  DIRECTOR.step3Revealed = false;
  DIRECTOR.step3Done = false;
  DIRECTOR.step3Cartel = null;
  DIRECTOR.step3Bag = null;
  DIRECTOR.invUnlocked = false;
  DIRECTOR.step4ZoneBuilt = false;
  DIRECTOR.step4Revealed = false;
  DIRECTOR.step4Done = false;
  DIRECTOR.step4Cartel = null;
  DIRECTOR.benchSpot = null;
  DIRECTOR.step5ZoneBuilt = false;
  DIRECTOR.step5Revealed = false;
  DIRECTOR.step5Done = false;
  DIRECTOR.step5Cartel = null;
  DIRECTOR.step5Robot = null;
  DIRECTOR.step6ZoneBuilt = false;
  DIRECTOR.step6Revealed = false;
  DIRECTOR.step6Done = false;
  DIRECTOR.step6Cartel = null;
  DIRECTOR.step7ZoneBuilt = false;
  DIRECTOR.step7Revealed = false;
  DIRECTOR.step7Done = false;
  DIRECTOR.step7Cartel = null;
  DIRECTOR.step7Totem = null;
  DIRECTOR.step7KeySpawned = false;
}

