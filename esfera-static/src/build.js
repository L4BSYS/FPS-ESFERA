// Construcción en un solo chart. La grilla es x, z y un nivel hacia afuera
// de la esfera. El apoyo mira ese nivel, no el Y del mundo.
(function () {
  window.Game = window.Game || {};
  const Config = window.Game.Config;

  const REACH = 5;
  const LIMIT = 16;
  const COSTS = { wood: 2, stone: 3, metal: 5 };
  const HP = { wood: 3, stone: 6, metal: 10 };
  const RESIST = { wood: 1, stone: 2, metal: 3 };
  const NAMES = { wood: 'madera', stone: 'piedra', metal: 'metal' };
  const ORDER = ['wood', 'stone', 'metal'];
  const LOOK = {
    wood: { color: 0x8B4513, emissive: 0x3a2010, metalness: 0.04, roughness: 0.82 },
    stone: { color: 0xb9b9b9, emissive: 0x3a3a3a, metalness: 0.08, roughness: 0.9 },
    metal: { color: 0x8d9398, emissive: 0x1c2226, metalness: 0.72, roughness: 0.35 },
  };
  const STAIR_RISE = 0.25;
  const STAIR_RUN = 0.8;
  const STAIR_COUNT = 4;

  function cellKey(ix, iz, level) {
    return ix + ',' + iz + ',' + level;
  }

  window.Game.createBuild = function (scene, frame) {
    const Inventory = window.Game.Inventory;
    const Colliders = window.Game.Colliders;
    const Utils = window.Game.Utils;

    const blocks = [];
    const grid = new Map();
    const stairs = [];
    let material = 'wood';
    let aimCamera = null;

    const ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x88ff88, transparent: true, opacity: 0.38, depthWrite: false })
    );
    ghost.raycast = function () {};
    ghost.visible = false;
    scene.add(ghost);

    const raycaster = new THREE.Raycaster();
    raycaster.far = REACH;

    function inChart(ix, iz) {
      return ix * ix + iz * iz <= LIMIT * LIMIT;
    }

    function overlaps(minX, maxX, minZ, maxZ, minH, maxH) {
      const list = Colliders.all();
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c.active || c.frame !== frame) continue;
        if (maxX <= c.minX + 0.02 || minX >= c.maxX - 0.02 ||
            maxZ <= c.minZ + 0.02 || minZ >= c.maxZ - 0.02) continue;
        const cMin = c.minH == null ? -100 : c.minH;
        const cMax = c.maxH == null ? 1000 : c.maxH;
        if (maxH <= cMin + 0.02 || minH >= cMax - 0.02) continue;
        return true;
      }
      return false;
    }

    function hitsPlayer(minX, maxX, minZ, maxZ, minH, maxH, playerPos) {
      if (!playerPos) return false;
      const loc = frame.worldToLocal(playerPos);
      const feet = playerPos.length() - Config.EYE_HEIGHT - Config.PLANET_RADIUS;
      const head = feet + Config.EYE_HEIGHT;
      const radius = Config.PLAYER_RADIUS;
      if (loc.x + radius <= minX || loc.x - radius >= maxX ||
          loc.z + radius <= minZ || loc.z - radius >= maxZ) return false;
      if (head <= minH || feet >= maxH) return false;
      return true;
    }

    function boxOf(ix, iz, level) {
      return {
        minX: ix - 0.5, maxX: ix + 0.5,
        minZ: iz - 0.5, maxZ: iz + 0.5,
        minH: level, maxH: level + 1,
      };
    }

    function reject(ix, iz, level, playerPos) {
      if (!inChart(ix, iz)) return 'Fuera del patio';
      if (level < 0 || level > 6) return 'Muy alto';
      if (grid.has(cellKey(ix, iz, level))) return 'Ese lugar está ocupado';
      const box = boxOf(ix, iz, level);
      if (overlaps(box.minX, box.maxX, box.minZ, box.maxZ, box.minH, box.maxH)) return 'Ese lugar está ocupado';
      if (hitsPlayer(box.minX, box.maxX, box.minZ, box.maxZ, box.minH, box.maxH, playerPos)) return 'Estás en el medio';
      if (level > 0 && !grid.has(cellKey(ix, iz, level - 1))) return 'No tiene apoyo';
      return '';
    }

    function addBlock(ix, iz, level, type) {
      const look = LOOK[type];
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: look.color,
          emissive: look.emissive,
          emissiveIntensity: 0.5,
          roughness: look.roughness,
          metalness: look.metalness,
        })
      );
      Utils.placeOnFrame(mesh, frame, ix, iz, level + 0.5);
      scene.add(mesh);
      const col = Colliders.add(frame, ix - 0.5, ix + 0.5, iz - 0.5, iz + 0.5, level, level + 1);
      col.stand = true;
      const block = {
        ix: ix, iz: iz, level: level, type: type,
        mesh: mesh, col: col, falling: false, h: level, vy: 0,
        hp: HP[type], maxHp: HP[type],
      };
      col.kind = 'block';
      col.ref = block;
      mesh.userData.block = block;
      blocks.push(block);
      grid.set(cellKey(ix, iz, level), block);
      return block;
    }

    function hurtBlock(block) {
      if (!block || block.falling || !block.col || !block.col.active) return false;
      const dmg = Math.max(1, 5 - (RESIST[block.type] || 1));
      block.hp -= dmg;
      if (block.hp > 0) return false;
      removeBlock(block);
      dropUnsupported();
      return true;
    }

    function removeBlock(block) {
      grid.delete(cellKey(block.ix, block.iz, block.level));
      scene.remove(block.mesh);
      if (window.Game.Audio) window.Game.Audio.breakBlock(block.type);
      Colliders.remove(block.col);
      const index = blocks.indexOf(block);
      if (index >= 0) blocks.splice(index, 1);
    }

    function startFall(block) {
      const from = block.level;
      grid.delete(cellKey(block.ix, block.iz, from));
      block.falling = true;
      block.vy = 0;
      block.h = from;
      block.col.active = false;
      // Reserva el hueco de aterrizaje ya: si cae toda la columna en el
      // mismo frame, cada bloque pide el siguiente y no pisan la misma celda.
      const land = landingLevel(block.ix, block.iz);
      block.landAt = land;
      block.level = land;
      grid.set(cellKey(block.ix, block.iz, land), block);
    }

    function dropUnsupported() {
      let guard = 0;
      let changed = true;
      while (changed && guard < 8) {
        changed = false;
        guard += 1;
        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];
          if (block.falling || block.level === 0) continue;
          if (!grid.has(cellKey(block.ix, block.iz, block.level - 1))) {
            startFall(block);
            changed = true;
          }
        }
      }
    }

    function landingLevel(ix, iz) {
      let level = 0;
      while (grid.has(cellKey(ix, iz, level))) level += 1;
      return level;
    }

    function aim(playerPos) {
      if (!aimCamera) return null;
      const origin = aimCamera.position.clone();
      const dir = new THREE.Vector3();
      aimCamera.getWorldDirection(dir);
      const meshes = [];
      for (let i = 0; i < blocks.length; i++) {
        if (!blocks[i].falling) meshes.push(blocks[i].mesh);
      }
      if (meshes.length) {
        raycaster.set(origin, dir);
        raycaster.far = REACH;
        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length) {
          const normal = hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld);
          const point = hits[0].point.clone().addScaledVector(normal, 0.51);
          if (origin.distanceTo(point) <= REACH + 0.4) {
            const loc = frame.worldToLocal(point);
            return {
              ix: Math.round(loc.x),
              iz: Math.round(loc.z),
              level: Math.max(0, Math.round(loc.h - 0.5)),
            };
          }
        }
      }
      for (let t = 0.4; t <= REACH; t += 0.2) {
        const point = origin.clone().addScaledVector(dir, t);
        const loc = frame.worldToLocal(point);
        if (loc.h <= 0.15) {
          return { ix: Math.round(loc.x), iz: Math.round(loc.z), level: 0 };
        }
      }
      if (!playerPos) return null;
      const flat = dir.clone();
      flat.addScaledVector(frame.up, -flat.dot(frame.up));
      if (flat.lengthSq() < 1e-6) {
        const eye = frame.worldToLocal(playerPos);
        return { ix: Math.round(eye.x), iz: Math.round(eye.z), level: 0 };
      }
      flat.normalize();
      const loc = frame.worldToLocal(playerPos.clone().addScaledVector(flat, 2.2));
      return { ix: Math.round(loc.x), iz: Math.round(loc.z), level: 0 };
    }

    function spend(type, amount) {
      if (Inventory.count(type) < amount) return false;
      const cost = {};
      cost[type] = amount;
      return Inventory.trySpend(cost);
    }

    function placeCell(ix, iz, level, type, playerPos) {
      const why = reject(ix, iz, level, playerPos);
      if (why) return { ok: false, text: why };
      const cost = COSTS[type] || COSTS.wood;
      if (!spend(type, cost)) {
        return { ok: false, text: 'Te falta ' + (NAMES[type] || type) + ' (' + cost + ')' };
      }
      const block = addBlock(ix, iz, level, type);
      return { ok: true, text: 'Puesto: ' + NAMES[type], block: block };
    }

    function tryPlace(playerPos) {
      const cell = aim(playerPos);
      if (!cell) return { ok: false, text: 'No hay donde poner' };
      return placeCell(cell.ix, cell.iz, cell.level, material, playerPos);
    }

    function tryDelete() {
      if (!aimCamera) return null;
      const origin = aimCamera.position.clone();
      const dir = new THREE.Vector3();
      aimCamera.getWorldDirection(dir);
      const meshes = [];
      for (let i = 0; i < blocks.length; i++) {
        if (!blocks[i].falling) meshes.push(blocks[i].mesh);
      }
      if (!meshes.length) return null;
      raycaster.set(origin, dir);
      raycaster.far = REACH;
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) return null;
      const block = hits[0].object.userData.block;
      if (!block) return null;
      removeBlock(block);
      dropUnsupported();
      return { ok: true, text: 'Bloque destruido' };
    }

    function yawFromCamera() {
      const dir = new THREE.Vector3();
      aimCamera.getWorldDirection(dir);
      const angle = Math.atan2(dir.dot(frame.tangentX), dir.dot(frame.tangentZ));
      const quarter = Math.round(angle / (Math.PI / 2));
      return ((quarter % 4) + 4) % 4 * (Math.PI / 2);
    }

    function stepCenter(ix, iz, yaw, index) {
      return {
        x: ix + Math.sin(yaw) * index * STAIR_RUN,
        z: iz + Math.cos(yaw) * index * STAIR_RUN,
      };
    }

    function stepBounds(x, z, yaw) {
      const alongX = Math.abs(Math.cos(yaw)) < 0.5;
      const halfX = alongX ? 0.34 : 0.5;
      const halfZ = alongX ? 0.5 : 0.34;
      return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
    }

    function placeStairs(ix, iz, yaw, playerPos) {
      if (!inChart(ix, iz)) return { ok: false, text: 'Fuera del patio' };
      const spots = [];
      for (let i = 0; i < STAIR_COUNT; i++) {
        const center = stepCenter(ix, iz, yaw, i);
        if (center.x * center.x + center.z * center.z > LIMIT * LIMIT) {
          return { ok: false, text: 'Fuera del patio' };
        }
        const bounds = stepBounds(center.x, center.z, yaw);
        const minH = i * STAIR_RISE;
        const maxH = (i + 1) * STAIR_RISE;
        if (overlaps(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, minH, maxH)) {
          return { ok: false, text: 'Ese lugar está ocupado' };
        }
        if (hitsPlayer(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, minH, maxH, playerPos)) {
          return { ok: false, text: 'Estás en el medio' };
        }
        spots.push({ center: center, bounds: bounds, minH: minH, maxH: maxH });
      }
      if (!spend('wood', STAIR_COUNT)) return { ok: false, text: 'Te falta madera (' + STAIR_COUNT + ')' };
      const flight = [];
      const alongX = Math.abs(Math.cos(yaw)) < 0.5;
      for (let i = 0; i < spots.length; i++) {
        const spot = spots[i];
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(alongX ? 0.68 : 1, STAIR_RISE, alongX ? 1 : 0.68),
          new THREE.MeshStandardMaterial({
            color: 0x8B4513, emissive: 0x3a2010, emissiveIntensity: 0.45, roughness: 0.82,
          })
        );
        Utils.placeOnFrame(mesh, frame, spot.center.x, spot.center.z, spot.minH + STAIR_RISE / 2);
        scene.add(mesh);
        const col = Colliders.add(
          frame,
          spot.bounds.minX, spot.bounds.maxX,
          spot.bounds.minZ, spot.bounds.maxZ,
          spot.minH, spot.maxH
        );
        col.stand = true;
        flight.push({ mesh: mesh, col: col });
      }
      stairs.push(flight);
      return { ok: true, text: 'Escalera puesta', flight: flight };
    }

    function tryStairs(playerPos) {
      if (!aimCamera) return { ok: false, text: 'No hay donde poner' };
      const cell = aim(playerPos);
      if (!cell) return { ok: false, text: 'No hay donde poner' };
      if (cell.level !== 0) return { ok: false, text: 'La escalera va en el piso' };
      return placeStairs(cell.ix, cell.iz, yawFromCamera(), playerPos);
    }

    function update(dt, tool, playerPos) {
      const showGhost = aimCamera && tool === 'hammer';
      if (!showGhost) {
        ghost.visible = false;
      } else {
        const cell = aim(playerPos);
        if (!cell) {
          ghost.visible = false;
        } else {
          ghost.visible = true;
          const free = !reject(cell.ix, cell.iz, cell.level, playerPos);
          ghost.material.color.setHex(free ? 0x88ff88 : 0xff6655);
          Utils.placeOnFrame(ghost, frame, cell.ix, cell.iz, cell.level + 0.5);
        }
      }

      const falling = blocks.filter((block) => block.falling).sort((a, b) => a.h - b.h);
      for (let i = 0; i < falling.length; i++) {
        const block = falling[i];
        block.vy += 20 * dt;
        block.h -= block.vy * dt;
        const land = block.landAt;
        if (block.h <= land) {
          block.h = land;
          block.level = land;
          block.falling = false;
          block.vy = 0;
          block.col.minH = land;
          block.col.maxH = land + 1;
          block.col.active = true;
          grid.set(cellKey(block.ix, block.iz, land), block);
        }
        Utils.placeOnFrame(block.mesh, frame, block.ix, block.iz, block.h + 0.5);
      }
    }

    function dispose() {
      while (blocks.length) removeBlock(blocks[0]);
      for (let i = 0; i < stairs.length; i++) {
        for (let s = 0; s < stairs[i].length; s++) {
          scene.remove(stairs[i][s].mesh);
          Colliders.remove(stairs[i][s].col);
        }
      }
      stairs.length = 0;
      scene.remove(ghost);
    }

    return {
      setCamera(camera) { aimCamera = camera; },
      materialName() { return NAMES[material]; },
      cycleMaterial() {
        material = ORDER[(ORDER.indexOf(material) + 1) % ORDER.length];
        return 'Bloque: ' + NAMES[material];
      },
      aimCell: aim,
      tryPlace: tryPlace,
      tryDelete: tryDelete,
      tryStairs: tryStairs,
      placeCell: placeCell,
      placeStairs: placeStairs,
      removeBlock: removeBlock,
      hurtBlock: hurtBlock,
      dropUnsupported: dropUnsupported,
      update: update,
      dispose: dispose,
      occupies(ix, iz, level) { return grid.has(cellKey(ix, iz, level)); },
      blockCount() { return blocks.length; },
      blocks: blocks,
    };
  };
})();
