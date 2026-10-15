// Recursos salvajes del planeta: nodos de madera, piedra y metal fuera del
// patio, puestos con la semilla del mapa. La misma semilla da el mismo campo
// en todas las máquinas: cada jugador carga localmente el mismo mapa y el
// online solo sincronizaría lo que cambia (jugadores, bloques, mesas).
(function () {
  window.Game = window.Game || {};

  const COUNT = 48;
  const HARVEST_RANGE = 4.6;
  const HARVEST_DAMAGE = 10;
  const RESPAWN_TIME = 20;
  const NODE_HP = { wood: 50, stone: 80, metal: 100 };
  const RES_ES = { wood: 'madera', stone: 'piedra', metal: 'metal' };
  // Banda alrededor del patio: ni adentro (es el tutorial) ni tan lejos
  // que nadie llegue caminando. En ángulo desde el polo.
  const BAND_MIN = 0.1;
  const BAND_MAX = 0.5;
  const MIN_SEPARATION = 0.035;
  // Mojones: conos que marcan zonas a lo lejos, como las viejas rocas.
  const LANDMARK_COUNT = 22;
  const LANDMARK_MIN = 0.08;
  const LANDMARK_SEPARATION = 0.06;
  // Campamentos: de acá salen las oleadas. En coords del chart del patio.
  const CAMP_COUNT = 6;
  // Sueltos: ramas, piedras y chatarra para juntar a mano en el wild,
  // puestos con la seed como todo lo demás. Se agarran al pisarlos.
  const LOOSIE_COUNT = 24;
  const LOOSIE_INFO = {
    wood: { amount: 2, color: 0x8B5A2B, emissive: 0x2a1408 },
    stone: { amount: 2, color: 0x9a9a9a, emissive: 0x3a3a3a },
    metal: { amount: 1, color: 0x7a8288, emissive: 0x22262a },
  };
  const LOOSIE_SEPARATION = 0.02;

  function buildMesh(type) {
    let geometry;
    let material;
    let height;
    let colH;
    if (type === 'wood') {
      geometry = new THREE.BoxGeometry(1, 1, 1);
      material = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.8, emissive: 0x3a2010, emissiveIntensity: 0.4 });
      height = 0.5;
      colH = 1;
    } else if (type === 'stone') {
      geometry = new THREE.SphereGeometry(0.55, 10, 8);
      material = new THREE.MeshStandardMaterial({ color: 0xC0C0C0, roughness: 0.55, metalness: 0.12, emissive: 0x3a3a3a, emissiveIntensity: 0.35 });
      height = 0.55;
      colH = 1.1;
    } else {
      geometry = new THREE.TetrahedronGeometry(0.75, 0);
      material = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.32, metalness: 0.8, emissive: 0x22262a, emissiveIntensity: 0.4 });
      height = 0.6;
      colH = 1.15;
    }
    const mesh = new THREE.Mesh(geometry, material);
    return { mesh: mesh, height: height, colH: colH };
  }

  window.Game.createWilds = function (scene, seed, opts) {
    const Config = window.Game.Config;
    const Colliders = window.Game.Colliders;
    const Utils = window.Game.Utils;
    const Inventory = window.Game.Inventory;
    const Audio = window.Game.Audio;
    const PlayerHealth = window.Game.PlayerHealth || null;
    const NN = window.Game.NeuralNet || null;
    // Opciones por nivel (zonas de recursos): misma semilla + mismas zonas
    // = mismo planeta en todas las máquinas.
    const O = opts || {};
    const COUNT = O.count != null ? O.count : 48;
    const BAND_MIN = O.bandMin != null ? O.bandMin : 0.1;
    const BAND_MAX = O.bandMax != null ? O.bandMax : 0.5;
    const LANDMARK_COUNT = O.landmarks != null ? O.landmarks : 22;
    const CAMP_COUNT = O.camps != null ? O.camps : 6;
    const LOOSIE_COUNT = O.loosies != null ? O.loosies : 24;
    const CRITTER_COUNT = O.critters != null ? O.critters : 10;
    // Comestibles salvajes: comida que cura y toxina que quema, para el
    // jugador, los robots y los bichos. Ver patrones emerger es la gracia.
    const WILD_FOOD = O.food != null ? O.food : 12;
    const WILD_TOXIN = O.toxin != null ? O.toxin : 8;
    const EDIBLE_RESPAWN = 30;
    const EDIBLE_EAT_DIST = 1.1;

    const rng = window.Game.makeRng ? window.Game.makeRng(seed) : Math.random;
    // Stream propio para la fauna: el mapa de nodos/rocas/sueltos queda
    // idéntico al de antes con la misma semilla.
    const crng = window.Game.makeRng ? window.Game.makeRng(((seed || 0) ^ 0x9e3779b9) >>> 0) : Math.random;
    const nodes = [];
    const landmarks = [];
    const spawnPoints = [];
    const loosies = [];
    const critters = [];
    const edibles = [];
    const notices = [];
    const raycaster = new THREE.Raycaster();
    const _up = new THREE.Vector3();
    const _feet = new THREE.Vector3();
    const _fwd = new THREE.Vector3();
    const _tmp = new THREE.Vector3();
    const _east = new THREE.Vector3();
    const _north = new THREE.Vector3();
    const _ref = new THREE.Vector3();
    let aimCamera = null;
    // Chart del polo para chequear campamentos libres (misma base que el
    // patio: LocalFrame es determinista para la misma ancla).
    const chart = window.Game.LocalFrame(new THREE.Vector3(0, Config.PLANET_RADIUS, 0));

    // Ignora lo salvaje: dos campos con la misma semilla tienen que dar el
    // mismo mapa aunque el primero ya haya registrado sus cajas.
    function notWild(c) { return !!c.wild; }

    // Zonas libres: nada salvaje pegado al spawn ni a la puerta (los
    // recursos viven en el resto del planeta). En metros, no en ángulo,
    // para que valga igual en planetas chicos y grandes.
    const spawnDir = chart.localToWorld(Config.SPAWN_X || 0, Config.SPAWN_Z || -2, 0).normalize();
    const antiDir = spawnDir.clone().negate();
    const KEEP_SPAWN_M = 12;
    const KEEP_DOOR_M = 15;
    function inKeepOut(dir) {
      const R = Config.PLANET_RADIUS;
      if (dir.angleTo(spawnDir) * R < KEEP_SPAWN_M) return true;
      if (dir.angleTo(antiDir) * R < KEEP_DOOR_M) return true;
      return false;
    }

    function rockBlocked(probe) {
      if (!Colliders) return false;
      return Colliders.blocked(probe, 0.4, { feet: 0, top: 1 }, null, notWild);
    }

    function directionTaken(dir, minSep, lists) {
      for (let l = 0; l < lists.length; l++) {
        const list = lists[l];
        for (let i = 0; i < list.length; i++) {
          if (list[i].dir.angleTo(dir) < minSep) return true;
        }
      }
      return false;
    }

    function polarDir(polarMin, polarMax, pow) {
      const az = rng() * Math.PI * 2;
      const polar = polarMin + Math.pow(rng(), pow || 0.9) * (polarMax - polarMin);
      return new THREE.Vector3(
        Math.sin(polar) * Math.cos(az),
        Math.cos(polar),
        Math.sin(polar) * Math.sin(az)
      ).normalize();
    }

    function scatterLandmarks() {
      const colors = Config.DARK_COLORS;
      let guard = 0;
      while (landmarks.length < LANDMARK_COUNT && guard < LANDMARK_COUNT * 30) {
        guard += 1;
        const dir = polarDir(LANDMARK_MIN, Math.PI - 0.05, 1);
        if (inKeepOut(dir)) continue;
        if (directionTaken(dir, LANDMARK_SEPARATION, [landmarks])) continue;
        const anchor = dir.clone().multiplyScalar(Config.PLANET_RADIUS);
        const probe = anchor.clone().addScaledVector(dir, 0.5);
        if (rockBlocked(probe)) continue;
        const coneRadius = 1.2 + rng() * 1.8;
        const coneHeight = 2.5 + rng() * 4;
        const color = colors[Math.floor(rng() * colors.length)];
        const mesh = new THREE.Mesh(
          new THREE.ConeGeometry(coneRadius, coneHeight, 7),
          new THREE.MeshStandardMaterial({
            color: color, roughness: 0.85, metalness: 0.08,
            flatShading: rng() > 0.5,
          })
        );
        const half = coneRadius * 0.5;
        const maxH = coneHeight * 0.5;
        mesh.position.copy(anchor);
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        mesh.setRotationFromQuaternion(quat);
        mesh.rotateOnWorldAxis(dir, rng() * Math.PI * 2);
        const frame = window.Game.frameFromQuaternion(mesh.position, mesh.quaternion);
        const col = Colliders.add(frame, -half, half, -half, half, 0, maxH);
        col.wild = true;
        scene.add(mesh);
        landmarks.push({ dir: dir, mesh: mesh, col: col });
      }
    }

    function scatter() {
      let guard = 0;
      while (nodes.length < COUNT && guard < COUNT * 30) {
        guard += 1;
        const dir = polarDir(BAND_MIN, BAND_MAX, 0.9);
        if (inKeepOut(dir)) continue;
        if (directionTaken(dir, MIN_SEPARATION, [nodes, landmarks])) continue;
        const anchor = dir.clone().multiplyScalar(Config.PLANET_RADIUS);
        // Fuera de las rocas: el campo sirve igual en todas las máquinas
        // porque las rocas usan la misma semilla.
        const probe = anchor.clone().addScaledVector(dir, 0.5);
        if (rockBlocked(probe)) continue;
        const r = rng();
        const type = r < 0.45 ? 'wood' : (r < 0.75 ? 'stone' : 'metal');
        const built = buildMesh(type);
        const frame = window.Game.LocalFrame(anchor);
        Utils.placeOnFrame(built.mesh, frame, 0, 0, built.height);
        const hp = NODE_HP[type];
        const col = Colliders.add(frame, -0.48, 0.48, -0.48, 0.48, 0, built.colH);
        col.wild = true;
        const node = {
          type: type, dir: dir, frame: frame,
          mesh: built.mesh, col: col, hp: hp, maxHp: hp,
          alive: true, respawn: 0,
        };
        built.mesh.userData.node = node;
        scene.add(built.mesh);
        nodes.push(node);
      }
    }

    function scatterCamps() {
      // Lejos del spawn pero en el chart del patio: el nuevo juega tranquilo
      // y las oleadas caminan hasta él. Ni se ven (vista 14) ni disparan (15).
      const sx = Config.SPAWN_X || 0;
      const sz = Config.SPAWN_Z || -2;
      const minD = Config.CAMP_MIN_SPAWN_DIST || 25;
      const maxD = Config.CAMP_MAX_SPAWN_DIST || 40;
      let guard = 0;
      while (spawnPoints.length < CAMP_COUNT && guard < CAMP_COUNT * 30) {
        guard += 1;
        const az = rng() * Math.PI * 2;
        const dist = minD + rng() * (maxD - minD);
        const x = Math.round((sx + Math.cos(az) * dist) * 10) / 10;
        const z = Math.round((sz + Math.sin(az) * dist) * 10) / 10;
        const probe = chart.localToWorld(x, z, 0.8);
        if (Colliders && Colliders.blocked(probe, 0.4, { feet: 0, top: 1.6 }, null, notWild)) continue;
        spawnPoints.push({ x: x, z: z });
      }
      while (spawnPoints.length < CAMP_COUNT) {
        spawnPoints.push({ x: 10, z: 24 });
      }
    }

    scatterLandmarks();
    scatter();
    scatterCamps();
    scatterLoosies();
    scatterCritters();
    scatterEdibles();

    // Comida y toxina regadas por el mapa (stream principal, al final: lo
    // anterior queda idéntico con la misma semilla). Las comen el jugador,
    // los robots y los bichos; reaparecen al rato en el mismo lugar.
    function scatterEdibles() {
      const kinds = [];
      for (let i = 0; i < WILD_FOOD; i++) kinds.push('food');
      for (let i = 0; i < WILD_TOXIN; i++) kinds.push('toxin');
      // Mezclar con el propio stream para no agrupar por tipo.
      for (let i = kinds.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const swap = kinds[i];
        kinds[i] = kinds[j];
        kinds[j] = swap;
      }
      let guard = 0;
      let k = 0;
      while (k < kinds.length && guard < kinds.length * 30) {
        guard += 1;
        const dir = polarDir(BAND_MIN, BAND_MAX, 0.9);
        if (inKeepOut(dir)) continue;
        if (directionTaken(dir, 0.02, [nodes, landmarks, loosies])) continue;
        const anchor = dir.clone().multiplyScalar(Config.PLANET_RADIUS);
        const probe = anchor.clone().addScaledVector(dir, 0.5);
        if (rockBlocked(probe)) continue;
        const id = kinds[k];
        k += 1;
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.22, 0.32, 8),
          new THREE.MeshStandardMaterial({
            color: id === 'food' ? 0x3d9a45 : 0xc43737,
            emissive: id === 'food' ? 0x145018 : 0x6a1010,
            emissiveIntensity: 0.7,
            roughness: 0.45,
          })
        );
        mesh.raycast = function () {};
        const basePos = anchor.clone().addScaledVector(dir, 0.35);
        mesh.position.copy(basePos);
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        mesh.setRotationFromQuaternion(quat);
        scene.add(mesh);
        edibles.push({
          dir: dir, edible: id, mesh: mesh, basePos: basePos,
          phase: edibles.length * 1.9, alive: true, respawn: 0,
        });
      }
    }

    // Come un comestible en un punto del mundo (robots y bichos lo usan con
    // su posición): devuelve 'food', 'toxin' o null.
    function eatEdibleAtWorld(worldPos) {
      for (let i = 0; i < edibles.length; i++) {
        const e = edibles[i];
        if (!e.alive) continue;
        if (e.basePos.distanceTo(worldPos) >= EDIBLE_EAT_DIST) continue;
        e.alive = false;
        try { scene.remove(e.mesh); } catch (err) {}
        e.respawn = EDIBLE_RESPAWN;
        return e.edible;
      }
      return null;
    }

    // Bichos salvajes con cerebro propio: deambulan, buscan sueltos para
    // comer y huyen del jugador. Fauna ambiente con la misma red neuronal
    // de los robots (5 sensores → giro, velocidad, ramoneo). Sin colisión:
    // atraviesan, no bloquean ni se cosechan.
    function scatterCritters() {
      let guard = 0;
      while (critters.length < CRITTER_COUNT && guard < CRITTER_COUNT * 30) {
        guard += 1;
        const dir = polarDir(BAND_MIN, BAND_MAX, 0.9);
        if (inKeepOut(dir)) continue;
        if (directionTaken(dir, 0.02, [nodes, landmarks])) continue;
        const anchor = dir.clone().multiplyScalar(Config.PLANET_RADIUS);
        const probe = anchor.clone().addScaledVector(dir, 0.5);
        if (rockBlocked(probe)) continue;
        const mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.3, 0),
          new THREE.MeshStandardMaterial({
            color: 0x4fc36a, emissive: 0x1a5c2e, emissiveIntensity: 0.8,
            roughness: 0.5, metalness: 0.1,
          })
        );
        mesh.raycast = function () {};
        const pos = anchor.clone().addScaledVector(dir, 0.35);
        mesh.position.copy(pos);
        scene.add(mesh);
        let brain = null;
        try {
          if (NN) brain = NN.fresh([5, 5, 3], crng);
        } catch (e) {
          brain = null;
        }
        critters.push({
          dir: dir, mesh: mesh, pos: pos,
          heading: crng() * Math.PI * 2,
          hunger: crng() * 0.5,
          sick: 0,
          phase: critters.length * 2.3,
          brain: brain,
          alive: true,
        });
      }
    }

    function updateCritters(dt, t, playerPos) {
      const time = t || 0;
      const R = Config.PLANET_RADIUS;
      _up.copy(playerPos).normalize();
      _feet.copy(playerPos).addScaledVector(_up, -Config.EYE_HEIGHT);
      for (let i = 0; i < critters.length; i++) {
        const c = critters[i];
        if (!c.alive) continue;
        const up = _tmp.copy(c.pos).normalize().clone();
        // Base tangente local para el rumbo.
        _ref.set(0, 1, 0);
        if (Math.abs(up.y) >= 0.99) _ref.set(1, 0, 0);
        _east.crossVectors(up, _ref).normalize();
        _north.crossVectors(_east, up).normalize();
        // Suelto o comida más cercana (comida, no toxina) en 14 m.
        let food = null;
        let foodDist = Infinity;
        let foodEdible = null;
        for (let k = 0; k < loosies.length; k++) {
          const item = loosies[k];
          if (!item.alive) continue;
          const d = item.basePos.distanceTo(c.pos);
          if (d < foodDist) {
            foodDist = d;
            food = item;
            foodEdible = null;
          }
        }
        for (let k = 0; k < edibles.length; k++) {
          const item = edibles[k];
          if (!item.alive || item.edible !== 'food') continue;
          const d = item.basePos.distanceTo(c.pos);
          if (d < foodDist) {
            foodDist = d;
            food = item;
            foodEdible = item;
          }
        }
        if (foodDist > 14) {
          food = null;
          foodDist = Infinity;
        }
        _fwd.copy(_east).multiplyScalar(Math.sin(c.heading))
          .addScaledVector(_north, Math.cos(c.heading));
        let foodDir = 0;
        if (food) {
          _tmp.copy(food.basePos).sub(c.pos);
          _tmp.addScaledVector(up, -_tmp.dot(up));
          if (_tmp.lengthSq() > 1e-6) {
            _tmp.normalize();
            foodDir = Math.atan2(
              (_fwd.y * _tmp.z - _fwd.z * _tmp.y) * up.x +
              (_fwd.z * _tmp.x - _fwd.x * _tmp.z) * up.y +
              (_fwd.x * _tmp.y - _fwd.y * _tmp.x) * up.z,
              _fwd.dot(_tmp)
            ) / Math.PI;
          }
        }
        const playerDist = c.pos.distanceTo(_feet);
        let turn = Math.sin(time * 0.7 + c.phase) * 0.4;
        let speed = 1.2;
        let graze = 0;
        if (c.brain) {
          let out = null;
          try {
            out = c.brain.forward([
              Math.max(0, Math.min(1, playerDist / 14)),
              food ? Math.max(0, Math.min(1, foodDist / 14)) : 1,
              foodDir,
              Math.max(0, Math.min(1, c.hunger)),
              0.5 + 0.5 * Math.sin(time * 1.3 + c.phase),
            ]);
          } catch (e) {
            out = null;
          }
          if (out) {
            turn = out[0] || 0;
            speed = 0.8 + ((out[1] || 0) * 0.5 + 0.5) * 2.2;
            graze = out[2] || 0;
          }
        }
        if (c.sick > 0) {
          c.sick -= dt;
          speed *= 0.45;
          if (c.sick <= 0) {
            c.sick = 0;
            c.mesh.material.color.setHex(0x4fc36a);
          }
        }
        if (playerDist < 4) {          // Huida: rumbo directo opuesto al jugador, a toda velocidad.
          _tmp.copy(c.pos).sub(_feet);
          _tmp.addScaledVector(up, -_tmp.dot(up));
          if (_tmp.lengthSq() > 1e-6) {
            _tmp.normalize();
            const want = Math.atan2(_tmp.dot(_east), _tmp.dot(_north));
            let diff = want - c.heading;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            c.heading += diff * Math.min(1, 6 * dt);
          }
          speed = 3.4;
        } else {
          c.heading += turn * 2.2 * dt;
          if (!food) speed *= 0.55;
        }
        _fwd.copy(_east).multiplyScalar(Math.sin(c.heading))
          .addScaledVector(_north, Math.cos(c.heading));
        c.pos.addScaledVector(_fwd, speed * dt);
        const bob = Math.sin(time * 6 + c.phase) * (0.03 + 0.1 * Math.max(0, graze));
        c.pos.copy(c.pos.clone().normalize().multiplyScalar(R + 0.35 + bob));
        c.mesh.position.copy(c.pos);
        c.mesh.lookAt(_tmp.copy(c.pos).addScaledVector(_fwd, 1).addScaledVector(up, 0.4));
        c.hunger = Math.min(1, c.hunger + dt * 0.015);
        if (food && foodDist < 0.8) {
          if (foodEdible) {
            foodEdible.alive = false;
            try { scene.remove(foodEdible.mesh); } catch (e) {}
            foodEdible.respawn = EDIBLE_RESPAWN;
          } else {
            food.alive = false;
            try { scene.remove(food.mesh); } catch (e) {}
          }
          c.hunger = 0;
        }
        // Pisó toxina: se enferma y se arrastra un rato (patrón visible).
        if (!c.sick) {
          for (let k = 0; k < edibles.length; k++) {
            const item = edibles[k];
            if (!item.alive || item.edible !== 'toxin') continue;
            if (item.basePos.distanceTo(c.pos) >= 0.8) continue;
            item.alive = false;
            try { scene.remove(item.mesh); } catch (e) {}
            item.respawn = EDIBLE_RESPAWN;
            c.sick = 6;
            c.mesh.material.color.setHex(0x6a8a3a);
            break;
          }
        }
      }
    }

    function scatterLoosies() {
      const keys = ['wood', 'stone', 'metal'];
      let guard = 0;
      let k = 0;
      while (loosies.length < LOOSIE_COUNT && guard < LOOSIE_COUNT * 30) {
        guard += 1;
        const dir = polarDir(BAND_MIN, BAND_MAX, 0.9);
        if (inKeepOut(dir)) continue;
        if (directionTaken(dir, LOOSIE_SEPARATION, [nodes, landmarks, loosies])) continue;
        const res = keys[k % keys.length];
        k += 1;
        const info = LOOSIE_INFO[res];
        const anchor = dir.clone().multiplyScalar(Config.PLANET_RADIUS);
        const probe = anchor.clone().addScaledVector(dir, 0.5);
        if (rockBlocked(probe)) continue;
        const mesh = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.22, 0),
          new THREE.MeshStandardMaterial({
            color: info.color, emissive: info.emissive, emissiveIntensity: 0.5,
            roughness: 0.85, metalness: res === 'metal' ? 0.6 : 0.05,
          })
        );
        const basePos = anchor.clone().addScaledVector(dir, 0.25);
        mesh.position.copy(basePos);
        scene.add(mesh);
        loosies.push({
          dir: dir, res: res, amount: info.amount,
          mesh: mesh, basePos: basePos, phase: loosies.length * 1.7,
          alive: true,
        });
      }
    }

    function aimedNode() {
      if (!aimCamera) return null;
      raycaster.setFromCamera({ x: 0, y: 0 }, aimCamera);
      const meshes = nodes.filter((node) => node.alive).map((node) => node.mesh);
      if (!meshes.length) return null;
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length || hits[0].distance > HARVEST_RANGE) return null;
      return hits[0].object.userData.node || null;
    }

    function toolHint(node) {
      const tool = Inventory.activeTool;
      if (node.type === 'wood') {
        return tool === 'axe' ? '' : 'Madera salvaje: equipá el hacha (2)';
      }
      return tool === 'pickaxe' ? '' : 'Piedra y metal: equipá el pico (3)';
    }

    return {
      nodes: nodes,
      landmarks: landmarks,
      spawnPoints: spawnPoints,
      loosies: loosies,
      critters: critters,
      edibles: edibles,
      seed: seed,

      setCamera(camera) { aimCamera = camera; },

      // Comestible salvaje en un punto del mundo (lo usan robots y bichos).
      eatEdibleAtWorld: eatEdibleAtWorld,

      drainNotices() {
        if (!notices.length) return [];
        const out = notices.slice();
        notices.length = 0;
        return out;
      },

      tryHarvest() {
        const node = aimedNode();
        if (!node) return null;
        const tool = Inventory.activeTool;
        const wood = node.type === 'wood';
        if (tool === 'hands' || tool === 'hammer' || tool === 'pistol') {
          return wood ? 'La madera se cosecha con el hacha (2)' : 'Piedra y metal se cosechan con el pico (3)';
        }
        if (wood && tool !== 'axe') return 'La madera se cosecha con el hacha (2)';
        if (!wood && tool !== 'pickaxe') return 'Piedra y metal se cosechan con el pico (3)';
        node.hp -= HARVEST_DAMAGE;
        Inventory.addResource(node.type, 1);
        if (Audio) Audio.hit();
        if (node.hp <= 0) {
          node.alive = false;
          node.mesh.visible = false;
          node.col.active = false;
          node.respawn = RESPAWN_TIME;
          if (Audio) Audio.pickup('ammo');
        }
        const label = RES_ES[node.type];
        return label.charAt(0).toUpperCase() + label.slice(1) + ' +1 (' + Inventory.count(node.type) + ')';
      },

      getPrompt() {
        const node = aimedNode();
        if (!node) return '';
        const hint = toolHint(node);
        if (hint) return hint;
        const name = RES_ES[node.type];
        return 'Clic: cosechar ' + name + ' salvaje';
      },

      update(dt, t, playerPos) {
        const time = t || 0;
        nodes.forEach((node) => {
          if (node.alive) {
            const k = Math.max(0.55, node.hp / node.maxHp);
            node.mesh.scale.set(k, k, k);
            return;
          }
          node.respawn -= dt;
          if (node.respawn > 0) return;
          node.alive = true;
          node.hp = node.maxHp;
          node.col.active = true;
          node.mesh.visible = true;
          node.mesh.scale.set(1, 1, 1);
        });
        loosies.forEach((item) => {
          if (!item.alive) return;
          item.mesh.position.copy(item.basePos)
            .addScaledVector(item.dir, Math.sin(time * 2 + item.phase) * 0.06);
          item.mesh.rotation.y += dt * 1.2;
          if (!playerPos) return;
          // A los pies, no a los ojos (la cámara va 1.6 arriba).
          _up.copy(playerPos).normalize();
          _feet.copy(playerPos).addScaledVector(_up, -Config.EYE_HEIGHT);
          if (item.basePos.distanceTo(_feet) >= 1.3) return;
          item.alive = false;
          try { scene.remove(item.mesh); } catch (e) {}
          Inventory.addResource(item.res, item.amount);
          if (Audio) Audio.pickup('ammo');
          const label = RES_ES[item.res];
          notices.push('+' + item.amount + ' ' + label + ' (suelto)');
        });
        edibles.forEach((item) => {
          if (!item.alive) {
            item.respawn -= dt;
            if (item.respawn <= 0) {
              item.alive = true;
              item.respawn = 0;
              scene.add(item.mesh);
            }
            return;
          }
          item.mesh.position.copy(item.basePos)
            .addScaledVector(item.dir, Math.sin(time * 2 + item.phase) * 0.06);
          item.mesh.rotation.y += dt * 0.8;
          if (!playerPos) return;
          _up.copy(playerPos).normalize();
          _feet.copy(playerPos).addScaledVector(_up, -Config.EYE_HEIGHT);
          if (item.basePos.distanceTo(_feet) >= EDIBLE_EAT_DIST) return;
          if (item.edible === 'food') {
            // Llena no se gasta: queda para cuando la necesites.
            if (!PlayerHealth || PlayerHealth.hp >= PlayerHealth.maxHp) return;
            PlayerHealth.heal(30);
            notices.push('Comida +30 (auto)');
          } else {
            if (PlayerHealth) PlayerHealth.damage(30);
            notices.push('¡Toxina! −30 (auto)');
          }
          item.alive = false;
          try { scene.remove(item.mesh); } catch (e) {}
          item.respawn = EDIBLE_RESPAWN;
          if (Audio) Audio.pickup('ammo');
        });
        if (playerPos && dt > 0) updateCritters(dt, time, playerPos);
      },

      dispose() {
        nodes.forEach((node) => {
          scene.remove(node.mesh);
          if (node.col && Colliders) Colliders.remove(node.col);
          node.alive = false;
        });
        nodes.length = 0;
        critters.forEach((c) => {
          try { scene.remove(c.mesh); } catch (e) {}
          c.alive = false;
        });
        critters.length = 0;
        edibles.forEach((item) => {
          try { scene.remove(item.mesh); } catch (e) {}
          item.alive = false;
        });
        edibles.length = 0;
        loosies.forEach((item) => {
          try { scene.remove(item.mesh); } catch (e) {}
          item.alive = false;
        });
        loosies.length = 0;
        landmarks.forEach((mark) => {
          scene.remove(mark.mesh);
          if (mark.col && Colliders) Colliders.remove(mark.col);
        });
        landmarks.length = 0;
        spawnPoints.length = 0;
      },
    };
  };
})();
