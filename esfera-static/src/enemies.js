(function () {
  window.Game = window.Game || {};

  const ENEMY_RADIUS = 0.45;

  /**
   * Robots del patio. Caminan en el chart, disparan con gravedad radial
   * y se cubren si les queda poca vida. La caja propia no les tapa el paso.
   * spawnList: [{ x, z, speed, sight, chase, attack, hp }]
   * sight = distancia para verte por primera vez. chase = hasta dónde te siguen.
   */
  window.Game.createEnemies = function (scene, frame, spawnList, opts) {
    const Colliders = window.Game.Colliders;
    const Audio = window.Game.Audio;
    const PlayerHealth = window.Game.PlayerHealth;
    const NN = window.Game.NeuralNet || null;
    // Cerebros prendidos salvo pedido (los self-tests usan clásico
    // determinista; el juego usa neuronal).
    const brainsOn = !opts || opts.brains !== false;

    const BODY = 0.45;
    const _pbUp = new THREE.Vector3();
    const _pbTo = new THREE.Vector3();
    const _pbRight = new THREE.Vector3();
    const _pbM = new THREE.Matrix4();

    // Apoya la malla con el arriba RADIAL (no el del chart) y mirando a
    // (faceX, faceZ) del chart (null = adelante del chart). Con placeOnFrame
    // el cuerpo se acostaba a medida que se alejaba del ancla del marco
    // (a 40 m en un planeta de R=100, ~23° de tilt): de lado cada vez más.
    function placeBody(mesh, frm, x, z, h, faceX, faceZ) {
      mesh.position.copy(frm.localToWorld(x, z, h));
      _pbUp.copy(mesh.position).normalize();
      if (faceX === null || faceX === undefined) {
        _pbTo.copy(frm.tangentZ).addScaledVector(_pbUp, -frm.tangentZ.dot(_pbUp));
      } else {
        _pbTo.copy(frm.localToWorld(faceX, faceZ, h)).sub(mesh.position);
        _pbTo.addScaledVector(_pbUp, -_pbTo.dot(_pbUp));
      }
      if (_pbTo.lengthSq() < 1e-8) {
        _pbTo.copy(frm.tangentX).addScaledVector(_pbUp, -frm.tangentX.dot(_pbUp));
      }
      _pbTo.normalize();
      _pbRight.crossVectors(_pbUp, _pbTo).normalize();
      _pbM.makeBasis(_pbRight, _pbUp, _pbTo);
      mesh.quaternion.setFromRotationMatrix(_pbM);
    }
    // Cerebro del robot: 6 sensores → 4 impulsos (empuje, zigzag, agresión,
    // cautela). Modula la máquina de estados clásica, no la reemplaza: con
    // pesos al azar el comportamiento queda cerca del clásico.
    const BRAIN_SIZES = [6, 6, 4];

    function freshBrain() {
      if (!NN || !brainsOn) return null;
      try {
        return NN.fresh(BRAIN_SIZES);
      } catch (e) {
        return null;
      }
    }

    // Hijo de oleada: cruce de dos cerebros vivos + mutación (a veces
    // estructural). Así las oleadas evolucionan de verdad.
    function inheritBrain() {
      if (!NN || !brainsOn) return freshBrain();
      try {
        const donors = enemies.filter((e) => e.alive && e.brain);
        if (donors.length >= 2 && Math.random() < 0.6) {
          const a = donors[(Math.random() * donors.length) | 0].brain;
          const b = donors[(Math.random() * donors.length) | 0].brain;
          const child = NN.NeuralNetwork.crossover(a, b);
          child.mutate(0.12, 0.35);
          if (Math.random() < 0.08) {
            child.structuralMutate({ hidden: { neurons: [2, 10], min: 1 } });
          }
          return child;
        }
      } catch (e) {}
      return freshBrain();
    }

    function brainTick(e, t, dist, los) {
      if (!e.brain) {
        e.brainOut = null;
        return null;
      }
      const seenRecent = (e.seen && (t - e.seenAt) < 4) ? 1 : 0;
      let out;
      try {
        out = e.brain.forward([
          Math.max(0, Math.min(1, dist / Math.max(1, e.sightRange))),
          los ? 1 : 0,
          Math.max(0, Math.min(1, e.hp / e.maxHp)),
          Math.max(0, Math.min(1, e.energy / e.maxEnergy)),
          e.focusBench ? 1 : 0,
          seenRecent,
        ]);
      } catch (err) {
        e.brainOut = null;
        return null;
      }
      e.brainOut = { push: out[0] || 0, strafe: out[1] || 0, aggression: out[2] || 0, caution: out[3] || 0 };
      return e.brainOut;
    }

    // Ojos a 1.3 m. Una caja de 1 m no esconde a alguien parado; la puerta sí.
    function hasLineOfSight(x1, z1, x2, z2, ignore, frm) {
      const useFrame = frm || frame;
      const dist = Math.hypot(x2 - x1, z2 - z1);
      const steps = Math.max(8, Math.ceil(dist / 0.25));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const sx = x1 + (x2 - x1) * t;
        const sz = z1 + (z2 - z1) * t;
        const worldPos = useFrame.localToWorld(sx, sz, 1.3);
        if (Colliders && Colliders.blocksSight(worldPos, ignore)) return false;
      }
      return true;
    }

    function syncBody(enemy) {
      enemy.col.minX = enemy.localX - BODY;
      enemy.col.maxX = enemy.localX + BODY;
      enemy.col.minZ = enemy.localZ - BODY;
      enemy.col.maxZ = enemy.localZ + BODY;
    }

    function spawnEnemy(spec) {
      // Cada robot puede vivir en su propio chart (los del creador en el
      // otro hemisferio usan el remoto; si no, el del patio). Todo lo que
      // camina o mira lo hace en ese marco.
      const eframe = spec.frame || frame;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xcc3333, emissive: 0xaa2211, emissiveIntensity: 1, roughness: 0.45,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.8), mat);
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.08, 0.08),
        new THREE.MeshBasicMaterial({ color: 0x44dd66 })
      );
      bar.position.y = 1.05;
      bar.raycast = function () {};
      mesh.add(bar);
      scene.add(mesh);
      const hp = spec.hp || 100;
      const col = Colliders
        ? Colliders.add(eframe, spec.x - BODY, spec.x + BODY, spec.z - BODY, spec.z + BODY, 0, 1.6)
        : null;
      const enemy = {
        mesh, bar, col, frame: eframe, far: spec.far ? 1 : 0, guard: !!spec.guard,
        brain: spec.brain || freshBrain(), brainOut: null,
        localX: spec.x, localZ: spec.z, bob: Math.random() * 10,
        faceX: spec.x, faceZ: spec.z + 1,
        // Hogar y patrulla ambiente: quieto del todo queda solo en el modo
        // creador pasivo. Los guardianes rondan corto (no se alejan).
        homeX: spec.x, homeZ: spec.z,
        patrolR: spec.patrolR != null ? spec.patrolR : (spec.guard ? 2.5 : 4),
        wpX: spec.x, wpZ: spec.z, wpT: 2 + Math.random() * 3,
        speed: spec.speed || 2.2,
        attackRange: spec.attack || 3.2,
        sightRange: spec.sight || 14,
        chaseRange: spec.chase || 46,
        rangedRange: 15,
        attackCooldown: 1.1 + Math.random() * 0.4, lastAttack: -999,
        shotWait: 0, energy: 100, maxEnergy: 100,
        state: 'idle', alive: true, hp: hp, maxHp: hp,
        seen: false, seenX: spec.x, seenZ: spec.z, seenAt: -999,
        lastHurt: 0, detourX: 0, detourZ: 0, focusBench: null,
      };
      if (col) {
        col.kind = 'enemy';
        col.ref = enemy;
      }
      return enemy;
    }

    let guns = null;
    let benchSource = function () { return []; };
    let hurtBench = function () {};

    function paintBar(enemy) {
      const ratio = Math.max(0, enemy.hp / enemy.maxHp);
      enemy.bar.scale.x = Math.max(0.05, ratio);
      enemy.bar.material.color.setHex(ratio > 0.6 ? 0x44dd66 : (ratio > 0.3 ? 0xffaa33 : 0xff3344));
    }

    function enemyBody(x, z, frm) {
      return (frm || frame).localToWorld(x, z, 1);
    }

    function freeAt(x, z, ignore, frm) {
      if (!Colliders) return true;
      return !Colliders.blocked(enemyBody(x, z, frm), 0.35, { feet: 0, top: 1.6 }, ignore);
    }

    function steer(enemy, dx, dz, dt, strafeAmt, speedMul) {
      const frm = enemy.frame || frame;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) return;
      let nx = dx / dist;
      let nz = dz / dist;
      // Zigzag neuronal: solo a cielo abierto (con rodeo de muro se respeta
      // el rodeo determinista, para no zigzaguear contra la pared).
      const strafe = strafeAmt || 0;
      if (strafe !== 0 && !enemy.detourX && !enemy.detourZ) {
        const sx = -nz * strafe * 0.6;
        const sz = nx * strafe * 0.6;
        const inv = 1 / Math.max(1e-6, Math.hypot(nx + sx, nz + sz));
        nx = (nx + sx) * inv;
        nz = (nz + sz) * inv;
      }
      const step = enemy.speed * dt * (speedMul == null ? 1 : speedMul);
      // 0.85 m hacia el objetivo. Si está libre, suelta el rodeo y camina derecho.
      if (freeAt(enemy.localX + nx * 0.85, enemy.localZ + nz * 0.85, enemy.col, frm)) {
        enemy.detourX = 0;
        enemy.detourZ = 0;
        if (freeAt(enemy.localX + nx * step, enemy.localZ + nz * step, enemy.col, frm)) {
          enemy.localX += nx * step;
          enemy.localZ += nz * step;
        }
        return;
      }
      // Muro ancho: elige un lado una sola vez y lo mantiene.
      // Si se recalcula cada frame, el robot zigzaguea y no avanza.
      if (!enemy.detourX && !enemy.detourZ) {
        const sideX = -nz;
        const sideZ = nx;
        const left = freeAt(enemy.localX + sideX * 1.3, enemy.localZ + sideZ * 1.3, enemy.col, frm);
        const right = freeAt(enemy.localX - sideX * 1.3, enemy.localZ - sideZ * 1.3, enemy.col, frm);
        let sign = (enemy.localX + enemy.localZ) >= 0 ? 1 : -1;
        if (left && !right) sign = 1;
        else if (right && !left) sign = -1;
        enemy.detourX = sideX * sign;
        enemy.detourZ = sideZ * sign;
      }
      const sx = enemy.localX + enemy.detourX * step;
      const sz = enemy.localZ + enemy.detourZ * step;
      if (freeAt(sx, sz, enemy.col, frm)) {
        enemy.localX = sx;
        enemy.localZ = sz;
        return;
      }
      enemy.detourX = 0;
      enemy.detourZ = 0;
    }

    // Ronda ambiente: waypoints cerca del hogar, despacio. Acotada a
    // propósito (más corta que el vagabundeo de los bichos): el robot
    // cuida su zona en vez de perderse por el planeta.
    function patrol(e, dt) {
      const dx = e.wpX - e.localX;
      const dz = e.wpZ - e.localZ;
      e.wpT -= dt;
      if (Math.hypot(dx, dz) < 0.5 || e.wpT <= 0) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * (e.patrolR || 4);
        e.wpX = e.homeX + Math.cos(a) * r;
        e.wpZ = e.homeZ + Math.sin(a) * r;
        e.wpT = 3 + Math.random() * 4;
        return;
      }
      steer(e, dx, dz, dt, 0, 0.35);
    }

    function shootAt(enemy, x, z, height) {
      if (!guns || enemy.energy <= 30 || enemy.shotWait > 0) return;
      const frm = enemy.frame || frame;
      const muzzle = frm.localToWorld(enemy.localX, enemy.localZ, 1.2);
      const aim = frm.localToWorld(x, z, height);
      const dir = aim.sub(muzzle).normalize();
      const up = muzzle.clone().normalize();
      const side = new THREE.Vector3().crossVectors(dir, up);
      if (side.lengthSq() > 1e-6) {
        side.normalize();
        dir.addScaledVector(side, (Math.random() - 0.5) * 0.08);
        dir.addScaledVector(up, (Math.random() - 0.5) * 0.04);
        dir.normalize();
      }
      const origin = frm.localToWorld(enemy.localX, enemy.localZ, 1.2).addScaledVector(dir, 0.7);
      guns.spawn({
        position: origin,
        direction: dir,
        speed: 22.5,
        damage: 6,
        owner: 'enemy',
        ignore: enemy.col,
        color: 0xff3333,
        life: 1.5,
      });
      enemy.energy -= 20;
      enemy.shotWait = enemy.attackCooldown * 1.5;
      if (Audio) Audio.shoot();
    }

    const specs = (spawnList && spawnList.length) ? spawnList : [
      { x: 5, z: -10 },
      { x: -9, z: -5 },
    ];
    const enemies = specs.map(spawnEnemy);
    let kills = 0;
    let passive = false;

    function spawnAt(points, count) {
      const pts = (points && points.length) ? points : specs;
      let made = 0;
      for (let k = 0; k < count; k++) {
        const sp = pts[k % pts.length];
        const ox = ((k % 3) - 1) * 1.15;
        const oz = (Math.floor(k / 3) % 3 - 1) * 1.15;
        enemies.push(spawnEnemy({
          x: sp.x + ox,
          z: sp.z + oz,
          speed: sp.speed,
          sight: sp.sight,
          chase: sp.chase,
          attack: sp.attack,
          hp: sp.hp,
          brain: inheritBrain(),
        }));
        made += 1;
      }
      return made;
    }

    function nearestBench(enemy, playerDist) {
      const list = benchSource() || [];
      let best = null;
      let bestD = Infinity;
      const efar = enemy.far ? 1 : 0;
      for (let i = 0; i < list.length; i++) {
        const bench = list[i];
        if (!bench.alive) continue;
        if ((bench.far ? 1 : 0) !== efar) continue;
        const dist = Math.hypot(bench.x - enemy.localX, bench.z - enemy.localZ);
        if (dist < bestD) {
          bestD = dist;
          best = bench;
        }
      }
      if (!best) return null;
      if (bestD >= playerDist * 0.7) return null;
      if (bestD >= enemy.sightRange * 1.5) return null;
      return best;
    }

    function update(dt, t, playerWorldPos) {
      if (PlayerHealth && PlayerHealth.isDead) return;
      // Modo creador (como el FPS): los enemigos no atacan ni persiguen.
      if (passive) {
        enemies.forEach((e) => {
          if (!e.alive) return;
          patrol(e, dt);
          placeBody(e.mesh, e.frame || frame, e.localX, e.localZ, 0.8, null, null);
          if (e.col) syncBody(e);
        });
        return;
      }
      const now = performance.now();

      enemies.forEach((e) => {
        if (!e.alive) return;
        const frm = e.frame || frame;
        e.shotWait = Math.max(0, e.shotWait - dt);
        e.energy = Math.min(e.maxEnergy, e.energy + 5 * dt);
        if (now - e.lastHurt > 4000 && e.hp < e.maxHp) {
          const rate = e.state === 'flee' ? 6 : 1.5;
          e.hp = Math.min(e.maxHp, e.hp + rate * dt);
          paintBar(e);
        }

        // La malla se apoya al final (con facing) o en la rama dormida.
        // Lejos en el mundo (p. ej. otra mitad del planeta) el jugador no
        // existe para este robot: proyectarlo en su plano daría ~0 y lo
        // pondría a perseguir un fantasma en su propia celda.
        if (e.mesh.position.distanceTo(playerWorldPos) > e.chaseRange + 12) {
          e.state = 'idle';
          e.focusBench = null;
          patrol(e, dt);
          placeBody(e.mesh, frm, e.localX, e.localZ, 0.8, null, null);
          if (e.col) syncBody(e);
          return;
        }
        const pzloc = frm.worldToLocalXZ(playerWorldPos);
        const px = pzloc.x;
        const pz = pzloc.z;
        const eye = frm.worldToLocal(playerWorldPos);
        const aimH = Math.max(0.4, eye.h - 0.4);

        const dx = px - e.localX;
        const dz = pz - e.localZ;
        const dist = Math.hypot(dx, dz);
        const los = hasLineOfSight(e.localX, e.localZ, px, pz, e.col, frm);
        // Cerebro: modula vista, coraje y alcance según lo que siente.
        const bo = brainTick(e, t, dist, los);
        const effSight = e.sightRange * (1 + 0.25 * (bo ? bo.aggression : 0));
        const fleeAt = 0.25 + 0.10 * (bo ? bo.caution : 0);
        const effAttack = e.attackRange * (1 + 0.3 * (bo ? bo.push : 0));
        const strafe = (los && bo) ? bo.strafe : 0;
        if (los && dist < effSight) {
          e.seen = true;
          e.seenX = px;
          e.seenZ = pz;
          e.seenAt = t;
        }

        e.focusBench = e.seen ? nearestBench(e, dist) : null;
        const ratio = e.hp / e.maxHp;
        if (e.state !== 'flee' && ratio < fleeAt && e.seen && dist < effSight) {
          e.state = 'flee';
        } else if (e.state === 'flee' && (dist > effSight * 1.5 || ratio > 0.5)) {
          e.state = 'chase';
        }

        let benchDist = Infinity;
        if (e.focusBench) {
          benchDist = Math.hypot(e.focusBench.x - e.localX, e.focusBench.z - e.localZ);
        }
        if (e.state !== 'flee') {
          const remembers = e.seen && (t - e.seenAt) < 4;
          if (!remembers) {
            e.state = 'idle';
            e.focusBench = null;
          } else if (e.focusBench && benchDist <= effAttack) {
            e.state = 'attack';
          } else if (!e.focusBench && los && dist <= effAttack) {
            e.state = 'attack';
          } else {
            e.state = 'chase';
          }
        }

        if (e.state === 'chase') {
          if (e.focusBench) steer(e, e.focusBench.x - e.localX, e.focusBench.z - e.localZ, dt, strafe);
          else if (!los) steer(e, e.seenX - e.localX, e.seenZ - e.localZ, dt, 0);
          else steer(e, dx, dz, dt, strafe);
        } else if (e.state === 'flee') {
          steer(e, -dx, -dz, dt, 0);
        } else if (e.state === 'idle') {
          patrol(e, dt);
        }

        if (e.state === 'chase' || e.state === 'attack') {
          if (e.focusBench) {
            if (benchDist > effAttack && benchDist <= e.rangedRange &&
                hasLineOfSight(e.localX, e.localZ, e.focusBench.x, e.focusBench.z, e.col, frm)) {
              shootAt(e, e.focusBench.x, e.focusBench.z, 0.7);
            }
          } else if (los && dist > effAttack && dist <= e.rangedRange) {
            shootAt(e, px, pz, aimH);
          }
        }

        if (e.state === 'attack' && t - e.lastAttack > e.attackCooldown) {
          e.lastAttack = t;
          e.mesh.scale.set(1.15, 0.9, 1.15);
          setTimeout(() => { if (e.alive) e.mesh.scale.set(1, 1, 1); }, 120);
          if (Audio) Audio.enemyGrowl();
          if (e.focusBench) hurtBench(e.focusBench, 8);
          else if (PlayerHealth) PlayerHealth.damage(8);
        }

        const targetColor = e.state === 'flee' ? 0x3366aa
          : (e.state === 'attack' ? 0xff4400 : (e.state === 'chase' ? 0xdd2222 : 0x882222));
        e.mesh.material.color.setHex(targetColor);
      });

      // separación entre enemigos, para que no se apilen
      // (solo dentro del mismo chart: comparar hemisferios no tiene sentido).
      enemies.forEach((e) => {
        if (!e.alive) return;
        enemies.forEach((other) => {
          if (other === e || !other.alive) return;
          if ((other.far ? 1 : 0) !== (e.far ? 1 : 0)) return;
          const dx = e.localX - other.localX;
          const dz = e.localZ - other.localZ;
          const dist = Math.hypot(dx, dz);
          const minDist = ENEMY_RADIUS * 2;
          if (dist > 0.001 && dist < minDist) {
            const push = (minDist - dist) * 0.5;
            e.localX += (dx / dist) * push;
            e.localZ += (dz / dist) * push;
            if (e.col) syncBody(e);
          }
        });
      });

      enemies.forEach((e) => {
        if (!e.alive) return;
        const frm = e.frame || frame;
        // La orientación mira al jugador solo si está cerca en el mundo
        // (si no, el plano lo pliega sobre la propia celda): se guarda para
        // no girar de golpe cuando se aleja.
        if (e.mesh.position.distanceTo(playerWorldPos) <= e.chaseRange + 12) {
          try {
            const pl = frm.worldToLocalXZ(playerWorldPos);
            e.faceX = pl.x;
            e.faceZ = pl.z;
          } catch (err) {}
        }
        const bob = e.state === 'idle' ? 0.05 : 0.02;
        const h = 0.8 + Math.sin(t * 2 + e.bob) * bob;
        placeBody(e.mesh, frm, e.localX, e.localZ, h, e.faceX, e.faceZ);
        if (e.col) syncBody(e);
      });
    }

    function damageEnemy(enemy, amount) {
      if (!enemy || !enemy.alive) return false;
      enemy.hp -= amount;
      enemy.lastHurt = performance.now();
      paintBar(enemy);
      if (enemy.hp <= 0) {
        enemy.alive = false;
        kills += 1;
        scene.remove(enemy.mesh);
        if (enemy.col && Colliders) Colliders.remove(enemy.col);
        return true;
      }
      return false;
    }

    function dispose() {
      enemies.forEach((enemy) => {
        scene.remove(enemy.mesh);
        if (enemy.col && Colliders) Colliders.remove(enemy.col);
        enemy.alive = false;
      });
      enemies.length = 0;
      creatorEnemies.length = 0;
    }

    // --- Creador: poner/sacar robots a mano ---
    const creatorEnemies = [];

    function spawnOne(x, z, fromCreator, far, chartFrame, isGuard) {
      const enemy = spawnEnemy({
        x: x, z: z, speed: 2.2, sight: 14, chase: 46, attack: 3.2, hp: 100,
        far: far ? 1 : 0, frame: chartFrame || undefined,
        // Guardián de la puerta: no cuenta para las oleadas (si no, las
        // oleadas no arrancarían hasta matarlo) ni se guarda con el creador.
        guard: !!isGuard,
      });
      enemies.push(enemy);
      if (fromCreator) {
        enemy.creator = true;
        creatorEnemies.push(enemy);
      }
      return enemy;
    }

    function removeEnemy(enemy) {
      if (!enemy) return false;
      enemy.alive = false;
      try { scene.remove(enemy.mesh); } catch (e) {}
      if (enemy.col && Colliders) {
        try { Colliders.remove(enemy.col); } catch (e) {}
      }
      const at = enemies.indexOf(enemy);
      if (at >= 0) enemies.splice(at, 1);
      const ct = creatorEnemies.indexOf(enemy);
      if (ct >= 0) creatorEnemies.splice(ct, 1);
      return true;
    }

    function tryDeleteAimed(camera) {
      if (!camera) return null;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera({ x: 0, y: 0 }, camera);
      raycaster.far = 16;
      const meshes = enemies.filter((e) => e.alive).map((e) => e.mesh);
      if (!meshes.length) return null;
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) return null;
      for (let i = 0; i < enemies.length; i++) {
        if (enemies[i].mesh === hits[0].object) {
          removeEnemy(enemies[i]);
          return { ok: true, text: 'Robot destruido' };
        }
      }
      return null;
    }

    function clearCreatorEnemies() {
      for (let i = creatorEnemies.length - 1; i >= 0; i--) {
        removeEnemy(creatorEnemies[i]);
      }
    }

    function snapshotCreatorEnemies() {
      const out = [];
      for (let i = 0; i < creatorEnemies.length; i++) {
        const e = creatorEnemies[i];
        if (!e.alive) continue;
        out.push({ x: Math.round(e.localX * 100) / 100, z: Math.round(e.localZ * 100) / 100, far: e.far ? 1 : 0 });
      }
      return out;
    }

    function restoreCreatorEnemies(list, chartFor) {
      if (!Array.isArray(list)) return 0;
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        if (!d || typeof d.x !== 'number' || typeof d.z !== 'number') continue;
        let rx = d.x;
        let rfar = (typeof d.far === 'number') ? (d.far ? 1 : 0) : 0;
        if (typeof d.far !== 'number' && rx >= 1000000) {
          // Guardado viejo (v2 con FAR + remoto).
          rx -= 1000000;
          rfar = 1;
        }
        const frm = (typeof chartFor === 'function') ? chartFor(rfar) : undefined;
        spawnOne(Math.round(rx), Math.round(d.z), true, rfar, frm);
        n += 1;
      }
      return n;
    }

    return {
      enemies: enemies,
      get kills() { return kills; },
      aliveCount() {
        let n = 0;
        for (let i = 0; i < enemies.length; i++) if (enemies[i].alive) n += 1;
        return n;
      },
      // Vivos sin contar guardianes: es lo que miran las oleadas (si no,
      // los guardianes de la puerta bloquearían las oleadas para siempre).
      foesAlive() {
        let n = 0;
        for (let i = 0; i < enemies.length; i++) {
          if (enemies[i].alive && !enemies[i].guard) n += 1;
        }
        return n;
      },
      spawnAt: spawnAt,
      spawnOne: spawnOne,
      canSpawnAt(x, z, far, chartFrame) {
        try {
          return freeAt(x, z, null, chartFrame || frame);
        } catch (e) {
          return true;
        }
      },
      removeEnemy: removeEnemy,
      tryDeleteAimed: tryDeleteAimed,
      clearCreatorEnemies: clearCreatorEnemies,
      snapshotCreatorEnemies: snapshotCreatorEnemies,
      restoreCreatorEnemies: restoreCreatorEnemies,
      update: update,
      damageEnemy: damageEnemy,
      healEnemy(enemy, amount) {
        if (!enemy || !enemy.alive) return false;
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + amount);
        paintBar(enemy);
        return true;
      },
      dispose: dispose,
      setCombat(opts) {
        guns = opts && opts.projectiles;
        if (opts && opts.benches) benchSource = opts.benches;
        if (opts && opts.hurtBench) hurtBench = opts.hurtBench;
      },
      setPassive(on) { passive = !!on; },
      isPassive() { return passive; },
    };
  };

  // Cuando no queda nadie, espera 5 s y suelta la siguiente oleada.
  // La cuenta sigue a La Grieta: min(2 + oleada, 6).
  // Con grace, el spawn arranca en calma N segundos antes del ciclo.
  window.Game.createWaves = function (enemies, points, grace) {
    let number = 0;
    let timer = 0;
    let pending = false;
    let calm = (typeof grace === 'number' && grace > 0) ? grace : 0;

    function update(dt) {
      if (calm > 0) {
        calm -= dt;
        if (calm <= 0) {
          calm = 0;
          return { type: 'wake' };
        }
        return null;
      }      if (enemies.foesAlive() > 0) {
        timer = 0;
        pending = false;
        return null;
      }
      if (!pending) {
        pending = true;
        timer = 5;
        return { type: 'clear' };
      }
      timer -= dt;
      if (timer > 0) return null;
      pending = false;
      timer = 0;
      number += 1;
      const count = Math.min(2 + number, 6);
      enemies.spawnAt(points, count);
      return { type: 'spawn', wave: number, count: count };
    }

    return {
      update: update,
      get number() { return number; },
      calmLeft() { return Math.max(0, calm); },
    };
  };
})();
