(function () {
  window.Game = window.Game || {};

  const ENEMY_RADIUS = 0.45;

  /**
   * Robots del patio. Caminan en el chart, disparan con gravedad radial
   * y se cubren si les queda poca vida. La caja propia no les tapa el paso.
   * spawnList: [{ x, z, speed, sight, chase, attack, hp }]
   * sight = distancia para verte por primera vez. chase = hasta dónde te siguen.
   */
  window.Game.createEnemies = function (scene, frame, spawnList) {
    const Colliders = window.Game.Colliders;
    const Audio = window.Game.Audio;
    const PlayerHealth = window.Game.PlayerHealth;

    const BODY = 0.45;

    // Ojos a 1.3 m. Una caja de 1 m no esconde a alguien parado; la puerta sí.
    function hasLineOfSight(x1, z1, x2, z2, ignore) {
      const dist = Math.hypot(x2 - x1, z2 - z1);
      const steps = Math.max(8, Math.ceil(dist / 0.25));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const sx = x1 + (x2 - x1) * t;
        const sz = z1 + (z2 - z1) * t;
        const worldPos = frame.localToWorld(sx, sz, 1.3);
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
        ? Colliders.add(frame, spec.x - BODY, spec.x + BODY, spec.z - BODY, spec.z + BODY, 0, 1.6)
        : null;
      const enemy = {
        mesh, bar, col, localX: spec.x, localZ: spec.z, bob: Math.random() * 10,
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

    function enemyBody(x, z) {
      return frame.localToWorld(x, z, 1);
    }

    function freeAt(x, z, ignore) {
      if (!Colliders) return true;
      return !Colliders.blocked(enemyBody(x, z), 0.35, { feet: 0, top: 1.6 }, ignore);
    }

    function steer(enemy, dx, dz, dt) {
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) return;
      const nx = dx / dist;
      const nz = dz / dist;
      const step = enemy.speed * dt;
      // 0.85 m hacia el objetivo. Si está libre, suelta el rodeo y camina derecho.
      if (freeAt(enemy.localX + nx * 0.85, enemy.localZ + nz * 0.85, enemy.col)) {
        enemy.detourX = 0;
        enemy.detourZ = 0;
        if (freeAt(enemy.localX + nx * step, enemy.localZ + nz * step, enemy.col)) {
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
        const left = freeAt(enemy.localX + sideX * 1.3, enemy.localZ + sideZ * 1.3, enemy.col);
        const right = freeAt(enemy.localX - sideX * 1.3, enemy.localZ - sideZ * 1.3, enemy.col);
        let sign = (enemy.localX + enemy.localZ) >= 0 ? 1 : -1;
        if (left && !right) sign = 1;
        else if (right && !left) sign = -1;
        enemy.detourX = sideX * sign;
        enemy.detourZ = sideZ * sign;
      }
      const sx = enemy.localX + enemy.detourX * step;
      const sz = enemy.localZ + enemy.detourZ * step;
      if (freeAt(sx, sz, enemy.col)) {
        enemy.localX = sx;
        enemy.localZ = sz;
        return;
      }
      enemy.detourX = 0;
      enemy.detourZ = 0;
    }

    function shootAt(enemy, x, z, height) {
      if (!guns || enemy.energy <= 30 || enemy.shotWait > 0) return;
      const muzzle = frame.localToWorld(enemy.localX, enemy.localZ, 1.2);
      const aim = frame.localToWorld(x, z, height);
      const dir = aim.sub(muzzle).normalize();
      const up = muzzle.clone().normalize();
      const side = new THREE.Vector3().crossVectors(dir, up);
      if (side.lengthSq() > 1e-6) {
        side.normalize();
        dir.addScaledVector(side, (Math.random() - 0.5) * 0.08);
        dir.addScaledVector(up, (Math.random() - 0.5) * 0.04);
        dir.normalize();
      }
      const origin = frame.localToWorld(enemy.localX, enemy.localZ, 1.2).addScaledVector(dir, 0.7);
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
        }));
        made += 1;
      }
      return made;
    }

    function nearestBench(enemy, playerDist) {
      const list = benchSource() || [];
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < list.length; i++) {
        const bench = list[i];
        if (!bench.alive) continue;
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
      const { x: px, z: pz } = frame.worldToLocalXZ(playerWorldPos);
      const eye = frame.worldToLocal(playerWorldPos);
      const aimH = Math.max(0.4, eye.h - 0.4);
      const now = performance.now();

      enemies.forEach((e) => {
        if (!e.alive) return;
        e.shotWait = Math.max(0, e.shotWait - dt);
        e.energy = Math.min(e.maxEnergy, e.energy + 5 * dt);
        if (now - e.lastHurt > 4000 && e.hp < e.maxHp) {
          const rate = e.state === 'flee' ? 6 : 1.5;
          e.hp = Math.min(e.maxHp, e.hp + rate * dt);
          paintBar(e);
        }

        const dx = px - e.localX;
        const dz = pz - e.localZ;
        const dist = Math.hypot(dx, dz);
        const los = hasLineOfSight(e.localX, e.localZ, px, pz, e.col);
        if (los && dist < e.sightRange) {
          e.seen = true;
          e.seenX = px;
          e.seenZ = pz;
          e.seenAt = t;
        }

        e.focusBench = e.seen ? nearestBench(e, dist) : null;
        const ratio = e.hp / e.maxHp;
        if (e.state !== 'flee' && ratio < 0.25 && e.seen && dist < e.sightRange) {
          e.state = 'flee';
        } else if (e.state === 'flee' && (dist > e.sightRange * 1.5 || ratio > 0.5)) {
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
          } else if (e.focusBench && benchDist <= e.attackRange) {
            e.state = 'attack';
          } else if (!e.focusBench && los && dist <= e.attackRange) {
            e.state = 'attack';
          } else {
            e.state = 'chase';
          }
        }

        if (e.state === 'chase') {
          if (e.focusBench) steer(e, e.focusBench.x - e.localX, e.focusBench.z - e.localZ, dt);
          else if (!los) steer(e, e.seenX - e.localX, e.seenZ - e.localZ, dt);
          else steer(e, dx, dz, dt);
        } else if (e.state === 'flee') {
          steer(e, -dx, -dz, dt);
        }

        if (e.state === 'chase' || e.state === 'attack') {
          if (e.focusBench) {
            if (benchDist > e.attackRange && benchDist <= e.rangedRange &&
                hasLineOfSight(e.localX, e.localZ, e.focusBench.x, e.focusBench.z, e.col)) {
              shootAt(e, e.focusBench.x, e.focusBench.z, 0.7);
            }
          } else if (los && dist > e.attackRange && dist <= e.rangedRange) {
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
      enemies.forEach((e) => {
        if (!e.alive) return;
        enemies.forEach((other) => {
          if (other === e || !other.alive) return;
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
        const bob = e.state === 'idle' ? 0.05 : 0.02;
        const h = 0.8 + Math.sin(t * 2 + e.bob) * bob;
        window.Game.Utils.placeOnFrame(e.mesh, frame, e.localX, e.localZ, h);
        // +Z local del chart apunta a tangentZ. rotateY(θ) lo lleva a
        // (sin θ, 0, cos θ), o sea la dirección (dx, dz) hacia el jugador.
        e.mesh.rotateY(Math.atan2(px - e.localX, pz - e.localZ));
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
    }

    return {
      enemies: enemies,
      get kills() { return kills; },
      aliveCount() {
        let n = 0;
        for (let i = 0; i < enemies.length; i++) if (enemies[i].alive) n += 1;
        return n;
      },
      spawnAt: spawnAt,
      update: update,
      damageEnemy: damageEnemy,
      dispose: dispose,
      setCombat(opts) {
        guns = opts && opts.projectiles;
        if (opts && opts.benches) benchSource = opts.benches;
        if (opts && opts.hurtBench) hurtBench = opts.hurtBench;
      },
    };
  };

  // Cuando no queda nadie, espera 5 s y suelta la siguiente oleada.
  // La cuenta sigue a La Grieta: min(2 + oleada, 6).
  window.Game.createWaves = function (enemies, points) {
    let number = 0;
    let timer = 0;
    let pending = false;

    function update(dt) {
      if (enemies.aliveCount() > 0) {
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
    };
  };
})();
