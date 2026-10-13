// Construcción en un solo chart. La grilla es x, z y un nivel hacia afuera
// de la esfera. El apoyo mira ese nivel, no el Y del mundo.
//
// Los (ix,iz) son IDENTIDAD gruesa y estable (grilla, apoyo, guardado).
// La GEOMETRÍA (malla, caja, fantasma) va por teselas de 16: cada celda se
// dibuja en el marco local de su tesela, exacto en todo el planeta. Con el
// marco único del polo el error es cuadrático con la distancia (mm cerca,
// metros lejos) y el fantasma se separaba de la mira.
// Teselas de 16: como mucho 11 m del ancla => error milimétrico.
(function () {
  window.Game = window.Game || {};
  const Config = window.Game.Config;

  const REACH = 5;
  const TILE = 16;
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
    const stairsMeta = [];
    let material = 'wood';
    let aimCamera = null;
    let creator = false;
    let reach = REACH;
    // Territorio: lo provee el patio (bancos del jugador). null = sin límite
    // (los self-tests crean su propio build sin proveedor).
    let territoryProvider = null;
    // Decaimiento: sin banco, lo construido se deshace poco a poco.
    let decayActive = false;
    let decayTimer = 0;
    const DECAY_EVERY = 2.5;

    const ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x88ff88, transparent: true, opacity: 0.38, depthWrite: false })
    );
    ghost.raycast = function () {};
    ghost.visible = false;
    const ghostEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x00ff00 })
    );
    ghostEdges.raycast = function () {};
    ghost.add(ghostEdges);
    scene.add(ghost);

    // Retículo del centro de vista: marca el punto EXACTO del rayo
    // (el fantasma, en cambio, ocupa la celda entera que se va a poner).
    const anchor = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.09),
      new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.95, depthTest: false })
    );
    anchor.raycast = function () {};
    anchor.visible = false;
    anchor.frustumCulled = false;
    anchor.renderOrder = 999;
    scene.add(anchor);

    const raycaster = new THREE.Raycaster();
    raycaster.far = REACH;

    // Tesela de una celda: marco local anclado al centro de su tesela de
    // 16x16. Determinista para la misma celda (el ancla puede derivar con
    // la distancia, pero es estable y lo local queda a milímetros: como
    // mucho 11 m del ancla). Toda la geometría de bloques va por tesela.
    const tileFrames = new Map();
    function tileForPX(ix, iz) {
      const qx = Math.floor(ix / TILE);
      const qz = Math.floor(iz / TILE);
      const key = qx + ':' + qz;
      let t = tileFrames.get(key);
      if (!t) {
        const cx = qx * TILE + TILE / 2;
        const cz = qz * TILE + TILE / 2;
        const anchor = frame.localToWorld(cx, cz, 0);
        t = { qx: qx, qz: qz, cx: cx, cz: cz, frame: window.Game.LocalFrame(anchor) };
        tileFrames.set(key, t);
      }
      return t;
    }

    // Números locales (enteros) de una celda dentro de su tesela.
    function tileLocal(t, ix, iz) {
      return { lx: ix - t.cx, lz: iz - t.cz };
    }

    // ¿El candidato pisa alguna caja? Cada caja se testea en SU marco
    // (las esquinas del candidato viajan al mundo y de ahí al marco de la
    // caja): vale en todo el planeta, sin importar dónde viva cada uno.
    // Las alturas son radiales y por eso exactas en cualquier marco.
    function overlaps(minX, maxX, minZ, maxZ, minH, maxH) {
      const list = Colliders.all();
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const t = tileForPX(Math.round(cx), Math.round(cz));
      const clx = cx - t.cx;
      const clz = cz - t.cz;
      const center = t.frame.localToWorld(clx, clz, (minH + maxH) / 2);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c.active) continue;
        const F = c.frame || frame;
        if (F.anchorPosition && F.anchorPosition.distanceTo(center) > 6) continue;
        const l = F.worldToLocal(center);
        const pad = 2;
        if (l.x < c.minX - pad || l.x > c.maxX + pad ||
            l.z < c.minZ - pad || l.z > c.maxZ + pad) continue;
        let mnx = Infinity, mxx = -Infinity;
        let mnz = Infinity, mxz = -Infinity;
        let mnh = Infinity, mxh = -Infinity;
        const xs = [minX, maxX];
        const zs = [minZ, maxZ];
        const hs = [minH, maxH];
        for (let a = 0; a < 2; a++) {
          for (let b = 0; b < 2; b++) {
            for (let d = 0; d < 2; d++) {
              const w = t.frame.localToWorld(xs[a] - t.cx, zs[b] - t.cz, hs[d]);
              const p = F.worldToLocal(w);
              if (p.x < mnx) mnx = p.x;
              if (p.x > mxx) mxx = p.x;
              if (p.z < mnz) mnz = p.z;
              if (p.z > mxz) mxz = p.z;
              if (p.h < mnh) mnh = p.h;
              if (p.h > mxh) mxh = p.h;
            }
          }
        }
        if (mxx <= c.minX + 0.02 || mnx >= c.maxX - 0.02 ||
            mxz <= c.minZ + 0.02 || mnz >= c.maxZ - 0.02) continue;
        const cMin = c.minH == null ? -100 : c.minH;
        const cMax = c.maxH == null ? 1000 : c.maxH;
        if (mxh <= cMin + 0.02 || mnh >= cMax - 0.02) continue;
        return true;
      }
      return false;
    }

    function hitsPlayer(minX, maxX, minZ, maxZ, minH, maxH, playerPos) {
      if (!playerPos) return false;
      // En la tesela del candidato: parientes cercanos se comparan exactos
      // en cualquier parte del planeta (el marco del polo deforma lejos).
      const t = tileForPX(Math.round((minX + maxX) / 2), Math.round((minZ + maxZ) / 2));
      const loc = t.frame.worldToLocal(playerPos);
      const lx = loc.x + t.cx;
      const lz = loc.z + t.cz;
      const feet = playerPos.length() - Config.EYE_HEIGHT - Config.PLANET_RADIUS;
      const head = feet + Config.EYE_HEIGHT;
      const radius = Config.PLAYER_RADIUS;
      if (lx + radius <= minX || lx - radius >= maxX ||
          lz + radius <= minZ || lz - radius >= maxZ) return false;
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

    // Zona de spawn: ni bloques ni escaleras en el inicio, en ningún modo.
    // Solo vale con el juego cableado (los self-tests usan builds sueltos).
    function spawnBlockReason(ix, iz) {
      if (!territoryProvider) return '';
      const sx = Config.SPAWN_X || 0;
      const sz = Config.SPAWN_Z || -2;
      const r = Config.SPAWN_SAFE_R || 8;
      if (Math.hypot(ix - sx, iz - sz) < r) {
        return 'Zona de spawn: acá no se construye';
      }
      return '';
    }

    function territoryAt(ix, iz) {      if (!territoryProvider) return { ok: true, active: true };
      let t = null;
      try {
        t = territoryProvider();
      } catch (e) {
        return { ok: true, active: true };
      }
      if (!t) return { ok: true, active: true };
      if (!t.active) return { ok: false, active: false, text: 'Sin mesa: poné un workbench para reclamar la zona' };
      const centers = t.centers || [];
      const radius = t.radius || 9;
      for (let i = 0; i < centers.length; i++) {
        if (Math.hypot(ix - centers[i].x, iz - centers[i].z) <= radius) {
          return { ok: true, active: true };
        }
      }
      return { ok: false, active: true, text: 'Fuera de tu zona: construí cerca de tu mesa' };
    }

    function reject(ix, iz, level, playerPos) {
      // Sin compuerta de patio: la grilla envuelve la esfera y la zona del
      // banco manda en juego; el creador llega a todo el planeta.
      if (level < 0 || level > 6) return 'Muy alto';
      if (grid.has(cellKey(ix, iz, level))) return 'Ese lugar está ocupado';
      const box = boxOf(ix, iz, level);
      if (overlaps(box.minX, box.maxX, box.minZ, box.maxZ, box.minH, box.maxH)) return 'Ese lugar está ocupado';
      if (hitsPlayer(box.minX, box.maxX, box.minZ, box.maxZ, box.minH, box.maxH, playerPos)) return 'Estás en el medio';
      const spawnWhy = spawnBlockReason(ix, iz);
      if (spawnWhy) return spawnWhy;
      // Modo creador = dios en todo el planeta: gratis, sin apoyo y sin
      // zona. La zona del banco vale solo en modo juego.
      if (creator) return '';
      const terr = territoryAt(ix, iz);
      if (!terr.ok) return terr.text;
      if (level > 0 && !grid.has(cellKey(ix, iz, level - 1))) return 'No tiene apoyo';
      return '';
    }

    // Misma vara para cosas sobre el piso que para bloques nivel 0:
    // celda libre y sin solape, en cualquier parte del planeta.
    // Lo usa el creador y la mesa.
    function propSpotFree(ix, iz) {
      if (grid.has(cellKey(ix, iz, 0))) return 'Ese lugar está ocupado';
      const box = boxOf(ix, iz, 0);
      if (overlaps(box.minX, box.maxX, box.minZ, box.maxZ, box.minH, box.maxH)) {
        return 'Ese lugar está ocupado';
      }
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
      const t = tileForPX(ix, iz);
      const l = tileLocal(t, ix, iz);
      Utils.placeOnSphere(mesh, t.frame, l.lx, l.lz, level + 0.5);
      scene.add(mesh);
      // Caja en la misma tesela y mismos números locales: coincide exacto.
      const col = Colliders.add(t.frame, l.lx - 0.5, l.lx + 0.5, l.lz - 0.5, l.lz + 0.5, level, level + 1);
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

    // Celda + punto exacto de anclaje. La celda es lo que se pone (rejilla
    // de 1 m); el punto es el centro de vista sobre el rayo: en cara es el
    // impacto + la normal, en piso es el cruce recortado al alcance.
    function aimEx(playerPos) {
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
        raycaster.far = reach;
        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length && hits[0].distance <= reach + 0.4) {
          // Celda vecina por TOPOLOGÍA, no por proyección: la cara da el
          // vecino exacto en cualquier parte del planeta (la proyección del
          // patio se desfasa lejos del polo y erraba la celda).
          const block = hits[0].object.userData.block;
          const n = hits[0].face.normal;
          if (block && n) {
            const point = hits[0].point.clone().addScaledVector(
              n.clone().transformDirection(hits[0].object.matrixWorld), 0.06
            );
            return {
              cell: {
                ix: block.ix + Math.round(n.x),
                iz: block.iz + Math.round(n.z),
                level: Math.max(0, block.level + Math.round(n.y)),
              },
              point: point,
            };
          }
        }
      }
      // 2. Piso: donde mira cae la pared. Se intersecta el rayo con el plano
      // de los pies y se recorta al alcance: mirar al frente pone lejos,
      // mirar abajo pone cerca. Mirando muy arriba no hay preview (mejor
      // esconder el fantasma que mentir con la celda de los pies).
      // El redondeo es en la tesela del punto (exacto); la identidad que
      // vuelve es la gruesa del patio, estable para grilla y guardado.
      if (playerPos) {
        const up = playerPos.clone().normalize();
        const denom = dir.dot(up);
        if (denom <= 0.5) {
          let d = reach;
          if (denom < -1e-4) {
            const t = Config.EYE_HEIGHT / -denom;
            if (t < d) d = t;
          }
          const point = origin.clone().addScaledVector(dir, d);
          const approx = frame.worldToLocal(point);
          const tile = tileForPX(Math.round(approx.x), Math.round(approx.z));
          const fine = tile.frame.worldToLocal(point);
          const ix = Math.round(tile.cx + Math.round(fine.x));
          const iz = Math.round(tile.cz + Math.round(fine.z));
          return {
            cell: { ix: ix, iz: iz, level: 0 },
            point: point,
          };
        }
      }
      return null;
    }

    function aim(playerPos) {
      const r = aimEx(playerPos);
      return r ? r.cell : null;
    }

    function spend(type, amount) {
      if (creator) return true;
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
      raycaster.far = reach;
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
      const spawnWhy = spawnBlockReason(ix, iz);
      if (spawnWhy) return { ok: false, text: spawnWhy };
      if (!creator) {
        const terr = territoryAt(ix, iz);
        if (!terr.ok) return { ok: false, text: terr.text };
      }
      const spots = [];
      for (let i = 0; i < STAIR_COUNT; i++) {
        const center = stepCenter(ix, iz, yaw, i);
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
      const stepW = alongX ? 0.68 : 1;
      const stepD = alongX ? 1 : 0.68;
      for (let i = 0; i < spots.length; i++) {
        const spot = spots[i];
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(stepW, STAIR_RISE, stepD),
          new THREE.MeshStandardMaterial({
            color: 0x8B4513, emissive: 0x3a2010, emissiveIntensity: 0.45, roughness: 0.82,
          })
        );
        // Malla y caja en la tesela del peldaño, con sus números locales:
        // idénticas entre sí en todo el planeta.
        const st = tileForPX(Math.round(spot.center.x), Math.round(spot.center.z));
        const slx = spot.center.x - st.cx;
        const slz = spot.center.z - st.cz;
        Utils.placeOnSphere(mesh, st.frame, slx, slz, spot.minH + STAIR_RISE / 2);
        scene.add(mesh);
        const col = Colliders.add(
          st.frame,
          slx - stepW / 2, slx + stepW / 2,
          slz - stepD / 2, slz + stepD / 2,
          spot.minH, spot.maxH
        );
        col.stand = true;
        flight.push({ mesh: mesh, col: col });
      }
      stairs.push(flight);
      stairsMeta.push({ ix: ix, iz: iz, yaw: yaw });
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
      // En creador el fantasma va con cualquier herramienta en mano.
      const showGhost = aimCamera && (tool === 'hammer' || creator);
      if (!showGhost) {
        ghost.visible = false;
        anchor.visible = false;
      } else {
        const detail = aimEx(playerPos);
        const cell = detail && detail.cell;
        if (!cell) {
          ghost.visible = false;
          anchor.visible = false;
        } else {
          ghost.visible = true;
          const free = !reject(cell.ix, cell.iz, cell.level, playerPos);
          const tint = free ? 0x88ff88 : 0xff6655;
          ghost.material.color.setHex(tint);
          ghostEdges.material.color.setHex(free ? 0x00ff00 : 0xff0000);
          const gt = tileForPX(cell.ix, cell.iz);
          const gl = tileLocal(gt, cell.ix, cell.iz);
          Utils.placeOnSphere(ghost, gt.frame, gl.lx, gl.lz, cell.level + 0.5);
          anchor.visible = true;
          anchor.position.copy(detail.point);
          anchor.material.color.setHex(free ? 0xffd76a : 0xff4444);
        }
      }

      // Sin banco la zona se pierde: lo construido decae de a poco hasta
      // que el jugador reclame con una mesa nueva.
      if (decayActive && dt > 0) {
        decayTimer += dt;
        if (decayTimer >= DECAY_EVERY && (blocks.length || stairs.length)) {
          decayTimer = 0;
          if (blocks.length && (stairs.length === 0 || Math.random() < 0.7)) {
            const oldest = blocks[0];
            removeBlock(oldest);
            try { dropUnsupported(); } catch (e) {}
          } else if (stairs.length) {
            removeFlight(stairs[0]);
          }
        }
      } else {
        decayTimer = 0;
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
        const ft = tileForPX(block.ix, block.iz);
        const fl = tileLocal(ft, block.ix, block.iz);
        Utils.placeOnSphere(block.mesh, ft.frame, fl.lx, fl.lz, block.h + 0.5);
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
      stairsMeta.length = 0;
      scene.remove(ghost);
      scene.remove(anchor);
    }

    function removeFlight(flight) {
      const at = stairs.indexOf(flight);
      if (at < 0) return false;
      for (let s = 0; s < flight.length; s++) {
        scene.remove(flight[s].mesh);
        Colliders.remove(flight[s].col);
      }
      stairs.splice(at, 1);
      if (stairsMeta[at]) stairsMeta.splice(at, 1);
      return true;
    }

    function tryDeleteStairs() {
      if (!aimCamera) return null;
      const meshes = [];
      for (let i = 0; i < stairs.length; i++) {
        for (let s = 0; s < stairs[i].length; s++) meshes.push(stairs[i][s].mesh);
      }
      if (!meshes.length) return null;
      const origin = aimCamera.position.clone();
      const dir = new THREE.Vector3();
      aimCamera.getWorldDirection(dir);
      raycaster.set(origin, dir);
      raycaster.far = reach;
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) return null;
      for (let i = 0; i < stairs.length; i++) {
        for (let s = 0; s < stairs[i].length; s++) {
          if (stairs[i][s].mesh === hits[0].object) {
            removeFlight(stairs[i]);
            return { ok: true, text: 'Escalera destruida' };
          }
        }
      }
      return null;
    }

    // Saca todo lo del jugador (bloques + escaleras). El patio fijo queda.
    function clearAll() {
      while (blocks.length) {
        const block = blocks[0];
        grid.delete(cellKey(block.ix, block.iz, block.level));
        scene.remove(block.mesh);
        Colliders.remove(block.col);
        blocks.splice(0, 1);
      }
      while (stairs.length) removeFlight(stairs[0]);
    }

    function snapshot() {
      return {
        blocks: blocks
          .filter((block) => !block.falling)
          .map((block) => ({ ix: block.ix, iz: block.iz, level: block.level, type: block.type })),
        stairs: stairsMeta.slice(),
      };
    }

    function restore(data) {
      if (!data) return 0;
      const wasCreator = creator;
      const wasTerritory = territoryProvider;
      creator = true;
      territoryProvider = null;
      let n = 0;
      try {
        const list = Array.isArray(data.blocks) ? data.blocks : [];
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        if (typeof d.ix !== 'number' || typeof d.iz !== 'number' || typeof d.level !== 'number') continue;
        if (!LOOK[d.type]) continue;
        if (grid.has(cellKey(d.ix, d.iz, d.level))) continue;
        addBlock(d.ix, d.iz, d.level, d.type);
        n += 1;
      }
      const st = Array.isArray(data.stairs) ? data.stairs : [];
      for (let i = 0; i < st.length; i++) {
        const d = st[i];
        if (typeof d.ix !== 'number' || typeof d.iz !== 'number') continue;
        const r = placeStairs(d.ix, d.iz, typeof d.yaw === 'number' ? d.yaw : 0, null);
        if (r.ok) n += 1;
      }
      return n;
      } finally {
        creator = wasCreator;
        territoryProvider = wasTerritory;
      }
    }

    return {
      setCamera(camera) { aimCamera = camera; },
      setCreator(on, longReach) {
        creator = !!on;
        reach = creator ? (longReach || 14) : REACH;
        raycaster.far = reach;
      },
      isCreator() { return creator; },
      getReach() { return reach; },
      materialName() { return NAMES[material]; },
      setTerritoryProvider(fn) { territoryProvider = (typeof fn === 'function') ? fn : null; },
      setDecayActive(b) {
        decayActive = !!b;
        if (!decayActive) decayTimer = 0;
      },
      isDecayActive() { return decayActive; },
      territoryCheck(ix, iz) { return territoryAt(ix, iz); },
      propSpotFree(ix, iz) { return propSpotFree(ix, iz); },
      setMaterial(type) {
        if (ORDER.indexOf(type) >= 0) {
          material = type;
          return 'Bloque: ' + NAMES[material];
        }
        return '';
      },
      cycleMaterial() {
        material = ORDER[(ORDER.indexOf(material) + 1) % ORDER.length];
        return 'Bloque: ' + NAMES[material];
      },
      aimCell: aim,
      aimDetail: aimEx,
      tileFor(ix, iz) { return tileForPX(ix, iz); },
      tryPlace: tryPlace,
      tryDelete: tryDelete,
      tryDeleteStairs: tryDeleteStairs,
      tryErase() { return tryDelete() || tryDeleteStairs(); },
      tryStairs: tryStairs,
      placeCell: placeCell,
      placeStairs: placeStairs,
      removeBlock: removeBlock,
      removeFlight: removeFlight,
      hurtBlock: hurtBlock,
      dropUnsupported: dropUnsupported,
      overlaps: overlaps,
      update: update,
      dispose: dispose,
      clearAll: clearAll,
      snapshot: snapshot,
      restore: restore,
      occupies(ix, iz, level) { return grid.has(cellKey(ix, iz, level)); },
      blockCount() { return blocks.length; },
      stairCount() { return stairs.length; },
      blocks: blocks,
      stairsList() { return stairs; },
    };
  };
})();
