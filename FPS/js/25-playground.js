// js/25-playground.js — Layout temático del Playground (sectores).
// Depende de: carteles, containers, zones, totems, createLevelItem, pads tutoriales.

function pickupPlaygroundBag(mesh) {
  try {
    if (!mesh) return;
    mesh.userData.collected = true;
    try { scene.remove(mesh); } catch (e) {}
    const i = collidableObjects.indexOf(mesh);
    if (i > -1) collidableObjects.splice(i, 1);
    if (typeof roomObjects !== 'undefined') {
      const j = roomObjects.indexOf(mesh);
      if (j > -1) roomObjects.splice(j, 1);
    }
  } catch (e) {}
  try {
    if (typeof lvToast === 'function') lvToast('Mochila · Q abre inventario');
    else if (typeof showMessage === 'function') showMessage('Mochila lista · Q inventario');
  } catch (e) {}
}

function buildPlaygroundLevel() {
  // Spawn mira al sur (+Z, rot=π). Derecha = oeste (−X); izquierda = este (+X).

  // --- Frente (+Z): controles ---
  try {
    placeCartel(
      ['WASD  mover', 'Mouse mirar', 'E     usar / agarrar'],
      {
        x: 0, z: 4.2, rotY: Math.PI, width: 2.4, height: 1.35, style: 'poste',
        detail: [
          'Movimiento WASD y mirá con el mouse.',
          'E interactúa: ítems, puertas, carteles, tótems, cofres.',
          'Girá a la derecha → herramientas.',
          'Girá a la izquierda → mochila y cofre.',
          'Giro completo (norte) → zonas de daño y cura.',
          'Sureste → combate (pistola, melee, oleadas).',
          '1–5 cinturón. R recarga el arma. Q mochila.'
        ]
      }
    );
  } catch (e) { console.warn('playground cartel controles', e); }

  // --- Oeste (−X): Herramientas ---
  try {
    placeCartel(
      ['Herramientas', 'Hacha · pico · martillo', 'Click cosecha / melee'],
      {
        x: -8.2, z: 1.2, rotY: Math.PI / 2, width: 2.5, height: 1.4, style: 'poste',
        detail: [
          'Hacha → madera. Pico → piedra y metal.',
          'Click izquierdo cosecha si mirás un nodo.',
          'Con herramienta en mano también hacés melee.',
          'Martillo coloca bloques dentro del claim de tu mesa.',
          'La pistola está en el sector de combate (sureste).'
        ]
      }
    );
    const axe = createLevelItem(ITEM_DEFINITIONS.axe, -5.6, 0.2, 1.15);
    const pico = createLevelItem(ITEM_DEFINITIONS.pickaxe, -5.6, 1.2, 1.15);
    const hamm = createLevelItem(ITEM_DEFINITIONS.hammer, -5.6, 2.2, 1.15);
    try {
      placeTutorialToolPad(-5.6, 0.2, 'PgAxe');
      placeTutorialToolPad(-5.6, 1.2, 'PgPick');
      placeTutorialToolPad(-5.6, 2.2, 'PgHammer');
      if (axe) emphasizeTutorialTool(axe);
      if (pico) emphasizeTutorialTool(pico);
      if (hamm) emphasizeTutorialTool(hamm);
    } catch (e) {}
  } catch (e) { console.warn('playground sector herramientas', e); }

  try {
    const topY = function (x, z) {
      try { return (typeof groundTopY === 'function') ? groundTopY(x, z) : 0; } catch (e) { return 0; }
    };
    [['wood', -11, 0], ['wood', -12.5, 2.5], ['stone', -11.5, -2], ['metal', -13.5, 1]].forEach(function (c) {
      const n = createResourceNode(c[0], new THREE.Vector3(c[1], topY(c[1], c[2]), c[2]));
      collidableObjects.push(n); scene.add(n);
    });
    [[-6.8, -0.6], [-7.2, 2.8], [-4.8, 3.2]].forEach(function (c) {
      placeWorldItem('branch', new THREE.Vector3(c[0], 0.35, c[1]));
    });
    [[-6.5, -1.4], [-7.4, -2.2]].forEach(function (c) {
      placeWorldItem('pebble', new THREE.Vector3(c[0], 0.35, c[1]));
    });
    [['wood', -22, 8, 5], ['wood', 26, -10, 4], ['stone', 22, 14, 5],
     ['stone', -16, 28, 4], ['metal', 32, 8, 4], ['metal', -26, -8, 4]]
      .forEach(function (c) { spawnResourceCluster(c[0], c[1], c[2], c[3]); });
  } catch (e) { console.warn('playground resources', e); }

  // --- Este (+X): Contenedor ---
  try {
    placeCartel(
      ['Contenedor', 'Mochila · cofre', 'Q inventario · E cofre'],
      {
        x: 8.2, z: 1.2, rotY: -Math.PI / 2, width: 2.5, height: 1.4, style: 'poste',
        detail: [
          'La mochila del pedestal: E para tomarla (en Playground Q ya anda).',
          'Q abre inventario / craft a mano.',
          'Cofre: E abre. Arrastrá o click fichas Cosas ↔ Cofre.',
          'Loot del cofre: alcanza para martillo (piedra+piedra) y mesa (madera+metal).',
          'El dispenser de balas (sureste): E · Tomar 10.'
        ]
      }
    );
    placeWorldContainer({
      mode: 'storage',
      x: 5.4, z: 2.3, rotY: -Math.PI / 2,
      label: 'Cofre de prueba',
      slots: 12,
      seed: [
        { id: 'stone', type: 'resource', resourceKey: 'stone', name: 'Piedra', quantity: 10, stackable: true, maxStack: 10 },
        { id: 'stone', type: 'resource', resourceKey: 'stone', name: 'Piedra', quantity: 10, stackable: true, maxStack: 10 },
        { id: 'wood', type: 'resource', resourceKey: 'wood', name: 'Madera', quantity: 10, stackable: true, maxStack: 10 },
        { id: 'metal', type: 'resource', resourceKey: 'metal', name: 'Metal', quantity: 10, stackable: true, maxStack: 10 },
        { id: 'food', name: 'Comida', type: 'consumable', quantity: 2, healAmount: 30, stackable: true, maxStack: 5 }
      ]
    });
    try { placeTutorialToolPad(5.4, 0.3, 'PgBag'); } catch (e) {}
    const bag = buildTutorialBagModel();
    bag.position.set(5.4, 0.15, 0.3);
    bag.rotation.y = -Math.PI / 2;
    bag.scale.set(1.15, 1.15, 1.15);
    bag.isPickupable = true;
    bag.isStatic = false;
    bag.name = 'Mochila';
    bag.userData.collected = false;
    bag.userData.playgroundBag = true;
    bag.userData.solid = false;
    try {
      bag.updateMatrixWorld(true);
      bag.userData.worldBoundingBox = new THREE.Box3().setFromObject(bag, true);
    } catch (e) {}
    scene.add(bag);
    collidableObjects.push(bag);
    if (typeof roomObjects !== 'undefined') roomObjects.push(bag);
  } catch (e) { console.warn('playground sector contenedor', e); }

  // --- Norte (−Z): daño + cura ---
  try {
    placeCartel(
      ['Zonas', 'Daño · cura', 'E en tótem prende'],
      {
        x: 0, z: -6.8, rotY: 0, width: 2.5, height: 1.4, style: 'poste',
        detail: [
          'El tótem es el marcador de la zona (reemplaza la baliza).',
          'Las zonas empiezan apagadas (OFF).',
          'E en el tótem: prende / apaga.',
          'Roja (derecha): daño por segundo si entrás.',
          'Verde (izquierda): cura por segundo si entrás.',
          'Los anillos no se tocan: cada zona es independiente.'
        ]
      }
    );
    const zDmg = placeWorldZone({
      mode: 'damage', x: 8.5, z: -15.2, radius: 5.5, dps: 14, label: 'Zona de daño'
    });
    const zHeal = placeWorldZone({
      mode: 'heal', x: -8.5, z: -15.2, radius: 5.5, hps: 12, label: 'Zona de cura'
    });
    placeTotemBeacon({
      role: 'zone_switch', zoneId: zDmg.id, x: zDmg.x, z: zDmg.z,
      label: 'Zona de daño',
      lines: ['Tótem', 'Daño OFF', 'E — prender']
    });
    placeTotemBeacon({
      role: 'zone_switch', zoneId: zHeal.id, x: zHeal.x, z: zHeal.z,
      label: 'Zona de cura',
      lines: ['Tótem', 'Cura OFF', 'E — prender']
    });
  } catch (e) { console.warn('playground zonas daño/cura', e); }

  // --- Sureste: Combate ---
  // Una sola autoridad de presión: oleadas (enemySpawns).
  // Zona spawn = anillo + tótem (autoSpawn:false). Al prender, el tótem registra waveSpawns.
  try {
    waveNumber = 0;
    waveRespawnAt = 0;

    const combatCartelX = 12.5;
    const combatCartelZ = 14.5;
    const faceSpawn = Math.atan2(-combatCartelX, -combatCartelZ);
    placeCartel(
      ['Combate', 'Pistola · melee · olas', 'E tótem = oleadas'],
      {
        x: combatCartelX, z: combatCartelZ, rotY: faceSpawn, width: 2.6, height: 1.45, style: 'poste',
        detail: [
          'Pistola: click dispara · R recarga (cargador 12).',
          'Sin balas o con otra herramienta: click = melee.',
          'Manos / hacha / pico / martillo / antorcha también pegan.',
          'Balas en el piso o en el dispenser (E · Tomar 10).',
          'Tótem naranja: prende el anillo y activa las oleadas.',
          'Sin robots al inicio: vos elegís cuándo pelear.',
          'Autoridad de combate: solo el sistema de oleadas.'
        ]
      }
    );

    const pistol = createLevelItem(ITEM_DEFINITIONS.pistol, 10.4, 12.6, 1.2);
    const ammoA = createLevelItem(ITEM_DEFINITIONS.pistolAmmo, 11.2, 12.1, 1.15);
    const ammoB = createLevelItem(ITEM_DEFINITIONS.pistolAmmo, 9.8, 13.2, 1.15);
    try {
      placeTutorialToolPad(10.4, 12.6, 'PgPistol');
      placeTutorialToolPad(11.2, 12.1, 'PgAmmoA');
      placeTutorialToolPad(9.8, 13.2, 'PgAmmoB');
      if (pistol) emphasizeTutorialTool(pistol);
      if (ammoA) emphasizeTutorialTool(ammoA);
      if (ammoB) emphasizeTutorialTool(ammoB);
    } catch (e) {}

    placeWorldContainer({
      mode: 'dispenser',
      x: 13.6, z: 12.2, rotY: faceSpawn,
      label: 'Dispenser de balas',
      cooldown: 1.25,
      takeAmount: 10,
      stock: { id: 'pistol_ammo', name: 'Balas de pistola', amount: 60 }
    });

    [[11.5, 15.8], [14.2, 16.5]].forEach(function (c) {
      placeWorldItem('scrap', new THREE.Vector3(c[0], 0.35, c[1]));
    });

    const zSpawn = placeWorldZone({
      mode: 'spawn', x: 24, z: 26, radius: 7,
      autoSpawn: false,
      activateRange: 36,
      label: 'Arena de combate'
    });
    placeTotemBeacon({
      role: 'zone_switch',
      zoneId: zSpawn.id,
      x: zSpawn.x,
      z: zSpawn.z,
      label: 'Arena de combate',
      lines: ['Tótem', 'Olas OFF', 'E — prender'],
      waveSpawns: [
        { x: 24, z: 26 },
        { x: 27, z: 23 }
      ]
    });
  } catch (e) { console.warn('playground sector combate', e); }

  // Comida / toxina / llave (próximo pase de sectores).
  createLevelItem(ITEM_DEFINITIONS.toxin, -2, 28);
  createLevelItem(ITEM_DEFINITIONS.food, 2, 28);
  createLevelItem(ITEM_DEFINITIONS.key_golden, 0, 32);
  [[-18, 6], [18, -6]].forEach(function (c) { createLevelItem(ITEM_DEFINITIONS.toxin, c[0], c[1], 1); });
  [[-16, -4], [6, -22]].forEach(function (c) { createLevelItem(ITEM_DEFINITIONS.food, c[0], c[1], 1); });
}
