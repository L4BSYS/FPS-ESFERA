// js/22-neural-fauna.js. LaGrieta FPS — fauna neuronal: criaturas ambientales
// que expresan lo que hacen y cumplen una función con la luz y los recursos.
// Usa NeuralNetwork de 20-neuralnet.js. Scripts clásicos: comparten globals.

const FAUNA_INPUTS = 8;
const FAUNA_OUTPUTS = 3;

const FAUNA_STATES = {
  dormida:     { text: 'zZ  dormida',     color: 0x8a7dff, css: '#8a7dff' },
  explorando:  { text: '✦  explorando',   color: 0x6fe3ff, css: '#6fe3ff' },
  curiosa:     { text: '?  curiosa',      color: 0xffd166, css: '#ffd166' },
  asustada:    { text: '!  asustada',     color: 0xff5d73, css: '#ff5d73' },
  polinizando: { text: '✿  polinizando',  color: 0x7dff8a, css: '#7dff8a' }
};

let neuralFauna = [];
let neuralNpcAcc = 0;
let faunaPollinateAcc = 0;
const faunaPollinated = new Map();

function neuralIsDark() {
  if (typeof AMB === 'undefined' || !AMB || !AMB.current) return false;
  if (AMB.name === 'night' || AMB.name === 'void' || AMB.name === 'blood') return true;
  if (AMB.name === 'cycle') {
    try { return ambCycleSpecAt(AMB.time).ambient < 0.22; } catch (e) {}
  }
  return AMB.current.ambient < 0.22;
}

// ------------------------------------------------------------
//  Etiqueta flotante: dice qué está haciendo la criatura
// ------------------------------------------------------------
function faunaRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeFaunaLabel() {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true });
    const sprite = new THREE.Sprite(mat);
    sprite.name = 'CreatureLabel';
    sprite.scale.set(2.7, 0.68, 1);
    sprite.position.set(0, 1.85, 0);
    sprite.raycast = function () {};
    return { canvas: canvas, ctx: canvas.getContext('2d'), tex: tex, sprite: sprite, style: null };
  } catch (e) {
    return null;
  }
}

function paintFaunaLabel(label, state) {
  if (!label || !label.ctx || label.style === state) return;
  const st = FAUNA_STATES[state] || FAUNA_STATES.explorando;
  label.style = state;
  const ctx = label.ctx;
  const w = label.canvas.width, h = label.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(5,8,16,0.78)';
  faunaRoundRect(ctx, 4, 6, w - 8, h - 12, 20);
  ctx.fill();
  ctx.strokeStyle = st.css;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = 'bold 27px "Trebuchet MS", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(st.text, w / 2, h / 2 + 1);
  label.tex.needsUpdate = true;
}

// ------------------------------------------------------------
//  Polinización: las criaturas marcan recursos y mejoran la cosecha
// ------------------------------------------------------------
function faunaSetNodeGlow(node, on) {
  if (!node) return;
  try {
    node.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m || !m.emissive) return;
        if (on) {
          if (m.userData._baseEmissive === undefined) m.userData._baseEmissive = m.emissive.getHex();
          m.emissive.setHex(0x2f8f4a);
          m.emissiveIntensity = 0.7;
        } else {
          m.emissive.setHex(m.userData._baseEmissive || 0x000000);
          m.emissiveIntensity = 1;
        }
      });
    });
  } catch (e) {}
}

function markFaunaPollinated(node) {
  if (!node || !node.userData) return;
  node.userData.pollinatedUntil = performance.now() + 3000;
  if (!faunaPollinated.has(node)) {
    faunaPollinated.set(node, true);
    faunaSetNodeGlow(node, true);
  }
}

function updateFaunaPollination(delta) {
  if (!faunaPollinated.size) return;
  faunaPollinateAcc += delta;
  if (faunaPollinateAcc < 0.5) return;
  faunaPollinateAcc = 0;
  const now = performance.now();
  faunaPollinated.forEach(function (_v, node) {
    if (!node || !node.parent || !node.userData || (node.userData.pollinatedUntil || 0) < now) {
      faunaSetNodeGlow(node, false);
      faunaPollinated.delete(node);
    }
  });
}

function clearFaunaPollination() {
  faunaPollinated.forEach(function (_v, node) { faunaSetNodeGlow(node, false); });
  faunaPollinated.clear();
  faunaPollinateAcc = 0;
}

// ------------------------------------------------------------
//  Criatura ambiental
// ------------------------------------------------------------
class AmbientCreature {
  constructor(x, z, size, dark, withLight) {
    this.size = size || 120;
    this.dark = !!dark;
    this.baseY = 3.0 + Math.random() * 4.2;
    this.phase = Math.random() * Math.PI * 2;
    this.heading = Math.random() * Math.PI * 2;
    this.speed = 1.1 + Math.random() * 1.3;
    this.orbitDir = Math.random() < 0.5 ? -1 : 1;
    this.brain = new NeuralNetwork(FAUNA_INPUTS, [6, 6], FAUNA_OUTPUTS, false, { connectionDensity: 0.9 });
    this.brainTimer = 0;
    this.out = [0.5, 0.6, 0.5];
    this.state = 'explorando';
    this.scanTimer = 0;
    this.nearNode = null;
    this.light = null;
    this.label = null;
    this.chirpTimer = 2 + Math.random() * 9;
    this.voicePitch = 0.82 + Math.random() * 0.46;

    const hue = this.dark ? (0.5 + Math.random() * 0.25) : Math.random();
    const col = new THREE.Color().setHSL(hue, 0.85, this.dark ? 0.6 : 0.55);
    this.baseColor = col.clone();
    this.moodColor = col.clone();
    this.tmpColor = new THREE.Color();

    this.group = new THREE.Group();
    this.group.name = 'AmbientCreature';

    this.shellMat = new THREE.MeshStandardMaterial({
      color: col, emissive: col, emissiveIntensity: this.dark ? 1.7 : 0.45,
      transparent: true, opacity: 0.66, roughness: 0.2, metalness: 0.15, flatShading: true
    });
    this.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 0), this.shellMat);
    this.shell.castShadow = false;
    this.group.add(this.shell);

    this.coreMat = new THREE.MeshBasicMaterial({ color: col });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.31, 12, 8), this.coreMat);
    this.group.add(this.core);

    this.ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6 });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.045, 6, 28), this.ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.group.add(this.ring);

    if (withLight) {
      this.light = new THREE.PointLight(col.getHex(), 0.0, 11, 2);
      this.group.add(this.light);
    }

    this.label = makeFaunaLabel();
    if (this.label) {
      this.group.add(this.label.sprite);
      paintFaunaLabel(this.label, this.state);
    }

    this.group.position.set(x, this.baseY, z);
    scene.add(this.group);
  }

  setState(next) {
    if (next === this.state) return;
    this.state = next;
    paintFaunaLabel(this.label, next);
  }

  scanResources(px, pz) {
    this.nearNode = null;
    if (typeof resourceNodes === 'undefined') return;
    let best = 99;
    for (let i = 0; i < resourceNodes.length; i++) {
      const n = resourceNodes[i];
      if (!n || !n.visible || n.isHarvested) continue;
      const d = Math.hypot(px - n.position.x, pz - n.position.z);
      if (d < 9 && d < best) { best = d; this.nearNode = n; }
    }
  }

  update(delta) {
    const now = performance.now();
    const px = this.group.position.x;
    const pz = this.group.position.z;
    const p = (typeof player !== 'undefined' && player) ? player.container.position : null;
    const dPlayer = p ? Math.hypot(px - p.x, pz - p.z) : 9997;
    const ambient = (typeof AMB !== 'undefined' && AMB && AMB.current) ? AMB.current.ambient : 0.5;
    const dark = ambient < 0.24;

    this.brainTimer += delta;
    if (this.brainTimer >= 0.2) {
      this.brainTimer = 0;
      const half = this.size / 2;
      const edge = Math.max(0, Math.min(half - Math.abs(px), half - Math.abs(pz))) / half;
      try {
        this.out = this.brain.activate([
          Math.max(0, Math.min(1, edge)),
          px / half,
          pz / half,
          Math.sin(now * 0.0005),
          Math.cos(now * 0.0007),
          Math.random(),
          Math.min(1, this.baseY / 8),
          Math.max(0, Math.min(1, ambient * 4))
        ]);
      } catch (e) {}
    }

    this.scanTimer += delta;
    if (this.scanTimer >= 0.35) {
      this.scanTimer = 0;
      this.scanResources(px, pz);
    }

    // --- Elegir qué está haciendo ---
    let state = 'explorando';
    if (dPlayer < 4.2) state = 'asustada';
    else if (this.nearNode) state = 'polinizando';
    else if (ambient > 0.42 && dPlayer > 14 && Math.sin(now * 0.00013 + this.phase) > 0.35) state = 'dormida';
    else if (dark && dPlayer > 5 && dPlayer < 18) state = 'curiosa';
    this.setState(state);

    // --- Movimiento según la conducta ---
    let targetHeading = this.heading;
    let moveSpeed = 0;
    if (state === 'asustada' && p) {
      const dx = px - p.x, dz = pz - p.z;
      const len = Math.hypot(dx, dz) || 1;
      targetHeading = Math.atan2(dx / len, dz / len);
      moveSpeed = 3.4;
    } else if (state === 'polinizando' && this.nearNode) {
      const n = this.nearNode;
      const dx = n.position.x - px, dz = n.position.z - pz;
      const d = Math.hypot(dx, dz) || 1;
      if (d > 3.2) {
        targetHeading = Math.atan2(dx / d, dz / d);
        moveSpeed = 1.5;
      } else {
        targetHeading = Math.atan2(dx / d, dz / d) + (Math.PI / 2) * this.orbitDir;
        moveSpeed = 1.0;
      }
      markFaunaPollinated(n);
    } else if (state === 'curiosa' && p) {
      const dx = p.x - px, dz = p.z - pz;
      const d = Math.hypot(dx, dz) || 1;
      if (d > 5.5) {
        targetHeading = Math.atan2(dx / d, dz / d);
        moveSpeed = 1.0;
      } else {
        targetHeading = Math.atan2(dx / d, dz / d) + Math.PI / 2;
        moveSpeed = 0.45;
      }
    } else if (state === 'dormida') {
      targetHeading = this.heading + Math.sin(now * 0.0002 + this.phase) * 0.15;
      moveSpeed = 0.06;
    } else {
      targetHeading = this.heading + (this.out[0] - 0.5) * 3.2 * delta;
      moveSpeed = Math.max(0, this.out[1] - 0.45) * 2.4 * this.speed;
    }

    let dh = ((targetHeading - this.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.heading += dh * Math.min(1, delta * (state === 'asustada' ? 8 : 3.5));
    this.group.position.x += Math.sin(this.heading) * moveSpeed * delta;
    this.group.position.z += Math.cos(this.heading) * moveSpeed * delta;

    // Paredes del mundo
    const lim = Math.max(6, this.size / 2 - 6);
    if (this.group.position.x > lim) { this.group.position.x = lim; this.heading += Math.PI * 0.6; }
    if (this.group.position.x < -lim) { this.group.position.x = -lim; this.heading += Math.PI * 0.6; }
    if (this.group.position.z > lim) { this.group.position.z = lim; this.heading += Math.PI * 0.6; }
    if (this.group.position.z < -lim) { this.group.position.z = -lim; this.heading += Math.PI * 0.6; }

    // Flotación y balanceo (más lento si duerme)
    const bobRate = state === 'dormida' ? 0.35 : (1.1 + this.out[2]);
    const bobAmp = state === 'dormida' ? 0.18 : 0.9;
    this.phase += delta * bobRate;
    this.group.position.y = this.baseY + Math.sin(this.phase) * bobAmp;
    this.group.rotation.y += delta * 0.6;
    this.group.rotation.x = Math.sin(this.phase * 0.7) * 0.25;
    if (this.ring) this.ring.rotation.z += delta * 1.6 * (state === 'dormida' ? 0.3 : 1);
    if (this.shell) {
      const s = 1 + Math.sin(this.phase * 1.7) * 0.06;
      this.shell.scale.set(s, s, s);
    }

    // Color expresivo según conducta y luz
    if (state === 'explorando') {
      this.tmpColor.copy(this.baseColor);
      if (dark) this.tmpColor.lerp(new THREE.Color(0x66ccff), 0.3);
    } else {
      this.tmpColor.setHex(FAUNA_STATES[state].color);
    }
    this.moodColor.lerp(this.tmpColor, 1 - Math.exp(-delta * 3));
    this.shellMat.color.copy(this.moodColor);
    this.shellMat.emissive.copy(this.moodColor);
    this.coreMat.color.copy(this.moodColor);
    this.ringMat.color.copy(this.moodColor);

    let glow = dark ? 1.5 : 0.45;
    if (state === 'polinizando') glow += 0.5;
    if (state === 'asustada') glow += 0.35;
    this.shellMat.emissiveIntensity = glow + Math.sin(this.phase * 2) * 0.15;

    // Luz: de noche iluminan el entorno; de día casi no se ven
    if (this.light) {
      this.light.color.copy(this.moodColor);
      this.light.intensity = Math.max(0, (0.32 - ambient) * 3.0) +
        (state === 'polinizando' ? 0.25 : 0) + Math.sin(this.phase * 2) * 0.08;
      this.light.visible = this.light.intensity > 0.03;
    }

    // Chirp ambiental ocasional, espacializado
    this.chirpTimer = (this.chirpTimer || 0) - delta;
    if (this.chirpTimer <= 0) {
      const alert = state === 'asustada';
      const curious = state === 'curiosa' || state === 'polinizando';
      this.chirpTimer = (alert ? 2.5 : curious ? 4.5 : 7) + Math.random() * 8;
      if (state !== 'dormida' && dPlayer < 38 && typeof playSoundAt === 'function') {
        try {
          playSoundAt('fauna_chirp', this.group.position, {
            gain: alert ? 0.6 : curious ? 0.45 : 0.32,
            maxDist: 38,
            pitch: this.voicePitch,
            alert: alert
          });
        } catch (e) {}
      }
    }

    // Etiqueta: visible de cerca, se desvanece con la distancia
    if (this.label) {
      const vis = dPlayer < 30;
      this.label.sprite.visible = vis;
      if (vis) this.label.sprite.material.opacity = Math.max(0, Math.min(1, (34 - dPlayer) / 10));
    }
  }

  dispose() {
    try {
      scene.remove(this.group);
      this.group.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(function (m) { m.dispose(); });
          else o.material.dispose();
        }
      });
      if (this.label && this.label.tex) this.label.tex.dispose();
    } catch (e) {}
  }
}

function clearNeuralFauna() {
  clearFaunaPollination();
  neuralFauna.forEach(function (c) { try { c.dispose(); } catch (e) {} });
  neuralFauna = [];
}

function spawnNeuralFauna(def) {
  clearNeuralFauna();
  if (typeof scene === 'undefined' || !scene) return;
  const size = (def && def.size) || 120;
  const half = Math.max(8, size / 2 - 10);
  const dark = neuralIsDark();
  let count = Math.round(size / 45);
  count = Math.max(2, Math.min(6, count));
  for (let i = 0; i < count; i++) {
    const x = (Math.random() * 2 - 1) * half;
    const z = (Math.random() * 2 - 1) * half;
    const withLight = i < (dark ? 3 : 2);
    try { neuralFauna.push(new AmbientCreature(x, z, size, dark, withLight)); } catch (e) { console.warn('fauna', e); }
  }
}

// ------------------------------------------------------------
//  Cerebros de enemigos (vagar + atacar bases)
// ------------------------------------------------------------
function ensureNpcBrain(npc) {
  if (!npc) return;
  if (!npc.brain) {
    try {
      npc.brain = new NeuralNetwork(8, [6, 6], 3, false, { connectionDensity: 0.85 });
      npc.brainOut = [0.5, 0.5, 0.5];
      npc.brainTimer = 0;
    } catch (e) { return; }
  }
  if (!npc.homePos) npc.homePos = npc.container.position.clone();
}

function updateEnemyBrains(delta) {
  neuralNpcAcc += delta;
  if (neuralNpcAcc < 0.2) return;
  neuralNpcAcc = 0;
  if (typeof npcs === 'undefined') return;
  const p = (typeof player !== 'undefined') ? player : null;
  npcs.forEach(function (npc) {
    if (!npc || npc.health <= 0 || !npc.container || !npc.container.parent) return;
    ensureNpcBrain(npc);
    if (!npc.brain) return;
    const pos = npc.container.position;
    let distP = 999, los = 0;
    if (p) {
      distP = pos.distanceTo(p.container.position);
      try { los = npc.hasLineOfSight(p, collidableObjects) ? 1 : 0; } catch (e) {}
    }
    let wbD = 999;
    try {
      for (const wb of workbenches) {
        if (!wb || wb.hp <= 0) continue;
        wbD = Math.min(wbD, pos.distanceTo(wb.pos));
      }
    } catch (e) {}

    let blocked = 0;
    try {
      const origin = pos.clone(); origin.y += (npc.height || 1.6) * 0.5;
      const fwd = new THREE.Vector3(0, 0, -1).applyEuler(npc.container.rotation).normalize();
      const ray = new THREE.Raycaster(origin, fwd, 0, 2.2);
      blocked = ray.intersectObjects(collidableObjects, true).length ? 1 : 0;
    } catch (e) {}

    const light = (typeof AMB !== 'undefined' && AMB && AMB.current) ? AMB.current.ambient : 0.5;
    try {
      npc.brainOut = npc.brain.activate([
        Math.max(0, Math.min(1, 1 - distP / 45)),
        los,
        Math.max(0, Math.min(1, 1 - wbD / 45)),
        blocked,
        Math.max(0, Math.min(1, npc.health / (npc.maxHealth || 100))),
        Math.max(0, Math.min(1, (npc.energy || 0) / (npc.maxEnergy || 100))),
        Math.sin(performance.now() * 0.0004),
        Math.max(0, Math.min(1, light * 4))
      ]);
    } catch (e) {}

    // Curiosidad por la base: si hay una mesa cerca y no hay jugador más cerca, va a atacarla.
    if (!npc.baseHunt && wbD < 26 && wbD < distP + 8) {
      try {
        for (const wb of workbenches) {
          if (!wb || wb.hp <= 0) continue;
          if (pos.distanceTo(wb.pos) < 26) { npc.baseHunt = wb; break; }
        }
      } catch (e) {}
      if (npc.baseHunt && (npc.state === 'idle' || npc.state === 'wandering')) npc.state = 'chasing';
    }
  });
}

function updateNeuralFauna(delta) {
  for (let i = neuralFauna.length - 1; i >= 0; i--) {
    const c = neuralFauna[i];
    if (!c) { neuralFauna.splice(i, 1); continue; }
    try { c.update(delta); } catch (e) { try { c.dispose(); } catch (e2) {} neuralFauna.splice(i, 1); }
  }
  updateFaunaPollination(delta);
  updateEnemyBrains(delta);
}
