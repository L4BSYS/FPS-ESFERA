(function () {
  window.Game = window.Game || {};

  const HARVEST_RANGE = 4.6;
  // Vida de nodo de La Grieta (50 / 80 / 100). El golpe saca 10:
  // allá la eficiencia es 2 y un nodo pide decenas de clics.
  const HARVEST_DAMAGE = 10;
  const NODE_HP = { wood: 50, stone: 80, metal: 100 };

  const RES_ES = { wood: 'madera', stone: 'piedra', metal: 'metal' };

  const RECIPES = [
    { name: 'Martillo', cost: { wood: 4, stone: 2 }, need: null, tool: 'hammer' },
    { name: 'Hacha', cost: { wood: 4, stone: 3 }, need: 'hammer', tool: 'axe' },
    { name: 'Pico', cost: { wood: 2, stone: 6 }, need: 'axe', tool: 'pickaxe' },
    { name: 'Pistola (+6 balas)', cost: { metal: 10, wood: 4 }, need: 'pickaxe', tool: 'pistol', ammo: 6 },
    { name: 'Mesa de trabajo', cost: { wood: 6, stone: 4 }, placeBench: true },
    { name: 'Balas x12', cost: { metal: 3, wood: 2 }, ammo: 12 },
    { name: 'Venda (+30 vida)', cost: { wood: 4, stone: 2 }, heal: 30 },
    { name: 'Reparar mesa (+100)', cost: { wood: 3, stone: 2 }, repair: true },
  ];
  window.Game.CraftRecipes = RECIPES;

  function costText(cost) {
    return Object.keys(cost).map((key) => cost[key] + ' ' + RES_ES[key]).join(' + ');
  }

  /**
   * Un solo chart en el polo: el tutorial corto de La Grieta.
   * Coordenadas (x, z) son las del LocalFrame. El jugador nace en z = -2
   * mirando hacia +z (tangentZ con yaw 0).
   */
  window.Game.createCourtyard = function (scene) {
    const Config = window.Game.Config;
    const Utils = window.Game.Utils;
    const Colliders = window.Game.Colliders;
    const Inventory = window.Game.Inventory;
    const Audio = window.Game.Audio;
    const PlayerHealth = window.Game.PlayerHealth;

    const frame = window.Game.LocalFrame(new THREE.Vector3(0, Config.PLANET_RADIUS, 0));
    const nodes = [];
    const pickups = [];
    const interactables = [];
    const benches = [];
    const raycaster = new THREE.Raycaster();
    let aimCamera = null;
    let weaponRef = null;
    let buildRef = null;
    let openBench = null;
    let totemCount = 0;
    let playerPos = null;
    let lastHarvest = 0;

    function addBlock(x, z, w, h, d, color) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.04, emissive: 0x1a1008, emissiveIntensity: 0.4 })
      );
      Utils.placeOnFrame(mesh, frame, x, z, h / 2);
      scene.add(mesh);
      Colliders.add(frame, x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0, h);
      return mesh;
    }

    function makeSign(lines) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 280;
      const g = canvas.getContext('2d');
      g.fillStyle = '#140e08';
      g.fillRect(0, 0, 512, 280);
      g.strokeStyle = '#d7b173';
      g.lineWidth = 8;
      g.strokeRect(10, 10, 492, 260);
      g.fillStyle = '#f3e6c8';
      g.font = '32px Segoe UI, sans-serif';
      lines.forEach((line, i) => g.fillText(line, 36, 78 + i * 52));
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2.5, 1.35),
        new THREE.MeshBasicMaterial({ map: tex })
      );
      mesh.raycast = function () {};
      return mesh;
    }

    function placeSign(lines, x, z) {
      const mesh = makeSign(lines);
      Utils.placeOnFrame(mesh, frame, x, z, 1.35);
      // El plano mira a +Z. rotateY(π) lo da vuelta hacia el jugador, que está en −z.
      mesh.rotateY(Math.PI);
      scene.add(mesh);
    }

    function addNode(type, x, z) {
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
      Utils.placeOnFrame(mesh, frame, x, z, height);
      const hp = NODE_HP[type];
      const col = Colliders.add(frame, x - 0.48, x + 0.48, z - 0.48, z + 0.48, 0, colH);
      const node = { type, x, z, mesh, col, hp: hp, maxHp: hp, alive: true, respawn: 0 };
      mesh.userData.node = node;
      scene.add(mesh);
      nodes.push(node);
    }

    function addPickup(spec) {
      Utils.placeOnFrame(spec.mesh, frame, spec.x, spec.z, spec.base);
      spec.mesh.traverse((child) => { child.raycast = function () {}; });
      scene.add(spec.mesh);
      pickups.push(spec);
      interactables.push(spec);
    }

    const toolIds = [];
    const TOOL_LABEL = {
      axe: ['el hacha', '2'],
      pickaxe: ['el pico', '3'],
      hammer: ['el martillo', '4'],
      pistol: ['la pistola', '5'],
    };

    function toolPickup(id, x, z, listed, fromCreator) {
      const label = TOOL_LABEL[id] || [id, '?'];
      const group = new THREE.Group();
      if (id === 'pistol') {
        const dark = new THREE.MeshStandardMaterial({
          color: 0x2a2a2a, metalness: 0.7, roughness: 0.35, emissive: 0x222222, emissiveIntensity: 0.45,
        });
        const grip = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.22, 0.1),
          new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.7 })
        );
        grip.position.y = 0.12;
        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.4), dark);
        slide.position.set(0, 0.28, -0.04);
        group.add(grip, slide);
      } else {
        const color = id === 'axe' ? 0xd4652e : (id === 'pickaxe' ? 0x5d78e8 : 0xc5ccd2);
        const handle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.07, 0.72, 6),
          new THREE.MeshStandardMaterial({ color: 0x6b3e22, roughness: 0.7 })
        );
        const head = new THREE.Mesh(
          new THREE.BoxGeometry(id === 'axe' ? 0.42 : 0.5, 0.14, 0.08),
          new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.35, emissive: color, emissiveIntensity: 0.35 })
        );
        head.position.y = 0.36;
        group.add(handle, head);
      }
      if (listed !== false) toolIds.push(id);
      const spec = {
        mesh: group, x, z, base: 0.55, phase: x, alive: true, radius: 1.7,
        creator: !!fromCreator,
        prompt() { return 'E agarrar ' + label[0]; },
        use() {
          this.alive = false;
          scene.remove(this.mesh);
          Inventory.giveTool(id);
          if (Audio) Audio.pickup('ammo');
          return { type: 'flash', text: 'Agarraste ' + label[0] + '. Tecla ' + label[1] + '.' };
        },
      };
      addPickup(spec);
      return spec;
    }

    function spawnMedkit(x, z, fromCreator) {
      const kit = new THREE.Group();
      const kitBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.32, 0.42),
        new THREE.MeshStandardMaterial({ color: 0xf2f2f2, emissive: 0x882222, emissiveIntensity: 0.55, roughness: 0.4 })
      );
      const kitCross = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.08, 0.08),
        new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xaa0000, emissiveIntensity: 0.8 })
      );
      kitCross.position.z = 0.22;
      const kitCrossFront = kitCross.clone();
      kitCrossFront.position.z = -0.22;
      kit.add(kitBox, kitCross, kitCrossFront);
      const spec = {
        mesh: kit, x: x, z: z, base: 0.4, phase: x + z, alive: true, radius: 1.6,
        creator: !!fromCreator, kind: 'medkit',
        prompt() { return 'E botiquín'; },
        use() {
          if (PlayerHealth.hp >= PlayerHealth.maxHp) {
            return { type: 'flash', text: 'La vida ya está llena' };
          }
          this.alive = false;
          scene.remove(this.mesh);
          PlayerHealth.heal(30);
          if (Audio) Audio.pickup('health');
          return { type: 'flash', text: 'Botiquín +30' };
        },
      };
      addPickup(spec);
      return spec;
    }

    spawnMedkit(0, 4, false);

    toolPickup('axe', -2.4, 7.2);
    toolPickup('pickaxe', 2.4, 7.2);
    toolPickup('pistol', 2.2, 10.2);

    function spawnKey(x, z, fromCreator) {
      const key = new THREE.Group();
      const bow = new THREE.Mesh(
        new THREE.TorusGeometry(0.16, 0.04, 8, 14),
        new THREE.MeshStandardMaterial({ color: 0xffd76a, metalness: 0.85, roughness: 0.25, emissive: 0xaa8800, emissiveIntensity: 0.7 })
      );
      bow.rotation.x = Math.PI / 2;
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.48, 6),
        bow.material
      );
      shaft.position.y = -0.28;
      key.add(bow, shaft);
      const spec = {
        mesh: key, x: x, z: z, base: 0.7, phase: x, alive: true, radius: 1.7,
        creator: !!fromCreator, kind: 'key',
        prompt() { return 'E agarrar la llave dorada'; },
        use() {
          this.alive = false;
          scene.remove(this.mesh);
          Inventory.setKey(true);
          if (Audio) Audio.pickup('ammo');
          return { type: 'flash', text: 'Llave dorada. La puerta está al oeste.' };
        },
      };
      addPickup(spec);
      return spec;
    }

    spawnKey(-6.2, 15.4);

    addNode('wood', -3.4, 11);
    addNode('metal', 0, 11.4);
    addNode('stone', 3.4, 11);

    addBlock(-5.4, 13.2, 1, 1, 1, 0x8b5a2b);
    addBlock(-6.4, 13.2, 1, 1, 1, 0x8b5a2b);
    addBlock(-7.7, 18.2, 1, 2.4, 1, 0x5a3d28);
    addBlock(-4.3, 18.2, 1, 2.4, 1, 0x5a3d28);

    const door = { x: -6, z: 18.2, w: 1.6, h: 2.5, d: 0.28, state: 'closed', lift: 0 };
    const doorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(door.w, door.h, door.d),
      new THREE.MeshStandardMaterial({ color: 0x8a6232, roughness: 0.6, emissive: 0x553300, emissiveIntensity: 0.45 })
    );
    scene.add(doorMesh);
    const doorCol = Colliders.add(
      frame,
      door.x - door.w / 2, door.x + door.w / 2,
      door.z - door.d / 2, door.z + door.d / 2,
      0, door.h
    );
    interactables.push({
      x: door.x, z: door.z, radius: 2.3, alive: true,
      prompt() {
        if (!Inventory.hasKey) return 'E puerta — te falta la llave';
        if (door.state === 'open' || door.state === 'opening') return 'E cerrar la puerta';
        return 'E abrir la puerta';
      },
      use() {
        if (!Inventory.hasKey) {
          if (Audio) Audio.button();
          return { type: 'flash', text: 'Necesitás la llave dorada para abrir esta puerta' };
        }
        if (door.state === 'open' || door.state === 'opening') {
          door.state = 'closing';
          if (Audio) Audio.door();
          return { type: 'flash', text: 'La puerta se cierra' };
        }
        door.state = 'opening';
        doorCol.active = false;
        if (Audio) Audio.door();
        return { type: 'flash', text: 'La puerta se abre' };
      },
    });

    // --- Territorio: la zona se centra en las mesas vivas del jugador ---
    // (declarado antes de makeBench porque la primera mesa lo usa).
    const TERRITORY_RADIUS = 9;
    let territoryRing = null;
    let territorySig = '';

    function makeBench(x, z) {
      const group = new THREE.Group();
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.75, emissive: 0x2a1408, emissiveIntensity: 0.35 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.85), woodMat);
      top.position.y = 0.78;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.78, 0.18), woodMat);
      leg.position.y = 0.39;
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffcc88 })
      );
      lamp.position.y = 1.15;
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.08, 0.08),
        new THREE.MeshBasicMaterial({ color: 0x4CAF50 })
      );
      bar.position.y = 1.35;
      bar.raycast = function () {};
      group.add(top, leg, lamp, bar);
      Utils.placeOnFrame(group, frame, x, z, 0);
      scene.add(group);
      const col = Colliders.add(frame, x - 0.75, x + 0.75, z - 0.45, z + 0.45, 0, 0.95);
      const bench = { x: x, z: z, mesh: group, bar: bar, col: col, hp: 300, maxHp: 300, alive: true, owner: 'player' };
      col.kind = 'bench';
      col.ref = bench;
      benches.push(bench);
      interactables.push({
        x: x, z: z, radius: 2.5, alive: true, bench: bench,
        prompt() { return bench.hp > 0 ? 'E mesa de trabajo' : ''; },
        use() {
          if (bench.hp <= 0) return { type: 'none' };
          openBench = bench;
          return { type: 'open-craft' };
        },
      });
      updateTerritoryRing();
      return bench;
    }

    function paintBench(bench) {
      const ratio = Math.max(0, bench.hp / bench.maxHp);
      bench.bar.scale.x = Math.max(0.05, ratio);
      bench.bar.material.color.setHex(ratio > 0.6 ? 0x4CAF50 : (ratio > 0.3 ? 0xFFA500 : 0xff3333));
    }

    makeBench(0, 16.2);
    benches[0].creator = false;

    // --- Territorio: helpers (el anillo sigue a la mesa viva) ---

    function aliveBenches() {
      return benches.filter((bench) => bench && bench.alive && bench.hp > 0);
    }

    function territoryStatus() {
      const alive = aliveBenches();
      return {
        active: alive.length > 0,
        radius: TERRITORY_RADIUS,
        centers: alive.map((bench) => ({ x: bench.x, z: bench.z })),
      };
    }

    function isInTerritory(ix, iz) {
      const alive = aliveBenches();
      if (!alive.length) return false;
      for (let i = 0; i < alive.length; i++) {
        if (Math.hypot(ix - alive[i].x, iz - alive[i].z) <= TERRITORY_RADIUS) return true;
      }
      return false;
    }

    function updateTerritoryRing() {
      try {
        const alive = aliveBenches();
        if (!alive.length) {
          if (territoryRing) territoryRing.visible = false;
          territorySig = 'none';
          return;
        }
        // Una marca por mesa viva: la principal sigue a la primera.
        if (!territoryRing) {
          territoryRing = new THREE.Mesh(
            new THREE.RingGeometry(TERRITORY_RADIUS - 0.35, TERRITORY_RADIUS, 56),
            new THREE.MeshBasicMaterial({
              color: 0x33ff66, transparent: true, opacity: 0.5,
              side: THREE.DoubleSide, depthWrite: false,
            })
          );
          territoryRing.raycast = function () {};
          scene.add(territoryRing);
        }
        const main = alive[0];
        Utils.placeOnFrame(territoryRing, frame, main.x, main.z, 0.07);
        territoryRing.rotateX(-Math.PI / 2);
        territoryRing.visible = true;
        territorySig = alive.map((bench) => bench.x + ',' + bench.z).join(';');
      } catch (e) {}
    }

    // --- API Creador (como el FPS): poner/sacar mesas sin costo ---
    function placeBenchAt(ix, iz, fromCreator) {
      const x = ix;
      const z = iz;
      const list = Colliders.all();
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c.active || c.frame !== frame) continue;
        if (x + 0.75 <= c.minX || x - 0.75 >= c.maxX || z + 0.45 <= c.minZ || z - 0.45 >= c.maxZ) continue;
        const top = c.maxH == null ? 100 : c.maxH;
        const bottom = c.minH == null ? -1 : c.minH;
        if (top <= 0 || bottom >= 0.95) continue;
        return { ok: false, text: 'Ese lugar está ocupado' };
      }
      const bench = makeBench(x, z);
      bench.creator = !!fromCreator;
      paintBench(bench);
      return { ok: true, text: 'Mesa puesta', bench: bench };
    }

    function removeBench(bench) {
      const at = benches.indexOf(bench);
      if (at < 0) return false;
      scene.remove(bench.mesh);
      if (bench.col) Colliders.remove(bench.col);
      for (let i = interactables.length - 1; i >= 0; i--) {
        if (interactables[i].bench === bench) interactables.splice(i, 1);
      }
      benches.splice(at, 1);
      updateTerritoryRing();
      return true;
    }

    function tryDeleteBench() {
      if (!aimCamera) return null;
      raycaster.setFromCamera({ x: 0, y: 0 }, aimCamera);
      const meshes = benches.map((bench) => bench.mesh);
      if (!meshes.length) return null;
      const hits = raycaster.intersectObjects(meshes, true);
      if (!hits.length || hits[0].distance > 16) return null;
      let p = hits[0].object;
      while (p) {
        for (let i = 0; i < benches.length; i++) {
          if (benches[i].mesh === p) {
            const bench = benches[i];
            removeBench(bench);
            return { ok: true, text: 'Mesa destruida' };
          }
        }
        p = p.parent;
      }
      return null;
    }

    function clearCreatorBenches() {
      for (let i = benches.length - 1; i >= 0; i--) {
        if (benches[i].creator) removeBench(benches[i]);
      }
    }

    function snapshotBenches() {
      return benches
        .filter((bench) => bench.creator)
        .map((bench) => ({ x: bench.x, z: bench.z, hp: Math.round(bench.hp) }));
    }

    function restoreBenches(list) {
      if (!Array.isArray(list)) return 0;
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        if (typeof d.x !== 'number' || typeof d.z !== 'number') continue;
        const r = placeBenchAt(Math.round(d.x), Math.round(d.z), true);
        if (r.ok) {
          if (typeof d.hp === 'number') {
            r.bench.hp = Math.max(1, Math.min(r.bench.maxHp, d.hp));
            paintBench(r.bench);
          }
          n += 1;
        }
      }
      return n;
    }

    function placeTotem(lines, x, z) {
      const group = new THREE.Group();
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.9, emissive: 0x222222, emissiveIntensity: 0.3 });
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85, emissive: 0x2a1408, emissiveIntensity: 0.35 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 0.28, 8), stoneMat);
      base.position.y = 0.14;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.45, 6), woodMat);
      pole.position.y = 0.95;
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.2),
        new THREE.MeshStandardMaterial({ color: 0x4CAF50, emissive: 0x1a5c1a, emissiveIntensity: 0.8, roughness: 0.4 })
      );
      gem.position.y = 1.85;
      group.add(base, pole, gem);
      Utils.placeOnFrame(group, frame, x, z, 0);
      scene.add(group);
      totemCount += 1;
      interactables.push({
        x: x, z: z, radius: 2.1, alive: true, lines: lines,
        prompt() { return 'E leer'; },
        use() { return { type: 'totem', lines: lines }; },
      });
    }

    placeTotem(['Agarrá el hacha, el pico y la pistola con E.', '1 a 5, la rueda o el cinturón los equipan.', 'Clic en un nodo cosecha.'], -3.5, 2.4);
    placeTotem(['Hacha: madera.', 'Pico: piedra y metal.', 'Q abre la mochila.'], 3.6, 8.6);
    placeTotem(['Martillo: clic pone, derecho borra.', 'C cambia el material. V escalera.', 'La puerta del oeste pide llave.'], 3.5, 14.6);

    function pocketPickup(id, x, z, promptText, fullText, gotText, fromCreator) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.32, 8),
        new THREE.MeshStandardMaterial({
          color: id === 'food' ? 0x3d9a45 : 0xc43737,
          emissive: id === 'food' ? 0x145018 : 0x6a1010,
          emissiveIntensity: 0.7,
          roughness: 0.45,
        })
      );
      group.add(mesh);
      const spec = {
        mesh: group, x: x, z: z, base: 0.4, phase: x + z, alive: true, radius: 1.7,
        creator: !!fromCreator, kind: id,
        prompt() { return promptText; },
        use() {
          const added = Inventory.addStack(id, 1);
          if (!added) return { type: 'flash', text: fullText };
          this.alive = false;
          scene.remove(this.mesh);
          if (Audio) Audio.pickup(id === 'food' ? 'health' : 'ammo');
          return { type: 'flash', text: gotText };
        },
      };
      addPickup(spec);
      if (id === 'toxin' && !fromCreator) spec.hazard = true;
      if (id === 'toxin' && fromCreator) spec.hazard = true;
      return spec;
    }

    pocketPickup('food', 1.6, 5.6, 'E agarrar comida', 'No entra más comida', 'Comida en la mochila. Q para usarla.');
    pocketPickup('toxin', 4.4, 13.2, 'E agarrar toxina', 'No entra más toxina', 'Toxina guardada. No la uses.');
    pickups[pickups.length - 1].hazard = true;

    function spawnAmmo(x, z, rounds, fromCreator) {
      const ammoBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.16, 0.42),
        new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.4, roughness: 0.45, emissive: 0x222222, emissiveIntensity: 0.4 })
      );
      const spec = {
        mesh: ammoBox, x: x, z: z, base: 0.28, phase: x + z, alive: true, radius: 1.6, rounds: rounds,
        creator: !!fromCreator, kind: 'ammo',
        prompt() { return 'E agarrar balas'; },
        use() {
          this.alive = false;
          scene.remove(this.mesh);
          if (weaponRef) weaponRef.addReserve(this.rounds || 12);
          if (Audio) Audio.pickup('ammo');
          return { type: 'flash', text: 'Balas +' + (this.rounds || 12) };
        },
      };
      addPickup(spec);
      return spec;
    }

    spawnAmmo(0, 9, 12);

    const yardLight = new THREE.PointLight(0xfff1d6, 6, 70, 1);
    yardLight.position.copy(frame.localToWorld(0, 12, 4));
    scene.add(yardLight);
    const gateLight = new THREE.PointLight(0xffbb77, 3, 22, 1);
    gateLight.position.copy(frame.localToWorld(-6, 17, 2.6));
    scene.add(gateLight);

    // Sin losa rectangular: el piso es la esfera misma. La losa vieja
    // (22x30) flotaba ~0.2 en los bordes porque la esfera se curva.

    // --- Pickups del Creador: herramientas, arma, comida, toxina, balas, llave, botiquín ---
    const CREATOR_PICKUP_KINDS = ['axe', 'pickaxe', 'hammer', 'pistol', 'food', 'toxin', 'ammo', 'key', 'medkit'];
    const CREATOR_PICKUP_NAMES = {
      axe: 'hacha', pickaxe: 'pico', hammer: 'martillo', pistol: 'pistola',
      food: 'comida', toxin: 'toxina', ammo: 'balas', key: 'llave', medkit: 'botiquín',
    };

    function placeCreatorPickup(kind, ix, iz) {
      if (CREATOR_PICKUP_KINDS.indexOf(kind) < 0) return { ok: false, text: 'Eso no se puede poner' };
      const x = ix;
      const z = iz;
      for (let i = 0; i < pickups.length; i++) {
        const p = pickups[i];
        if (!p.alive || !p.creator) continue;
        if (Math.abs(p.x - x) < 0.9 && Math.abs(p.z - z) < 0.9) {
          return { ok: false, text: 'Ese lugar está ocupado' };
        }
      }
      // Igual que los bloques: no poner dentro de puerta, bloques, mesas o nodos.
      if (buildRef && buildRef.occupies && buildRef.occupies(ix, iz, 0)) {
        return { ok: false, text: 'Ese lugar está ocupado' };
      }
      try {
        const probe = frame.localToWorld(x, z, 0.5);
        if (Colliders && Colliders.blocked(probe, 0.3, { feet: 0, top: 1.0 })) {
          return { ok: false, text: 'Ese lugar está ocupado' };
        }
      } catch (e) {}
      let spec = null;
      if (TOOL_LABEL[kind]) spec = toolPickup(kind, x, z, false, true);
      else if (kind === 'food') spec = pocketPickup('food', x, z, 'E agarrar comida', 'No entra más comida', 'Comida en la mochila. Q para usarla.', true);
      else if (kind === 'toxin') spec = pocketPickup('toxin', x, z, 'E agarrar toxina', 'No entra más toxina', 'Toxina guardada. No la uses.', true);
      else if (kind === 'ammo') spec = spawnAmmo(x, z, 12, true);
      else if (kind === 'key') spec = spawnKey(x, z, true);
      else if (kind === 'medkit') spec = spawnMedkit(x, z, true);
      if (!spec) return { ok: false, text: 'No se pudo poner' };
      return { ok: true, text: 'Puesto: ' + (CREATOR_PICKUP_NAMES[kind] || kind), pickup: spec };
    }

    function removeCreatorPickup(spec) {
      if (!spec) return false;
      spec.alive = false;
      try { scene.remove(spec.mesh); } catch (e) {}
      const at = interactables.indexOf(spec);
      if (at >= 0) interactables.splice(at, 1);
      return true;
    }

    function tryDeleteCreatorPickupAt(ix, iz) {
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < pickups.length; i++) {
        const p = pickups[i];
        if (!p.alive || !p.creator) continue;
        const d = Math.hypot(p.x - ix, p.z - iz);
        if (d < 1.1 && d < bestD) {
          best = p;
          bestD = d;
        }
      }
      if (!best) return null;
      removeCreatorPickup(best);
      return { ok: true, text: 'Saque: ' + (CREATOR_PICKUP_NAMES[best.kind] || best.kind || 'cosa') };
    }

    function clearCreatorPickups() {
      for (let i = pickups.length - 1; i >= 0; i--) {
        if (pickups[i].creator && pickups[i].alive) removeCreatorPickup(pickups[i]);
      }
    }

    function snapshotCreatorPickups() {
      const out = [];
      for (let i = 0; i < pickups.length; i++) {
        const p = pickups[i];
        if (!p.alive || !p.creator) continue;
        let kind = p.kind;
        if (!kind) {
          // Herramientas viejas del creador: deducir por prompt.
          try {
            const pr = p.prompt ? p.prompt() : '';
            if (pr.indexOf('hacha') >= 0) kind = 'axe';
            else if (pr.indexOf('pico') >= 0) kind = 'pickaxe';
            else if (pr.indexOf('martillo') >= 0) kind = 'hammer';
            else if (pr.indexOf('pistola') >= 0) kind = 'pistol';
          } catch (e) {}
        }
        if (!kind) continue;
        out.push({ kind: kind, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 });
      }
      return out;
    }

    function restoreCreatorPickups(list) {
      if (!Array.isArray(list)) return 0;
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        if (!d || typeof d.x !== 'number' || typeof d.z !== 'number') continue;
        const r = placeCreatorPickup(d.kind, Math.round(d.x), Math.round(d.z));
        if (r.ok) n += 1;
      }
      return n;
    }

    function nearest(playerWorldPos) {
      const local = frame.worldToLocalXZ(playerWorldPos);
      let best = null;
      let bestD = Infinity;
      interactables.forEach((item) => {
        if (item.alive === false) return;
        const dist = Math.hypot(local.x - item.x, local.z - item.z);
        if (dist < item.radius && dist < bestD) {
          best = item;
          bestD = dist;
        }
      });
      return best;
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

    function canCraft(recipe) {
      if (recipe.tool && Inventory.hasTool(recipe.tool)) return { ok: false, reason: 'ya la tenés' };
      if (recipe.need && !Inventory.hasTool(recipe.need)) {
        return { ok: false, reason: 'necesitás ' + Inventory.toolName(recipe.need).toLowerCase() };
      }
      if (recipe.repair && (!openBench || openBench.hp >= openBench.maxHp)) {
        return { ok: false, reason: 'ya está entera' };
      }
      const missing = Object.keys(recipe.cost).filter((key) => Inventory.count(key) < recipe.cost[key]);
      if (missing.length) return { ok: false, reason: 'faltan materiales' };
      return { ok: true, reason: '' };
    }

    function refund(cost) {
      Object.keys(cost).forEach((key) => Inventory.addResource(key, cost[key]));
    }

    function tryPlaceBench() {
      if (!buildRef) return { ok: false, text: 'No se puede poner la mesa' };
      const cell = buildRef.aimCell(playerPos);
      if (!cell || cell.level !== 0) return { ok: false, text: 'La mesa va en el piso' };
      if (buildRef.occupies(cell.ix, cell.iz, 0)) return { ok: false, text: 'Ese lugar está ocupado' };
      if (playerPos) {
        const loc = frame.worldToLocal(playerPos);
        if (Math.abs(loc.x - cell.ix) < 1 && Math.abs(loc.z - cell.iz) < 0.8) {
          return { ok: false, text: 'Estás en el medio' };
        }
      }
      const x = cell.ix;
      const z = cell.iz;
      const list = Colliders.all();
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c.active || c.frame !== frame) continue;
        if (x + 0.75 <= c.minX || x - 0.75 >= c.maxX || z + 0.45 <= c.minZ || z - 0.45 >= c.maxZ) continue;
        const top = c.maxH == null ? 100 : c.maxH;
        const bottom = c.minH == null ? -1 : c.minH;
        if (top <= 0 || bottom >= 0.95) continue;
        return { ok: false, text: 'Ese lugar está ocupado' };
      }
      const bench = makeBench(x, z);
      paintBench(bench);
      return { ok: true, text: 'Mesa puesta' };
    }

    function recipeRow(recipe, index) {
      const gate = canCraft(recipe);
      return {
        index,
        label: recipe.name + ' (' + costText(recipe.cost) + ')',
        enabled: gate.ok,
        reason: gate.reason,
      };
    }

    function spotAhead(worldPos, dir) {
      const flat = (dir && dir.clone()) || frame.tangentZ.clone();
      flat.addScaledVector(frame.up, -flat.dot(frame.up));
      if (flat.lengthSq() < 1e-6) flat.copy(frame.tangentZ);
      else flat.normalize();
      // forward × up es un lado del chart. El signo solo corre el objeto.
      const side = new THREE.Vector3().crossVectors(flat, frame.up);
      if (side.lengthSq() < 1e-6) side.copy(frame.tangentX);
      else side.normalize();
      const distances = [2.4, 3.4, 1.8];
      const laterals = [0, 1.2, -1.2];
      for (let d = 0; d < distances.length; d++) {
        for (let s = 0; s < laterals.length; s++) {
          const at = worldPos.clone()
            .addScaledVector(flat, distances[d])
            .addScaledVector(side, laterals[s]);
          const local = frame.worldToLocal(at);
          const probe = frame.localToWorld(local.x, local.z, 0.8);
          const blocked = Colliders && Colliders.blocked(probe, 0.3, { feet: 0, top: 1.2 });
          if (!blocked) return { x: local.x, z: local.z };
        }
      }
      const fallback = frame.worldToLocal(worldPos.clone().addScaledVector(flat, 2.4));
      return { x: fallback.x, z: fallback.z };
    }

    const enemySpawns = [
      { x: 7.5, z: 22, sight: 14, chase: 46, attack: 3.2, hp: 100, speed: 2.3 },
      { x: 11, z: 22.5, sight: 14, chase: 46, attack: 3.2, hp: 100, speed: 2.15 },
    ];

    return {
      frame,
      enemySpawns,
      nodeCount: nodes.length,

      nodeHp: nodes.map((node) => node.maxHp),
      totemCount: totemCount,
      toolIds: toolIds,

      setWeapon(weapon) { weaponRef = weapon; },
      setCamera(camera) { aimCamera = camera; },
      setBuild(build) { buildRef = build; },
      benches: benches,
      placeBenchAt: placeBenchAt,
      removeBench: removeBench,
      tryDeleteBench: tryDeleteBench,
      clearCreatorBenches: clearCreatorBenches,
      snapshotBenches: snapshotBenches,
      restoreBenches: restoreBenches,
      placeCreatorPickup: placeCreatorPickup,
      tryDeleteCreatorPickupAt: tryDeleteCreatorPickupAt,
      clearCreatorPickups: clearCreatorPickups,
      snapshotCreatorPickups: snapshotCreatorPickups,
      restoreCreatorPickups: restoreCreatorPickups,
      territoryStatus: territoryStatus,
      isInTerritory: isInTerritory,
      updateTerritoryRing: updateTerritoryRing,
      territoryRadius() { return TERRITORY_RADIUS; },
      hurtBench(bench, amount) {
        if (!bench || bench.hp <= 0) return;
        bench.hp = Math.max(0, bench.hp - amount);
        paintBench(bench);
        if (bench.hp > 0) return;
        bench.alive = false;
        bench.col.active = false;
        bench.mesh.visible = false;
        updateTerritoryRing();
      },
      benchHeading() {
        if (!openBench) return 'Mesa de trabajo';
        return 'Mesa ' + Math.max(0, Math.round(openBench.hp)) + ' / ' + openBench.maxHp;
      },

      recipes() {
        const rows = RECIPES.map(recipeRow);
        // Vaciar la zona sin costo: borra bloques, escaleras y cosas del
        // creador alrededor del banco. Las mesas quedan (son el reclamo).
        let built = 0;
        try {
          if (buildRef) built += (buildRef.blockCount() || 0) + (buildRef.stairCount() || 0);
          for (let i = 0; i < pickups.length; i++) {
            if (pickups[i].alive && pickups[i].creator) { built += 1; break; }
          }
        } catch (e) {}
        rows.push({
          index: RECIPES.length,
          label: '🧹 Vaciar zona (las mesas quedan)',
          enabled: built > 0,
          reason: built > 0 ? '' : 'nada que borrar',
        });
        return rows;
      },

      clearBuildArea() {
        let n = 0;
        try {
          if (buildRef) {
            n += buildRef.blockCount() || 0;
            n += buildRef.stairCount() || 0;
            if (buildRef.clearAll) buildRef.clearAll();
          }
          for (let i = pickups.length - 1; i >= 0; i--) {
            if (pickups[i].creator && pickups[i].alive) {
              removeCreatorPickup(pickups[i]);
              n += 1;
            }
          }
        } catch (e) {}
        return n;
      },

      craft(index) {
        // Fila extra del menú: vaciar la zona (sin costo).
        if (index === RECIPES.length) {
          const n = this.clearBuildArea ? this.clearBuildArea() : 0;
          if (Audio) Audio.pickup('ammo');
          return { message: n > 0 ? ('Zona vaciada (' + n + '). Las mesas quedan.') : 'Nada que borrar' };
        }
        const recipe = RECIPES[index];
        if (!recipe) return { message: '' };
        const gate = canCraft(recipe);
        if (!gate.ok) {
          const reason = gate.reason;
          return { message: reason.charAt(0).toUpperCase() + reason.slice(1) };
        }
        if (recipe.heal && PlayerHealth.hp >= PlayerHealth.maxHp) return { message: 'La vida ya está llena' };
        if (!Inventory.trySpend(recipe.cost)) return { message: 'Faltan materiales' };
        if (recipe.placeBench) {
          const placed = tryPlaceBench();
          if (!placed.ok) {
            refund(recipe.cost);
            return { message: placed.text };
          }
          if (Audio) Audio.pickup('ammo');
          return { message: placed.text };
        }
        if (recipe.repair) {
          openBench.hp = Math.min(openBench.maxHp, openBench.hp + 100);
          paintBench(openBench);
          if (Audio) Audio.pickup('health');
          return { message: 'Mesa reparada (+100)' };
        }
        if (recipe.tool) Inventory.giveTool(recipe.tool);
        if (recipe.heal) PlayerHealth.heal(recipe.heal);
        if (recipe.ammo && weaponRef) weaponRef.addReserve(recipe.ammo);
        if (Audio) Audio.pickup(recipe.heal ? 'health' : 'ammo');
        return { message: 'Crafteado: ' + recipe.name };
      },

      tryInteract(playerWorldPos) {
        const item = nearest(playerWorldPos);
        if (!item) return { type: 'none' };
        return item.use();
      },

      tryHarvest() {
        const now = performance.now();
        if (now - lastHarvest < 280) return null;
        const node = aimedNode();
        if (!node) return null;
        const tool = Inventory.activeTool;
        const wood = node.type === 'wood';
        if (tool === 'hands' || tool === 'hammer' || tool === 'pistol') {
          lastHarvest = now;
          return wood ? 'La madera se cosecha con el hacha (2)' : 'Piedra y metal se cosechan con el pico (3)';
        }
        if (wood && tool !== 'axe') {
          lastHarvest = now;
          return 'La madera se cosecha con el hacha (2)';
        }
        if (!wood && tool !== 'pickaxe') {
          lastHarvest = now;
          return 'Piedra y metal se cosechan con el pico (3)';
        }
        lastHarvest = now;
        node.hp -= HARVEST_DAMAGE;
        Inventory.addResource(node.type, 1);
        if (Audio) Audio.hit();
        if (node.hp <= 0) {
          node.alive = false;
          node.mesh.visible = false;
          node.col.active = false;
          node.respawn = 10;
          if (Audio) Audio.pickup('ammo');
        }
        const label = RES_ES[node.type];
        return label.charAt(0).toUpperCase() + label.slice(1) + ' +1 (' + Inventory.count(node.type) + ')';
      },

      getPrompt(playerWorldPos) {
        const settings = window.Game.Settings;
        const interact = settings ? settings.label('interact') : 'E';
        const torch = settings ? settings.label('torch') : 'F';
        const pack = settings ? settings.label('pack') : 'Q';
        const reload = settings ? settings.label('reload') : 'R';
        const materialKey = settings ? settings.label('material') : 'C';
        const stairsKey = settings ? settings.label('stairs') : 'V';
        const node = aimedNode();
        if (node) {
          const tool = Inventory.activeTool;
          const name = RES_ES[node.type];
          if (node.type === 'wood') {
            return tool === 'axe' ? 'Clic: cosechar madera' : 'Madera: equipá el hacha (2)';
          }
          return tool === 'pickaxe' ? ('Clic: cosechar ' + name) : 'Piedra y metal: equipá el pico (3)';
        }
        const item = nearest(playerWorldPos);
        if (item) return item.prompt();
        if (Inventory.activeTool === 'hammer') {
          const mat = buildRef ? buildRef.materialName() : 'bloque';
          return 'Clic pone ' + mat + ' · derecho borra · ' + materialKey + ' material · ' + stairsKey + ' escalera';
        }
        return interact + ' interactúa · ' + torch + ' antorcha · ' + pack + ' mochila · 1-5 herramienta · ' + reload + ' recarga';
      },

      drop(kind, worldPos, dir) {
        const spot = spotAhead(worldPos, dir);
        if (kind === 'food' || kind === 'toxin') {
          if (!Inventory.takeStack(kind, 1)) {
            return { ok: false, text: kind === 'food' ? 'No tenés comida' : 'No tenés toxina' };
          }
          const food = kind === 'food';
          pocketPickup(
            kind, spot.x, spot.z,
            food ? 'E agarrar comida' : 'E agarrar toxina',
            food ? 'No entra más comida' : 'No entra más toxina',
            food ? 'Comida en la mochila. Q para usarla.' : 'Toxina guardada. No la uses.'
          );
          const spec = pickups[pickups.length - 1];
          if (!food) spec.hazard = true;
          return {
            ok: true,
            text: food ? 'Soltaste comida' : 'Soltaste toxina',
            x: spot.x, z: spot.z, pickup: spec,
          };
        }
        if (kind === 'key') {
          if (!Inventory.takeKey()) return { ok: false, text: 'No tenés la llave' };
          spawnKey(spot.x, spot.z);
          return {
            ok: true, text: 'Soltaste la llave dorada',
            x: spot.x, z: spot.z, pickup: pickups[pickups.length - 1],
          };
        }
        if (kind === 'ammo') {
          if (!weaponRef) return { ok: false, text: 'No hay arma' };
          const rounds = weaponRef.takeReserve(12);
          if (!rounds) return { ok: false, text: 'No tenés balas de reserva' };
          spawnAmmo(spot.x, spot.z, rounds);
          return {
            ok: true, text: 'Soltaste balas (+' + rounds + ')',
            x: spot.x, z: spot.z, pickup: pickups[pickups.length - 1],
          };
        }
        if (TOOL_LABEL[kind]) {
          if (!Inventory.takeTool(kind)) {
            return { ok: false, text: 'No tenés ' + Inventory.toolName(kind).toLowerCase() };
          }
          toolPickup(kind, spot.x, spot.z, false);
          return {
            ok: true, text: 'Soltaste ' + TOOL_LABEL[kind][0],
            x: spot.x, z: spot.z, pickup: pickups[pickups.length - 1],
          };
        }
        return { ok: false, text: 'Eso no se puede soltar' };
      },

      update(dt, t, worldPos) {
        playerPos = worldPos || playerPos;
        // El anillo sigue a la mesa viva (reclamo de zona).
        try {
          const alive = aliveBenches();
          const sig = alive.map((bench) => bench.x + ',' + bench.z).join(';') || 'none';
          if (sig !== territorySig) updateTerritoryRing();
          if (territoryRing && territoryRing.visible) {
            territoryRing.material.opacity = 0.38 + Math.sin(t * 2.2) * 0.12;
          }
        } catch (e) {}
        if (playerPos) {
          const local = frame.worldToLocal(playerPos);
          pickups.forEach((item) => {
            if (!item.alive || !item.hazard) return;
            if (Math.hypot(local.x - item.x, local.z - item.z) < 0.9) {
              item.alive = false;
              scene.remove(item.mesh);
              PlayerHealth.damage(30);
            }
          });
        }
        pickups.forEach((item) => {
          if (!item.alive) return;
          const height = item.base + Math.sin(t * 2 + item.phase) * 0.08;
          Utils.placeOnFrame(item.mesh, frame, item.x, item.z, height);
          item.mesh.rotateY(t * 1.3 + item.phase);
        });

        if (door.state === 'opening') {
          door.lift = Math.min(door.h, door.lift + 2.2 * dt);
          if (door.lift >= door.h - 0.04) door.state = 'open';
        } else if (door.state === 'closing') {
          door.lift = Math.max(0, door.lift - 2.2 * dt);
          if (door.lift <= 0.04) {
            door.lift = 0;
            door.state = 'closed';
            doorCol.active = true;
          }
        }
        Utils.placeOnFrame(doorMesh, frame, door.x, door.z, door.h / 2 + door.lift);

        nodes.forEach((node) => {
          if (node.alive) {
            const k = Math.max(0.55, node.hp / node.maxHp);
            node.mesh.scale.set(k, k, k);
            return;
          }
          node.respawn -= dt;
          if (node.respawn > 0) return;
          if (buildRef && buildRef.occupies(Math.round(node.x), Math.round(node.z), 0)) {
            node.respawn = 10;
            return;
          }
          node.alive = true;
          node.hp = node.maxHp;
          node.col.active = true;
          node.mesh.visible = true;
          node.mesh.scale.set(1, 1, 1);
        });
      },
    };
  };
})();
