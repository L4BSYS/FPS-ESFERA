(function () {
  const Config = window.Game.Config;
  const Inventory = window.Game.Inventory;
  const HUD = window.Game.HUD;
  const Audio = window.Game.Audio;
  const PlayerHealth = window.Game.PlayerHealth;

  // Chequea el frame una vez, sin renderer: ejes del chart y el signo del yaw.
  function selfTestFrame() {
    const frame = window.Game.LocalFrame(new THREE.Vector3(0, Config.PLANET_RADIUS, 0));
    const cross = new THREE.Vector3().crossVectors(frame.tangentX, frame.up);
    if (cross.dot(frame.tangentZ) < 0.999) throw new Error('base del chart no es derecha');

    const mesh = new THREE.Object3D();
    window.Game.Utils.placeOnFrame(mesh, frame, 0, 10, 0);
    [
      [new THREE.Vector3(1, 0, 0), frame.tangentX, '+X'],
      [new THREE.Vector3(0, 1, 0), frame.up, '+Y'],
      [new THREE.Vector3(0, 0, 1), frame.tangentZ, '+Z'],
    ].forEach(([local, expect, name]) => {
      const world = local.applyQuaternion(mesh.quaternion);
      if (world.dot(expect) < 0.999) throw new Error('placeOnFrame ' + name);
    });

    mesh.rotateY(Math.PI / 2);
    const faced = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
    if (faced.dot(frame.tangentX) < 0.999) throw new Error('yaw del chart');

    const ahead = frame.localToWorld(0, 10, 0);
    const expectPos = frame.anchorPosition.clone()
      .add(frame.tangentZ.clone().multiplyScalar(10))
      .normalize()
      .multiplyScalar(Config.PLANET_RADIUS);
    if (ahead.distanceTo(expectPos) > 0.02) throw new Error('local +z no mira al frente');
  }

  // Camina derecho más allá del viejo corte (|up.y| = 0.99, ~70 m) y exige
  // que la mirada no se invierta y que siga el meridiano de la esfera.
  function selfTestSphereWalk() {
    function walk(yaw, steps, checkEnd) {
      const player = new window.Game.Player();
      const camera = new THREE.PerspectiveCamera(75, 1, 0.5, 2000);
      const input = {
        yaw: yaw,
        pitch: 0,
        keys: { KeyW: true },
        isDown(code) { return !!this.keys[code]; },
        consume() {},
      };
      const prev = new THREE.Vector3();
      const fwd = new THREE.Vector3();
      let primed = false;
      for (let i = 0; i < steps; i++) {
        player.update(0.05, input, camera);
        camera.getWorldDirection(fwd);
        const up = player.localUp;
        if (Math.abs(fwd.dot(up)) > 0.05) throw new Error('la mirada no queda tangente al piso');
        if (camera.up.dot(up) < 0.999) throw new Error('el arriba de la cámara se separó del radio');
        if (primed && prev.dot(fwd) < 0.95) {
          throw new Error('la cámara se dio vuelta (paso ' + i + ', up.y=' + up.y.toFixed(3) + ')');
        }
        prev.copy(fwd);
        primed = true;
      }
      const up = player.localUp;
      if (up.y > 0.95) throw new Error('no cruzó el viejo límite del polo');
      if (Math.abs(player.position.length() - Config.TARGET_DISTANCE) > 0.2) {
        throw new Error('se salió de la esfera');
      }
      checkEnd(player, camera);
    }

    walk(0, 500, (player, camera) => {
      const up = player.localUp;
      if (Math.abs(up.z) > 0.03) throw new Error('caminar derecho se torció de lado');
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const expect = new THREE.Vector3(up.y, -up.x, 0).normalize();
      if (fwd.dot(expect) < 0.98) throw new Error('el adelante no sigue la esfera');
    });

    walk(Math.PI / 2, 500, (player, camera) => {
      const up = player.localUp;
      if (Math.abs(up.x) > 0.03) throw new Error('el otro meridiano se torció');
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const expect = new THREE.Vector3(0, up.z, -up.y).normalize();
      if (fwd.dot(expect) < 0.98) throw new Error('al mirar de lado no sigue la esfera');
    });
  }

  // 8 luces fijas, poste radial, la novena mueve la más vieja, y a menos de 12 m no planta.
  function selfTestTorches() {
    const scene = new THREE.Scene();
    const torches = window.Game.createTorches(scene);
    const R = Config.PLANET_RADIUS;
    const lights = scene.children.filter((obj) => obj.isPointLight);
    const groups = scene.children.filter((obj) => obj.type === 'Group');
    if (lights.length !== 8 || groups.length !== 8) throw new Error('el pool no quedó en 8');
    if (lights.some((light) => light.intensity !== 0)) throw new Error('la luz arranca prendida');

    const pos = new THREE.Vector3(0, Config.TARGET_DISTANCE, 0);
    const look = new THREE.Vector3(1, 0, 0);
    const first = torches.place(pos, look);
    if (!first.ok || first.active !== 1) throw new Error('no plantó la primera');
    const again = torches.place(pos, look);
    if (again.ok || again.active !== 1) throw new Error('plantó encima de la anterior');

    const slot0 = groups[0];
    const firstPos = slot0.position.clone();
    if (Math.abs(firstPos.z) > 0.05 || firstPos.x <= 0) throw new Error('no quedó adelante');
    const radial0 = firstPos.clone().normalize();
    const postUp = new THREE.Vector3(0, 1, 0).applyQuaternion(slot0.quaternion);
    if (postUp.dot(radial0) < 0.999) throw new Error('el poste no mira para afuera');
    if (Math.abs(firstPos.length() - (R + 0.03)) > 0.05) throw new Error('no apoya en la superficie');
    const flame = lights[0].position.clone().normalize();
    if (flame.dot(radial0) < 0.999 || lights[0].position.length() < R + 1) {
      throw new Error('la luz no quedó en la llama');
    }

    for (let i = 1; i <= 10; i++) {
      const theta = (i * 20) / R;
      const at = new THREE.Vector3(Math.sin(theta), Math.cos(theta), 0).multiplyScalar(Config.TARGET_DISTANCE);
      const fwd = new THREE.Vector3(Math.cos(theta), -Math.sin(theta), 0);
      const planted = torches.place(at, fwd);
      if (!planted.ok) throw new Error('rechazó un tramo de 20 m');
      if (planted.active !== Math.min(i + 1, 8)) throw new Error('contó mal las antorchas');
    }
    if (slot0.position.distanceTo(firstPos) < 1) throw new Error('no recicló la más vieja');
    if (groups.some((group) => !group.visible)) throw new Error('quedó una antorcha invisible');
    if (lights.some((light) => light.intensity <= 0)) throw new Error('una antorcha colocada quedó apagada');

    groups.forEach((group) => {
      const radial = group.position.clone().normalize();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion);
      if (up.dot(radial) < 0.999) throw new Error('un poste quedó torcido');
    });

    const overhead = new THREE.Vector3(0, 0, Config.TARGET_DISTANCE);
    const sky = torches.place(overhead, overhead.clone().normalize());
    if (!sky.ok) throw new Error('mirar arriba no plantó');
    // 11 plantas anteriores: esta cae en el puesto 3. Sin horizonte, el cruce up×Y la corre hacia −X.
    const newest = groups[3];
    const expect = new THREE.Vector3(-1.6, 0, R).normalize();
    if (newest.position.clone().normalize().dot(expect) < 0.999) {
      throw new Error('mirar arriba no la dejó en el piso');
    }
  }

  try {
    selfTestFrame();
    document.documentElement.dataset.frame = 'ok';
  } catch (err) {
    document.documentElement.dataset.frame = err.message || String(err);
    console.error(err);
  }

  try {
    selfTestSphereWalk();
    document.documentElement.dataset.walk = 'ok';
  } catch (err) {
    document.documentElement.dataset.walk = err.message || String(err);
    console.error(err);
  }

  // Coyote: se puede saltar un instante después de dejar el piso.
  // En el aire el cambio de velocidad es menor que en el suelo.
  function selfTestFeel() {
    const GroundHeight = window.Game.GroundHeight;
    let lift = 4;
    const liftOf = () => lift;
    GroundHeight.register(liftOf);
    try {
      function make(keys) {
        return {
          yaw: 0,
          pitch: 0,
          keys: keys || {},
          isDown(code) { return !!this.keys[code]; },
          consume(code) { this.keys[code] = false; },
        };
      }
      const cam = () => new THREE.PerspectiveCamera(75, 1, 0.5, 2000);

      const leaver = new window.Game.Player();
      const idle = make();
      leaver.update(0.05, idle, cam());
      lift = 0;
      leaver.update(0.05, idle, cam());
      if (leaver.isGrounded) throw new Error('no se cayó del borde');
      leaver.update(0.12, idle, cam());
      if (leaver.isGrounded) throw new Error('aterrizó antes del coyote');
      leaver.update(0.05, make({ Space: true }), cam());
      if (leaver.verticalVelocity < Config.JUMP_IMPULSE * 0.5) {
        throw new Error('el coyote no dejó saltar');
      }

      lift = 4;
      const missed = new window.Game.Player();
      const still = make();
      missed.update(0.05, still, cam());
      lift = 0;
      missed.update(0.05, still, cam());
      missed.update(0.2, still, cam());
      if (missed.isGrounded) throw new Error('el segundo salto de prueba ya tocó el piso');
      const falling = missed.verticalVelocity;
      missed.update(0.05, make({ Space: true }), cam());
      if (missed.verticalVelocity > falling) throw new Error('saltó cuando el coyote ya venció');

      function speedAfter(air) {
        const player = new window.Game.Player();
        const camera = cam();
        const input = make();
        player.update(0.05, input, camera);
        if (air) {
          input.keys.Space = true;
          player.update(0.05, input, camera);
          input.keys.Space = false;
          if (player.isGrounded) throw new Error('el salto de prueba no despegó');
        }
        input.keys.KeyW = true;
        for (let i = 0; i < 8; i++) player.update(0.05, input, camera);
        return player.tangentVelocity.length();
      }
      const groundSpeed = speedAfter(false);
      const airSpeed = speedAfter(true);
      if (!(airSpeed < groundSpeed * 0.6)) {
        throw new Error('el aire acelera igual que el piso (' + airSpeed.toFixed(2) + ' / ' + groundSpeed.toFixed(2) + ')');
      }
    } finally {
      GroundHeight.unregister(liftOf);
    }
  }

  try {
    selfTestFeel();
    document.documentElement.dataset.feel = 'ok';
  } catch (err) {
    document.documentElement.dataset.feel = err.message || String(err);
    console.error(err);
  }

  try {
    selfTestTorches();
    document.documentElement.dataset.torches = 'ok';
  } catch (err) {
    document.documentElement.dataset.torches = err.message || String(err);
    console.error(err);
  }

  // Campo salvaje: la misma semilla repite el mapa en cualquier máquina,
  // otra semilla lo cambia, y los nodos se cosechan con la herramienta justa.
  function selfTestWilds() {
    const s1 = new THREE.Scene();
    const s2 = new THREE.Scene();
    const a = window.Game.createWilds(s1, 1337);
    const b = window.Game.createWilds(s2, 1337);
    try {
      if (a.nodes.length < 30) throw new Error('faltan nodos salvajes (' + a.nodes.length + ')');
      for (let i = 0; i < a.nodes.length; i++) {
        if (a.nodes[i].mesh.position.distanceTo(b.nodes[i].mesh.position) > 0.001) {
          throw new Error('la semilla no repite el mapa');
        }
        if (a.nodes[i].type !== b.nodes[i].type) throw new Error('el tipo no repite');
      }
      if (!a.landmarks.length) throw new Error('sin mojones');
      for (let i = 0; i < a.landmarks.length; i++) {
        if (a.landmarks[i].mesh.position.distanceTo(b.landmarks[i].mesh.position) > 0.001) {
          throw new Error('los mojones no repiten');
        }
      }
      if (a.spawnPoints.length < 6) throw new Error('sin campamentos');
      for (let i = 0; i < a.spawnPoints.length; i++) {
        if (a.spawnPoints[i].x !== b.spawnPoints[i].x || a.spawnPoints[i].z !== b.spawnPoints[i].z) {
          throw new Error('los campamentos no repiten');
        }
        // Los campamentos quedan lejos del spawn: ni ven (14) ni disparan (15).
        const ds = Math.hypot(a.spawnPoints[i].x - Config.SPAWN_X, a.spawnPoints[i].z - Config.SPAWN_Z);
        if (ds < Config.CAMP_MIN_SPAWN_DIST - 0.001 || ds > Config.CAMP_MAX_SPAWN_DIST + 0.001) {
          throw new Error('campamento mal ubicado (' + ds.toFixed(1) + ')');
        }
      }
      const other = window.Game.createWilds(new THREE.Scene(), 777);
      try {
        let same = 0;
        for (let i = 0; i < a.nodes.length; i++) {
          if (a.nodes[i].mesh.position.distanceTo(other.nodes[i].mesh.position) < 0.001) same += 1;
        }
        if (same === a.nodes.length) throw new Error('otra semilla dio el mismo mapa');
      } finally {
        other.dispose();
      }
      const wood = a.nodes.filter((node) => node.type === 'wood')[0];
      if (!wood) throw new Error('sin madera salvaje');
      Inventory.giveTool('axe');
      Inventory.setTool('axe');
      const cam = new THREE.PerspectiveCamera(75, 1, 0.5, 100);
      const eye = wood.mesh.position.clone().normalize().multiplyScalar(Config.TARGET_DISTANCE);
      cam.position.copy(eye);
      cam.up.copy(eye.clone().normalize());
      cam.lookAt(wood.mesh.position);
      // Sin render no hay matrices: ni la cámara ni las mallas del escenario
      // tienen matrixWorld. El rayo saldría del origen y no pega nada.
      cam.updateMatrixWorld(true);
      s1.updateMatrixWorld(true);
      a.setCamera(cam);
      const before = Inventory.count('wood');
      const msg = a.tryHarvest();
      if (!msg) throw new Error('no cosechó el nodo salvaje');
      if (Inventory.count('wood') !== before + 1) throw new Error('no sumó madera salvaje');
      if (wood.hp >= wood.maxHp) throw new Error('el nodo no se gastó');
      if (!a.loosies.length) throw new Error('sin sueltos');
      if (a.loosies.length !== b.loosies.length) throw new Error('los sueltos no cierran');
      for (let i = 0; i < a.loosies.length; i++) {
        if (a.loosies[i].basePos.distanceTo(b.loosies[i].basePos) > 0.001) {
          throw new Error('los sueltos no repiten');
        }
      }
      const loose = a.loosies[0];
      const feet = loose.basePos.clone();
      const eyeAt = feet.clone().add(feet.clone().normalize().multiplyScalar(Config.EYE_HEIGHT));
      const hadRes = Inventory.count(loose.res);
      a.update(0.016, 0, eyeAt);
      if (loose.alive) throw new Error('el suelto no se agarró');
      if (Inventory.count(loose.res) !== hadRes + loose.amount) {
        throw new Error('el suelto no sumó material');
      }
    } finally {
      a.dispose();
      b.dispose();
      Inventory.reset();
      if (window.Game.Colliders.all().length !== 0) {
        throw new Error('el campo de prueba dejó cajas');
      }
    }
  }

  try {
    selfTestWilds();
    document.documentElement.dataset.wilds = 'ok';
  } catch (err) {
    document.documentElement.dataset.wilds = err.message || String(err);
    console.error(err);
  }

  // La mira manda: cara de bloque da la celda vecina, mirar abajo da cerca
  // y mirar al frente da al alcance (no a los pies). Para paredes rápidas.
  function selfTestAim() {
    const frame = window.Game.LocalFrame(new THREE.Vector3(0, Config.PLANET_RADIUS, 0));
    const scene = new THREE.Scene();
    const build = window.Game.createBuild(scene, frame);
    try {
      Inventory.addResource('wood', 10);
      const base = build.placeCell(2, 2, 0, 'wood', null);
      if (!base.ok) throw new Error(base.text || 'no puso base');
      const cam = new THREE.PerspectiveCamera(75, 1, 0.5, 100);
      build.setCamera(cam);
      scene.updateMatrixWorld(true);
      function look(fromX, fromZ, fromH, atX, atZ, atH) {
        const eye = frame.localToWorld(fromX, fromZ, fromH);
        cam.position.copy(eye);
        cam.up.copy(eye.clone().normalize());
        cam.lookAt(frame.localToWorld(atX, atZ, atH));
        cam.updateMatrixWorld(true);
        scene.updateMatrixWorld(true);
        return eye;
      }
      // Cara sur del bloque: la pared sigue al costado, a nivel 0.
      let eye = look(2, 0.5, 1.0, 2, 2, 0.5);
      let cell = build.aimCell(eye);
      if (!cell || cell.ix !== 2 || cell.iz !== 1 || cell.level !== 0) {
        throw new Error('la cara no dio (2,1,0): ' + JSON.stringify(cell));
      }
      // Mirando abajo: cerca, a nivel 0, a distancia de vista (1.6).
      eye = look(5, 5, 1.6, 5, 5, 0);
      cell = build.aimCell(eye);
      if (!cell || cell.ix !== 5 || cell.iz !== 5 || cell.level !== 0) {
        throw new Error('abajo no dio (5,5,0): ' + JSON.stringify(cell));
      }
      let detail = build.aimDetail(eye);
      if (!detail || Math.abs(eye.distanceTo(detail.point) - 1.6) > 0.4) {
        throw new Error('el anclaje de abajo no está a distancia de vista');
      }
      // Mirando al frente: al alcance (5), no a los pies (2.2).
      eye = look(0, 0, 1.6, 10, 0, 1.6);
      cell = build.aimCell(eye);
      if (!cell || cell.ix !== 5 || cell.iz !== 0 || cell.level !== 0) {
        throw new Error('al frente no dio (5,0,0): ' + JSON.stringify(cell));
      }
      detail = build.aimDetail(eye);
      if (!detail || Math.abs(eye.distanceTo(detail.point) - 5) > 0.6) {
        throw new Error('el anclaje no está al alcance en el centro de vista');
      }
    } finally {
      build.dispose();
      Inventory.reset();
      if (window.Game.Colliders.all().length !== 0) {
        throw new Error('la mira dejó cajas');
      }
    }
  }

  try {
    selfTestAim();
    document.documentElement.dataset.aim = 'ok';
  } catch (err) {
    document.documentElement.dataset.aim = err.message || String(err);
    console.error(err);
  }

  // Mochila, costos de La Grieta, bloque con apoyo, columna que cae y escalera.
  // Corre en una escena aparte y la borra: el patio de juego queda vacío.
  function selfTestPackAndBuild() {
    const Inventory = window.Game.Inventory;
    const frame = window.Game.LocalFrame(new THREE.Vector3(0, Config.PLANET_RADIUS, 0));
    Inventory.reset();
    let build = null;
    try {
      if (Inventory.addStack('torch', 9) !== 6) throw new Error('la antorcha no entra de a 6');
      if (Inventory.addStack('torch', 1) !== 0) throw new Error('la antorcha pasó de 6');
      if (Inventory.stackCount('torch') !== 6) throw new Error('el stock no quedó en 6');
      if (Inventory.takeStack('torch', 2) !== 2) throw new Error('no sacó 2 antorchas');
      if (Inventory.stackCount('torch') !== 4) throw new Error('quedaron mal las antorchas');
      Inventory.setKey(true);
      if (!Inventory.hasKey) throw new Error('el llavero no guardó la llave');
      Inventory.setKey(false);
      if (Inventory.hasKey) throw new Error('la llave quedó puesta');

      const recipes = window.Game.CraftRecipes;
      const hammer = recipes.find((recipe) => recipe.tool === 'hammer');
      const pistol = recipes.find((recipe) => recipe.tool === 'pistol');
      const repair = recipes.find((recipe) => recipe.repair);
      if (!hammer || hammer.cost.wood !== 4 || hammer.cost.stone !== 2) throw new Error('el martillo no sale 4+2');
      if (!pistol || pistol.cost.metal !== 10 || pistol.cost.wood !== 4) throw new Error('la pistola no sale 10+4');
      if (!repair || repair.cost.wood !== 3 || repair.cost.stone !== 2) throw new Error('reparar no sale 3+2');

      const scene = new THREE.Scene();
      build = window.Game.createBuild(scene, frame);
      Inventory.addResource('wood', 40);
      Inventory.addResource('stone', 10);
      Inventory.addResource('metal', 10);

      const floating = build.placeCell(4, 4, 1, 'wood', null);
      if (floating.ok) throw new Error('aceptó un bloque sin apoyo');

      const base = build.placeCell(4, 4, 0, 'wood', null);
      if (!base.ok) throw new Error(base.text || 'no puso la base');
      const eyeOnBlock = frame.localToWorld(4, 4, Config.EYE_HEIGHT + 1);
      const ground = window.Game.GroundHeight.get(eyeOnBlock);
      if (Math.abs(ground - 1) > 0.01) throw new Error('el piso del bloque es ' + ground);
      const at = frame.localToWorld(4, 4, Config.EYE_HEIGHT);
      if (!window.Game.Colliders.blocked(at, 0.2, { feet: 0, top: 1.6 })) {
        throw new Error('el bloque no frena en el piso');
      }
      if (window.Game.Colliders.blocked(at, 0.2, { feet: 1.05, top: 2.65 })) {
        throw new Error('frena arriba del bloque');
      }

      const upper = build.placeCell(4, 4, 1, 'wood', null);
      if (!upper.ok) throw new Error(upper.text || 'no puso el de arriba');
      const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(upper.block.mesh.quaternion);
      if (localY.dot(frame.up) < 0.999) throw new Error('el bloque no mira para afuera');
      if (upper.block.mesh.position.distanceTo(frame.localToWorld(4, 4, 1.5)) > 0.02) {
        throw new Error('el bloque no quedó en la celda');
      }

      build.removeBlock(base.block);
      build.dropUnsupported();
      for (let i = 0; i < 80; i++) build.update(0.05, 'hands', null);
      if (upper.block.falling || upper.block.level !== 0) throw new Error('el de arriba no cayó al piso');
      if (upper.block.mesh.position.distanceTo(frame.localToWorld(4, 4, 0.5)) > 0.05) {
        throw new Error('cayó fuera de la celda');
      }

      const b0 = build.placeCell(6, 2, 0, 'wood', null);
      const b1 = build.placeCell(6, 2, 1, 'wood', null);
      const b2 = build.placeCell(6, 2, 2, 'wood', null);
      if (!b0.ok || !b1.ok || !b2.ok) throw new Error('no armó la columna');
      build.removeBlock(b0.block);
      build.dropUnsupported();
      for (let i = 0; i < 120; i++) build.update(0.05, 'hands', null);
      if (b1.block.level !== 0 || b2.block.level !== 1) {
        throw new Error('la columna se apiló mal ' + b1.block.level + ',' + b2.block.level);
      }
      if (b1.block.mesh.position.distanceTo(b2.block.mesh.position) < 0.4) {
        throw new Error('dos bloques quedaron en la misma celda');
      }

      const stairs = build.placeStairs(0, 8, 0, null);
      if (!stairs.ok) throw new Error(stairs.text || 'no puso la escalera');
      const expectH = [0.25, 0.5, 0.75, 1];
      // Geometría en el mundo (las cajas viven en teselas): cada peldaño a
      // su altura radial, avanzando 0.8 por paso hacia +z.
      let prevStep = null;
      for (let i = 0; i < 4; i++) {
        const col = stairs.flight[i].col;
        if (Math.abs(col.maxH - expectH[i]) > 0.001) throw new Error('peldaño ' + i + ' a ' + col.maxH);
        const p = stairs.flight[i].mesh.position;
        if (Math.abs(p.length() - (Config.PLANET_RADIUS + (i + 0.5) * 0.25)) > 0.05) {
          throw new Error('peldaño ' + i + ' fuera de altura');
        }
        if (prevStep) {
          const d = p.clone().sub(prevStep);
          const radial = p.clone().normalize();
          const dh = d.dot(radial);
          const flat = d.addScaledVector(radial, -dh).length();
          if (Math.abs(dh - 0.25) > 0.06) throw new Error('el peldaño no sube');
          if (Math.abs(flat - 0.8) > 0.1) throw new Error('la escalera no sigue +z');
        }
        prevStep = p.clone();
      }
      const stepUp = new THREE.Vector3(0, 1, 0).applyQuaternion(stairs.flight[0].mesh.quaternion);
      const radial0 = stairs.flight[0].mesh.position.clone().normalize();
      if (stepUp.dot(radial0) < 0.9995) throw new Error('el peldaño no mira para afuera');

      const player = new window.Game.Player();
      const camera = new THREE.PerspectiveCamera(75, 1, 0.5, 2000);
      const start = frame.localToWorld(0, 6.2, Config.EYE_HEIGHT);
      player.position.copy(start);
      player.currentRadialDistance = start.length();
      const input = {
        yaw: 0,
        pitch: 0,
        keys: { KeyW: true },
        isDown(code) { return !!this.keys[code]; },
        consume() {},
      };
      let maxFeet = 0;
      for (let i = 0; i < 100; i++) {
        player.update(0.016, input, camera);
        const feet = player.currentRadialDistance - Config.EYE_HEIGHT - Config.PLANET_RADIUS;
        if (feet > maxFeet) maxFeet = feet;
      }
      const end = frame.worldToLocal(player.position);
      if (end.z < 9) throw new Error('no avanzó por la escalera (z ' + end.z.toFixed(2) + ')');
      if (maxFeet < 0.7) throw new Error('no subió la escalera (' + maxFeet.toFixed(2) + ')');
    } finally {
      if (build) build.dispose();
      Inventory.reset();
      window.Game.PlayerHealth.reset();
      const left = window.Game.Colliders.all().length;
      if (left !== 0) throw new Error('quedaron ' + left + ' colliders de prueba');
    }
  }

  try {
    selfTestPackAndBuild();
    document.documentElement.dataset.build = 'ok';
  } catch (err) {
    document.documentElement.dataset.build = err.message || String(err);
    console.error(err);
  }

  // Una caja alargada, girada 90° sobre su radio. El punto de adentro y el
  // de afuera salen de la malla, no del marco de la caja.
  function selfTestSolids() {
    const angle = (Config.YARD_CLEARANCE + 20) / Config.PLANET_RADIUS;
    const radial = new THREE.Vector3(Math.sin(angle), Math.cos(angle), 0);
    const position = radial.clone().multiplyScalar(Config.PLANET_RADIUS);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 1));
    mesh.position.copy(position);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), radial);
    mesh.setRotationFromQuaternion(quat);
    mesh.rotateOnWorldAxis(radial, Math.PI / 2);
    mesh.updateMatrixWorld(true);
    const upAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
    if (upAxis.dot(radial) < 0.999) throw new Error('la roca no mira para afuera');
    const frame = window.Game.frameFromQuaternion(position, mesh.quaternion);
    const col = window.Game.Colliders.add(frame, -2, 2, -0.5, 0.5, 0, 1);
    try {
      const body = { feet: 0, top: 1.6 };
      const inside = mesh.localToWorld(new THREE.Vector3(1.2, 0.2, 0));
      if (!window.Game.Colliders.blocked(inside, 0.15, body)) throw new Error('se atraviesa la roca');
      const outside = mesh.localToWorld(new THREE.Vector3(0, 0.2, 1.2));
      if (window.Game.Colliders.blocked(outside, 0.15, body)) {
        throw new Error('la caja no sigue la vuelta de la roca');
      }
      if (window.Game.Colliders.blocked(inside, 0.15, { feet: 1.2, top: 2.8 })) {
        throw new Error('frena arriba de la roca');
      }
    } finally {
      window.Game.Colliders.remove(col);
    }
  }

  let solidsError = null;
  try {
    selfTestSolids();
  } catch (err) {
    solidsError = err.message || String(err);
    console.error(err);
  }

  // Gravedad radial, daño a bloques, peldaño y un rodeo de muro.
  function selfTestCombat() {
    if (window.Game.Colliders.all().length !== 0) throw new Error('el patio de prueba no estaba vacío');
    const scene = new THREE.Scene();
    const frame = window.Game.LocalFrame(new THREE.Vector3(0, Config.PLANET_RADIUS, 0));
    const guns = window.Game.createProjectiles(scene);
    const build = window.Game.createBuild(scene, frame);
    let foes = null;
    try {
      const theta = 1;
      const anchor = new THREE.Vector3(Math.sin(theta), Math.cos(theta), 0).multiplyScalar(Config.PLANET_RADIUS);
      const far = window.Game.LocalFrame(anchor);
      const origin = far.localToWorld(0, 0, 4);
      const dropped = guns.spawn({
        position: origin,
        direction: origin.clone().normalize(),
        speed: 0,
        gravity: 2,
        owner: 'player',
        damage: 1,
      });
      for (let i = 0; i < 25; i++) guns.update(0.016);
      const up = dropped.position.clone().normalize();
      const height = dropped.position.length() - Config.PLANET_RADIUS;
      if (!(height < 3.95)) throw new Error('la bala no cayó (' + height.toFixed(2) + ')');
      if (dropped.velocity.lengthSq() < 1e-6) throw new Error('la bala no tomó velocidad');
      const fall = dropped.velocity.clone().normalize();
      if (fall.dot(up) > -0.85) throw new Error('no cae hacia el centro');
      if (fall.y < -0.9) throw new Error('la gravedad es el Y del mundo');
      guns.dispose();

      Inventory.addResource('wood', 40);
      Inventory.addResource('stone', 10);
      const wood = build.placeCell(6, 3, 0, 'wood', null);
      const stone = build.placeCell(-6, 3, 0, 'stone', null);
      if (!wood.ok || !stone.ok) throw new Error('no puso los bloques de tiro');
      let playerHurt = 0;
      guns.setHandlers({
        onBlock(block) { build.hurtBlock(block); },
        onPlayer(amount) { playerHurt += amount; },
        playerCapsule() {
          return {
            feet: frame.localToWorld(0, 0, 0),
            head: frame.localToWorld(0, 0, 1.7),
            radius: 0.4,
          };
        },
      });
      function fire(x, z, owner, damage) {
        const from = frame.localToWorld(x, 0, 0.5);
        const to = frame.localToWorld(x, 8, 0.5);
        guns.spawn({
          position: from,
          direction: to.sub(from),
          speed: 30,
          damage: damage,
          owner: owner,
          gravity: 2,
        });
      }
      fire(6, 3, 'player', 15);
      fire(-6, 3, 'player', 15);
      for (let i = 0; i < 15; i++) guns.update(0.016);
      if (build.occupies(6, 3, 0)) throw new Error('la madera sigue en pie');
      if (!build.occupies(-6, 3, 0) || stone.block.hp !== 3) {
        throw new Error('la piedra quedó en ' + (stone.block ? stone.block.hp : 'nada'));
      }
      if (playerHurt !== 0) throw new Error('un tiro del jugador pegó en el cuerpo');

      const stairs = build.placeStairs(0, 8, 0, null);
      if (!stairs.ok) throw new Error(stairs.text || 'no puso la escalera');
      const step = stairs.flight[0].col;
      const stepAt = frame.localToWorld((step.minX + step.maxX) / 2, (step.minZ + step.maxZ) / 2, 0.3);
      if (window.Game.Colliders.blocked(stepAt, 0.3, { feet: 0, top: 1.6 })) {
        throw new Error('el peldaño no se puede pisar');
      }

      const bodyFrom = frame.localToWorld(-3, 0, 0.9);
      const bodyTo = frame.localToWorld(3, 0, 0.9);
      guns.spawn({
        position: bodyFrom,
        direction: bodyTo.clone().sub(bodyFrom),
        speed: 30,
        damage: 6,
        owner: 'enemy',
        gravity: 0,
      });
      for (let i = 0; i < 12; i++) guns.update(0.016);
      if (playerHurt !== 6) throw new Error('el tiro enemigo no pegó (' + playerHurt + ')');
      const before = playerHurt;
      guns.spawn({
        position: frame.localToWorld(-3, 0, 0.9),
        direction: bodyTo.clone().sub(frame.localToWorld(-3, 0, 0.9)),
        speed: 30,
        damage: 15,
        owner: 'player',
        gravity: 0,
      });
      for (let i = 0; i < 12; i++) guns.update(0.016);
      if (playerHurt !== before) throw new Error('el tiro propio pegó en el cuerpo');

      for (let x = -3; x <= 3; x++) {
        const placed = build.placeCell(x, 1, 0, 'wood', null);
        if (!placed.ok) throw new Error(placed.text || 'no puso el muro');
      }
      foes = window.Game.createEnemies(scene, frame, [
        { x: 0, z: 0, speed: 2.2, sight: 30, chase: 40, attack: 1.2, hp: 100 },
      ]);
      const playerPos = frame.localToWorld(0, 8, 1.6);
      for (let i = 0; i < 125; i++) foes.update(0.016, i * 0.016, playerPos);
      const foe = foes.enemies[0];
      if (!foe || foe.hp !== 100 || foe.maxHp !== 100) throw new Error('el robot no tiene 100 de vida');
      if (foe.state === 'idle') throw new Error('no vio al jugador');
      if (Math.abs(foe.localX) <= 0.5) {
        throw new Error('no se corrió del muro (' + foe.localX.toFixed(2) + ', ' + foe.localZ.toFixed(2) + ')');
      }
      if (foe.localZ > 0.45 && foe.localZ < 1.6 && Math.abs(foe.localX) < 3.6) {
        throw new Error('atravesó el muro');
      }
    } finally {
      guns.dispose();
      if (foes) foes.dispose();
      build.dispose();
      Inventory.reset();
      window.Game.PlayerHealth.reset();
      const left = window.Game.Colliders.all().length;
      if (left !== 0) throw new Error('quedaron ' + left + ' colliders de combate');
    }
  }

  try {
    selfTestCombat();
    document.documentElement.dataset.combat = 'ok';
  } catch (err) {
    document.documentElement.dataset.combat = err.message || String(err);
    console.error(err);
  }

  function selfTestWaves() {
    const Colliders = window.Game.Colliders;
    const before = Colliders.all().length;
    const scene = new THREE.Scene();
    const frame = window.Game.LocalFrame(new THREE.Vector3(0, Config.PLANET_RADIUS, 0));
    const foes = window.Game.createEnemies(scene, frame, [{ x: 0, z: 0, hp: 10 }]);
    const waves = window.Game.createWaves(foes, [{ x: 4, z: 4 }, { x: -4, z: 4 }]);
    try {
      if (foes.aliveCount() !== 1) throw new Error('faltó el robot de prueba');
      if (waves.update(1)) throw new Error('arrancó la oleada con un robot vivo');
      if (!foes.damageEnemy(foes.enemies[0], 50)) throw new Error('no murió');
      if (foes.kills !== 1 || foes.aliveCount() !== 0) throw new Error('no contó la baja');
      const clear = waves.update(0.1);
      if (!clear || clear.type !== 'clear') throw new Error('no anunció el claro');
      if (waves.update(0.1)) throw new Error('anunció el claro dos veces');
      if (waves.update(4.7)) throw new Error('la oleada salió antes de los 5 s');
      const spawned = waves.update(0.3);
      if (!spawned || spawned.wave !== 1 || spawned.count !== 3) throw new Error('oleada 1 mal contada');
      if (foes.aliveCount() !== 3) throw new Error('no aparecieron los 3');
      const xs = {};
      foes.enemies.forEach((enemy) => {
        if (enemy.alive) xs[enemy.localX.toFixed(2)] = 1;
      });
      if (Object.keys(xs).length < 2) throw new Error('la oleada se apiló');
      if (waves.update(5)) throw new Error('avanzó con enemigos vivos');
    } finally {
      foes.dispose();
    }
    if (Colliders.all().length !== before) throw new Error('la oleada de prueba dejó cajas');
  }

  try {
    selfTestWaves();
    document.documentElement.dataset.waves = 'ok';
  } catch (err) {
    document.documentElement.dataset.waves = err.message || String(err);
    console.error(err);
  }

  HUD.init();

  function selfTestBelt() {
    const Inventory = window.Game.Inventory;
    try {
      Inventory.reset();
      Inventory.cycleTool(1);
      if (Inventory.activeTool !== 'hands') throw new Error('la rueda salió de las manos');
      if (!Inventory.giveTool('pistol') || Inventory.activeTool !== 'pistol') {
        throw new Error('la pistola no se equipó al agarrarla');
      }
      Inventory.giveTool('axe');
      if (Inventory.activeTool !== 'axe') throw new Error('el hacha no quedó en la mano');
      Inventory.cycleTool(1);
      if (Inventory.activeTool !== 'pistol') throw new Error('la rueda no pasó a la pistola');
      Inventory.cycleTool(-1);
      if (Inventory.activeTool !== 'axe') throw new Error('la rueda no volvió al hacha');

      const cam = new THREE.PerspectiveCamera(75, 1, 0.5, 100);
      const view = window.Game.createWeapon(cam, { spawn() {} });
      view.setTool('hammer');
      const byName = view.tools;
      ['axe', 'pickaxe', 'hammer', 'pistol', 'torch'].forEach((id) => {
        if (!byName[id]) throw new Error('falta el modelo de ' + id);
      });
      if (!byName.hammer.visible || byName.pistol.visible) throw new Error('el martillo no se muestra');
      view.setTool('pistol');
      if (!byName.pistol.visible || byName.hammer.visible || byName.axe.visible) {
        throw new Error('la pistola no se muestra en la mano');
      }
      view.setTool('hands');
      if (byName.pistol.visible || byName.axe.visible) throw new Error('las manos siguen mostrando un arma');

      const tools = Inventory.TOOLS.map((tool) => ({
        id: tool.id,
        key: tool.key,
        owned: Inventory.hasTool(tool.id),
      }));
      HUD.sync({
        hp: 100, maxHp: 100, toolName: 'Hacha',
        wood: 0, stone: 0, metal: 0,
        torch: 0, torchMax: 6,
        hasKey: false, showAmmo: true, mag: 12, reserve: 36, reloading: false,
        prompt: '', tools: tools, active: Inventory.activeTool,
      });
      const slots = document.querySelectorAll('.belt-slot');
      if (slots.length !== 6) throw new Error('el cinturón no tiene 6 lugares');
      if (!slots[0].classList.contains('owned')) throw new Error('las manos no están en el cinturón');
      if (!slots[1].classList.contains('owned') || !slots[1].classList.contains('active')) {
        throw new Error('el hacha no está marcada');
      }
      if (!slots[4].classList.contains('owned')) throw new Error('la pistola no está en el cinturón');
      if (slots[2].classList.contains('owned') || slots[3].classList.contains('owned')) {
        throw new Error('apareció una herramienta que no agarraste');
      }
      if (slots[5].classList.contains('owned')) throw new Error('la antorcha apareció sin craftearla');
    } finally {
      Inventory.reset();
      window.Game.PlayerHealth.reset();
    }
  }

  try {
    selfTestBelt();
    document.documentElement.dataset.belt = 'ok';
  } catch (err) {
    document.documentElement.dataset.belt = err.message || String(err);
    console.error(err);
  }

  const scene = new THREE.Scene();
  // 0.08: el choque deja el ojo a 0.4 m de una pared. Con 0.5 esa cara
  // caía detrás del plano cercano y, al dibujarse solo por fuera, desaparecía.
  // El hombro está a ~0.35 m, así que el mismo corte rebanaba los brazos.
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.08,
    800
  );

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (err) {
    document.documentElement.dataset.boot = err.message || String(err);
    console.error(err);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  // Nivel (?level=N): cada nivel es un planeta distinto. El tutorial es
  // chico y trae todas las mecánicas; los niveles son mundos limpios con
  // misión (llave → puerta → próximo mundo). El portal recarga la página:
  // inventario vacío y estado limpio en cada mundo.
  const levelDef = window.Game.Levels ? window.Game.Levels.current() : null;
  const levelId = levelDef ? levelDef.id : 0;
  if (levelDef && levelDef.planetRadius) {
    Config.PLANET_RADIUS = levelDef.planetRadius;
    Config.TARGET_DISTANCE = levelDef.planetRadius + Config.EYE_HEIGHT;
  }
  document.documentElement.dataset.level = String(levelId);

  // Semilla del mapa (?seed=N): mismo número, mismo planeta en tu máquina
  // y en la de cualquiera. Sin semilla, es la del nivel.
  const wildSeed = window.Game.seedFromUrl
    ? window.Game.seedFromUrl(levelDef ? levelDef.seed : 1337)
    : ((levelDef ? levelDef.seed : 1337) >>> 0);
  const { referenceObjects, playerLight, secondaryLight } = window.Game.createWorld(scene, wildSeed);
  try {
    // El mundo arranca vacío: lo puebla wilds.js con la semilla.
    if (referenceObjects.length !== 0) throw new Error('el mundo no arrancó vacío');
    document.documentElement.dataset.empty = 'ok';
  } catch (err) {
    solidsError = solidsError || err.message || String(err);
    console.error(err);
  }
  const torches = window.Game.createTorches(scene);
  const courtyard = window.Game.createCourtyard(scene, {
    mode: levelDef ? levelDef.mode : 'tutorial',
    mission: levelDef ? levelDef.mission : '',
    guards: levelDef && typeof levelDef.guards === 'number' ? levelDef.guards : 3,
    onPortal: levelDef && levelDef.next != null ? () => {
      // Puerta con llave abierta = misión cumplida = próximo mundo.
      try { HUD.flash('¡Nivel completo! Cruzando al próximo mundo…'); } catch (e) {}
      setTimeout(() => { try { window.Game.Levels.portalTo(levelDef.next); } catch (e) {} }, 900);
    } : (() => {
      try { HUD.flash('La puerta se abre… el próximo mundo todavía no existe.'); } catch (e) {}
    }),
  });
  try {
    if (courtyard.isClean) {
      // Mundo limpio: sin patio de muestra, el chequeo del tutorial no aplica.
      document.documentElement.dataset.yard = 'clean';
    } else {
      const hp = courtyard.nodeHp.join(',');
      if (hp !== '50,100,80') throw new Error('vida de nodos ' + hp);
      if (courtyard.totemCount !== 3) throw new Error('tótems ' + courtyard.totemCount);
      if (courtyard.toolIds.join(',') !== 'axe,pickaxe,pistol') {
        throw new Error('herramientas en el piso ' + courtyard.toolIds.join(','));
      }
      document.documentElement.dataset.yard = 'ok';
    }
  } catch (err) {
    document.documentElement.dataset.yard = err.message || String(err);
    console.error(err);
  }
  const build = window.Game.createBuild(scene, courtyard.frame);
  build.setCamera(camera);
  courtyard.setBuild(build);
  // Campo salvaje con la semilla del mapa: mojones, recursos y campamentos
  // idénticos en todas las máquinas. Las oleadas salen de sus campamentos.
  // Cada nivel define sus zonas (levelDef.wilds).
  const wilds = window.Game.createWilds(scene, wildSeed, levelDef ? levelDef.wilds : null);
  wilds.setCamera(camera);
  const enemiesSystem = window.Game.createEnemies(scene, courtyard.frame, wilds.spawnPoints);
  try {
    const robot = enemiesSystem.enemies[0];
    const at = courtyard.frame.localToWorld(robot.localX, robot.localZ, 1.6);
    const body = { feet: 0, top: 1.6 };
    if (!window.Game.Colliders.blocked(at, 0.2, body)) throw new Error('el robot no ocupa lugar');
    if (window.Game.Colliders.blocked(at, 0.2, body, robot.col)) {
      throw new Error('el robot se choca consigo');
    }
    if (robot.hp !== 100 || robot.maxHp !== 100) throw new Error('el robot no tiene 100 de vida');
    document.documentElement.dataset.solids = solidsError || 'ok';
  } catch (err) {
    document.documentElement.dataset.solids = err.message || String(err);
    console.error(err);
  }

  // Guardianes de la puerta (antípodas): hay que ir armado para pasar de
  // nivel. Viven en el marco de la avanzada, no cuentan para las oleadas
  // ni se guardan con el creador.
  try {
    const guards = courtyard.outpostGuards || [];
    guards.forEach((g) => {
      enemiesSystem.spawnOne(g.x, g.z, false, g.far, g.frame, true);
    });
    if (guards.length) console.log('Guardianes en la puerta:', guards.length);
    document.documentElement.dataset.guards = String(guards.length);
  } catch (err) {
    console.error(err);
  }

  const input = new window.Game.InputManager(canvas, null);
  const player = new window.Game.Player();
  player.position.copy(courtyard.frame.localToWorld(0, -2, Config.EYE_HEIGHT));
  player.currentRadialDistance = player.position.length();

  const projectiles = window.Game.createProjectiles(scene);
  const weapon = window.Game.createWeapon(camera, projectiles);
  const body = window.Game.createBody(scene);
  weapon.attach(body.toolMount);
  // El renderer solo dibuja la escena. La cámara va adentro para la luz
  // del disparo, que sigue siendo hija de ella.
  scene.add(camera);

  function bodyState(dead) {
    const look = new THREE.Vector3();
    camera.getWorldDirection(look);
    return {
      eye: player.position,
      up: player.localUp,
      facing: player.facing,
      grounded: player.isGrounded,
      speed: player.tangentVelocity.length(),
      running: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
      look: look,
      dead: !!dead,
      camera: camera,
    };
  }

  function selfTestViewmodel() {
    const fake = {
      yaw: 0,
      pitch: 0,
      keys: {},
      isDown() { return false; },
      consume() {},
    };
    player.update(0.016, fake, camera);
    body.update(0.016, bodyState(false));
    weapon.update(0.016, fake);
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (w < 32 || h < 32) throw new Error('sin imagen');
    function shot() {
      renderer.render(scene, camera);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return buf;
    }
    function differ(a, b) {
      let n = 0;
      for (let i = 0; i < a.length; i += 32) {
        n += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      }
      return n;
    }
    weapon.setTool('hands');
    const bare = shot();
    let lit = 0;
    for (let i = 0; i < bare.length; i += 64) lit += bare[i] + bare[i + 1] + bare[i + 2];
    if (lit < 200) throw new Error('la vista no se dibujó');
    weapon.setTool('pistol');
    body.update(0.016, bodyState(false));
    weapon.update(0.016, fake);
    const pistolDiff = differ(bare, shot());
    if (pistolDiff < 20000) {
      const pistol = weapon.tools.pistol;
      const at = new THREE.Vector3();
      pistol.getWorldPosition(at);
      throw new Error('la pistola no aparece en la mira (' + pistolDiff + ') d=' + at.distanceTo(camera.position).toFixed(2) + ' vis=' + pistol.visible);
    }
    weapon.setTool('axe');
    body.update(0.016, bodyState(false));
    weapon.update(0.016, fake);
    const axeDiff = differ(bare, shot());
    if (axeDiff < 20000) throw new Error('el hacha no aparece en la mira (' + axeDiff + ')');
    weapon.setTool('hammer');
    body.update(0.016, bodyState(false));
    weapon.update(0.016, fake);
    const hammerDiff = differ(bare, shot());
    if (hammerDiff < 20000) throw new Error('el martillo no aparece en la mira (' + hammerDiff + ')');
    weapon.setTool('pickaxe');
    body.update(0.016, bodyState(false));
    weapon.update(0.016, fake);
    const pickDiff = differ(bare, shot());
    if (pickDiff < 20000) throw new Error('el pico no aparece en la mira (' + pickDiff + ')');
    weapon.setTool('torch');
    body.update(0.016, bodyState(false));
    weapon.update(0.016, fake);
    const torchDiff = differ(bare, shot());
    if (torchDiff < 20000) throw new Error('la antorcha no aparece en la mira (' + torchDiff + ')');
    weapon.setTool(Inventory.activeTool);
  }

  try {
    selfTestViewmodel();
    document.documentElement.dataset.view = 'ok';
  } catch (err) {
    document.documentElement.dataset.view = err.message || String(err);
    console.error(err);
  }

  function selfTestBody() {
    const frame = courtyard.frame;
    const level = {
      yaw: 0, pitch: 0, keys: {},
      isDown() { return false; },
      consume() {},
    };
    function place(pitch) {
      level.pitch = pitch;
      player.update(0.05, level, camera);
      body.update(0.05, bodyState(false));
    }
    function ahead(point) {
      const camFwd = new THREE.Vector3();
      camera.getWorldDirection(camFwd);
      return point.clone().sub(camera.position).dot(camFwd);
    }
    place(0);
    if (camera.near > 0.1) throw new Error('el plano cercano corta de cerca');
    if (body.root.parent !== scene) throw new Error('el muñeco no está en el mundo');
    if (body.head.visible) throw new Error('se ve la cabeza desde adentro');
    const up = player.localUp;
    const right = new THREE.Vector3().crossVectors(player.facing, up);
    const rightHand = body.fist('right');
    const leftHand = body.fist('left');
    const rightDot = rightHand.clone().sub(player.position).dot(right);
    const leftDot = leftHand.clone().sub(player.position).dot(right);
    if (rightDot < leftDot + 0.15) {
      throw new Error('las manos están cruzadas r=' + rightDot.toFixed(2) + ' l=' + leftDot.toFixed(2));
    }
    const fistDist = body.fist('right').distanceTo(player.position);
    if (fistDist < 0.55) throw new Error('el puño entra en la cámara (' + fistDist.toFixed(2) + ')');
    if (ahead(body.foot('right')) > 0.45) throw new Error('los pies se ven mirando al frente');

    place(-1.15);
    const footAhead = ahead(body.foot('right'));
    if (footAhead < 0.8) throw new Error('mirar abajo no muestra los pies (' + footAhead.toFixed(2) + ')');
    place(0);

    let separated = 0;
    for (let i = 0; i < 10; i++) {
      body.update(0.08, {
        eye: player.position,
        up: player.localUp,
        facing: player.facing,
        grounded: true,
        speed: 8,
        running: false,
        look: player.facing,
        dead: false,
        camera: camera,
      });
      const gap = Math.abs(
        body.foot('right').sub(player.position).dot(player.facing) -
        body.foot('left').sub(player.position).dot(player.facing)
      );
      if (gap > separated) separated = gap;
    }
    if (separated < 0.04) throw new Error('las piernas no caminan');
    place(0);

    const guard = body.fist('right').sub(player.position).dot(player.facing);
    if (guard < 0.25) throw new Error('la guardia no está adelante (' + guard.toFixed(2) + ')');
    if (!body.tryPunch('right')) throw new Error('el puño derecho no salió');
    for (let i = 0; i < 5; i++) body.update(0.03, bodyState(false));
    const extended = body.fist('right').sub(player.position).dot(player.facing);
    body.takeStrike();
    if (extended < guard + 0.12) {
      throw new Error('el puño no avanza (' + guard.toFixed(2) + '→' + extended.toFixed(2) + ')');
    }
    if (body.tryPunch('right')) throw new Error('el mismo puño salió dos veces');
    if (body.tryPunch('left')) throw new Error('el otro puño salió antes de tiempo');
    body.update(0.2, bodyState(false));
    body.takeStrike();
    if (!body.tryPunch('left')) throw new Error('no dejó alternar');
    if (body.tryPunch('right')) throw new Error('la derecha no esperó su vuelta');
    body.update(0.6, bodyState(false));
    body.update(0.6, bodyState(false));
    body.takeStrike();

    const here = frame.worldToLocal(player.position);
    const fx = player.facing.dot(frame.tangentX);
    const fz = player.facing.dot(frame.tangentZ);
    const before = window.Game.Colliders.all().length;
    const foes = window.Game.createEnemies(scene, frame, [{
      x: here.x + fx * 1.15,
      z: here.z + fz * 1.15,
      hp: 40,
    }]);
    try {
      if (!body.tryPunch('right')) throw new Error('el golpe de prueba no salió');
      let strike = null;
      for (let i = 0; i < 8; i++) {
        body.update(0.03, bodyState(false));
        strike = body.takeStrike() || strike;
      }
      if (!strike) throw new Error('el golpe no tuvo impacto');
      const end = strike.origin.clone().addScaledVector(strike.direction, body.reach);
      const hit = window.Game.Colliders.segment(strike.origin, end);
      if (!hit || hit.col.kind !== 'enemy') throw new Error('el puño no encontró al robot');
      foes.damageEnemy(hit.col.ref, body.damage);
      if (hit.col.ref.hp !== 30) throw new Error('el puño pegó ' + (40 - hit.col.ref.hp));
    } finally {
      foes.dispose();
    }
    if (window.Game.Colliders.all().length !== before) {
      throw new Error('el robot de prueba dejó su caja');
    }
    place(0);
    weapon.setTool(Inventory.activeTool);
  }

  try {
    selfTestBody();
    document.documentElement.dataset.body = 'ok';
  } catch (err) {
    document.documentElement.dataset.body = err.message || String(err);
    console.error(err);
  }

  projectiles.setHandlers({
    onEnemy(enemy, amount) { return enemiesSystem.damageEnemy(enemy, amount); },
    onBlock(block) { build.hurtBlock(block); },
    onBench(bench, amount) { courtyard.hurtBench(bench, amount); },
    onPlayer(amount) { PlayerHealth.damage(amount); },
    playerCapsule() {
      const up = player.position.clone().normalize();
      const feet = player.position.clone().addScaledVector(up, -Config.EYE_HEIGHT);
      const head = feet.clone().addScaledVector(up, 1.7);
      return { feet: feet, head: head, radius: Config.PLAYER_RADIUS };
    },
  });
  enemiesSystem.setCombat({
    projectiles: projectiles,
    benches: function () { return courtyard.benches; },
    hurtBench: function (bench, amount) { courtyard.hurtBench(bench, amount); },
  });
  courtyard.setWeapon(weapon);
  courtyard.setCamera(camera);
  const waves = window.Game.createWaves(enemiesSystem, wilds.spawnPoints, 60);
  // Modo Creador (port del FPS): gratis + volar + paleta + guardado.
  // El load se hace después de los self-tests para no ocuparles las celdas.
  const Creator = window.Game.createCreator
    ? window.Game.createCreator({ build: build, courtyard: courtyard, enemies: enemiesSystem, player: player, camera: camera, canvas: canvas, scene: scene, store: window.Game.Levels ? window.Game.Levels.creatorStore(levelId) : undefined })
    : null;
  if (Creator && Creator.setCamera) Creator.setCamera(camera);
  // La zona se cablea después de los self-tests (usan su propio build y
  // celdas fuera de la zona, p. ej. 12,4 en selfTestLife).
  if (HUD.setCreatorHandlers && Creator) {
    HUD.setCreatorHandlers({
      isOn: () => Creator.isOn(),
      isFly: () => Creator.isFly(),
      toggle: () => Creator.toggle(),
      fly: () => Creator.setFly(!Creator.isFly()),
      palette: () => Creator.togglePalette(true),
      clear: () => {
        if (window.confirm('¿Vaciar lo construido? El patio fijo queda.')) {
          const r = Creator.clearWorld();
          if (r && r.text) HUD.flash(r.text);
        }
      },
      save: () => HUD.flash(Creator.save() ? 'Mundo guardado' : 'No se pudo guardar'),
      status: () => {
        try {
          const st = courtyard.territoryStatus();
          const base = st.active
            ? ('Zona activa: radio ' + st.radius + ' alrededor de tu mesa (' + st.centers.length + ').')
            : 'Zona perdida: poné un workbench para reclamar y frenar el decaimiento.';
          return base + (Creator.isOn() ? ' Creador SÍ.' : ' Creador NO (G lo prende).');
        } catch (e) {
          return '';
        }
      },
    });
  }
  const Settings = window.Game.Settings;
  const spawnPos = player.position.clone();
  let runStart = performance.now();
  Inventory.onChange((snap) => weapon.setTool(snap.active));
  HUD.setToolHandler((id) => {
    if (HUD.isModalOpen() || HUD.isPaused() || PlayerHealth.isDead) return;
    if (!Inventory.setTool(id)) HUD.flash('Todavía no tenés esa herramienta');
  });
  window.addEventListener('wheel', (e) => {
    if (HUD.isModalOpen() || HUD.isPaused() || PlayerHealth.isDead) return;
    if (!(input.pointerLocked || input.fallbackMode)) return;
    const dir = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    if (!dir) return;
    Inventory.cycleTool(dir > 0 ? 1 : -1);
  }, { passive: true });

  window.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('click', () => {
    if (Audio && !Audio.isReady()) Audio.init();
    if (!(input.pointerLocked || input.fallbackMode)) return;
    if (HUD.isModalOpen() || HUD.isPaused() || PlayerHealth.isDead) return;
    // Mesa en mano: el jugador decide dónde va con el fantasma.
    if (courtyard.isCarryingBench()) {
      const put = courtyard.placeCarriedBench(player.position);
      if (put && put.text) HUD.flash(put.text);
      return;
    }
    if (Creator && Creator.isOn()) {
      // En creador la paleta puede estar abierta: el clic ya eligió.
      if (Creator.isPaletteOpen()) {
        Creator.togglePalette(false);
        try { canvas.requestPointerLock(); } catch (err) {}
        return;
      }
      const placed = Creator.place(player.position);
      if (placed && placed.text) HUD.flash(placed.text);
      return;
    }
    if (Inventory.activeTool === 'hands') {
      body.tryPunch('right');
      return;
    }
    if (Inventory.activeTool === 'hammer') {
      const placed = build.tryPlace(player.position);
      if (placed && placed.text) HUD.flash(placed.text);
      return;
    }
    if (Inventory.activeTool === 'pistol') weapon.shoot();
    else {
      const message = courtyard.tryHarvest() || wilds.tryHarvest();
      if (message) HUD.flash(message);
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    if (Audio && !Audio.isReady()) Audio.init();
    if (!(input.pointerLocked || input.fallbackMode)) return;
    if (HUD.isModalOpen() || HUD.isPaused() || PlayerHealth.isDead) return;
    if (Creator && Creator.isOn()) {
      // Como el FPS: el derecho abre el menú de construcción.
      // Para sacar, elegí ❌ y hacé clic.
      Creator.togglePalette(true);
      return;
    }
    if (Inventory.activeTool === 'hammer') {
      const removed = build.tryDelete();
      if (removed && removed.text) HUD.flash(removed.text);
      return;
    }
    body.tryPunch('left');
  });

  function unlockForModal() {
    // Con pointer lock el mouse no puede clicar botones: se suelta al abrir
    // un menú (mesa, mochila, tótem) y se recupera al cerrarlo.
    try {
      document.exitPointerLock();
    } catch (err) {}
  }

  function relockAfterModal() {
    try {
      if (!input.pointerLocked && !input.fallbackMode && !HUD.isPaused()) {
        canvas.requestPointerLock();
      }
    } catch (err) {}
  }

  function showCraft() {
    HUD.openCraft(courtyard.recipes(), (index) => {
      const result = courtyard.craft(index);
      if (result.message) HUD.flash(result.message);
      // La mesa queda en mano: se cierra el menú para elegir dónde ponerla.
      if (result.carrying) {
        HUD.closeModal();
        relockAfterModal();
        return;
      }
      if (HUD.isCraftOpen()) showCraft();
    }, courtyard.benchHeading());
    unlockForModal();
  }

  function showPack() {
    const snap = Inventory.state;
    HUD.openPack({
      wood: snap.resources.wood,
      stone: snap.resources.stone,
      metal: snap.resources.metal,
      torch: snap.stacks.torch || 0,
      torchMax: Inventory.stackMax('torch'),
      hasKey: snap.hasKey,
      reserve: weapon.reserve,
      tools: Inventory.TOOLS.map((tool) => ({
        id: tool.id,
        name: tool.name,
        owned: !!snap.owned[tool.id],
      })),
      basic: courtyard.basicRecipes(),
    }, {
      craftBasic(index) {
        const result = courtyard.craft(index);
        if (result.message) HUD.flash(result.message);
        // La mesa queda en mano: se cierra la mochila para posicionarla.
        if (result.carrying) {
          HUD.closeModal();
          relockAfterModal();
          return;
        }
        if (HUD.isPackOpen()) showPack();
      },
      drop(id) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const result = courtyard.drop(id, player.position, dir);
        if (result.text) HUD.flash(result.text);
        if (HUD.isPackOpen()) showPack();
      },
    });
    unlockForModal();
  }

  function runClock() {
    const seconds = Math.max(0, Math.floor((performance.now() - runStart) / 1000));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }

  function revivePlayer(lock) {
    PlayerHealth.revive();
    player.position.copy(spawnPos);
    player.currentRadialDistance = player.position.length();
    player.tangentVelocity.set(0, 0, 0);
    player.verticalVelocity = 0;
    player.isGrounded = true;
    player.coyote = Config.COYOTE_TIME;
    if (Inventory.hasTool('pistol')) weapon.ensureReserve(12);
    deathShown = false;
    HUD.closeDeath();
    runStart = performance.now();
    if (lock) {
      try { canvas.requestPointerLock(); } catch (err) { /* el click siguiente entra */ }
    }
  }

  HUD.setRespawn(() => revivePlayer(true));

  const toolByCode = {
    Digit1: 'hands', Digit2: 'axe', Digit3: 'pickaxe', Digit4: 'hammer', Digit5: 'pistol', Digit6: 'torch',
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (HUD.isRebinding()) {
      HUD.captureKey(e);
      return;
    }
    if (e.code === 'Escape') {
      if (PlayerHealth.isDead || HUD.isDeathOpen()) return;
      // Mesa en mano: Esc la guarda sin gastar.
      if (courtyard.isCarryingBench()) {
        courtyard.cancelBenchCarry();
        HUD.flash('Mesa guardada');
        return;
      }
      if (Creator && Creator.isPaletteOpen()) {
        Creator.togglePalette(false);
        try { canvas.requestPointerLock(); } catch (err) {}
        return;
      }
      if (HUD.isModalOpen()) {
        HUD.closeModal();
        relockAfterModal();
        return;
      }
      if (!HUD.isPaused()) {
        try { document.exitPointerLock(); } catch (err) { /* sigue en pausa igual */ }
      }
      HUD.togglePause();
      return;
    }
    if (HUD.isPaused() || PlayerHealth.isDead) return;
    if (e.code === Settings.code('pack')) {
      if (HUD.isPackOpen()) {
        HUD.closeModal();
        relockAfterModal();
      } else {
        HUD.closeModal();
        showPack();
      }
      return;
    }
    if (HUD.isCraftOpen() && /^Digit[0-9]$/.test(e.code)) {
      HUD.pickCraft(e.code === 'Digit0' ? 9 : Number(e.code.slice(5)) - 1);
      return;
    }
    if (HUD.isPackOpen() && /^Digit[1-5]$/.test(e.code)) {
      const rows = courtyard.basicRecipes();
      const row = rows[Number(e.code.slice(5)) - 1];
      if (row) {
        const made = courtyard.craft(row.index);
        if (made.message) HUD.flash(made.message);
        if (made.carrying) {
          HUD.closeModal();
          relockAfterModal();
          return;
        }
        if (HUD.isPackOpen()) showPack();
      }
      return;
    }
    if (HUD.isModalOpen()) return;
    const playing = input.pointerLocked || input.fallbackMode;
    // Modo Creador: G prende/apaga, B abre la paleta (como el FPS).
    if (Creator && playing && e.code === 'KeyG') {
      Creator.toggle();
      return;
    }
    if (Creator && Creator.isOn() && playing && e.code === 'KeyB') {
      Creator.togglePalette();
      return;
    }
    if (playing && toolByCode[e.code]) {
      if (!Inventory.setTool(toolByCode[e.code])) HUD.flash('Todavía no tenés esa herramienta');
    }
    if (e.code === Settings.code('reload') && playing && Inventory.activeTool === 'pistol') weapon.startReload();
    if (e.code === Settings.code('material') && playing && Inventory.activeTool === 'hammer') {
      HUD.flash(build.cycleMaterial());
    }
    if (e.code === Settings.code('stairs') && playing && Inventory.activeTool === 'hammer') {
      const placed = build.tryStairs(player.position);
      if (placed && placed.text) HUD.flash(placed.text);
    }
  });

  camera.position.copy(player.position);
  camera.up.copy(player.localUp);

  input.onResize(() => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const debugEl = document.getElementById('debug-info');
  const clock = new THREE.Clock();
  const lookDir = new THREE.Vector3();
  let ePrevDown = false;
  let fPrevDown = false;
  let deathShown = false;
  let heartIn = 0.4;
  // Paredes rápidas: clic mantenido pone en ráfaga (martillo y creador).
  // El clic simple da el primer bloque al instante; la ráfaga arranca a
  // los 220 ms para no duplicarlo.
  let placingHeld = false;
  let placeCooldown = 0;

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    placingHeld = true;
    placeCooldown = 0.22;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) placingHeld = false;
  });
  window.addEventListener('blur', () => {
    placingHeld = false;
  });

  function discardPickup(spec) {
    if (!spec || !spec.alive) return;
    spec.alive = false;
    scene.remove(spec.mesh);
  }

  function selfTestLife() {
    let block = null;
    try {
      Inventory.addResource('wood', 2);
      Inventory.addStack('torch', 2);
      const placed = build.placeCell(12, 4, 0, 'wood', player.position);
      if (!placed.ok) throw new Error(placed.text);
      block = placed.block;
      const blocks = build.blockCount();
      PlayerHealth.damage(40);
      if (PlayerHealth.isDead) throw new Error('murió con vida de sobra');
      PlayerHealth.damage(80);
      if (!PlayerHealth.isDead || PlayerHealth.hp !== 0) throw new Error('no murió');
      HUD.showDeath({ time: runClock(), kills: enemiesSystem.kills, wave: waves.number, blocks: blocks });
      const sheet = document.querySelector('.death-sheet');
      const stats = document.querySelector('.death-stats');
      if (!sheet || sheet.hidden) throw new Error('no apareció la pantalla de muerte');
      if (!stats || stats.textContent.indexOf('Bloques ' + blocks) < 0 || stats.textContent.indexOf('Oleada') < 0) {
        throw new Error('las estadísticas no están');
      }
      if (Inventory.stackCount('torch') !== 2 || build.blockCount() !== blocks) {
        throw new Error('morir borró el patio');
      }
      revivePlayer(false);
      if (PlayerHealth.isDead || PlayerHealth.hp !== 100) throw new Error('reaparecer no devolvió la vida');
      if (Inventory.stackCount('torch') !== 2 || build.blockCount() !== blocks) {
        throw new Error('reaparecer no conservó mochila y bloques');
      }
      if (!sheet.hidden) throw new Error('la pantalla de muerte quedó abierta');
    } finally {
      if (block) build.removeBlock(block);
      Inventory.reset();
      if (PlayerHealth.isDead) PlayerHealth.revive();
      HUD.closeDeath();
      deathShown = false;
    }
  }

  function selfTestPause() {
    const sens = Settings.sensitivity;
    const music = Settings.music;
    try {
      Settings.setKey('torch', 'KeyF');
      if (Settings.setKey('torch', 'KeyW').ok) throw new Error('dejó reasignar W');
      if (!Settings.setKey('torch', 'KeyG').ok || Settings.code('torch') !== 'KeyG') {
        throw new Error('no reasignó la antorcha');
      }
      if (Settings.label('torch') !== 'G') throw new Error('la letra no se lee');
      Settings.setSensitivity(0.004);
      if (Config.MOUSE_SENSITIVITY !== 0.004) throw new Error('la sensibilidad no llegó al mouse');
      Settings.setMusic(false);
      if (Settings.music !== false) throw new Error('la música no se apagó');
      Settings.setMusic(true);
      HUD.togglePause();
      const sheet = document.querySelector('.pause-sheet');
      if (!HUD.isPaused() || !sheet || sheet.hidden) throw new Error('la pausa no se abrió');
      HUD.setPauseStats('Vida 100 · prueba');
      const stats = sheet.querySelector('.craft-copy');
      if (!stats || stats.textContent.indexOf('Vida 100') < 0) throw new Error('el estado no se escribió');
      HUD.closePause();
      if (HUD.isPaused() || !sheet.hidden) throw new Error('la pausa no se cerró');
    } finally {
      Settings.setKey('torch', 'KeyF');
      Settings.setSensitivity(sens);
      Settings.setMusic(music);
      HUD.closePause();
    }
  }

  function selfTestDrop() {
    const ahead = courtyard.frame.tangentZ.clone();
    const origin = courtyard.frame.worldToLocal(player.position);
    let spec = null;
    try {
      Inventory.setKey(true);
      const key = courtyard.drop('key', player.position, ahead);
      spec = key.pickup;
      if (!key.ok || Inventory.hasKey) throw new Error('la llave no salió de la mochila');
      courtyard.tryInteract(courtyard.frame.localToWorld(key.x, key.z, Config.EYE_HEIGHT));
      if (!Inventory.hasKey) throw new Error('la llave no volvió');
      spec = null;
      Inventory.takeKey();

      Inventory.giveTool('axe');
      const idsBefore = courtyard.toolIds.join(',');
      const axe = courtyard.drop('axe', player.position, ahead);
      spec = axe.pickup;
      if (!axe.ok || Inventory.hasTool('axe')) throw new Error('el hacha no se soltó');
      if (courtyard.toolIds.join(',') !== idsBefore) {
        throw new Error('soltar sumó un arma al patio fijo');
      }
      courtyard.tryInteract(courtyard.frame.localToWorld(axe.x, axe.z, Config.EYE_HEIGHT));
      if (!Inventory.hasTool('axe')) throw new Error('el hacha no se recogió');
      spec = null;
      Inventory.takeTool('axe');

      const before = weapon.reserve;
      const ammo = courtyard.drop('ammo', player.position, ahead);
      spec = ammo.pickup;
      if (!ammo.ok || weapon.reserve !== before - 12) throw new Error('las balas no salieron de la reserva');
      courtyard.tryInteract(courtyard.frame.localToWorld(ammo.x, ammo.z, Config.EYE_HEIGHT));
      if (weapon.reserve !== before) throw new Error('las balas no volvieron');
      spec = null;
    } finally {
      discardPickup(spec);
      Inventory.reset();
      PlayerHealth.revive();
    }
  }

  try {
    selfTestLife();
    document.documentElement.dataset.life = 'ok';
  } catch (err) {
    document.documentElement.dataset.life = err.message || String(err);
    console.error(err);
  }

  try {
    selfTestPause();
    document.documentElement.dataset.pause = 'ok';
  } catch (err) {
    document.documentElement.dataset.pause = err.message || String(err);
    console.error(err);
  }

  try {
    selfTestDrop();
    document.documentElement.dataset.drop = 'ok';
  } catch (err) {
    document.documentElement.dataset.drop = err.message || String(err);
    console.error(err);
  }

  try {
    if (Creator) {
      const restored = Creator.load();
      if (restored > 0) console.log('Mundo creador restaurado:', restored);
    }
  } catch (err) { console.error(err); }

  // La misión vive en la solapa Jugar del menú (se muestra al entrar).

  // La zona de construcción la da el banco del jugador (ver territoryStatus).
  if (build.setTerritoryProvider) {
    build.setTerritoryProvider(() => courtyard.territoryStatus());
  }

  // Sin mesa no hay zona; con mesa propia la zona cubre los 360° donde el
  // patio deja (lo ocupado fijo no cuenta). El spawn y el afuera quedan
  // prohibidos, y no deja otra mesa pegada: el reclamo es del primero.
  function selfTestTerritory() {
    if (Creator && Creator.isOn()) throw new Error('el creador quedó prendido');
    const before = Inventory.count('wood');
    Inventory.addResource('wood', 60);
    const beforeStone = Inventory.count('stone');
    Inventory.addResource('stone', 10);
    const placed = [];
    let bench = null;
    try {
      // Si un mundo guardado ya tiene reclamo, no se puede probar el vacío.
      if (!courtyard.territoryStatus().active) {
        const bare = build.placeCell(0, 13, 0, 'wood', null);
        if (bare.ok || bare.text !== 'Sin mesa: poné un workbench para reclamar la zona') {
          throw new Error('dejó construir sin mesa (' + (bare.ok ? 'ok' : bare.text) + ')');
        }
      }
      // Horizontal de verdad lejos del polo: el arriba de la mesa es el
      // radio local aunque el chart mire al polo.
      let farBench = null;
      for (const [fx, fz] of [[12, 24], [-12, 24], [12, -24]]) {
        const attempt = courtyard.placeBenchAt(fx, fz, true);
        if (attempt.ok) {
          farBench = attempt.bench;
          break;
        }
      }
      if (farBench) {
        try {
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(farBench.mesh.quaternion);
          const radial = farBench.mesh.position.clone().normalize();
          if (up.dot(radial) < 0.999) {
            throw new Error('la mesa quedó ladeada (' + up.dot(radial).toFixed(4) + ')');
          }
        } finally {
          try { courtyard.removeBench(farBench); } catch (e) {}
        }
      }
      // Craftear la mesa la deja en mano con fantasma, sin gastar todavía.
      const benchIdx = window.Game.CraftRecipes.findIndex((r) => r.placeBench);
      if (benchIdx < 0) throw new Error('sin receta de mesa');
      const wBeforeCarry = Inventory.count('wood');
      const sBeforeCarry = Inventory.count('stone');
      const carryRes = courtyard.craft(benchIdx);
      if (!carryRes.carrying || !courtyard.isCarryingBench()) {
        throw new Error('la mesa no quedó en mano');
      }
      if (Inventory.count('wood') !== wBeforeCarry || Inventory.count('stone') !== sBeforeCarry) {
        throw new Error('craftear la mesa gastó antes de ponerla');
      }
      courtyard.cancelBenchCarry();
      if (courtyard.isCarryingBench()) throw new Error('la mesa no se guardó');
      const benchSpots = [[0, 14], [0, 10], [6, 12], [-6, 12]];
      for (const [bx, bz] of benchSpots) {
        const put = courtyard.placeBenchAt(bx, bz, false);
        if (put.ok) {
          bench = put.bench;
          break;
        }
      }
      if (!bench) throw new Error('no pudo poner su mesa de prueba');
      const bx = bench.x;
      const bz = bench.z;
      // El anillo de zona va clavado a SU mesa, no al polo.
      if (!bench.ring || !bench.ring.visible) throw new Error('la zona no marca su mesa');
      const rr = bench.mesh.position.clone().normalize();
      const expectRing = bench.mesh.position.clone().addScaledVector(rr, 0.07);
      if (bench.ring.position.distanceTo(expectRing) > 0.05) {
        throw new Error('el anillo no está en la mesa');
      }
      // En-chart en los cuatro cuadrantes; lo ocupado ajeno se saltea.
      const cells = [[3, -1], [-3, -1], [0, -3], [2, -2], [-2, -2], [0, 1], [4, -2], [-4, -2], [0, -4]];
      cells.forEach(([dx, dz]) => {
        const ix = Math.round(bx + dx);
        const iz = Math.round(bz + dz);
        if (ix * ix + iz * iz > 256) return;
        if (Math.hypot(ix - Config.SPAWN_X, iz - Config.SPAWN_Z) < Config.SPAWN_SAFE_R) return;
        const r = build.placeCell(ix, iz, 0, 'wood', null);
        if (r.ok) {
          placed.push(r.block);
          return;
        }
        if (r.text !== 'Ese lugar está ocupado') {
          throw new Error('celda ' + ix + ',' + iz + ': ' + r.text);
        }
      });
      if (placed.length < 3) throw new Error('casi no puso bloques en la zona (' + placed.length + ')');
      // Lejos de todo reclamo pero dentro del patio y fuera del spawn.
      const farSpots = [[10, 8], [-10, 8], [0, -10], [10, -6], [-10, -6]];
      let zoneChecked = false;
      for (const [ix, iz] of farSpots) {
        if (ix * ix + iz * iz > 256) continue;
        if (Math.hypot(ix - Config.SPAWN_X, iz - Config.SPAWN_Z) < Config.SPAWN_SAFE_R) continue;
        const st = courtyard.territoryStatus();
        const inside = st.centers.some((c) => Math.hypot(ix - c.x, iz - c.z) <= st.radius);
        if (inside) continue;
        const out = build.placeCell(ix, iz, 0, 'wood', null);
        if (out.ok) throw new Error('dejó construir fuera de la zona en ' + ix + ',' + iz);
        if (out.text === 'Ese lugar está ocupado') continue;
        if (out.text !== 'Fuera de tu zona: construí cerca de tu mesa') {
          throw new Error('mensaje raro fuera de zona: ' + out.text);
        }
        zoneChecked = true;
        break;
      }
      if (!zoneChecked) throw new Error('no encontró dónde probar fuera de zona');
      const spawn = build.placeCell(0, -2, 0, 'wood', null);
      if (spawn.ok || (spawn.text !== 'Zona de spawn: acá no se construye' && spawn.text !== 'Ese lugar está ocupado')) {
        throw new Error('dejó construir en el spawn (' + (spawn.ok ? 'ok' : spawn.text) + ')');
      }
      const patio = build.placeCell(0, 17, 0, 'wood', null);
      if (!patio.ok && patio.text !== 'Ese lugar está ocupado') {
        throw new Error('celda 0,17: ' + patio.text);
      }
      if (patio.ok) placed.push(patio.block);
      // Dios en creador: bloques en cualquier parte del planeta.
      const godSpots = [[30, -40], [-35, -30], [40, 25]];
      let farPlaced = false;
      build.setCreator(true);
      try {
        for (const [ix, iz] of godSpots) {
          const r = build.placeCell(ix, iz, 0, 'stone', null);
          if (r.ok) {
            placed.push(r.block);
            farPlaced = true;
            break;
          }
          if (r.text !== 'Ese lugar está ocupado') {
            throw new Error('celda lejana ' + ix + ',' + iz + ': ' + r.text);
          }
        }
      } finally {
        build.setCreator(false);
      }
      if (!farPlaced) throw new Error('el creador no llega lejos');
      let gapChecked = false;
      const gapSpots = [[2, 0], [-2, 0], [0, 2], [0, -2]];
      for (const [dx, dz] of gapSpots) {
        const near = courtyard.placeBenchAt(Math.round(bx + dx), Math.round(bz + dz), true);
        if (near.ok) {
          try { courtyard.removeBench(near.bench); } catch (e) {}
          throw new Error('dejó otra mesa pegada');
        }
        if (near.text === 'Ese lugar está ocupado') continue;
        if (near.text.indexOf('cerca') < 0) throw new Error('aviso raro de cercanía: ' + near.text);
        gapChecked = true;
        break;
      }
      if (!gapChecked) throw new Error('no pudo probar cercanía de mesas');
    } finally {
      placed.forEach((block) => {
        try { build.removeBlock(block); } catch (e) {}
      });
      if (bench) {
        try { courtyard.removeBench(bench); } catch (e) {}
      }
      try {
        const diff = Inventory.count('wood') - before;
        if (diff > 0) Inventory.trySpend({ wood: diff });
        const diffStone = Inventory.count('stone') - beforeStone;
        if (diffStone > 0) Inventory.trySpend({ stone: diffStone });
      } catch (e) {}
    }
  }

  try {
    selfTestTerritory();
    document.documentElement.dataset.territory = 'ok';
  } catch (err) {
    document.documentElement.dataset.territory = err.message || String(err);
    console.error(err);
  }

  // Avanzada real: la puerta está en la antípoda, frena de verdad y la E
  // la entiende (marco propio). La llave espera al lado, visible.
  function selfTestOutpost() {
    const st = courtyard.outpostStatus ? courtyard.outpostStatus() : null;
    if (!st) throw new Error('sin avanzada');
    if (st.antipodal > -0.98) {
      throw new Error('la puerta no está en la antípoda (' + st.antipodal.toFixed(3) + ')');
    }
    if (Math.abs(st.door.length() - Config.PLANET_RADIUS - 1.25) > 0.6) {
      throw new Error('la puerta flota o está enterrada');
    }
    if (!window.Game.Colliders.blocked(st.door, 0.2, { feet: 0, top: 2 })) {
      throw new Error('la puerta no frena');
    }
    if (!st.keyAlive || !st.key) throw new Error('falta la llave de la avanzada');
    if (Math.abs(st.key.length() - Config.PLANET_RADIUS - 0.7) > 0.6) {
      throw new Error('la llave flota o está enterrada');
    }
    const savedPos = player.position.clone();
    try {
      // En el spawn no hay puerta fantasma: ni la E la ve ni frena nada.
      player.position.copy(courtyard.frame.localToWorld(Config.SPAWN_X, Config.SPAWN_Z, Config.EYE_HEIGHT));
      const home = courtyard.tryInteract(player.position);
      if (home && home.type === 'flash' && home.text.indexOf('llave') >= 0) {
        throw new Error('la puerta fantasma atiende en el spawn');
      }
      if (window.Game.Colliders.blocked(player.position, Config.PLAYER_RADIUS, { feet: 0, top: Config.EYE_HEIGHT })) {
        throw new Error('pared fantasma en el spawn');
      }
      // Pararse ante la puerta: la E tiene que pedir la llave (sin tenerla).
      player.position.copy(st.door.clone().normalize().multiplyScalar(Config.TARGET_DISTANCE));
      const locked = courtyard.tryInteract(player.position);
      if (!locked || locked.type !== 'flash' || locked.text.indexOf('llave') < 0) {
        throw new Error('la E no entendió la puerta (' + (locked && locked.text) + ')');
      }
    } finally {
      player.position.copy(savedPos);
    }
  }

  try {
    selfTestOutpost();
    document.documentElement.dataset.outpost = 'ok';
  } catch (err) {
    document.documentElement.dataset.outpost = err.message || String(err);
    console.error(err);
  }

  // Menú inicial = la misma pausa. El mundo arranca en pausa; la primera
  // vez muestra la intro y después el menú, si no entra directo al menú.
  if (HUD.setResumeHandler) {
    HUD.setResumeHandler(() => {
      try {
        if (Audio && !Audio.isReady()) Audio.init();
      } catch (e) {}
      try {
        if (!input.pointerLocked && !input.fallbackMode) canvas.requestPointerLock();
      } catch (e) {}
    });
  }
  if (!HUD.hasSeenIntro()) {
    HUD.setIntroDone(() => HUD.openMenu('start'));
    HUD.openIntro();
  } else if (!HUD.isPaused()) {
    HUD.openMenu('start');
  }

  let hadTerritory = true;
  try {
    hadTerritory = courtyard.territoryStatus().active;
  } catch (e) {}

  function animate() {
    requestAnimationFrame(animate);

    let dt = clock.getDelta();
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) dt = 0.016;
    const t = clock.elapsedTime;
    const isDead = PlayerHealth.isDead;

    const paused = HUD.isModalOpen() || HUD.isPaused();
    if (!isDead && !paused) {
      player.update(dt, input, camera);
      body.update(dt, bodyState(false));
      const strike = body.takeStrike();
      if (strike) {
        const end = strike.origin.clone().addScaledVector(strike.direction, body.reach);
        const hit = window.Game.Colliders.segment(strike.origin, end);
        if (hit && hit.col.kind === 'enemy' && hit.col.ref) {
          const killed = enemiesSystem.damageEnemy(hit.col.ref, body.damage);
          if (Audio && Audio.isReady()) {
            if (killed) Audio.kill();
            else Audio.hit();
          }
        }
      }
      courtyard.update(dt, t, player.position);
      enemiesSystem.update(dt, t, player.position);
      wilds.update(dt, t, player.position);
      projectiles.update(dt);
      weapon.update(dt, input);
      build.update(dt, Inventory.activeTool, player.position);
      if (Creator && Creator.update) {
        try {
          Creator.update(dt, Inventory.activeTool, player.position);
        } catch (e) {}
      }
      // Comida y toxina: los robots también las consumen al pisarlas.
      // La comida los cura, la toxina los quema.
      try {
        if (courtyard.consumeEdibleAt && enemiesSystem.aliveCount() > 0) {
          const foes = enemiesSystem.enemies;
          for (let i = 0; i < foes.length; i++) {
            const foe = foes[i];
            if (!foe.alive) continue;
            const eaten = courtyard.consumeEdibleAt(foe.localX, foe.localZ, foe.frame);
            if (eaten === 'food' && enemiesSystem.healEnemy) enemiesSystem.healEnemy(foe, 25);
            else if (eaten === 'toxin') enemiesSystem.damageEnemy(foe, 20);
          }
        }
      } catch (e) {}
      try {
        const seen = [];
        if (courtyard.drainNotices) seen.push(...courtyard.drainNotices());
        if (wilds.drainNotices) seen.push(...wilds.drainNotices());
        if (seen.length) HUD.flash(seen[seen.length - 1]);
      } catch (e) {}
      // Territorio del banco (solo modo juego): sin mesa se pierden los
      // derechos y decae. En creador sos dios: no decae nada.
      const creatorOn = !!(Creator && Creator.isOn());
      try {
        const st = courtyard.territoryStatus();
        if (st.active !== hadTerritory) {
          hadTerritory = st.active;
          if (!st.active) {
            HUD.flash('¡Mesa destruida! Sin zona lo construido decae. Poné otra mesa.');
          } else {
            HUD.flash('Zona reclamada: la construcción se estabiliza.');
          }
        }
        if (build.setDecayActive) {
          build.setDecayActive(!st.active && !creatorOn && (build.blockCount() > 0 || build.stairCount() > 0));
        }
      } catch (e) {}
      // Ráfaga con clic mantenido: paredes y barreras sin clicar mil veces.
      // El acierto es silencioso (el fantasma ya lo muestra); el fallo avisa
      // espaciado para no spamear.
      if (placeCooldown > 0) placeCooldown -= dt;
      const holdLocked = input.pointerLocked || input.fallbackMode;
      if (!holdLocked) placingHeld = false;
      if (placingHeld && holdLocked && !HUD.isModalOpen() && placeCooldown <= 0 &&
          !courtyard.isCarryingBench() && !(Creator && Creator.isPaletteOpen())) {
        // En creador la ráfaga vale para bloques, escaleras y sacar;
        // mesa, cosas y bichos se ponen con clic para no sembrar sin querer.
        if (creatorOn) {
          const mode = Creator.getPlaceMode ? Creator.getPlaceMode().kind : 'block';
          if (mode === 'block' || mode === 'stairs' || mode === 'erase') {
            const rep = Creator.place(player.position);
            if (rep && !rep.ok && rep.text) HUD.flash(rep.text);
            placeCooldown = rep && rep.ok ? 0.2 : 0.6;
          } else {
            placeCooldown = 0.2;
          }
        } else if (Inventory.activeTool === 'hammer') {
          const rep = build.tryPlace(player.position);
          if (rep && !rep.ok && rep.text) HUD.flash(rep.text);
          placeCooldown = rep && rep.ok ? 0.2 : 0.6;
        }
      }
      // En creador (como el FPS) no avanzan las oleadas.
      const waveEvent = creatorOn ? null : waves.update(dt);
      if (waveEvent && waveEvent.type === 'wake') HUD.flash('Calma rota: se acerca la primera oleada.');
      if (waveEvent && waveEvent.type === 'clear') HUD.flash('Oleada superada. La próxima en 5 s.');
      if (waveEvent && waveEvent.type === 'spawn') {
        HUD.flash('Oleada ' + waveEvent.wave + ': ' + waveEvent.count + ' enemigos.');
      }
      if (PlayerHealth.hp <= PlayerHealth.maxHp * 0.3) {
        heartIn -= dt;
        if (heartIn <= 0) {
          Audio.heartbeat();
          heartIn = 0.9;
        }
      } else {
        heartIn = 0.4;
      }
    } else if (isDead) {
      body.update(dt, bodyState(true));
      if (build) build.update(0, 'hands', player.position);
    } else if (build) {
      build.update(0, 'hands', player.position);
      if (courtyard.hideCarryGhost) courtyard.hideCarryGhost();
    }

    if (HUD.isPaused()) {
      let terrTxt = '';
      try {
        const st = courtyard.territoryStatus();
        terrTxt = st.active ? '  ·  Zona SÍ' : '  ·  Zona NO';
      } catch (e) {}
      HUD.setPauseStats(
        (levelDef ? (levelDef.name + ' — ' + levelDef.mission) : 'La Grieta') +
        '  ·  Vida ' + Math.round(PlayerHealth.hp) +
        '  ·  Bloques ' + build.blockCount() +
        '  ·  Enemigos ' + enemiesSystem.aliveCount() +
        '  ·  Oleada ' + waves.number +
        '  ·  Tiempo ' + runClock() + terrTxt +
        '  ·  Semilla ' + wildSeed +
        (Creator && Creator.isOn() ? '  ·  Creador SÍ (G apaga, derecho menú)' : '')
      );
    }

    if (!isDead && !HUD.isPaused()) {
      const eDown = input.isDown(Settings.code('interact'));
      if (eDown && !ePrevDown) {
        if (HUD.isModalOpen()) {
          HUD.closeModal();
          relockAfterModal();
        } else {
          const action = courtyard.tryInteract(player.position);
          if (action.type === 'open-craft') showCraft();
          else if (action.type === 'totem') {
            HUD.openTotem(action.lines);
            unlockForModal();
          } else if (action.type === 'flash') HUD.flash(action.text);
        }
      }
      ePrevDown = eDown;

      const fDown = input.isDown(Settings.code('torch'));
      if (fDown && !fPrevDown && (input.pointerLocked || input.fallbackMode) && !HUD.isModalOpen()) {
        // La antorcha se sostiene en la mano (6): plantar gasta 1 del stock.
        // En creador es gratis, como todo lo demás.
        const god = Creator && Creator.isOn();
        if (!god && !Inventory.hasTool('torch')) {
          HUD.flash('Crafteá una antorcha en la mesa');
        } else if (!god && Inventory.activeTool !== 'torch') {
          HUD.flash('Equipá la antorcha (6) para plantarla');
        } else if (!god && Inventory.stackCount('torch') <= 0) {
          HUD.flash('Sin antorchas: crafteá más en la mesa');
        } else {
          camera.getWorldDirection(lookDir);
          const planted = torches.place(player.position, lookDir);
          if (planted.ok) {
            if (!god) Inventory.takeStack('torch', 1);
            HUD.flash('Antorchas ' + planted.active + '/' + planted.total);
          } else {
            HUD.flash('Muy cerca de la anterior');
          }
        }
      }
      fPrevDown = fDown;
    } else if (isDead && !deathShown) {
      deathShown = true;
      placingHeld = false;
      HUD.closeModal();
      if (courtyard.cancelBenchCarry) courtyard.cancelBenchCarry();
      try { document.exitPointerLock(); } catch (err) { /* la pantalla tapa el juego */ }
      HUD.showDeath({
        time: runClock(),
        kills: enemiesSystem.kills,
        wave: waves.number,
        blocks: build.blockCount(),
      });
    }

    playerLight.position.copy(player.position);
    secondaryLight.position.copy(
      player.position.clone().add(player.localUp.clone().multiplyScalar(10))
    );

    const inv = Inventory.state;
    const interactKey = Settings.label('interact');
    const packKey = Settings.label('pack');
    let prompt = '';
    if (isDead) prompt = 'Reaparecer conserva el patio. Reiniciar borra todo.';
    else if (HUD.isPaused()) prompt = 'Esc sigue';
    else if (HUD.isCraftOpen()) prompt = 'Números 1-9 craftean · clic/toque también · ' + interactKey + ' cierra';
    else if (HUD.isPackOpen()) prompt = '1-5 crafteo básico · ' + packKey + ' cierra';
    else if (HUD.isTotemOpen()) prompt = interactKey + ' cierra';
    else if (courtyard.isCarryingBench()) prompt = 'Clic pone la mesa · Esc la guarda';
    else if (Creator && Creator.isOn()) {
      const mode = Creator.getPlaceMode();
      const what = mode.kind === 'block' ? ('bloque ' + mode.id)
        : mode.kind === 'stairs' ? 'escalera'
        : mode.kind === 'bench' ? 'mesa'
        : mode.kind === 'item' ? mode.id
        : mode.kind === 'enemy' ? 'robot'
        : 'borrar (clic saca)';
      prompt = 'Creador: clic pone ' + what + ' · derecho menú · B menú · G apaga'
        + (player.creatorFly ? ' · Espacio/Shift volar' : '');
    }
    else prompt = wilds.getPrompt() || courtyard.getPrompt(player.position);
    const toolName = Inventory.activeTool === 'hammer'
      ? (Inventory.toolName(inv.active) + ' (' + build.materialName() + ')')
      : Inventory.toolName(inv.active);
    HUD.sync({
      hp: PlayerHealth.hp,
      maxHp: PlayerHealth.maxHp,
      toolName: toolName,
      wood: inv.resources.wood,
      stone: inv.resources.stone,
      metal: inv.resources.metal,
      torch: inv.stacks.torch || 0,
      torchMax: Inventory.stackMax('torch'),
      hasKey: inv.hasKey,
      showAmmo: Inventory.hasTool('pistol'),
      mag: weapon.mag,
      reserve: weapon.reserve,
      reloading: weapon.reloading,
      prompt,
      active: inv.active,
      tools: Inventory.TOOLS.map((tool) => ({
        id: tool.id,
        key: tool.key,
        owned: !!inv.owned[tool.id],
      })),
    });

    if (!isDead) {
      const up = player.localUp;
      const lat = Math.asin(Math.max(-1, Math.min(1, up.y))) * (180 / Math.PI);
      const lon = Math.atan2(up.x, up.z) * (180 / Math.PI);
      let calmTxt = '';
      try {
        const left = waves.calmLeft ? waves.calmLeft() : 0;
        if (left > 0) calmTxt = ' | calma ' + Math.ceil(left) + 's';
      } catch (e) {}
      debugEl.textContent =
        'patio sobre la esfera | radial ' + player.currentRadialDistance.toFixed(1) +
        ' | lat ' + lat.toFixed(1) + '° lon ' + lon.toFixed(1) + '° | ' +
        (player.isGrounded ? 'en el piso' : 'en el aire') + calmTxt;
    }

    renderer.render(scene, camera);
  }

  animate();
  document.documentElement.dataset.boot = 'ok';
  document.documentElement.dataset.seed = String(wildSeed);
  document.documentElement.dataset.nodes = String(courtyard.nodeCount);
  document.documentElement.dataset.enemies = String(enemiesSystem.enemies.length);
  console.log('Patio de La Grieta sobre la esfera.');
  console.log('   Mojones:', wilds.landmarks.length);
  console.log('   Nodos salvajes:', wilds.nodes.length);
  console.log('   Enemigos:', enemiesSystem.enemies.length);
})();
