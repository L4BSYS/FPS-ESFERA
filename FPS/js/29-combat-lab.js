// js/29-combat-lab.js — Combat Lab (jaula de betatest). Melee layer first.
// LOAD: after 19-levels.js / 07-spawns.js (needs registerLevel helpers + spawnRobot).
// Contract: COMBAT_LAB + runtime LAB. Melee feel resolves at swing peak.

var COMBAT_LAB = {
  id: 'combat_lab',
  kind: 'lab',
  // fists = boxing layer (symmetric strike + guard). Future: ballistics / mixed.
  layer: 'fists',
  craft: false,
  resourceNodes: false,
  persistInventory: false,
  enemyPolicy: {
    meleeOnly: true,
    fists: true,
    npcFights: true,     // lab enemies fight each other (nearest-threat)
    count: 1,            // start with one
    onKillSpawn: 2,      // kill 1 → spawn 2
    maxAlive: 8,         // soft cap so hydra stays playable
    damage: 7,
    speed: 2.5,
    // Set from meleeShortReach() in applyCombatLabEnemyPolicy
    attackRange: null,
    detectionRange: 22,
    guardChance: 0.35,
    guardDuration: 0.65
  },
  // Fists layer: empty loadout (hands only).
  loadout: {
    belt: [null, null, null, null, null],
    bag: []
  },
  restartKey: 'F8',
  arenaHalf: 14,
  spawnPoints: [
    { x: 8, z: 8 },
    { x: -8, z: 8 },
    { x: 8, z: -8 },
    { x: -8, z: -8 }
  ]
};

var LAB = {
  active: false,
  layer: null,
  craft: true,
  persistInventory: true,
  def: null,
  stats: {
    swings: 0,
    hits: 0,
    kills: 0,
    headshots: 0,
    blocks: 0,
    clashes: 0,
    lastZone: null,
    lastDamage: 0,
    lastHand: null,
    lastClash: null
  }
};

function resetCombatLabStats() {
  LAB.stats = {
    swings: 0, hits: 0, kills: 0, headshots: 0, blocks: 0, clashes: 0,
    lastZone: null, lastDamage: 0, lastHand: null, lastClash: null
  };
}

function noteCombatLabMeleeHit(info) {
  if (!LAB.active || !LAB.stats) return;
  info = info || {};
  LAB.stats.hits++;
  LAB.stats.lastZone = info.zone || LAB.stats.lastZone;
  LAB.stats.lastDamage = info.damage || 0;
  LAB.stats.lastHand = info.hand != null ? (info.hand > 0 ? 'R' : 'L') : LAB.stats.lastHand;
  if (info.zone === 'head') LAB.stats.headshots++;
  try { updateCombatLabHud(); } catch (e) {}
}

function noteCombatLabBlock(who) {
  if (!LAB.active || !LAB.stats) return;
  LAB.stats.blocks++;
  try { updateCombatLabHud(); } catch (e) {}
}

function noteCombatLabClash(result) {
  if (!LAB.active || !LAB.stats) return;
  LAB.stats.clashes++;
  LAB.stats.lastClash = result || null;
  try { updateCombatLabHud(); } catch (e) {}
}

function noteCombatLabKill() {
  if (!LAB.active || !LAB.stats) return;
  LAB.stats.kills++;
  try { updateCombatLabHud(); } catch (e) {}
  // Hydra: kill 1 → spawn N (default 2), soft-capped by maxAlive
  try { combatLabOnKillSpawn(); } catch (e) {}
}

function combatLabCountAlive() {
  var alive = 0;
  try {
    if (typeof npcs !== 'undefined' && npcs) {
      for (var i = 0; i < npcs.length; i++) {
        if (npcs[i] && npcs[i].health > 0 && npcs[i].state !== 'dead') alive++;
      }
    }
  } catch (e) {}
  return alive;
}

function combatLabOnKillSpawn() {
  if (!LAB.active) return;
  var ep = (COMBAT_LAB && COMBAT_LAB.enemyPolicy) || {};
  var n = (ep.onKillSpawn != null) ? ep.onKillSpawn : 2;
  if (n <= 0) return;
  var maxAlive = (ep.maxAlive != null) ? ep.maxAlive : 8;
  var alive = combatLabCountAlive();
  // die() already removed this kill from "alive" in most paths; count current living
  var room = Math.max(0, maxAlive - alive);
  var spawnN = Math.min(n, room);
  if (spawnN <= 0) return;
  spawnCombatLabEnemies(spawnN);
}

/** Spawn N lab enemies at arena points (away from player when possible). */
function spawnCombatLabEnemies(count) {
  if (typeof spawnRobot !== 'function' || count <= 0) return;
  var pts = COMBAT_LAB.spawnPoints || [{ x: 8, z: 8 }];
  var px = 0, pz = 0;
  try {
    if (player && player.container) {
      px = player.container.position.x;
      pz = player.container.position.z;
    }
  } catch (e) {}
  // Pick farthest spawn points first so hydra doesn't pop on your face
  var ranked = pts.slice().sort(function (a, b) {
    var da = (a.x - px) * (a.x - px) + (a.z - pz) * (a.z - pz);
    var db = (b.x - px) * (b.x - px) + (b.z - pz) * (b.z - pz);
    return db - da;
  });
  for (var i = 0; i < count; i++) {
    var p = ranked[i % ranked.length] || { x: 6, z: 6 };
    var jitter = 1.4;
    var pos = new THREE.Vector3(
      p.x + (Math.random() - 0.5) * jitter,
      0,
      p.z + (Math.random() - 0.5) * jitter
    );
    var npc = null;
    try { npc = spawnRobot(pos); } catch (e) { npc = null; }
    if (npc) applyCombatLabEnemyPolicy(npc);
  }
  try { updateCombatLabHud(); } catch (e) {}
}

function isCombatLabActive() {
  return !!(LAB && LAB.active);
}

function deactivateCombatLab() {
  LAB.active = false;
  LAB.layer = null;
  LAB.craft = true;
  LAB.persistInventory = true;
  LAB.def = null;
  try {
    if (typeof player !== 'undefined' && player) {
      player.fistsCombat = false;
      if (typeof player.setGuard === 'function') player.setGuard(false);
      player._meleePending = null;
    }
  } catch (e) {}
  // Clear lab combat flags on any leaked NPCs (teardown may leave them briefly)
  try {
    if (typeof npcs !== 'undefined' && npcs) {
      for (var i = 0; i < npcs.length; i++) {
        var n = npcs[i];
        if (!n) continue;
        n.fistsCombat = false;
        n.labEnemy = false;
        n.guardChance = 0;
        if (typeof n.setGuard === 'function') n.setGuard(false);
        n._meleePending = null;
        n._lastAttacker = null;
      }
    }
  } catch (e) {}
  try {
    var el = document.getElementById('combatLabHud');
    if (el) el.style.display = 'none';
  } catch (e) {}
}

function activateCombatLab(def) {
  LAB.active = true;
  LAB.layer = (COMBAT_LAB && COMBAT_LAB.layer) || 'melee';
  LAB.craft = !!(COMBAT_LAB && COMBAT_LAB.craft);
  LAB.persistInventory = !!(COMBAT_LAB && COMBAT_LAB.persistInventory);
  LAB.def = def || COMBAT_LAB;
  resetCombatLabStats();
  try { updateCombatLabHud(); } catch (e) {}
}

function updateCombatLabHud() {
  var el = document.getElementById('combatLabHud');
  if (!el) {
    el = document.createElement('div');
    el.id = 'combatLabHud';
    el.style.cssText = 'position:fixed;left:12px;bottom:72px;z-index:40;padding:8px 12px;' +
      'background:rgba(0,0,0,0.55);border:1px solid #6a4;color:#cfc;font:13px/1.4 monospace;' +
      'pointer-events:none;display:none;max-width:340px;';
    document.body.appendChild(el);
  }
  if (!LAB.active) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  var s = LAB.stats || {};
  var alive = (typeof combatLabCountAlive === 'function') ? combatLabCountAlive() : 0;
  var cd = (typeof meleeCooldown !== 'undefined') ? meleeCooldown : 0;
  var sta = 0, staMax = 100, exh = false;
  try {
    if (typeof player !== 'undefined' && player) {
      sta = Math.round(player.stamina || 0);
      staMax = Math.round(player.maxStamina || 100);
      exh = !!player.staminaExhausted;
    }
  } catch (e) {}
  el.innerHTML =
    '<b>LAB ' + String(LAB.layer || 'fists').toUpperCase() + '</b> · F8 reset<br>' +
    'hits ' + (s.hits || 0) + ' · kills ' + (s.kills || 0) +
    ' · head ' + (s.headshots || 0) + ' · blocks ' + (s.blocks || 0) +
    ' · clash ' + (s.clashes || 0) + ' · alive ' + alive + '<br>' +
    'aguante ' + sta + '/' + staMax + (exh ? ' <span style="color:#ff9a3c">agotado</span>' : '') +
    ' · hand ' + (s.lastHand || '—') + ' · last ' + (s.lastZone || '—') +
    ' dmg ' + (s.lastDamage || 0) +
    (cd > 0.02 ? (' · cd ' + cd.toFixed(2) + 's') : ' · ready') + '<br>' +
    '<span style="color:#8a8">S1: earlier punch wins · aguante soft · kill→+2</span>';
}

function combatLabMakeItem(defKey) {
  if (!defKey || typeof ITEM_DEFINITIONS === 'undefined') return null;
  var def = ITEM_DEFINITIONS[defKey];
  if (!def) return null;
  var entry = Object.assign({}, def, { quantity: 1 });
  try {
    if (def.createModel) entry.model = def.createModel();
  } catch (e) {}
  try {
    if (typeof attachToolModel === 'function') attachToolModel(entry, def);
  } catch (e) {}
  return entry;
}

function applyCombatLabLoadout() {
  if (typeof player === 'undefined' || !player || !player.inventory) return;
  var inv = player.inventory;
  var belt = (COMBAT_LAB.loadout && COMBAT_LAB.loadout.belt) || [];
  var fists = (COMBAT_LAB.layer === 'fists');
  try { if (typeof resetPlayerInventory === 'function') resetPlayerInventory(); } catch (e) {}
  inv._suspendPersist = true;
  try {
    for (var i = 0; i < inv.quickSlots.length; i++) inv.quickSlots[i] = null;
    if (!fists) {
      for (var i = 0; i < belt.length && i < inv.quickSlots.length; i++) {
        var key = belt[i];
        if (!key) continue;
        var entry = combatLabMakeItem(key);
        if (entry) inv.quickSlots[i] = entry;
      }
    }
    try { inv.equippedItem = null; } catch (e) {}
    try {
      player.currentTool = TOOLS.HANDS;
      player.fistsCombat = fists;
      player.setGuard(false);
      player.nextHand = 1;
      player._meleePending = null;
      if (typeof player.setTool === 'function') player.setTool(TOOLS.HANDS);
    } catch (e) {}
  } finally {
    inv._suspendPersist = false;
  }
  try { inv.updateQuickSlotUI(); } catch (e) {}
  try { if (typeof player.updateToolModelVisibility === 'function') player.updateToolModelVisibility(); } catch (e) {}
  try { if (typeof player.syncBodyToolMount === 'function') player.syncBodyToolMount(); } catch (e) {}
  try { if (typeof player.updateToolHUD === 'function') player.updateToolHUD(); } catch (e) {}
  try { if (typeof updateActionButton === 'function') updateActionButton(); } catch (e) {}
}

function combatLabSilentClearNpcs() {
  if (typeof npcs === 'undefined' || !npcs) return;
  var list = npcs.slice();
  for (var i = 0; i < list.length; i++) {
    var n = list[i];
    if (!n) continue;
    try { n._deadCounted = true; } catch (e) {}
    try { n.state = 'dead'; n.health = 0; } catch (e) {}
    try {
      if (n.mesh) {
        var mi = collidableObjects.indexOf(n.mesh);
        if (mi > -1) collidableObjects.splice(mi, 1);
      }
      if (n.collider) {
        var ci = collidableObjects.indexOf(n.collider);
        if (ci > -1) collidableObjects.splice(ci, 1);
      }
    } catch (e) {}
    try {
      if (n.body && typeof n.body.dispose === 'function') n.body.dispose();
      n.body = null;
    } catch (e) {}
    try { if (n.mesh && n.mesh.parent) scene.remove(n.mesh); } catch (e) {}
    try { if (n.container && n.container.parent) scene.remove(n.container); } catch (e) {}
  }
  npcs.length = 0;
}

function applyCombatLabEnemyPolicy(npc) {
  if (!npc || !COMBAT_LAB || !COMBAT_LAB.enemyPolicy) return npc;
  var ep = COMBAT_LAB.enemyPolicy;
  if (ep.meleeOnly || LAB.layer === 'melee' || LAB.layer === 'fists') {
    npc.rangedRange = 0;
    npc.canRanged = false;
    npc.attackMode = 'melee';
  }
  if (ep.fists || LAB.layer === 'fists') {
    npc.fistsCombat = true;
    npc.guardChance = ep.guardChance != null ? ep.guardChance : 0.35;
    npc.guardDuration = ep.guardDuration != null ? ep.guardDuration : 0.65;
    npc.attackCooldownBase = 0.42;
    npc.nextHand = Math.random() < 0.5 ? 1 : -1;
  }
  if (ep.damage != null) npc.attackDamage = ep.damage;
  if (ep.speed != null) {
    try { npc.config.speed = ep.speed; npc.speed = ep.speed; } catch (e) {}
  }
  // Engage range = short band (+tiny slack) unless policy overrides with a number
  try {
    var fr = (typeof meleeShortReach === 'function')
      ? meleeShortReach()
      : ((typeof meleeReachFor === 'function') ? meleeReachFor('short') : 1.35);
    if (typeof ep.attackRange === 'number') npc.attackRange = ep.attackRange;
    else npc.attackRange = fr + 0.05;
  } catch (e) {
    if (typeof ep.attackRange === 'number') npc.attackRange = ep.attackRange;
  }
  if (ep.detectionRange != null) npc.detectionRange = ep.detectionRange;
  npc.labEnemy = true;
  // Fresh Aguante for fists S1
  try {
    npc.stamina = npc.maxStamina || 100;
    npc.staminaExhausted = false;
    npc._staminaRestTimer = 0;
  } catch (e) {}
  return npc;
}

function spawnCombatLabPack() {
  var count = (COMBAT_LAB.enemyPolicy && COMBAT_LAB.enemyPolicy.count != null)
    ? COMBAT_LAB.enemyPolicy.count : 1;
  spawnCombatLabEnemies(count);
}

function restartCombatLab() {
  if (!LAB.active) return;
  try { combatLabSilentClearNpcs(); } catch (e) {}
  try { resetCombatLabStats(); } catch (e) {}
  try {
    if (player) {
      player.health = player.maxHealth || 100;
      player.stamina = player.maxStamina || 100;
      player.staminaExhausted = false;
      player._staminaRestTimer = 0;
      player.velocity.set(0, 0, 0);
      player._meleePending = null;
      if (typeof player.setGuard === 'function') player.setGuard(false);
      if (typeof placePlayerAt === 'function') {
        placePlayerAt((LEVEL.defs && LEVEL.defs.combat_lab && LEVEL.defs.combat_lab.spawn) || { x: 0, z: 0, rot: Math.PI });
      }
      try { player.updateStatsHUD(); } catch (e) {}
    }
  } catch (e) {}
  try { if (typeof meleeCooldown !== 'undefined') meleeCooldown = 0; } catch (e) {}
  try { applyCombatLabLoadout(); } catch (e) {}
  try { spawnCombatLabPack(); } catch (e) {}
  try { updateCombatLabHud(); } catch (e) {}
  try {
    if (typeof showMessage === 'function') showMessage('LAB reiniciado');
    else if (typeof lvToast === 'function') lvToast('LAB reiniciado');
  } catch (e) {}
}

function onCombatLabLoaded(def) {
  activateCombatLab(def);
  // Do not leave wave-manager spawns active.
  try {
    if (typeof enemySpawns !== 'undefined' && enemySpawns) enemySpawns.length = 0;
    waveNumber = 0;
    waveRespawnAt = 0;
  } catch (e) {}
  try { applyCombatLabLoadout(); } catch (e) {}
  try { spawnCombatLabPack(); } catch (e) {}
  try { updateCombatLabHud(); } catch (e) {}
  try {
    if (typeof lvToast === 'function') lvToast('⚔ Combat Lab · fists');
  } catch (e) {}
}

function buildCombatLabLevel(def) {
  // Room walls come from buildRoom(def). Add arena ring props + carteles.
  try {
    if (typeof placeCartel === 'function') {
      placeCartel(
        ['COMBAT LAB', 'Fists · hydra', 'F8 = restart'],
        {
          x: 0, z: 5.5, rotY: Math.PI, width: 2.6, height: 1.35, style: 'poste',
          detail: [
            'Piñas simétricas: vos y el enemy pueden pegar y bloquear.',
            'LMB = puño L/R · RMB hold = guardia (chip damage).',
            'Alcance SHORT (MELEE_RANGE.short). Escala: short/mid/long.',
            'Empieza 1 enemy. Matás uno → aparecen dos (cap 8).',
            'NPC↔NPC: pelean entre sí (amenaza más cercana).',
            'S1: quien inicia antes gana el choque de piñas.',
            'Aguante: pegar/bloquear cansa; agotado = flojo / sin guard.',
            'Sin inventario / craft. F8 reinicia.'
          ]
        }
      );
    }
  } catch (e) { console.warn('combat lab cartel', e); }

  // Low ring posts as visual arena markers
  var half = (COMBAT_LAB && COMBAT_LAB.arenaHalf) || 14;
  try {
    if (typeof placeStaticBox === 'function') {
      var posts = [
        [half, half], [-half, half], [half, -half], [-half, -half],
        [0, half], [0, -half], [half, 0], [-half, 0]
      ];
      for (var i = 0; i < posts.length; i++) {
        placeStaticBox(
          'cube',
          new THREE.Vector3(posts[i][0], 0.45, posts[i][1]),
          0,
          { w: 0.9, h: 0.9, d: 0.9 },
          0x3a4a3a
        );
      }
    }
  } catch (e) {}

  // Markers at spawn points (invisible to combat; help orientation)
  try {
    var pts = COMBAT_LAB.spawnPoints || [];
    for (var k = 0; k < pts.length; k++) {
      var m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.08, 10),
        new THREE.MeshStandardMaterial({ color: 0x884422, roughness: 0.9 })
      );
      m.position.set(pts[k].x, 0.04, pts[k].z);
      m.receiveShadow = true;
      m.raycast = function () {};
      scene.add(m);
      if (typeof roomObjects !== 'undefined') roomObjects.push(m);
    }
  } catch (e) {}
}

function combatLabBlocksCraft() {
  return isCombatLabActive() && LAB.craft === false;
}
