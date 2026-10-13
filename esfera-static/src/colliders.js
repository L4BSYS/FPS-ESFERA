(function () {
  window.Game = window.Game || {};
  const Config = window.Game.Config;

  const colliders = [];
  // Un peldaño de 0.25 entra. Un bloque de 1 no: hay que saltarlo.
  const STEP = 0.36;
  let groundHooked = false;

    function hookGround() {
      if (groundHooked || !window.Game.GroundHeight) return;
      groundHooked = true;
      window.Game.GroundHeight.register((worldPos) => window.Game.Colliders.support(worldPos));
    }

    // Un collider solo vale cerca de su ancla: proyectar un punto lejano
    // (p. ej. la antípoda) en su plano da coordenadas mentirosas.
    function inRange(c, worldPos) {
      if (!c.frame || !c.frame.anchorPosition) return true;
      const range = (Config && Config.FRAME_RANGE) || 120;
      return c.frame.anchorPosition.distanceTo(worldPos) <= range;
    }

  window.Game.Colliders = {
    /**
     * Rectángulo en el chart. minH/maxH son altura sobre la esfera.
     * Sin altura, bloquea en toda la vertical (muros y puerta).
     * stand: el jugador puede quedar parado en maxH.
     */
    add(frame, minX, maxX, minZ, maxZ, minH, maxH) {
      hookGround();
      const c = {
        frame, minX, maxX, minZ, maxZ,
        minH: minH == null ? null : minH,
        maxH: maxH == null ? null : maxH,
        active: true,
        stand: false,
      };
      colliders.push(c);
      return c;
    },

    remove(collider) {
      const index = colliders.indexOf(collider);
      if (index >= 0) colliders.splice(index, 1);
    },

    /**
     * body = { feet, top } en altura sobre la esfera.
     * Sin body se asume alguien parado en el piso (0 a 1.8): así los
     * robots no atraviesan un bloque. El paso automático solo vale
     * cuando el jugador manda su propia altura.
     */
    blocked(worldPos, radius, body, ignore, skip) {
      radius = radius || Config.PLAYER_RADIUS;
      const feet = body ? body.feet : 0;
      const head = body ? body.top : 1.8;
      for (const c of colliders) {
        if (!c.active || c === ignore) continue;
        if (skip && skip(c)) continue;
        if (!inRange(c, worldPos)) continue;
        const { x, z } = c.frame.worldToLocalXZ(worldPos);
        if (x + radius <= c.minX || x - radius >= c.maxX ||
            z + radius <= c.minZ || z - radius >= c.maxZ) continue;
        if (c.minH == null || c.maxH == null) return true;
        if (head <= c.minH + 0.02) continue;
        if (feet >= c.maxH - 0.02) continue;
        if (body && c.stand && c.maxH - feet <= STEP && c.maxH >= feet - 0.05) continue;
        return true;
      }
      return false;
    },

    /** La muestra de visión está a una altura, no ocupa un cuerpo.
     *  ignore es la caja de quien mira, para no taparse solo. */
    blocksSight(worldPos, ignore) {
      const h = worldPos.length() - Config.PLANET_RADIUS;
      for (const c of colliders) {
        if (!c.active || c === ignore) continue;
        if (!inRange(c, worldPos)) continue;
        const { x, z } = c.frame.worldToLocalXZ(worldPos);
        if (x <= c.minX || x >= c.maxX || z <= c.minZ || z >= c.maxZ) continue;
        if (c.minH == null || c.maxH == null) return true;
        if (h >= c.minH - 0.05 && h <= c.maxH + 0.05) return true;
      }
      return false;
    },

    /** Altura de piso bajo los pies. worldPos es la altura de los ojos. */
    support(worldPos) {
      const feet = worldPos.length() - Config.EYE_HEIGHT - Config.PLANET_RADIUS;
      let best = 0;
      for (const c of colliders) {
        if (!c.active || !c.stand || c.maxH == null) continue;
        if (!inRange(c, worldPos)) continue;
        const { x, z } = c.frame.worldToLocalXZ(worldPos);
        // 5 cm de borde. Con 20 cm el peldaño (68 cm) casi no tenía piso
        // y a 12 m/s el jugador lo salteaba en un frame.
        const inset = 0.05;
        if (x <= c.minX + inset || x >= c.maxX - inset ||
            z <= c.minZ + inset || z >= c.maxZ - inset) continue;
        if (c.maxH <= feet + 0.5 && c.maxH > best) best = c.maxH;
      }
      return best;
    },

    /**
     * Primer caja que corta el segmento de mundo a→b.
     * La altura es la radial de cada extremo, no el Y del mundo.
     * t es 0 en a y 1 en b. ignore es la caja del que disparó.
     */
    segment(a, b, ignore) {
      let best = null;
      let bestT = 1.01;
      for (const c of colliders) {
        if (!c.active || c === ignore) continue;
        if (c.frame && c.frame.anchorPosition) {
          const range = (Config && Config.FRAME_RANGE) || 120;
          if (c.frame.anchorPosition.distanceTo(a) > range &&
              c.frame.anchorPosition.distanceTo(b) > range) continue;
        }
        const la = c.frame.worldToLocal(a);
        const lb = c.frame.worldToLocal(b);
        const t = slab(la, lb, c);
        if (t == null || t >= bestT) continue;
        bestT = t;
        best = c;
      }
      return best ? { col: best, t: bestT } : null;
    },

    all() {
      return colliders;
    },
  };

  function slab(a, b, c) {
    const pad = 0.02;
    let t0 = 0;
    let t1 = 1;
    const axes = [
      [a.x, b.x - a.x, c.minX - pad, c.maxX + pad],
      [a.z, b.z - a.z, c.minZ - pad, c.maxZ + pad],
    ];
    if (c.minH != null && c.maxH != null) {
      axes.push([a.h, b.h - a.h, c.minH - pad, c.maxH + pad]);
    }
    for (let i = 0; i < axes.length; i++) {
      const origin = axes[i][0];
      const delta = axes[i][1];
      const mn = axes[i][2];
      const mx = axes[i][3];
      if (Math.abs(delta) < 1e-8) {
        if (origin < mn || origin > mx) return null;
        continue;
      }
      let ta = (mn - origin) / delta;
      let tb = (mx - origin) / delta;
      if (ta > tb) {
        const swap = ta;
        ta = tb;
        tb = swap;
      }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }
    if (t1 < 0) return null;
    return t0 >= 0 ? t0 : 0;
  }
})();
