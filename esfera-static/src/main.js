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

  // Mochila, costos de La Grieta, bloque con apoyo, columna que cae y escalera.
  // Corre en una escena aparte y la borra: el patio de juego queda vacío.
  function selfTestPackAndBuild() {
    const Inventory = window.Game.Inventory;
    const frame = window.Game.LocalFrame(new THREE.Vector3(0, Config.PLANET_RADIUS, 0));
    Inventory.reset();
    let build = null;
    try {
      if (Inventory.addStack('food', 9) !== 5) throw new Error('la comida no entra de a 5');
      if (Inventory.addStack('food', 1) !== 0) throw new Error('la comida pasó de 5');
      if (Inventory.useFood().ok) throw new Error('usó comida con la vida llena');
      if (Inventory.stackCount('food') !== 5) throw new Error('gastó comida sin usarla');
      if (Inventory.addStack('toxin', 4) !== 3) throw new Error('la toxina no entra de a 3');
      const sipped = Inventory.useToxin();
      if (!sipped.ok || Inventory.stackCount('toxin') !== 2) throw new Error('la toxina no se consumió');
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
      for (let i = 0; i < 4; i++) {
        const col = stairs.flight[i].col;
        if (Math.abs(col.maxH - expectH[i]) > 0.001) throw new Error('peldaño ' + i + ' a ' + col.maxH);
        const centerX = (col.minX + col.maxX) / 2;
        const centerZ = (col.minZ + col.maxZ) / 2;
        if (Math.abs(centerX) > 0.05 || Math.abs(centerZ - (8 + i * 0.8)) > 0.05) {
          throw new Error('la escalera no sigue +z');
        }
      }
      const stepUp = new THREE.Vector3(0, 1, 0).applyQuaternion(stairs.flight[0].mesh.quaternion);
      if (stepUp.dot(frame.up) < 0.999) throw new Error('el peldaño no mira para afuera');

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
      ['axe', 'pickaxe', 'hammer', 'pistol'].forEach((id) => {
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
        food: 0, foodMax: 5, toxin: 0, toxinMax: 3,
        hasKey: false, showAmmo: true, mag: 12, reserve: 36, reloading: false,
        prompt: '', tools: tools, active: Inventory.activeTool,
      });
      const slots = document.querySelectorAll('.belt-slot');
      if (slots.length !== 5) throw new Error('el cinturón no tiene 5 lugares');
      if (!slots[0].classList.contains('owned')) throw new Error('las manos no están en el cinturón');
      if (!slots[1].classList.contains('owned') || !slots[1].classList.contains('active')) {
        throw new Error('el hacha no está marcada');
      }
      if (!slots[4].classList.contains('owned')) throw new Error('la pistola no está en el cinturón');
      if (slots[2].classList.contains('owned') || slots[3].classList.contains('owned')) {
        throw new Error('apareció una herramienta que no agarraste');
      }
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

  const { referenceObjects, playerLight, secondaryLight } = window.Game.createWorld(scene);
  try {
    const minAngle = Config.YARD_CLEARANCE / Config.PLANET_RADIUS;
    const expect = Config.TOTAL_REFERENCE_OBJECTS + Config.REFERENCE_OBJECTS_NEAR_SPAWN;
    if (referenceObjects.length !== expect) throw new Error('faltan rocas');
    referenceObjects.forEach((mesh) => {
      const angle = Math.acos(Math.min(1, mesh.position.clone().normalize().y));
      if (angle < minAngle - 0.001) throw new Error('roca en el patio');
      if (!mesh.userData.solid) throw new Error('roca sin caja');
    });
  } catch (err) {
    solidsError = solidsError || err.message || String(err);
    console.error(err);
  }
  const torches = window.Game.createTorches(scene);
  const courtyard = window.Game.createCourtyard(scene);
  try {
    const hp = courtyard.nodeHp.join(',');
    if (hp !== '50,100,80') throw new Error('vida de nodos ' + hp);
    if (courtyard.totemCount !== 3) throw new Error('tótems ' + courtyard.totemCount);
    if (courtyard.toolIds.join(',') !== 'axe,pickaxe,pistol') {
      throw new Error('herramientas en el piso ' + courtyard.toolIds.join(','));
    }
    document.documentElement.dataset.yard = 'ok';
  } catch (err) {
    document.documentElement.dataset.yard = err.message || String(err);
    console.error(err);
  }
  const build = window.Game.createBuild(scene, courtyard.frame);
  build.setCamera(camera);
  courtyard.setBuild(build);
  const enemiesSystem = window.Game.createEnemies(scene, courtyard.frame, courtyard.enemySpawns);
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
  const waves = window.Game.createWaves(enemiesSystem, courtyard.enemySpawns);
  // Modo Creador (port del FPS): gratis + volar + paleta + guardado.
  // El load se hace después de los self-tests para no ocuparles las celdas.
  const Creator = window.Game.createCreator
    ? window.Game.createCreator({ build: build, courtyard: courtyard, enemies: enemiesSystem, player: player, camera: camera, canvas: canvas, scene: scene })
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
      const message = courtyard.tryHarvest();
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
      if (HUD.isCraftOpen()) showCraft();
    }, courtyard.benchHeading());
    unlockForModal();
  }

  function showPack() {
    HUD.openPack({
      wood: snap.resources.wood,
      stone: snap.resources.stone,
      metal: snap.resources.metal,
      food: snap.stacks.food,
      foodMax: Inventory.stackMax('food'),
      toxin: snap.stacks.toxin,
      toxinMax: Inventory.stackMax('toxin'),
      hasKey: snap.hasKey,
      reserve: weapon.reserve,
      tools: Inventory.TOOLS.map((tool) => ({
        id: tool.id,
        name: tool.name,
        owned: !!snap.owned[tool.id],
      })),
    }, {
      use(id) {
        const result = id === 'food' ? Inventory.useFood() : Inventory.useToxin();
        if (result.text) HUD.flash(result.text);
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
    Digit1: 'hands', Digit2: 'axe', Digit3: 'pickaxe', Digit4: 'hammer', Digit5: 'pistol',
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (HUD.isRebinding()) {
      HUD.captureKey(e);
      return;
    }
    if (e.code === 'Escape') {
      if (PlayerHealth.isDead || HUD.isDeathOpen()) return;
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
    if (HUD.isCraftOpen() && /^Digit[1-9]$/.test(e.code)) {
      HUD.pickCraft(Number(e.code.slice(5)) - 1);
      return;
    }
    if (HUD.isPackOpen() && (e.code === 'Digit1' || e.code === 'Digit2')) {
      const used = e.code === 'Digit1' ? Inventory.useFood() : Inventory.useToxin();
      if (used.text) HUD.flash(used.text);
      if (HUD.isPackOpen()) showPack();
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

  function discardPickup(spec) {
    if (!spec || !spec.alive) return;
    spec.alive = false;
    scene.remove(spec.mesh);
  }

  function selfTestLife() {
    let block = null;
    try {
      Inventory.addResource('wood', 2);
      Inventory.addStack('food', 2);
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
      if (Inventory.stackCount('food') !== 2 || build.blockCount() !== blocks) {
        throw new Error('morir borró el patio');
      }
      revivePlayer(false);
      if (PlayerHealth.isDead || PlayerHealth.hp !== 100) throw new Error('reaparecer no devolvió la vida');
      if (Inventory.stackCount('food') !== 2 || build.blockCount() !== blocks) {
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
      Inventory.addStack('food', 1);
      const food = courtyard.drop('food', player.position, ahead);
      spec = food.pickup;
      if (!food.ok) throw new Error(food.text);
      if (food.z < origin.z + 1.2) throw new Error('la comida no cayó adelante (' + food.z.toFixed(2) + ')');
      if (Inventory.stackCount('food') !== 0) throw new Error('la comida siguió en la mochila');
      const stand = courtyard.frame.localToWorld(food.x, food.z, Config.EYE_HEIGHT);
      const got = courtyard.tryInteract(stand);
      if (!got || got.type !== 'flash' || Inventory.stackCount('food') !== 1) {
        throw new Error('no se volvió a agarrar la comida');
      }
      spec = null;
      Inventory.takeStack('food', 1);

      Inventory.setKey(true);
      const key = courtyard.drop('key', player.position, ahead);
      spec = key.pickup;
      if (!key.ok || Inventory.hasKey) throw new Error('la llave no salió de la mochila');
      courtyard.tryInteract(courtyard.frame.localToWorld(key.x, key.z, Config.EYE_HEIGHT));
      if (!Inventory.hasKey) throw new Error('la llave no volvió');
      spec = null;
      Inventory.takeKey();

      Inventory.giveTool('axe');
      const axe = courtyard.drop('axe', player.position, ahead);
      spec = axe.pickup;
      if (!axe.ok || Inventory.hasTool('axe')) throw new Error('el hacha no se soltó');
      if (courtyard.toolIds.join(',') !== 'axe,pickaxe,pistol') {
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

  // La zona de construcción la da el banco del jugador (ver territoryStatus).
  if (build.setTerritoryProvider) {
    build.setTerritoryProvider(() => courtyard.territoryStatus());
  }

  // Sin overlay inicial: el menú de pausa es la entrada.
  // Arranca en pausa con los controles a la vista; Seguir pide el mouse.
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
  if (!HUD.isPaused()) HUD.togglePause();

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
      projectiles.update(dt);
      weapon.update(dt, input);
      build.update(dt, Inventory.activeTool, player.position);
      if (Creator && Creator.update) {
        try {
          Creator.update(dt, Inventory.activeTool, player.position);
        } catch (e) {}
      }
      // Territorio del banco: sin mesa se pierden los derechos y decae.
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
          build.setDecayActive(!st.active && (build.blockCount() > 0 || build.stairCount() > 0));
        }
      } catch (e) {}
      // En creador (como el FPS) no avanzan las oleadas.
      const creatorOn = !!(Creator && Creator.isOn());
      const waveEvent = creatorOn ? null : waves.update(dt);
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
    }

    if (HUD.isPaused()) {
      let terrTxt = '';
      try {
        const st = courtyard.territoryStatus();
        terrTxt = st.active ? '  ·  Zona SÍ' : '  ·  Zona NO';
      } catch (e) {}
      HUD.setPauseStats(
        'Vida ' + Math.round(PlayerHealth.hp) +
        '  ·  Bloques ' + build.blockCount() +
        '  ·  Enemigos ' + enemiesSystem.aliveCount() +
        '  ·  Oleada ' + waves.number +
        '  ·  Tiempo ' + runClock() + terrTxt +
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
        camera.getWorldDirection(lookDir);
        const planted = torches.place(player.position, lookDir);
        HUD.flash(planted.ok
          ? ('Antorchas ' + planted.active + '/' + planted.total)
          : 'Muy cerca de la anterior');
      }
      fPrevDown = fDown;
    } else if (isDead && !deathShown) {
      deathShown = true;
      HUD.closeModal();
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
    else if (HUD.isPackOpen()) prompt = '1 comida · 2 toxina · ' + packKey + ' cierra';
    else if (HUD.isTotemOpen()) prompt = interactKey + ' cierra';
    else if (Creator && Creator.isOn()) {
      const mode = Creator.getPlaceMode();
      const what = mode.kind === 'block' ? ('bloque ' + mode.id)
        : mode.kind === 'stairs' ? 'escalera'
        : mode.kind === 'bench' ? 'mesa'
        : mode.kind === 'item' ? mode.id
        : mode.kind === 'enemy' ? 'robot'
        : 'borrar (clic saca)';
      let terr = '';
      try {
        const st = courtyard.territoryStatus();
        terr = st.active ? '' : ' · ¡SIN ZONA! poné una mesa';
      } catch (e) {}
      prompt = 'Creador: clic pone ' + what + ' · derecho menú · B menú · G apaga'
        + (player.creatorFly ? ' · Espacio/Shift volar' : '') + terr;
    }
    else prompt = courtyard.getPrompt(player.position);
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
      food: inv.stacks.food,
      foodMax: Inventory.stackMax('food'),
      toxin: inv.stacks.toxin,
      toxinMax: Inventory.stackMax('toxin'),
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
      debugEl.textContent =
        'patio sobre la esfera | radial ' + player.currentRadialDistance.toFixed(1) +
        ' | lat ' + lat.toFixed(1) + '° lon ' + lon.toFixed(1) + '° | ' +
        (player.isGrounded ? 'en el piso' : 'en el aire');
    }

    renderer.render(scene, camera);
  }

  animate();
  document.documentElement.dataset.boot = 'ok';
  document.documentElement.dataset.nodes = String(courtyard.nodeCount);
  document.documentElement.dataset.enemies = String(enemiesSystem.enemies.length);
  console.log('Patio de La Grieta sobre la esfera.');
  console.log('   Objetos de referencia:', referenceObjects.length);
  console.log('   Enemigos:', enemiesSystem.enemies.length);
})();
