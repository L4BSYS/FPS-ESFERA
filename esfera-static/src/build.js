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

  function cellKey(ix, iz, level, far) {
    return (far ? 1 : 0) + ',' + ix + ',' + iz + ',' + level;
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
    // 16x16, con ejes TRANSPORTADOS desde el chart (no recalculados), así
    // la grilla no gira ni se espeja al alejarse. Toda la geometría de
    // bloques va por tesela: como mucho 11 m del ancla => milimétrica.
    //
    // Dos charts cosidos en el ecuador: el de spawn (el que se pasa al
    // crear) sólo cubre hasta ~80° porque su proyección se pliega pasado
    // los 90° (la antípoda vuelve a caer en el polo). Del otro lado manda
    // el chart remoto, anclado en la antípoda. La identidad lleva el chart
    // en un campo `far` explícito (0 = spawn, 1 = remoto): el truco viejo
    // de sumar FAR al ix se rompía con coordenadas negativas (un ix remoto
    // negativo caía por debajo de FAR y se leía como celda de spawn en el
    // ecuador, a cientos de metros del punto de mira).
    const chartUp = frame.anchorPosition.clone().normalize();
    let chartFar = null;
    function farChart() {
      if (chartFar) return chartFar;
      chartFar = window.Game.LocalFrame(frame.anchorPosition.clone().negate());
      return chartFar;
    }
    function chartFor(far) {
      return far ? farChart() : frame;
    }
    function chartOfPoint(worldPos) {
      const d = worldPos.clone().normalize();
      return d.dot(chartUp) >= 0.15 ? 0 : 1;
    }

    // Inversa EXACTA de localToWorld (proyección gnomónica): el chart es un
    // plano tangente, así que mundo->chart es R·tan(ángulo), no el producto
    // escalar ortográfico (R·seno) que usa LocalFrame.worldToLocal. Con el
    // ortográfico la tesela elegida se iba decenas de metros del punto a
    // partir de ~30° del polo y el fantasma se separaba de la mira (a 45°,
    // 30 m; en el ecuador, 260 m). Con la inversa exacta la tesela siempre
    // es la más cercana y el fantasma queda a menos de una celda.
    function chartLocal(chartFrame, worldPos) {
      const R = Config.PLANET_RADIUS;
      const d = worldPos.clone().normalize();
      const upA = chartFrame.anchorPosition.clone().normalize();
      const cosA = d.dot(upA);
      // Más allá del horizonte (el otro hemisferio): este chart no vale.
      // Justo en el ecuador (cosA≈0) se sujeta a un mínimo en vez de dar
      // null: la dirección sigue siendo exacta y la tesela queda a cm.
      if (cosA <= 0) return null;
      const k = R / Math.max(cosA, 1e-4);
      return {
        x: d.dot(chartFrame.tangentX) * k,
        z: d.dot(chartFrame.tangentZ) * k,
        h: worldPos.length() - R,
      };
    }

    const tileFrames = new Map();
    function tileRaw(far, nx, nz) {
      const qx = Math.floor(nx / TILE);
      const qz = Math.floor(nz / TILE);
      const key = (far ? 1 : 0) + ':' + qx + ':' + qz;
      let t = tileFrames.get(key);
      if (!t) {
        const cx = qx * TILE + TILE / 2;
        const cz = qz * TILE + TILE / 2;
        t = { far: far, cx: cx, cz: cz, frame: (far ? farChart() : frame).at(cx, cz) };
        tileFrames.set(key, t);
      }
      return t;
    }

    function tileForPX(ix, iz, far) {
      return tileRaw(far ? 1 : 0, ix, iz);
    }

    // Números locales (y el marco) de una celda: lo que dibuja y choca.
    // cxRef/czRef son los centros de su tesela, para reconstruir la identidad.
    function cellLocal(ix, iz, far) {
      const t = tileForPX(ix, iz, far ? 1 : 0);
      return {
        far: t.far,
        frame: t.frame,
        cxRef: t.cx,
        czRef: t.cz,
        lx: ix - t.cx,
        lz: iz - t.cz,
      };
    }

    // ¿El candidato pisa alguna caja? Cada caja se testea en SU marco
    // (las esquinas del candidato viajan al mundo y de ahí al marco de la
    // caja): vale en todo el planeta, sin importar dónde viva cada uno.
    // Las alturas son radiales y por eso exactas en cualquier marco.
    function overlaps(minX, maxX, minZ, maxZ, minH, maxH, far) {
      const list = Colliders.all();
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const cl = cellLocal(Math.round(cx), Math.round(cz), far);
      const center = cl.frame.localToWorld(cl.lx, cl.lz, (minH + maxH) / 2);
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
              const w = cl.frame.localToWorld(
                xs[a] - cl.cxRef,
                zs[b] - cl.czRef,
                hs[d]
              );
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

    function hitsPlayer(minX, maxX, minZ, maxZ, minH, maxH, playerPos, far) {
      if (!playerPos) return false;
      // En la tesela del candidato: parientes cercanos se comparan exactos
      // en cualquier parte del planeta (el marco del polo deforma lejos).
      const cl = cellLocal(Math.round((minX + maxX) / 2), Math.round((minZ + maxZ) / 2), far);
      const loc = cl.frame.worldToLocal(playerPos);
      const lx = loc.x + cl.cxRef;
      const lz = loc.z + cl.czRef;
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
    function spawnBlockReason(ix, iz, far) {
      if (far) return '';
      if (!territoryProvider) return '';
      const sx = Config.SPAWN_X || 0;
      const sz = Config.SPAWN_Z || -2;
      const r = Config.SPAWN_SAFE_R || 8;
      if (Math.hypot(ix - sx, iz - sz) < r) {
        return 'Zona de spawn: acá no se construye';
      }
      return '';
    }

    function territoryAt(ix, iz, far) {      if (!territoryProvider) return { ok: true, active: true };
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
      const wantFar = far ? 1 : 0;
      for (let i = 0; i < centers.length; i++) {
        if ((centers[i].far | 0) !== wantFar) continue;
        if (Math.hypot(ix - centers[i].x, iz - centers[i].z) <= radius) {
          return { ok: true, active: true };
        }
      }
      return { ok: false, active: true, text: 'Fuera de tu zona: construí cerca de tu mesa' };
    }

    function reject(ix, iz, level, playerPos, far) {
      far = far ? 1 : 0;
      // Sin compuerta de patio: la grilla envuelve la esfera y la zona del
      // banco manda en juego; el creador llega a todo el planeta.
      if (level < 0 || level > 6) return 'Muy alto';
      if (grid.has(cellKey(ix, iz, level, far))) return 'Ese lugar está ocupado';
      const box = boxOf(ix, iz, level);
      if (overlaps(box.minX, box.maxX, box.minZ, box.maxZ, box.minH, box.maxH, far)) return 'Ese lugar está ocupado';
      if (hitsPlayer(box.minX, box.maxX, box.minZ, box.maxZ, box.minH, box.maxH, playerPos, far)) return 'Estás en el medio';
      const spawnWhy = spawnBlockReason(ix, iz, far);
      if (spawnWhy) return spawnWhy;
      // Modo creador = dios en todo el planeta: gratis, sin apoyo y sin
      // zona. La zona del banco vale solo en modo juego.
      if (creator) return '';
      const terr = territoryAt(ix, iz, far);
      if (!terr.ok) return terr.text;
      if (level > 0 && !grid.has(cellKey(ix, iz, level - 1, far))) return 'No tiene apoyo';
      return '';
    }

    // Misma vara para cosas sobre el piso que para bloques nivel 0:
    // celda libre y sin solape, en cualquier parte del planeta.
    // Lo usa el creador y la mesa.
    function propSpotFree(ix, iz, far) {
      far = far ? 1 : 0;
      if (grid.has(cellKey(ix, iz, 0, far))) return 'Ese lugar está ocupado';
      const box = boxOf(ix, iz, 0);
      if (overlaps(box.minX, box.maxX, box.minZ, box.maxZ, box.minH, box.maxH, far)) {
        return 'Ese lugar está ocupado';
      }
      return '';
    }

    function addBlock(ix, iz, level, type, far) {
      far = far ? 1 : 0;
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
      const l = cellLocal(ix, iz, far);
      Utils.placeOnSphere(mesh, l.frame, l.lx, l.lz, level + 0.5);
      scene.add(mesh);
      // Caja en la misma tesela y mismos números locales: coincide exacto.
      const col = Colliders.add(l.frame, l.lx - 0.5, l.lx + 0.5, l.lz - 0.5, l.lz + 0.5, level, level + 1);
      col.stand = true;
      const block = {
        ix: ix, iz: iz, level: level, far: far, type: type,
        mesh: mesh, col: col, falling: false, h: level, vy: 0,
        hp: HP[type], maxHp: HP[type],
      };
      col.kind = 'block';
      col.ref = block;
      mesh.userData.block = block;
      blocks.push(block);
      grid.set(cellKey(ix, iz, level, far), block);
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
      grid.delete(cellKey(block.ix, block.iz, block.level, block.far));
      scene.remove(block.mesh);
      if (window.Game.Audio) window.Game.Audio.breakBlock(block.type);
      Colliders.remove(block.col);
      const index = blocks.indexOf(block);
      if (index >= 0) blocks.splice(index, 1);
    }

    function startFall(block) {
      const from = block.level;
      grid.delete(cellKey(block.ix, block.iz, from, block.far));
      block.falling = true;
      block.vy = 0;
      block.h = from;
      block.col.active = false;
      // Reserva el hueco de aterrizaje ya: si cae toda la columna en el
      // mismo frame, cada bloque pide el siguiente y no pisan la misma celda.
      const land = landingLevel(block.ix, block.iz, block.far);
      block.landAt = land;
      block.level = land;
      grid.set(cellKey(block.ix, block.iz, land, block.far), block);
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
          if (!grid.has(cellKey(block.ix, block.iz, block.level - 1, block.far))) {
            startFall(block);
            changed = true;
          }
        }
      }
    }

    function landingLevel(ix, iz, far) {
      let level = 0;
      while (grid.has(cellKey(ix, iz, level, far ? 1 : 0))) level += 1;
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
                far: block.far ? 1 : 0,
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
      // El chart se elige por dónde queda el punto (el de spawn se pliega
      // pasados los 90°); el redondeo es en la tesela de ese chart, con la
      // proyección gnomónica exacta (ver chartLocal): vale en todo el planeta.
      if (playerPos) {
        const up = playerPos.clone().normalize();
        const denom = dir.dot(up);
        if (denom <= 0.5) {
          let d = reach;
          if (denom < -1e-4) {
            const feet = Config.EYE_HEIGHT / -denom;
            if (feet < d) d = feet;
          }
          const point = origin.clone().addScaledVector(dir, d);
          const far = chartOfPoint(point) === 1;
          const r = cellOnChart(far, chartFor(far), point);
          if (r) return r;
          const r2 = cellOnChart(!far, chartFor(!far), point);
          if (r2) return r2;
        }
      }
      return null;
    }

    // Punto del mundo -> celda de ese chart. La tesela se elige con la
    // proyección exacta, así que siempre es la más cercana al punto y el
    // redondeo fino queda a menos de una celda (el fantasma no se despega).
    function cellOnChart(far, chart, point) {
      const coarse = chartLocal(chart, point);
      if (!coarse) return null;
      const tile = tileRaw(far ? 1 : 0, coarse.x, coarse.z);
      const fine = chartLocal(tile.frame, point);
      if (!fine) {
        return {
          cell: { ix: Math.round(coarse.x), iz: Math.round(coarse.z), level: 0, far: far ? 1 : 0 },
          point: point,
        };
      }
      return {
        cell: { ix: tile.cx + Math.round(fine.x), iz: tile.cz + Math.round(fine.z), level: 0, far: far ? 1 : 0 },
        point: point,
      };
    }

    // Celda bajo un punto cualquiera del mundo (la usa el patio para soltar
    // cosas y ubicar la mesa donde mira el jugador, en cualquier hemisferio).
    function worldToCell(worldPos) {
      if (!worldPos) return null;
      const far = chartOfPoint(worldPos) === 1;
      const r = cellOnChart(far, chartFor(far), worldPos);
      if (r) return r.cell;
      const r2 = cellOnChart(!far, chartFor(!far), worldPos);
      return r2 ? r2.cell : null;
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

    function placeCell(ix, iz, level, type, playerPos, far) {
      far = far ? 1 : 0;
      const why = reject(ix, iz, level, playerPos, far);
      if (why) return { ok: false, text: why };
      const cost = COSTS[type] || COSTS.wood;
      if (!spend(type, cost)) {
        return { ok: false, text: 'Te falta ' + (NAMES[type] || type) + ' (' + cost + ')' };
      }
      const block = addBlock(ix, iz, level, type, far);
      return { ok: true, text: 'Puesto: ' + NAMES[type], block: block };
    }

    function tryPlace(playerPos) {
      const cell = aim(playerPos);
      if (!cell) return { ok: false, text: 'No hay donde poner' };
      return placeCell(cell.ix, cell.iz, cell.level, material, playerPos, cell.far);
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

    function yawFromCamera(far) {
      const dir = new THREE.Vector3();
      aimCamera.getWorldDirection(dir);
      // El yaw se mide en el chart donde se va a poner (el remoto tiene la
      // X espejada respecto al de spawn; con el de spawn la escalera salía
      // girada al otro lado del planeta).
      const chart = chartFor(far ? 1 : 0);
      const angle = Math.atan2(dir.dot(chart.tangentX), dir.dot(chart.tangentZ));
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

    function placeStairs(ix, iz, yaw, playerPos, far) {
      far = far ? 1 : 0;
      const spawnWhy = spawnBlockReason(ix, iz, far);
      if (spawnWhy) return { ok: false, text: spawnWhy };
      if (!creator) {
        const terr = territoryAt(ix, iz, far);
        if (!terr.ok) return { ok: false, text: terr.text };
      }
      const spots = [];
      for (let i = 0; i < STAIR_COUNT; i++) {
        const center = stepCenter(ix, iz, yaw, i);
        const bounds = stepBounds(center.x, center.z, yaw);
        const minH = i * STAIR_RISE;
        const maxH = (i + 1) * STAIR_RISE;
        if (overlaps(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, minH, maxH, far)) {
          return { ok: false, text: 'Ese lugar está ocupado' };
        }
        if (hitsPlayer(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, minH, maxH, playerPos, far)) {
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
        // Malla y caja en la tesela del peldaño, con sus números locales
        // EXACTOS (fraccionales: los peldaños avanzan 0.8, no de a celda).
        // La tesela se elige por el centro redondeado; la malla conserva el
        // resto fraccional, idénticas entre sí en todo el planeta.
        const sl = cellLocal(Math.round(spot.center.x), Math.round(spot.center.z), far);
        const slx = spot.center.x - sl.cxRef;
        const slz = spot.center.z - sl.czRef;
        Utils.placeOnSphere(mesh, sl.frame, slx, slz, spot.minH + STAIR_RISE / 2);
        scene.add(mesh);
        const col = Colliders.add(
          sl.frame,
          slx - stepW / 2, slx + stepW / 2,
          slz - stepD / 2, slz + stepD / 2,
          spot.minH, spot.maxH
        );
        col.stand = true;
        flight.push({ mesh: mesh, col: col });
      }
      stairs.push(flight);
      stairsMeta.push({ ix: ix, iz: iz, yaw: yaw, far: far });
      return { ok: true, text: 'Escalera puesta', flight: flight };
    }

    function tryStairs(playerPos) {
      if (!aimCamera) return { ok: false, text: 'No hay donde poner' };
      const cell = aim(playerPos);
      if (!cell) return { ok: false, text: 'No hay donde poner' };
      if (cell.level !== 0) return { ok: false, text: 'La escalera va en el piso' };
      return placeStairs(cell.ix, cell.iz, yawFromCamera(cell.far), playerPos, cell.far);
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
          const free = !reject(cell.ix, cell.iz, cell.level, playerPos, cell.far);
          const tint = free ? 0x88ff88 : 0xff6655;
          ghost.material.color.setHex(tint);
          ghostEdges.material.color.setHex(free ? 0x00ff00 : 0xff0000);
          const gl = cellLocal(cell.ix, cell.iz, cell.far);
          Utils.placeOnSphere(ghost, gl.frame, gl.lx, gl.lz, cell.level + 0.5);
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
        const fl = cellLocal(block.ix, block.iz, block.far);
        Utils.placeOnSphere(block.mesh, fl.frame, fl.lx, fl.lz, block.h + 0.5);
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
        grid.delete(cellKey(block.ix, block.iz, block.level, block.far));
        scene.remove(block.mesh);
        Colliders.remove(block.col);
        blocks.splice(0, 1);
      }
      while (stairs.length) removeFlight(stairs[0]);
    }

    function snapshot() {
      return {
        v: 3,
        blocks: blocks
          .filter((block) => !block.falling)
          .map((block) => ({ ix: block.ix, iz: block.iz, level: block.level, far: block.far ? 1 : 0, type: block.type })),
        stairs: stairsMeta.slice(),
      };
    }

    // Migra un ix viejo (v2 con FAR + remoto) a {ix, far} explícitos.
    function migrateIx(ix) {
      if (typeof ix !== 'number') return null;
      if (ix >= 1000000) return { ix: ix - 1000000, far: 1 };
      return { ix: ix, far: 0 };
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
        if (typeof d.iz !== 'number' || typeof d.level !== 'number') continue;
        if (!LOOK[d.type]) continue;
        let ix = d.ix;
        let far = d.far ? 1 : 0;
        if (typeof ix !== 'number') continue;
        if (data.v !== 3) {
          const m = migrateIx(ix);
          if (!m) continue;
          ix = m.ix;
          far = m.far;
        }
        if (grid.has(cellKey(ix, d.iz, d.level, far))) continue;
        addBlock(ix, d.iz, d.level, d.type, far);
        n += 1;
      }
      const st = Array.isArray(data.stairs) ? data.stairs : [];
      for (let i = 0; i < st.length; i++) {
        const d = st[i];
        if (typeof d.ix !== 'number' || typeof d.iz !== 'number') continue;
        let six = d.ix;
        let sfar = d.far ? 1 : 0;
        if (data.v !== 3) {
          const m = migrateIx(six);
          if (!m) continue;
          six = m.ix;
          sfar = m.far;
        }
        const r = placeStairs(six, d.iz, typeof d.yaw === 'number' ? d.yaw : 0, null, sfar);
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
      territoryCheck(ix, iz) { return territoryAt(ix, iz, 0); },
      propSpotFree(ix, iz, far) { return propSpotFree(ix, iz, far); },
      chartFor(far) { return chartFor(far ? 1 : 0); },
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
      cellLocal(ix, iz, far) { return cellLocal(ix, iz, far); },
      tileFor(ix, iz, far) { return tileForPX(ix, iz, far); },
      worldToCell: worldToCell,
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
      occupies(ix, iz, level, far) { return grid.has(cellKey(ix, iz, level, far ? 1 : 0)); },
      blockCount() { return blocks.length; },
      stairCount() { return stairs.length; },
      blocks: blocks,
      stairsList() { return stairs; },
    };
  };
})();
