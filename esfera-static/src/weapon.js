(function () {
  window.Game = window.Game || {};

  const MAG_SIZE = 12;
  const MAX_RESERVE = 90;
  const FIRE_COOLDOWN_MS = 220;

  /**
   * Pistola del jugador. El clic spawnea un proyectil en el mundo:
   * la bala vive en projectiles.js y pega contra las cajas del chart.
   * Acá queda el cargador, la recarga y el modelo en pantalla.
   */
  window.Game.createWeapon = function (camera, projectiles) {
    const Audio = window.Game.Audio;

    let currentMag = MAG_SIZE;
    let reserveAmmo = 36;
    let reloading = false;
    let lastShot = 0;

    // La mano vive en el espacio de la cámara, abajo a la derecha.
    // z = -0.72 queda delante del plano cercano (0.5) y lejos de la mira.
    const REST = { x: 0.28, y: -0.24, z: -0.72 };
    const rig = new THREE.Group();
    rig.name = 'viewmodel';
    rig.position.set(REST.x, REST.y, REST.z);
    camera.add(rig);

    const held = {};
    let current = 'hands';
    let kick = 0;
    let drop = 0;
    let swayX = 0;
    let swayY = 0;
    let bob = 0;
    let lastYaw = 0;
    let lastPitch = 0;

    function tune(obj) {
      obj.frustumCulled = false;
      obj.raycast = function () {};
      obj.castShadow = false;
      obj.receiveShadow = false;
    }

    function mount(id, group) {
      group.userData.tool = id;
      group.visible = false;
      group.traverse(tune);
      rig.add(group);
      held[id] = group;
    }

    function woodMat() {
      return new THREE.MeshStandardMaterial({
        color: 0x8a5a32, roughness: 0.5, metalness: 0.04,
        emissive: 0x4a2c14, emissiveIntensity: 0.55,
      });
    }

    function metalMat(color, emissive) {
      return new THREE.MeshStandardMaterial({
        color: color, roughness: 0.32, metalness: 0.62,
        emissive: emissive, emissiveIntensity: 0.5,
      });
    }

    function handleMesh() {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.034, 0.5, 7), woodMat());
      return handle;
    }

    function makeAxe() {
      const group = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.04), metalMat(0xe07030, 0x6a2808));
      blade.position.set(0.09, 0.22, 0);
      const poll = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.045), metalMat(0x9aa0a6, 0x22262a));
      poll.position.set(-0.07, 0.2, 0);
      group.add(handleMesh(), blade, poll);
      group.rotation.set(0.55, 0.35, 0.7);
      mount('axe', group);
    }

    function makePickaxe() {
      const group = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), metalMat(0x8ea0ff, 0x1c2448));
      bar.position.y = 0.24;
      group.add(handleMesh(), bar);
      group.rotation.set(0.5, -0.25, 0.55);
      mount('pickaxe', group);
    }

    function makeHammer() {
      const group = new THREE.Group();
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.1), metalMat(0xc5ccd2, 0x2a3036));
      head.position.y = 0.24;
      group.add(handleMesh(), head);
      group.rotation.set(0.45, 0.15, 0.4);
      mount('hammer', group);
    }

    function makePistol() {
      const group = new THREE.Group();
      const dark = metalMat(0x3a4048, 0x14181c);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.075), woodMat());
      grip.position.set(0, -0.07, 0.06);
      grip.rotation.x = 0.42;
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.3), dark);
      slide.position.set(0, 0.03, -0.05);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.032, 0.14), dark);
      barrel.position.set(0, 0.025, -0.25);
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.028, 0.022), metalMat(0xe6d48a, 0x5a4810));
      sight.position.set(0, 0.078, -0.12);
      group.add(grip, slide, barrel, sight);
      group.rotation.y = 0.18;
      mount('pistol', group);
    }

    tune(rig);
    makeAxe();
    makePickaxe();
    makeHammer();
    makePistol();

    function setTool(id) {
      const next = held[id] ? id : 'hands';
      if (next !== current) drop = 0.18;
      current = next;
      Object.keys(held).forEach((key) => { held[key].visible = key === next; });
      kick = 0;
    }

    const muzzle = new THREE.PointLight(0xffaa33, 0, 6);
    muzzle.position.set(0.25, -0.2, -1.1);
    camera.add(muzzle);
    const shotDir = new THREE.Vector3();

    function startReload() {
      if (reloading) return;
      if (currentMag >= MAG_SIZE || reserveAmmo <= 0) return;
      reloading = true;
      if (Audio) Audio.reloadOut();
      setTimeout(() => {
        if (Audio) Audio.reloadIn();
        const needed = MAG_SIZE - currentMag;
        const taken = Math.min(needed, reserveAmmo);
        currentMag += taken;
        reserveAmmo -= taken;
        reloading = false;
      }, 900);
    }

    function addReserve(amount) {
      reserveAmmo = Math.min(MAX_RESERVE, reserveAmmo + amount);
    }

    function takeReserve(amount) {
      const taken = Math.min(reserveAmmo, Math.max(0, amount));
      reserveAmmo -= taken;
      return taken;
    }

    function ensureReserve(min) {
      if (reserveAmmo < min) reserveAmmo = min;
    }

    function shoot() {
      if (reloading) return;
      const now = performance.now();
      if (now - lastShot < FIRE_COOLDOWN_MS) return;

      if (currentMag <= 0) {
        lastShot = now;
        if (Audio) Audio.emptyClick();
        return;
      }

      lastShot = now;
      currentMag--;
      if (Audio) Audio.shoot();

      kick = 1;
      muzzle.intensity = 3;
      setTimeout(() => { muzzle.intensity = 0; }, 60);

      if (!projectiles) return;
      const origin = camera.position.clone();
      camera.getWorldDirection(shotDir);
      origin.addScaledVector(shotDir, 0.35);
      projectiles.spawn({
        position: origin,
        direction: shotDir,
        speed: 30,
        damage: 15,
        owner: 'player',
        color: 0xffd76a,
      });
    }

    function update(dt, input) {
      const yaw = input ? input.yaw : lastYaw;
      const pitch = input ? input.pitch : lastPitch;
      const dyaw = Math.max(-0.2, Math.min(0.2, yaw - lastYaw));
      const dpitch = Math.max(-0.2, Math.min(0.2, pitch - lastPitch));
      lastYaw = yaw;
      lastPitch = pitch;
      const follow = Math.min(1, dt * 8);
      swayX += (-dyaw * 0.4 - swayX) * follow;
      swayY += (dpitch * 0.3 - swayY) * follow;
      const moving = !!(input && (
        input.isDown('KeyW') || input.isDown('KeyA') || input.isDown('KeyS') || input.isDown('KeyD') ||
        input.isDown('ArrowUp') || input.isDown('ArrowDown') || input.isDown('ArrowLeft') || input.isDown('ArrowRight')
      ));
      if (moving) bob += dt * ((input.isDown('ShiftLeft') || input.isDown('ShiftRight')) ? 14 : 9);
      const bobY = moving ? Math.sin(bob) * 0.014 : 0;
      const bobX = moving ? Math.cos(bob * 0.5) * 0.008 : 0;
      kick += (0 - kick) * Math.min(1, dt * 9);
      drop += (0 - drop) * Math.min(1, dt * 7);
      rig.position.set(
        REST.x + swayX + bobX,
        REST.y + swayY + bobY - drop,
        REST.z + kick * 0.045
      );
      rig.rotation.z = -swayX * 0.35;
      rig.rotation.x = swayY * 0.25;
    }

    return {
      shoot, startReload, addReserve, takeReserve, ensureReserve, update, setTool,
      get mag() { return currentMag; },
      get reserve() { return reserveAmmo; },
      get reloading() { return reloading; },
    };
  };
})();
