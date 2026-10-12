// Antorchas que el jugador planta como rastro. Las 8 PointLight existen desde
// el arranque (intensidad 0 hasta plantarlas): Three r128 recompila el shader
// del planeta, que es una sola malla, si cambia la cantidad de luces.
(function () {
  window.Game = window.Game || {};
  const Config = window.Game.Config;

  const POOL = 8;
  const MIN_SPACING = 12;
  const FORWARD = 1.6;
  const POST_HEIGHT = 2.2;
  const FLAME_LIFT = 2.45;
  const SURFACE_LIFT = 0.03;
  const LIGHT_INTENSITY = 2.4;
  const LIGHT_DISTANCE = 25;
  const LIGHT_DECAY = 2;

  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const X_AXIS = new THREE.Vector3(1, 0, 0);

  function makeMesh() {
    const group = new THREE.Group();
    group.visible = false;

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.1, POST_HEIGHT, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a3428, roughness: 0.9, metalness: 0.04 })
    );
    post.position.y = POST_HEIGHT / 2;
    post.raycast = function () {};

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.46, 7),
      new THREE.MeshBasicMaterial({ color: 0xffb347 })
    );
    flame.position.y = POST_HEIGHT + 0.12;
    flame.raycast = function () {};

    group.add(post, flame);
    return group;
  }

  window.Game.createTorches = function (scene) {
    const slots = [];
    for (let i = 0; i < POOL; i++) {
      const group = makeMesh();
      const light = new THREE.PointLight(0xff9944, 0, LIGHT_DISTANCE, LIGHT_DECAY);
      scene.add(group);
      scene.add(light);
      slots.push({ group: group, light: light, placed: false });
    }

    let next = 0;
    let active = 0;
    let lastPos = null;
    const up = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const spot = new THREE.Vector3();
    const radial = new THREE.Vector3();

    function place(position, lookDir) {
      up.copy(position);
      if (up.lengthSq() < 1e-8) return { ok: false, reason: 'cerca', active: active, total: POOL };
      up.normalize();

      forward.copy(lookDir);
      forward.addScaledVector(up, -forward.dot(up));
      if (forward.lengthSq() < 1e-8) {
        const ref = Math.abs(up.y) > 0.9 ? X_AXIS : Y_AXIS;
        forward.crossVectors(up, ref);
      }
      forward.normalize();

      spot.copy(up).multiplyScalar(Config.PLANET_RADIUS).addScaledVector(forward, FORWARD);
      spot.normalize().multiplyScalar(Config.PLANET_RADIUS);

      if (lastPos && lastPos.distanceTo(spot) < MIN_SPACING) {
        return { ok: false, reason: 'cerca', active: active, total: POOL };
      }

      const slot = slots[next];
      next = (next + 1) % POOL;
      if (!slot.placed) {
        slot.placed = true;
        active += 1;
      }

      radial.copy(spot).normalize();
      slot.group.visible = true;
      slot.group.position.copy(spot).addScaledVector(radial, SURFACE_LIFT);
      slot.group.quaternion.setFromUnitVectors(Y_AXIS, radial);
      slot.light.position.copy(spot).addScaledVector(radial, FLAME_LIFT);
      slot.light.intensity = LIGHT_INTENSITY;
      if (!lastPos) lastPos = new THREE.Vector3();
      lastPos.copy(spot);

      return { ok: true, active: active, total: POOL };
    }

    return { place: place, total: POOL };
  };
})();
