// Proyectil sobre la esfera. La velocidad tangente se transporta con el
// piso y la gravedad resta altura hacia el centro, no el Y del mundo.
(function () {
  window.Game = window.Game || {};
  const Config = window.Game.Config;

  const GRAVITY = 2;
  const DRAG = 0.995;
  const LIFE = 1.5;

  function segmentSegment(p1, q1, p2, q2) {
    const d1 = q1.clone().sub(p1);
    const d2 = q2.clone().sub(p2);
    const r = p1.clone().sub(p2);
    const aa = d1.dot(d1);
    const e = d2.dot(d2);
    const f = d2.dot(r);
    let s;
    let t;
    if (aa <= 1e-8 && e <= 1e-8) {
      return { s: 0, dist: p1.distanceTo(p2) };
    }
    if (aa <= 1e-8) {
      s = 0;
      t = Math.max(0, Math.min(1, f / e));
    } else {
      const c = d1.dot(r);
      if (e <= 1e-8) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / aa));
      } else {
        const b = d1.dot(d2);
        const denom = aa * e - b * b;
        s = denom > 1e-8 ? (b * f - c * e) / denom : 0;
        s = Math.max(0, Math.min(1, s));
        t = (b * s + f) / e;
        if (t < 0) {
          t = 0;
          s = Math.max(0, Math.min(1, -c / aa));
        } else if (t > 1) {
          t = 1;
          s = Math.max(0, Math.min(1, (b - c) / aa));
        }
      }
    }
    const c1 = p1.clone().addScaledVector(d1, s);
    const c2 = p2.clone().addScaledVector(d2, t);
    return { s: s, dist: c1.distanceTo(c2) };
  }

  window.Game.createProjectiles = function (scene) {
    const Colliders = window.Game.Colliders;
    const Audio = window.Game.Audio;
    const bullets = [];
    let handlers = {};

    function integrate(bullet, dt) {
      const radius = Config.PLANET_RADIUS;
      const up = bullet.position.clone().normalize();
      let radial = bullet.velocity.dot(up);
      const tangent = bullet.velocity.clone().addScaledVector(up, -radial);
      const moved = bullet.position.clone().addScaledVector(tangent, dt);
      const upNew = moved.clone().normalize();
      tangent.addScaledVector(upNew, -tangent.dot(upNew));
      radial -= bullet.gravity * dt;
      const h0 = bullet.position.length() - radius;
      const h1 = h0 + radial * dt;
      const drag = Math.pow(DRAG, dt * 60);
      tangent.multiplyScalar(drag);
      radial *= drag;
      const next = upNew.clone().multiplyScalar(Math.max(radius * 0.25, radius + h1));
      const velocity = tangent.addScaledVector(upNew, radial);
      return { next: next, velocity: velocity, h0: h0, h1: h1 };
    }

    function playerHit(bullet, from, to) {
      if (bullet.owner !== 'enemy' || !handlers.playerCapsule) return null;
      const cap = handlers.playerCapsule();
      if (!cap) return null;
      const hit = segmentSegment(from, to, cap.feet, cap.head);
      if (hit.dist > cap.radius) return null;
      return hit.s;
    }

    function applyHit(bullet, col) {
      if (col && col.kind === 'enemy') {
        if (bullet.owner === 'enemy') return;
        const died = handlers.onEnemy && handlers.onEnemy(col.ref, bullet.damage);
        if (Audio) Audio.hit();
        if (died && Audio) Audio.kill();
        return;
      }
      if (col && col.kind === 'block' && handlers.onBlock) handlers.onBlock(col.ref);
      if (col && col.kind === 'bench' && handlers.onBench) handlers.onBench(col.ref, bullet.damage);
      if (!col && bullet.owner === 'enemy' && handlers.onPlayer) {
        handlers.onPlayer(bullet.damage);
        if (Audio) Audio.hit();
      }
    }

    function destroy(bullet) {
      scene.remove(bullet.mesh);
      scene.remove(bullet.trail);
      const index = bullets.indexOf(bullet);
      if (index >= 0) bullets.splice(index, 1);
    }

    function spawn(spec) {
      const color = spec.color == null ? 0xffd76a : spec.color;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 6, 4),
        new THREE.MeshBasicMaterial({ color: color })
      );
      const trailGeom = new THREE.BufferGeometry().setFromPoints([
        spec.position.clone(),
        spec.position.clone(),
      ]);
      const trail = new THREE.Line(
        trailGeom,
        new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.75 })
      );
      trail.frustumCulled = false;
      mesh.position.copy(spec.position);
      scene.add(mesh);
      scene.add(trail);
      const velocity = spec.direction.clone().normalize().multiplyScalar(spec.speed || 0);
      const bullet = {
        mesh: mesh,
        trail: trail,
        position: spec.position.clone(),
        velocity: velocity,
        life: spec.life == null ? LIFE : spec.life,
        damage: spec.damage == null ? 15 : spec.damage,
        owner: spec.owner || 'player',
        ignore: spec.ignore || null,
        gravity: spec.gravity == null ? GRAVITY : spec.gravity,
      };
      bullets.push(bullet);
      return bullet;
    }

    function update(dt) {
      for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        bullet.hitPlayer = false;
        bullet.hitGround = false;
        const from = bullet.position.clone();
        const step = integrate(bullet, dt);
        let to = step.next;
        let stop = null;
        let stopT = 2;
        if (Colliders) {
          const hit = Colliders.segment(from, to, bullet.ignore);
          if (hit && hit.t < stopT) {
            stopT = hit.t;
            stop = hit.col;
          }
        }
        const bodyT = playerHit(bullet, from, to);
        if (bodyT != null && bodyT < stopT) {
          stopT = bodyT;
          stop = null;
          bullet.hitPlayer = true;
        } else {
          bullet.hitPlayer = false;
        }
        if (step.h1 <= 0) {
          const drop = step.h0 - step.h1;
          const groundT = drop > 1e-6 ? Math.max(0, Math.min(1, step.h0 / drop)) : 0;
          if (groundT < stopT) {
            stopT = groundT;
            stop = null;
            bullet.hitPlayer = false;
            bullet.hitGround = true;
          }
        }
        if (stopT <= 1) {
          bullet.position.copy(from).lerp(to, Math.max(0, Math.min(1, stopT)));
          bullet.mesh.position.copy(bullet.position);
          if (bullet.hitPlayer) applyHit(bullet, null);
          else if (!bullet.hitGround) applyHit(bullet, stop);
          destroy(bullet);
          continue;
        }
        bullet.position.copy(to);
        bullet.velocity.copy(step.velocity);
        bullet.mesh.position.copy(to);
        bullet.life -= dt;
        const attr = bullet.trail.geometry.attributes.position;
        const back = bullet.velocity.clone().multiplyScalar(0.04);
        attr.setXYZ(0, to.x, to.y, to.z);
        attr.setXYZ(1, to.x - back.x, to.y - back.y, to.z - back.z);
        attr.needsUpdate = true;
        if (bullet.life <= 0) destroy(bullet);
      }
    }

    return {
      spawn: spawn,
      update: update,
      setHandlers(next) { handlers = next || {}; },
      dispose() {
        while (bullets.length) destroy(bullets[0]);
      },
    };
  };
})();
