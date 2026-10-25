// js/24-world-zone.js — Zonas de mundo: damage | heal | spawn (sin conquista).
var worldZones = [];
var _zoneIdSeq = 1;

function worldZoneColor(mode) {
  if (mode === 'heal') return { ring: 0x4caf50, emissive: 0x1b5e20, fill: 0x2e7d32 };
  if (mode === 'spawn') return { ring: 0xff9800, emissive: 0xe65100, fill: 0xf57c00 };
  return { ring: 0xf44336, emissive: 0xb71c1c, fill: 0xc62828 }; // damage
}

function buildWorldZoneMesh(mode, radius) {
  const g = new THREE.Group();
  const col = worldZoneColor(mode);
  const r = Math.max(1.5, radius || 6);

  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(r * 0.92, 48),
    new THREE.MeshBasicMaterial({
      color: col.fill,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.03;
  fill.raycast = function () {};
  g.add(fill);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r - 0.22, r, 64),
    new THREE.MeshBasicMaterial({
      color: col.ring,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.raycast = function () {};
  g.add(ring);

  // Sin poste/baliza 3D: el tótem en el mundo es el marcador representativo.
  g.name = 'WorldZone_' + mode;
  g.userData.noCollide = true;
  return g;
}

// opts: { id?, mode, x, z, radius, dps, hps, interval, maxAlive, activateRange, label, enabled, autoSpawn }
function placeWorldZone(opts) {
  opts = opts || {};
  let mode = opts.mode || 'damage';
  if (mode !== 'damage' && mode !== 'heal' && mode !== 'spawn') mode = 'damage';

  const x = (typeof opts.x === 'number') ? opts.x : 0;
  const z = (typeof opts.z === 'number') ? opts.z : 0;
  const radius = (typeof opts.radius === 'number') ? opts.radius : 6;
  const label = opts.label || (
    mode === 'heal' ? 'Zona de cura' :
    mode === 'spawn' ? 'Zona de spawn' : 'Zona de daño'
  );

  const mesh = buildWorldZoneMesh(mode, radius);
  mesh.position.set(x, 0, z);

  let id;
  if (typeof opts.id === 'number' && opts.id > 0) {
    id = opts.id;
    if (opts.id >= _zoneIdSeq) _zoneIdSeq = opts.id + 1;
  } else {
    id = _zoneIdSeq++;
  }

  const ref = {
    id: id,
    mode: mode,
    label: label,
    mesh: mesh,
    x: x,
    z: z,
    radius: radius,
    // Default OFF: la baliza-tótem prende/apaga con E.
    enabled: opts.enabled === true,
    // damage
    dps: (typeof opts.dps === 'number') ? opts.dps : 12,
    // heal
    hps: (typeof opts.hps === 'number') ? opts.hps : 10,
    // spawn — autoSpawn:false = solo anillo/tótem; las oleadas van por enemySpawns
    interval: (typeof opts.interval === 'number') ? opts.interval : 6,
    maxAlive: (typeof opts.maxAlive === 'number') ? opts.maxAlive : 2,
    activateRange: (typeof opts.activateRange === 'number') ? opts.activateRange : 28,
    autoSpawn: opts.autoSpawn !== false,
    spawnAcc: 0,
    // shared
    tickAcc: 0,
    playerInside: false
  };

  mesh.userData.zoneRef = ref;
  scene.add(mesh);
  worldZones.push(ref);
  applyWorldZoneVisual(ref);
  return ref;
}

function findWorldZoneById(id) {
  if (id == null) return null;
  for (let i = 0; i < worldZones.length; i++) {
    if (worldZones[i].id === id) return worldZones[i];
  }
  return null;
}

function applyWorldZoneVisual(zone) {
  if (!zone || !zone.mesh) return;
  const on = zone.enabled !== false;
  zone.mesh.traverse(function (o) {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(function (m) {
      if (!m.userData) m.userData = {};
      if (m.transparent && m.opacity !== undefined) {
        if (m.userData._opOn == null) m.userData._opOn = m.opacity;
        if (o.geometry && o.geometry.type === 'CircleGeometry') {
          m.opacity = on ? 0.12 : 0.03;
        } else if (o.geometry && o.geometry.type === 'RingGeometry') {
          m.opacity = on ? 0.55 : 0.18;
        } else {
          m.opacity = on ? m.userData._opOn : Math.min(0.2, m.userData._opOn * 0.35);
        }
      }
      if (m.emissiveIntensity !== undefined) {
        if (m.userData._emiOn == null) m.userData._emiOn = m.emissiveIntensity;
        m.emissiveIntensity = on ? m.userData._emiOn : 0.1;
      }
    });
  });
}

function setWorldZoneEnabled(zoneOrId, on) {
  const zone = (typeof zoneOrId === 'object' && zoneOrId) ? zoneOrId : findWorldZoneById(zoneOrId);
  if (!zone) return false;
  zone.enabled = !!on;
  if (!zone.enabled) {
    zone.tickAcc = 0;
    zone.spawnAcc = 0;
    zone.playerInside = false;
  }
  applyWorldZoneVisual(zone);
  try {
    if (typeof lvToast === 'function') {
      lvToast((zone.label || zone.mode) + (zone.enabled ? ' · ON' : ' · OFF'));
    }
  } catch (e) {}
  return true;
}

function toggleWorldZoneEnabled(zoneOrId) {
  const zone = (typeof zoneOrId === 'object' && zoneOrId) ? zoneOrId : findWorldZoneById(zoneOrId);
  if (!zone) return false;
  return setWorldZoneEnabled(zone, !(zone.enabled !== false));
}

function clearWorldZones() {
  [...worldZones].forEach(function (z) {
    try { scene.remove(z.mesh); } catch (e) {}
    try {
      z.mesh.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(function (m) { m.dispose(); });
          else o.material.dispose();
        }
      });
    } catch (e) {}
  });
  worldZones.length = 0;
  _zoneIdSeq = 1;
}

function isInsideWorldZone(zone, pos) {
  if (!zone || !pos) return false;
  const dx = pos.x - zone.x;
  const dz = pos.z - zone.z;
  return (dx * dx + dz * dz) <= (zone.radius * zone.radius);
}

function countZoneSpawnAlive(zone) {
  if (!zone || typeof npcs === 'undefined') return 0;
  let n = 0;
  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    if (npc && npc.health > 0 && npc.zoneSpawnId === zone.id) n++;
  }
  return n;
}

function worldZoneSpawnOne(zone) {
  if (!zone || typeof spawnRobot !== 'function') return null;
  const ang = Math.random() * Math.PI * 2;
  const rad = Math.random() * zone.radius * 0.75;
  const sx = zone.x + Math.cos(ang) * rad;
  const sz = zone.z + Math.sin(ang) * rad;
  let npc = null;
  try {
    npc = spawnRobot(new THREE.Vector3(sx, 0, sz));
  } catch (e) { return null; }
  if (npc) {
    npc.zoneSpawnId = zone.id;
    npc.isHostile = true;
    try { npc.detectionRange = Math.max(npc.detectionRange || 16, 18); } catch (e) {}
  }
  return npc;
}

function updateWorldZones(delta) {
  if (!worldZones.length) return;
  if (typeof isGamePaused !== 'undefined' && isGamePaused) return;
  const p = (typeof player !== 'undefined') ? player : null;
  const pos = p && p.container ? p.container.position : null;

  for (let i = 0; i < worldZones.length; i++) {
    const z = worldZones[i];
    if (z.enabled === false) {
      z.tickAcc = 0;
      z.spawnAcc = 0;
      z.playerInside = false;
      continue;
    }

    const inside = !!(pos && isInsideWorldZone(z, pos));
    const wasInside = z.playerInside;
    z.playerInside = inside;

    if (inside && !wasInside) {
      try {
        if (typeof lvToast === 'function') lvToast(z.label || z.mode);
      } catch (e) {}
    }

    if (z.mode === 'damage' || z.mode === 'heal') {
      if (!inside || !p) {
        z.tickAcc = 0;
        continue;
      }
      z.tickAcc += delta;
      // aplicar por segundo acumulado
      if (z.tickAcc >= 0.25) {
        const t = z.tickAcc;
        z.tickAcc = 0;
        if (z.mode === 'damage') {
          const dmg = (z.dps || 12) * t;
          p.health = Math.max(0, (p.health || 0) - dmg);
          try { p.updateStatsHUD(); } catch (e) {}
          z._fxAcc = (z._fxAcc || 0) + t;
          if (z._fxAcc >= 0.7) {
            z._fxAcc = 0;
            try { p.applyDamageEffect(); playSound('damage-taken'); } catch (e) {}
          }
          if (p.health <= 0) {
            try { if (typeof showGameOver === 'function') showGameOver(); } catch (e) {}
          }
        } else {
          const maxHp = p.maxHealth || 100;
          const before = p.health || 0;
          p.health = Math.min(maxHp, before + (z.hps || 10) * t);
          if (p.health > before) {
            try { p.updateStatsHUD(); } catch (e) {}
            z._fxAcc = (z._fxAcc || 0) + t;
            if (z._fxAcc >= 1.2) {
              z._fxAcc = 0;
              try { playSound('health-regen'); } catch (e) {}
            }
          }
        }
      }
      continue;
    }

    if (z.mode === 'spawn') {
      if (z.autoSpawn === false) continue;
      if (!pos) continue;
      const dist = Math.hypot(pos.x - z.x, pos.z - z.z);
      if (dist > (z.activateRange || 28)) {
        z.spawnAcc = 0;
        continue;
      }
      const cap = (typeof z.maxAlive === 'number') ? z.maxAlive : 2;
      const alive = countZoneSpawnAlive(z);
      if (alive >= cap) {
        z.spawnAcc = 0;
        continue;
      }
      z.spawnAcc += delta;
      if (z.spawnAcc >= (z.interval || 6)) {
        z.spawnAcc = 0;
        try { worldZoneSpawnOne(z); } catch (e) {}
      }
    }
  }
}
