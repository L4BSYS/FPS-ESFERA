(function () {
  window.Game = window.Game || {};
  const Config = window.Game.Config;
  const Utils = window.Game.Utils;

  const WORLD_Y = new THREE.Vector3(0, 1, 0);
  const WORLD_X = new THREE.Vector3(1, 0, 0);

  /**
   * Base inicial, una sola vez. Sirve en el polo, donde "arriba" es paralelo
   * a Y y un cruce con Y daría cero. No se vuelve a usar al caminar: rehacerla
   * cada frame con un eje fijo del mundo da un salto de ~180° cuando |up.y|
   * cruza 0.99 (unos 70 m desde este polo, radio 500).
   */
  function seedBasis(up, basisX, basisZ) {
    const referenceVec = Math.abs(up.y) < 0.99 ? WORLD_Y : WORLD_X;
    basisX.crossVectors(up, referenceVec);
    if (basisX.lengthSq() < 1e-4) {
      const altRef = Math.abs(up.x) < 0.99 ? WORLD_X : WORLD_Y;
      basisX.crossVectors(up, altRef);
    }
    basisX.normalize();
    basisZ.crossVectors(basisX, up).normalize();
  }

  /**
   * Jugador que camina sobre la superficie de una esfera. Toda la física
   * (movimiento, gravedad, salto) ocurre en el plano tangente local a la
   * posición actual, y la posición se reproyecta sobre la esfera cada frame.
   */
  class Player {
    constructor() {
      this.position = new THREE.Vector3(0, Config.TARGET_DISTANCE, 0);
      this.tangentVelocity = new THREE.Vector3(0, 0, 0);
      this.verticalVelocity = 0;
      this.isGrounded = true;
      this.currentRadialDistance = Config.TARGET_DISTANCE;

      // basisX / basisZ viajan con el jugador (transporte paralelo).
      // En el polo, yaw 0 mira a basisZ = +X del mundo.
      this._up = new THREE.Vector3();
      this.basisX = new THREE.Vector3();
      this.basisZ = new THREE.Vector3();
      this._transportQuat = new THREE.Quaternion();
      this._seedAt(this.position.clone().normalize());
      this.coyote = Config.COYOTE_TIME;
      this._wasGrounded = true;
      this.stepClock = 0;
      // Adelante horizontal, el mismo vector con el que camina. El muñeco
      // lo lee de acá: no recalcula el yaw por su cuenta.
      this.facing = new THREE.Vector3();
      this.facing.copy(this.basisZ);
    }

    _seedAt(up) {
      seedBasis(up, this.basisX, this.basisZ);
      this._up.copy(up);
    }

    /**
     * Lleva la base tangente de this._up a newUp por el giro más corto,
     * que en la esfera es el transporte a lo largo del arco. Después la
     * apoya de nuevo en el plano: basisZ = basisX × up.
     */
    _alignBasis(newUp) {
      if (this._up.dot(newUp) < 0.999999) {
        this._transportQuat.setFromUnitVectors(this._up, newUp);
        this.basisX.applyQuaternion(this._transportQuat);
      }
      this.basisX.addScaledVector(newUp, -this.basisX.dot(newUp));
      if (this.basisX.lengthSq() < 1e-8) {
        this._seedAt(newUp);
        return;
      }
      this.basisX.normalize();
      this.basisZ.crossVectors(this.basisX, newUp).normalize();
      this._up.copy(newUp);
    }

    get localUp() {
      return this.position.clone().normalize();
    }

    update(dt, input, camera) {
      const localUp = this.position.clone().normalize();
      this._alignBasis(localUp);

      const forwardDir = this.basisZ.clone()
        .multiplyScalar(Math.cos(input.yaw))
        .addScaledVector(this.basisX, Math.sin(input.yaw))
        .normalize();
      const rightDir = new THREE.Vector3().crossVectors(forwardDir, localUp).normalize();

      let inputX = 0;
      let inputZ = 0;
      if (input.isDown('KeyW') || input.isDown('ArrowUp')) inputZ += 1;
      if (input.isDown('KeyS') || input.isDown('ArrowDown')) inputZ -= 1;
      if (input.isDown('KeyA') || input.isDown('ArrowLeft')) inputX -= 1;
      if (input.isDown('KeyD') || input.isDown('ArrowRight')) inputX += 1;

      const inputLen = Math.hypot(inputX, inputZ);
      if (inputLen > 0.001) {
        inputX /= inputLen;
        inputZ /= inputLen;
      }

      const isRunning = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      const speed = isRunning ? Config.RUN_SPEED : Config.WALK_SPEED;

      const velForward = this.tangentVelocity.dot(forwardDir);
      const velRight = this.tangentVelocity.dot(rightDir);
      const targetVelForward = inputZ * speed;
      const targetVelRight = inputX * speed;

      // El frame del salto sigue con mando de piso. En el aire el cambio es más lento.
      const airScale = this.isGrounded ? 1 : Config.AIR_CONTROL;
      const newVelForward = Utils.moveToward(
        velForward, targetVelForward, Config.ACCELERATION * airScale, Config.FRICTION * airScale, dt
      );
      const newVelRight = Utils.moveToward(
        velRight, targetVelRight, Config.ACCELERATION * airScale, Config.FRICTION * airScale, dt
      );

      this.tangentVelocity.copy(forwardDir).multiplyScalar(newVelForward)
        .add(rightDir.clone().multiplyScalar(newVelRight));

      // Desplazamiento tangente primero. La altura de los ojos viaja en
      // currentRadialDistance; el cuerpo para el choque sale de esa altura.
      const Colliders = window.Game.Colliders;
      const bodyOf = (pos) => {
        const feet = pos.length() - Config.EYE_HEIGHT - Config.PLANET_RADIUS;
        return { feet: feet, top: feet + Config.EYE_HEIGHT };
      };
      const dispForward = forwardDir.clone().multiplyScalar(newVelForward * dt);
      const dispRight = rightDir.clone().multiplyScalar(newVelRight * dt);

      let candidate = this.position.clone().add(dispForward);
      if (Colliders && Colliders.blocked(candidate, Config.PLAYER_RADIUS, bodyOf(candidate))) {
        candidate = this.position.clone();
      }
      const candidateWithRight = candidate.clone().add(dispRight);
      if (!Colliders || !Colliders.blocked(candidateWithRight, Config.PLAYER_RADIUS, bodyOf(candidateWithRight))) {
        candidate = candidateWithRight;
      }
      this.position.copy(candidate);

      // El piso puede ser la esfera o la tapa de un bloque / escalón del chart.
      const GroundHeight = window.Game.GroundHeight;
      const extraGround = GroundHeight ? GroundHeight.get(this.position) : 0;
      const effectiveGroundDistance = Config.TARGET_DISTANCE + extraGround;
      const feetNow = this.currentRadialDistance - Config.EYE_HEIGHT - Config.PLANET_RADIUS;
      if (this.isGrounded && feetNow > extraGround + 0.12) {
        this.isGrounded = false;
        this.verticalVelocity = Math.min(0, this.verticalVelocity);
      }

      let landedHit = null;
      if (!this.isGrounded) {
        this.verticalVelocity -= Config.GRAVITY * dt;
        this.currentRadialDistance += this.verticalVelocity * dt;
        if (this.currentRadialDistance <= effectiveGroundDistance) {
          landedHit = this.verticalVelocity;
          this.currentRadialDistance = effectiveGroundDistance;
          this.verticalVelocity = 0;
          this.isGrounded = true;
        }
      } else {
        this.currentRadialDistance = effectiveGroundDistance;
        this.verticalVelocity = 0;
      }

      const Audio = window.Game.Audio;
      // El coyote se mira al entrar al frame. Si se descuenta antes,
      // el último instante (queda menos que dt) ya no salta.
      const canJump = this.isGrounded || this.coyote > 0;
      if (canJump && input.isDown('Space')) {
        this.verticalVelocity = Config.JUMP_IMPULSE;
        this.isGrounded = false;
        this.coyote = 0;
        if (this.currentRadialDistance < effectiveGroundDistance) {
          this.currentRadialDistance = effectiveGroundDistance;
        }
        input.consume('Space');
        if (Audio) Audio.jump();
        this._wasGrounded = false;
      } else {
        if (this.isGrounded) this.coyote = Config.COYOTE_TIME;
        else this.coyote = Math.max(0, this.coyote - dt);
        if (landedHit != null && landedHit < -6 && Audio) Audio.land();
        this._wasGrounded = this.isGrounded;
      }

      if (this.isGrounded && inputLen > 0.001) {
        this.stepClock -= dt;
        if (this.stepClock <= 0) {
          if (Audio) Audio.footstep();
          this.stepClock = isRunning ? 0.28 : 0.42;
        }
      } else {
        this.stepClock = 0;
      }

      const newRadialDir = this.position.clone().normalize();
      if (newRadialDir.length() < 0.001) {
        this.position.set(0, this.currentRadialDistance, 0);
      } else {
        this.position.copy(newRadialDir.multiplyScalar(this.currentRadialDistance));
      }

      const updatedLocalUp = this.position.clone().normalize();
      this._alignBasis(updatedLocalUp);
      const fwdDir = this.basisZ.clone().multiplyScalar(Math.cos(input.yaw))
        .addScaledVector(this.basisX, Math.sin(input.yaw))
        .normalize();

      const lookDirection = fwdDir.clone()
        .multiplyScalar(Math.cos(input.pitch))
        .add(updatedLocalUp.clone().multiplyScalar(Math.sin(input.pitch)))
        .normalize();

      const lookTarget = this.position.clone().add(lookDirection);

      this.facing.copy(fwdDir);
      camera.up.copy(updatedLocalUp);
      camera.position.copy(this.position);
      camera.lookAt(lookTarget);
    }
  }

  window.Game.Player = Player;
})();
