(function () {
  window.Game = window.Game || {};

  const SKIN = 0xc4896a;
  const SHIRT = 0x3e5c49;
  const PANTS = 0x2a3144;
  const SHOE = 0x161616;
  const PUNCH_TIME = 0.32;
  const IMPACT_AT = 0.14;
  const SAME_HAND = 0.45;
  const OTHER_HAND = 0.18;

  /**
   * Muñeco de bloques del jugador, parado en la esfera.
   * El tronco no se acuesta con la mirada: +Y es el radio y +Z es
   * player.facing. +X es up × facing, el mismo lado que basisX del
   * jugador (basisX × up = facing). La derecha del movimiento, KeyD,
   * es facing × up, o sea el -X local. La cámara sigue en los ojos,
   * así que mirar abajo muestra los pies y los brazos salen de los hombros.
   * La cabeza no se dibuja: la cámara vive ahí adentro.
   * Las poses son locales. Por la red, el día que exista, viaja el id de
   * la pose, no estos huesos.
   */
  window.Game.createBody = function (scene) {
    const Config = window.Game.Config;
    const root = new THREE.Group();
    root.name = 'player-body';
    scene.add(root);

    const _eye = new THREE.Vector3();
    const _up = new THREE.Vector3();
    const _facing = new THREE.Vector3();
    const _look = new THREE.Vector3();
    const _right = new THREE.Vector3();
    const _fist = new THREE.Vector3();
    const _foot = new THREE.Vector3();
    const _dir = new THREE.Vector3();
    const _upVec = new THREE.Vector3(0, 1, 0);

    function voxel(w, h, d, color) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({
          color: color,
          roughness: 0.9,
          metalness: 0,
          emissive: color,
          emissiveIntensity: 0.28,
        })
      );
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.raycast = function () {};
      return mesh;
    }

    const pelvis = voxel(0.34, 0.18, 0.2, PANTS);
    pelvis.position.set(0, 0.92, 0);
    const torso = new THREE.Group();
    torso.position.set(0, 1.02, 0);
    const chest = voxel(0.42, 0.4, 0.22, SHIRT);
    chest.position.y = 0.2;
    torso.add(chest);
    const head = voxel(0.28, 0.28, 0.28, SKIN);
    head.position.set(0, 1.62, 0.02);
    head.visible = false;
    root.add(pelvis, torso, head);

    function makeArm(side) {
      // +X local es la izquierda del jugador. El brazo derecho nace en -X.
      const sign = side === 'right' ? -1 : 1;
      const shoulder = new THREE.Group();
      shoulder.position.set(0.28 * sign, 1.4, 0.04);
      const upper = voxel(0.12, 0.3, 0.12, SHIRT);
      const elbow = new THREE.Group();
      const forearm = voxel(0.11, 0.26, 0.11, SKIN);
      const hand = new THREE.Group();
      const fist = voxel(0.13, 0.13, 0.15, SKIN);
      fist.position.z = 0.04;
      hand.add(fist);
      elbow.add(forearm, hand);
      shoulder.add(upper, elbow);
      root.add(shoulder);
      return { shoulder: shoulder, upper: upper, elbow: elbow, forearm: forearm, hand: hand, fist: fist };
    }

    function makeLeg(x) {
      const hip = new THREE.Group();
      hip.position.set(x, 0.86, 0);
      const thigh = voxel(0.14, 0.36, 0.14, PANTS);
      thigh.position.y = -0.18;
      const knee = new THREE.Group();
      knee.position.y = -0.36;
      const shin = voxel(0.12, 0.34, 0.12, PANTS);
      shin.position.y = -0.17;
      const foot = voxel(0.13, 0.08, 0.24, SHOE);
      foot.position.set(0, -0.36, 0.06);
      knee.add(shin, foot);
      hip.add(thigh, knee);
      root.add(hip);
      return { hip: hip, knee: knee, foot: foot };
    }

    const arms = { right: makeArm('right'), left: makeArm('left') };
    const legs = { right: makeLeg(0.1), left: makeLeg(-0.1) };

    // La herramienta no hereda el codo doblado: se sienta en el puño
    // y apunta al adelante del cuerpo. El modelo de arma fue armado
    // con el -Z de la cámara como adelante; el giro en Y lo endereza.
    const toolMount = new THREE.Group();
    toolMount.name = 'tool-mount';
    root.add(toolMount);

    let phase = 0;
    let strike = null;
    const punch = {
      right: { t: -1, cool: 0, struck: false },
      left: { t: -1, cool: 0, struck: false },
    };

    function otherOf(side) {
      return side === 'right' ? 'left' : 'right';
    }

    function tryPunch(side) {
      const me = punch[side];
      const other = punch[otherOf(side)];
      if (!me || me.t >= 0) return false;
      if (me.cool > 0) return false;
      if (other.t >= 0 && other.t < OTHER_HAND) return false;
      me.t = 0;
      me.cool = SAME_HAND;
      me.struck = false;
      const Audio = window.Game.Audio;
      if (Audio) Audio.punch();
      return true;
    }

    // El brazo se arma con posiciones, no con un Euler grande: el +Z local
    // es el adelante del cuerpo, y un giro mal firmado mandaba el puño atrás.
    function stretch(mesh, to, baseLen) {
      const len = Math.max(0.08, to.length());
      mesh.position.copy(to).multiplyScalar(0.5);
      mesh.scale.set(1, len / baseLen, 1);
      _dir.copy(to).multiplyScalar(1 / len);
      mesh.quaternion.setFromUnitVectors(_upVec, _dir);
    }

    function applyArm(side, extend, swing, dead) {
      const arm = arms[side];
      const sign = side === 'right' ? -1 : 1;
      arm.shoulder.rotation.set(0, 0, 0);
      arm.elbow.rotation.set(0, 0, 0);
      if (dead) {
        arm.elbow.position.set(0.05 * sign, -0.34, 0.06);
        arm.hand.position.set(0, -0.28, 0.04);
      } else {
        arm.elbow.position.set(
          0.04 * sign,
          -0.06 + extend * 0.08 + swing * 0.03,
          0.3 + extend * 0.12
        );
        arm.hand.position.set(0, -0.02 + extend * 0.05, 0.28 + extend * 0.18);
      }
      stretch(arm.upper, arm.elbow.position, 0.3);
      stretch(arm.forearm, arm.hand.position, 0.26);
    }

    function applyLeg(side, swing, tuck) {
      const leg = legs[side];
      leg.hip.rotation.x = swing * 0.6;
      leg.knee.rotation.x = Math.max(0, -swing) * 0.95 + tuck;
    }

    function placeTool() {
      root.updateMatrixWorld(true);
      arms.right.fist.getWorldPosition(_fist);
      root.worldToLocal(_fist);
      toolMount.position.copy(_fist);
      toolMount.rotation.set(0, Math.PI, 0);
    }

    function update(dt, state) {
      _eye.copy(state.eye);
      _up.copy(state.up);
      if (_up.lengthSq() < 1e-8) _up.set(0, 1, 0);
      _up.normalize();
      _facing.copy(state.facing);
      _facing.addScaledVector(_up, -_facing.dot(_up));
      if (_facing.lengthSq() < 1e-8) _facing.set(1, 0, 0);
      _facing.normalize();
      _look.copy(state.look || _facing);
      if (_look.lengthSq() < 1e-8) _look.copy(_facing);
      _look.normalize();

      const feet = _eye.clone().addScaledVector(_up, -Config.EYE_HEIGHT);
      root.position.copy(feet);
      // up × facing da una base derecha (det +1). facing × up es la
      // derecha del movimiento, pero con +Z = facing esa matriz es un
      // reflejo y el quaternion sale mal: los brazos no giran.
      _right.crossVectors(_up, _facing).normalize();
      const basis = new THREE.Matrix4().makeBasis(_right, _up, _facing);
      root.quaternion.setFromRotationMatrix(basis);

      const moving = !state.dead && state.grounded && state.speed > 0.6;
      if (moving) phase += dt * (state.running ? 11 : 8);
      const swing = moving ? Math.sin(phase) : 0;
      const tuck = !state.grounded && !state.dead ? 0.45 : 0;
      applyLeg('right', swing, tuck);
      applyLeg('left', -swing, tuck);

      ['right', 'left'].forEach(function (side) {
        const slot = punch[side];
        if (slot.cool > 0) slot.cool = Math.max(0, slot.cool - dt);
        let extend = 0;
        if (slot.t >= 0 && !state.dead) {
          slot.t += dt;
          const u = slot.t / PUNCH_TIME;
          extend = u < 0.45 ? (u / 0.45) : (1 - (u - 0.45) / 0.55);
          if (extend < 0) extend = 0;
          if (extend > 1) extend = 1;
          if (!slot.struck && slot.t >= IMPACT_AT) {
            slot.struck = true;
            const origin = _eye.clone()
              .addScaledVector(_up, -0.25)
              .addScaledVector(_look, 0.4)
              .addScaledVector(_right, side === 'right' ? -0.12 : 0.12);
            strike = { origin: origin, direction: _look.clone(), hand: side };
          }
          if (slot.t >= PUNCH_TIME) slot.t = -1;
        }
        const armSwing = moving ? (side === 'right' ? -swing : swing) : 0;
        applyArm(side, state.dead ? 0 : extend, state.dead ? 0 : armSwing, !!state.dead);
      });

      torso.rotation.x = state.dead ? 1.05 : 0;
      if (state.dead) {
        legs.right.knee.rotation.x = 1.15;
        legs.left.knee.rotation.x = 1.15;
      }

      placeTool();

      if (state.camera && moving) {
        state.camera.position.addScaledVector(_up, Math.sin(phase * 2) * 0.02);
      }
    }

    function worldOf(obj) {
      root.updateMatrixWorld(true);
      return obj.getWorldPosition(new THREE.Vector3());
    }

    return {
      root: root,
      head: head,
      toolMount: toolMount,
      reach: 1.8,
      damage: 10,
      update: update,
      tryPunch: tryPunch,
      takeStrike: function () {
        const hit = strike;
        strike = null;
        return hit;
      },
      fist: function (side) { return worldOf(arms[side].fist); },
      foot: function (side) { return worldOf(legs[side].foot); },
      coolOf: function (side) { return punch[side].cool; },
    };
  };
})();
