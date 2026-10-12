(function () {
  window.Game = window.Game || {};

  window.Game.Utils = {
    /**
     * Mueve `current` hacia `target` respetando una tasa de aceleración
     * (si hay input) o de fricción (si no la hay).
     */
    moveToward: function (current, target, accel, fric, dt) {
      const diff = target - current;
      if (Math.abs(diff) < 0.001 && Math.abs(current) < 0.001) return 0;

      if (Math.abs(target) > 0.001) {
        const maxChange = accel * dt;
        if (Math.abs(diff) <= maxChange) return target;
        return current + Math.sign(diff) * maxChange;
      }
      const frictionForce = fric * dt;
      if (Math.abs(current) <= frictionForce) return 0;
      return current - Math.sign(current) * frictionForce;
    },

    /**
     * Apoya un objeto en el chart: posición sobre la esfera y ejes alineados
     * al frame. makeBasis(tangentX, up, tangentZ) porque tangentZ = tangentX × up.
     * En el polo: tangentX=(0,0,-1), up=(0,1,0), tangentZ=(1,0,0).
     * El ancho de un BoxGeometry (eje local X) cae sobre tangentX y el
     * profundo (eje local Z) sobre tangentZ, igual que los colliders.
     * rotateY(θ) manda el +Z local a (sin θ, 0, cos θ) en ese plano.
     */
    placeOnFrame: function (object, frame, x, z, height) {
      object.position.copy(frame.localToWorld(x, z, height || 0));
      const basis = new THREE.Matrix4().makeBasis(frame.tangentX, frame.up, frame.tangentZ);
      object.quaternion.setFromRotationMatrix(basis);
    },
  };
})();
