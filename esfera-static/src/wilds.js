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
    // Opciones por nivel (zonas de recursos): misma semilla + mismas zonas
    // = mismo planeta en todas las máquinas.
    const O = opts || {};
    const COUNT = O.count != null ? O.count : 48;
    const BAND_MIN = O.bandMin != null ? O.bandMin : 0.1;
    const BAND_MAX = O.bandMax != null ? O.bandMax : 0.5;
    const LANDMARK_COUNT = O.landmarks != null ? O.landmarks : 22;
    const CAMP_COUNT = O.camps != null ? O.camps : 6;
    const LOOSIE_COUNT = O.loosies != null ? O.loosies : 24;

    const rng = window.Game.makeRng ? window.Game.makeRng(seed) : Math.random;
    const nodes = [];
    const landmarks = [];
    const spawnPoints = [];
    const loosies = [];
    const notices = [];
    const raycaster = new THREE.Raycaster();
    const _up = new THREE.Vector3();
    const _feet = new THREE.Vector3();
    let aimCamera = null;
    // Chart del polo para chequear campamentos libres (misma base que el
    // patio: LocalFrame es determinista para la misma ancla).
    const chart = window.Game.LocalFrame(new THREE.Vector3(0, Config.PLANET_RADIUS, 0));

    // Ignora lo salvaje: dos campos con la misma semilla tienen que dar el
    // mismo mapa aunque el primero ya haya registrado sus cajas.
    function notWild(c) { return !!c.wild; }

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

    function scatterLoosies() {
      const keys = ['wood', 'stone', 'metal'];
      let guard = 0;
      let k = 0;
      while (loosies.length < LOOSIE_COUNT && guard < LOOSIE_COUNT * 30) {
        guard += 1;
        const dir = polarDir(BAND_MIN, BAND_MAX, 0.9);
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
      seed: seed,

      setCamera(camera) { aimCamera = camera; },

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
      },

      dispose() {
        nodes.forEach((node) => {
          scene.remove(node.mesh);
          if (node.col && Colliders) Colliders.remove(node.col);
          node.alive = false;
        });
        nodes.length = 0;
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
