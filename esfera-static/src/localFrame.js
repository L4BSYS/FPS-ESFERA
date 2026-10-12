(function () {
  window.Game = window.Game || {};

  const WORLD_Y = new THREE.Vector3(0, 1, 0);
  const WORLD_X = new THREE.Vector3(1, 0, 0);

  /**
   * Crea un "ancla" local en un punto de la esfera: una base tangente fija
   * (tangentX, tangentZ, up) calculada una sola vez en ese punto, que
   * permite tratar una zona chica del planeta como si fuera un plano X/Z
   * de toda la vida — igual que el laberinto original — sin que la
   * curvatura real de la esfera se note (el error es de centímetros para
   * zonas de ~20-30 unidades sobre un planeta de radio 500).
   *
   * Sirve para posicionar paredes, puertas, plataformas, ítems, etc. usando
   * las mismas coordenadas locales (x, z, altura) que ya usábamos, sin
   * tener que pensar en la esfera en absoluto al definir el layout.
   */
  function makeFrame(anchorPosition, tangentX, up, tangentZ) {
    const Config = window.Game.Config;
    const anchor = anchorPosition.clone();
    return {
      anchorPosition: anchor,
      tangentX,
      tangentZ,
      up,

      /** Local (x, z, altura sobre el piso) → posición real en el mundo */
      localToWorld(x, z, height) {
        height = height || 0;
        const flat = anchor.clone()
          .add(tangentX.clone().multiplyScalar(x))
          .add(tangentZ.clone().multiplyScalar(z));
        const dir = flat.clone().normalize();
        return dir.multiplyScalar(Config.PLANET_RADIUS + height);
      },

      /** Posición en el mundo → (x, z) en el plano del ancla y altura sobre la esfera. */
      worldToLocal(worldPos) {
        const rel = worldPos.clone().sub(anchor);
        return {
          x: rel.dot(tangentX),
          z: rel.dot(tangentZ),
          h: worldPos.length() - Config.PLANET_RADIUS,
        };
      },

      worldToLocalXZ(worldPos) {
        const here = this.worldToLocal(worldPos);
        return { x: here.x, z: here.z };
      },
    };
  }

  window.Game.LocalFrame = function (anchorPosition) {
    const up = anchorPosition.clone().normalize();
    const referenceVec = Math.abs(up.y) < 0.99 ? WORLD_Y : WORLD_X;
    const tangentX = new THREE.Vector3().crossVectors(up, referenceVec).normalize();
    const tangentZ = new THREE.Vector3().crossVectors(tangentX, up).normalize();
    return makeFrame(anchorPosition, tangentX, up, tangentZ);
  };

  /** Misma base que la malla, leída de su quaternion. Sirve para una roca
   *  girada sobre su radio: la caja usa esos ejes, no un marco nuevo. */
  window.Game.frameFromQuaternion = function (anchorPosition, quaternion) {
    const tangentX = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
    const tangentZ = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    return makeFrame(anchorPosition, tangentX, up, tangentZ);
  };
})();
