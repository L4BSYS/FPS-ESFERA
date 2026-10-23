// js/02-systems.js (part 2/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Wave respawn system: new wave spawns a few seconds after all enemies die ---
const ENEMY_SPAWN_POINTS = [
  new THREE.Vector3(20, 0, 30),
  new THREE.Vector3(25, 0, 25),
  new THREE.Vector3(30, 0, 20)
];
let waveNumber = 0;
let waveRespawnAt = 0;

// --- Creator mode: god building (fly, free placement, place props, passive enemies) ---
let creatorMode = false;
let creatorPlaceMode = { kind: 'block', id: 'wood' };
let worldItems = [];    // placed pickup/item models (creator + scene)
let resourceNodes = []; // placed resource nodes (creator + scene)
let creatorBaseReach = null;

// --- Tótems de info (E para leer, reemplazan carteles gigantes) ---
let totems = [];
function escHtml(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function placeTotem(lines, x, z) {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6f6f73, roughness: 0.95 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: 0x4a4a4e, roughness: 0.95 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x9a7b46, roughness: 0.9 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.26, 12), stoneMat);
  base.position.y = 0.13;
  const baseStep = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.16, 12), stoneDark);
  baseStep.position.y = 0.34;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.7, 9), woodMat);
  pole.position.y = 1.2;
  const rope1 = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 12), ropeMat);
  rope1.rotation.x = Math.PI / 2; rope1.position.y = 1.05;
  const rope2 = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 12), ropeMat);
  rope2.rotation.x = Math.PI / 2; rope2.position.y = 1.3;
  // Runa lateral
  const runeMat = new THREE.MeshStandardMaterial({ color: 0x4CAF50, emissive: 0x1a5c1a, emissiveIntensity: 0.7, roughness: 0.4 });
  const runeL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.05), runeMat);
  runeL.position.set(-0.5, 1.5, 0);
  const runeR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.05), runeMat);
  runeR.position.set(0.5, 1.5, 0);
  const top = new THREE.Mesh(new THREE.OctahedronGeometry(0.26),
      new THREE.MeshStandardMaterial({ color: 0x66e06a, emissive: 0x2fbf3a, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.2 }));
  top.position.y = 2.35;
  const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 16),
      new THREE.MeshStandardMaterial({ color: 0xffcf6b, metalness: 0.85, roughness: 0.3 }));
  topRing.rotation.x = Math.PI / 2; topRing.position.y = 2.1;

  [base, baseStep, pole, rope1, rope2, runeL, runeR, top, topRing].forEach(m => { m.castShadow = true; g.add(m); });
  g.position.set(x, 0, z);
  const tb = { lines: lines.slice(0, 4), mesh: g, top, pos: new THREE.Vector3(x, 0, z) };
  g.userData.isTotem = true;
  g.userData.totemRef = tb;
  g.userData.solid = true;
  g.isStatic = true;
  try { g.updateMatrixWorld(true); g.userData.worldBoundingBox = new THREE.Box3().setFromObject(g, true); } catch (e) {}
  scene.add(g);
  if (typeof collidableObjects !== 'undefined' && collidableObjects.indexOf(g) === -1) collidableObjects.push(g);
  totems.push(tb);
  return tb;
}
var currentTotem = null;
var totemOpen = false;
function toggleTotem(open, tb) {
  const modal = document.getElementById('totemModal');
  if (!modal) return;
  if (open) {
      currentTotem = tb || currentTotem;
      if (!currentTotem) return;
      if (typeof invOpen !== 'undefined' && invOpen) toggleInventory();
      if (typeof benchOpen !== 'undefined' && benchOpen) toggleBench(false);
      if (typeof pauseMenu !== 'undefined' && pauseMenu) pauseMenu.style.display = 'none';
      isGamePaused = true;
      try { document.exitPointerLock(); } catch (e) {}
      const body = document.getElementById('totemBody');
      if (body) body.innerHTML = currentTotem.lines.map(l => '<div>' + escHtml(l) + '</div>').join('');
      modal.style.display = 'flex';
      totemOpen = true;
      openModal = 'totem';
  } else {
      modal.style.display = 'none';
      totemOpen = false;
      currentTotem = null;
      if (typeof openModal !== 'undefined' && openModal === 'totem') openModal = null;
      if ((typeof invOpen === 'undefined' || !invOpen) && (typeof benchOpen === 'undefined' || !benchOpen)) { isGamePaused = false; lockPointer(); }
  }
}
function tryOpenTotem() {
  if (typeof player === 'undefined' || !player || !totems.length) return false;
  const o = new THREE.Vector3(); camera.getWorldPosition(o);
  const d = camera.getWorldDirection(new THREE.Vector3());
  const ray = new THREE.Raycaster(o, d, 0.1, 3.4);
  const hits = ray.intersectObjects(totems.map(t => t.mesh), true);
  for (const h of hits) {
      let p = h.object, tb = null;
      while (p) {
          if (p.userData && p.userData.totemRef) { tb = p.userData.totemRef; break; }
          p = p.parent;
      }
      if (tb) {
          if (totemOpen && currentTotem === tb) toggleTotem(false);
          else toggleTotem(true, tb);
          return true;
      }
  }
  return false;
}

// --- Mesas de trabajo: la base a defender ---
let workbenches = [];
var currentBench = null;
var lastBenchDamageTs = 0;
var CLAIM_RADIUS = 14; // área reclamada alrededor de cada mesa
function buildClaimRing(radius) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.3, radius, 72),
    new THREE.MeshBasicMaterial({ color: 0xffb300, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.raycast = function () {};
  return ring;
}
function isInAnyClaim(pos) {
  if (!workbenches.length) return false;
  for (const wb of workbenches) {
    if (!wb || wb.hp <= 0) continue;
    const dx = pos.x - wb.pos.x, dz = pos.z - wb.pos.z;
    const r = wb.claimRadius || CLAIM_RADIUS;
    if (dx * dx + dz * dz <= r * r) return true;
  }
  return false;
}
function placeWorkbench(pos) {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x9a6a38, roughness: 0.8 });
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x7a4f24, roughness: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x4a3116, roughness: 0.9 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x6d7278, metalness: 0.75, roughness: 0.4 });
  const clothMat = new THREE.MeshStandardMaterial({ color: 0xffb300, roughness: 0.8, side: THREE.DoubleSide });

  const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 1.15), woodMat);
  top.position.y = 0.98; top.castShadow = true; top.receiveShadow = true;
  g.add(top);
  const plank1 = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.02, 0.03), plankMat);
  plank1.position.set(0, 1.05, 0.25); g.add(plank1);
  const plank2 = plank1.clone(); plank2.position.z = -0.25; g.add(plank2);

  const legMeshes = [];
  [[-0.85, -0.48], [0.85, -0.48], [-0.85, 0.48], [0.85, 0.48]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.98, 0.13), darkMat);
      leg.position.set(x, 0.49, z); leg.castShadow = true;
      g.add(leg);
      legMeshes.push(leg);
  });
  const braceA = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.08), darkMat);
  braceA.position.set(0, 0.3, -0.48); g.add(braceA);
  const braceB = braceA.clone(); braceB.position.z = 0.48; g.add(braceB);
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.9), plankMat);
  shelf.position.set(0, 0.55, 0); shelf.castShadow = true; g.add(shelf);

  const vice = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.32), metalMat);
  vice.position.set(-0.55, 1.18, 0); vice.castShadow = true;
  g.add(vice);
  const viceJaw = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.07, 0.22), metalMat);
  viceJaw.position.set(-0.55, 1.33, 0); g.add(viceJaw);

  // Herramienta apoyada sobre la mesa
  const toolHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.42, 7), woodMat);
  toolHandle.rotation.z = Math.PI / 2; toolHandle.position.set(0.45, 1.09, 0.15); g.add(toolHandle);
  const toolHead = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.08), metalMat);
  toolHead.position.set(0.72, 1.09, 0.15); g.add(toolHead);

  // Mástil con bandera: marca tu base reclamada
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.5, 7), metalMat);
  flagPole.position.set(0.95, 1.75, -0.5); flagPole.castShadow = true; g.add(flagPole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.34), clothMat);
  flag.position.set(1.22, 2.3, -0.5); g.add(flag);

  g.position.copy(pos);
  g.position.y = Math.max(0.05, pos.y);
  const wb = { isWorkbench: true, name: 'Mesa de trabajo', mesh: g, pos: g.position.clone(), hp: 300, maxHp: 300, height: 1.6, bar: null, solids: [], ring: null, claimRadius: CLAIM_RADIUS };
  g.userData.isWorkbench = true;
  g.userData.benchRef = wb;

  // Anillo que marca la zona de construcción reclamada
  const ring = buildClaimRing(CLAIM_RADIUS);
  g.add(ring);
  wb.ring = ring;

  const barMat = new THREE.SpriteMaterial({ color: 0x4CAF50 });
  const bar = new THREE.Sprite(barMat);
  bar.scale.set(1.6, 0.12, 1);
  bar.position.set(0, 2.1, 0);
  bar.raycast = function () {};
  g.add(bar);
  wb.bar = bar;
  wb.solids = [top, vice, viceJaw, shelf, braceA, braceB, ...legMeshes];
  scene.add(g);
  // Register only solid meshes: the Group/Sprite/Ring break raycasts and physics
  // that assume Mesh entries (sprite raycast throws without raycaster.camera)
  wb.solids.forEach(m => { if (!collidableObjects.includes(m)) collidableObjects.push(m); });
  if (!workbenches.includes(wb)) workbenches.push(wb);
  updateBenchBar(wb);
  try { cancelZoneDecay(g.position.x, g.position.z); } catch (e) {}
  return wb;
}
function updateBenchBar(wb) {
  if (!wb || !wb.bar) return;
  const r = Math.max(0, Math.min(1, wb.hp / wb.maxHp));
  wb.bar.scale.x = 1.6 * r;
  wb.bar.material.color.set(r > 0.6 ? 0x4CAF50 : (r > 0.3 ? 0xFFA500 : 0xff3333));
}
function damageWorkbench(wb, n) {
  if (!wb || wb.hp <= 0) return;
  wb.hp -= n;
  lastBenchDamageTs = performance.now();
  updateBenchBar(wb);
  if (wb.hp <= 0) {
      wb.hp = 0;
      destroyBench(wb, false);
  }
}
function destroyBench(wb, quiet) {
  if (!wb) return;
  try {
      scene.remove(wb.mesh);
      (wb.solids || []).forEach(m => {
          const i = collidableObjects.indexOf(m);
          if (i > -1) collidableObjects.splice(i, 1);
      });
      const j = workbenches.indexOf(wb);
      if (j > -1) workbenches.splice(j, 1);
  } catch (e) {}
  if (typeof currentBench !== 'undefined' && currentBench === wb) {
      currentBench = null;
      if (typeof benchOpen !== 'undefined' && benchOpen) toggleBench(false);
  }
  if (!quiet) {
      showPlacementMessage('¡Destruyeron tu mesa de trabajo! Los bloques van a decaer...');
      try { playSound('explosion'); } catch (e) {}
      try { if (typeof startZoneDecay === 'function') startZoneDecay(wb); } catch (e) {}
  } else {
      showPlacementMessage('Saqué: mesa de trabajo');
  }
}
function refreshBenchModal() {
  const wb = (typeof currentBench !== 'undefined') ? currentBench : null;
  const txt = document.getElementById('benchHpTxt');
  const bar = document.getElementById('benchHpBar');
  if (!wb) { if (txt) txt.textContent = '—'; return; }
  if (txt) txt.textContent = Math.max(0, Math.round(wb.hp)) + ' / ' + wb.maxHp;
  if (bar) {
      const r = Math.max(0, wb.hp / wb.maxHp);
      bar.style.width = (r * 100) + '%';
      bar.style.background = r > 0.6 ? '#4CAF50' : (r > 0.3 ? '#FFA500' : '#ff3333');
  }
}
function repairBench() {
  const wb = (typeof currentBench !== 'undefined') ? currentBench : null;
  if (!wb || wb.hp <= 0) return;
  const inv = (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
  if (!inv) return;
  if (wb.hp >= wb.maxHp) { setCraftStatus('La mesa ya está entera'); return; }
  if ((inv.resources.wood || 0) < 3 || (inv.resources.stone || 0) < 2) {
      setCraftStatus('Te faltan materiales (3 madera + 2 piedra)');
      return;
  }
  inv.resources.wood -= 3; inv.resources.stone -= 2;
  wb.hp = Math.min(wb.maxHp, wb.hp + 100);
  updateBenchBar(wb);
  refreshBenchModal();
  try { updateResourceHUD(); playSound('health-regen'); } catch (e) {}
  setCraftStatus('Mesa reparada (+100)');
}
function toggleBench(open, wb) {
  const modal = document.getElementById('benchModal');
  if (!modal) return;
  if (open) {
      currentBench = wb || currentBench;
      if (!currentBench || currentBench.hp <= 0) return;
      if (typeof invOpen !== 'undefined' && invOpen) toggleInventory();
      if (typeof pauseMenu !== 'undefined' && pauseMenu) pauseMenu.style.display = 'none';
      isGamePaused = true;
      try { document.exitPointerLock(); } catch (e) {}
      renderCraftButtons(document.getElementById('benchCraft'), 'bench');
      try { renderMaterialChips(document.getElementById('benchFoot')); } catch (e) {}
      refreshBenchModal();
      try { refreshCraftUI(); } catch (e) {}
      modal.style.display = 'flex';
      benchOpen = true;
      openModal = 'bench';
  } else {
      modal.style.display = 'none';
      benchOpen = false;
      currentBench = null;
      if (typeof openModal !== 'undefined' && openModal === 'bench') openModal = null;
      if (typeof invOpen === 'undefined' || !invOpen) { isGamePaused = false; lockPointer(); }
  }
}
function tryOpenWorkbench() {
  if (typeof player === 'undefined' || !player || !workbenches.length) return false;
  const o = new THREE.Vector3(); camera.getWorldPosition(o);
  const d = camera.getWorldDirection(new THREE.Vector3());
  const ray = new THREE.Raycaster(o, d, 0.1, 3.2);
  const hits = ray.intersectObjects(workbenches.map(w => w.mesh), true);
  for (const h of hits) {
      let p = h.object, wb = null;
      while (p) {
          if (p.userData && p.userData.benchRef) { wb = p.userData.benchRef; break; }
          p = p.parent;
      }
      if (wb && wb.hp > 0) { toggleBench(true, wb); return true; }
  }
  return false;
}

// --- Colocación con vista previa (mesa de trabajo y futuras estructuras) ---
var pendingPlacement = null;
function buildWorkbenchGhost(withRing) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x00ff66, transparent: true, opacity: 0.4, depthWrite: false });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 1.15), mat);
  top.position.y = 0.98;
  g.add(top);
  const legGeo = new THREE.BoxGeometry(0.13, 0.98, 0.13);
  [[-0.85, -0.48], [0.85, -0.48], [-0.85, 0.48], [0.85, 0.48]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(x, 0.49, z);
      g.add(leg);
  });
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.9), mat);
  shelf.position.y = 0.55;
  g.add(shelf);
  const vice = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.32), mat);
  vice.position.set(-0.55, 1.18, 0);
  g.add(vice);
  const ring = new THREE.Mesh(new THREE.RingGeometry(CLAIM_RADIUS - 0.3, CLAIM_RADIUS, 72), 
      new THREE.MeshBasicMaterial({ color: 0x00ff66, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  if (withRing !== false) g.add(ring);
  return g;
}
function clearPlacementGhost() {
  if (pendingPlacement && pendingPlacement.ghost) {
      try { scene.remove(pendingPlacement.ghost); } catch (e) {}
  }
}
// opts: { label, cost, radius, buildGhost:()=>Object3D, place:(pos)=>bool }
function startPlacement(opts) {
  cancelPlacement(true);
  let ghost = null;
  try { ghost = opts.buildGhost ? opts.buildGhost() : null; } catch (e) { console.error(e); }
  if (ghost) {
      ghost.raycast = function () {};
      ghost.traverse(o => { o.raycast = function () {}; });
      ghost.visible = false;
      scene.add(ghost);
  }
  pendingPlacement = {
      label: opts.label || 'objeto',
      cost: opts.cost || null,
      radius: opts.radius || 1.2,
      snapGround: !!opts.snapGround,
      ghost: ghost,
      place: opts.place,
      lastPos: null,
      lastOk: false
  };
  try { showMessage('Clic para colocar ' + pendingPlacement.label + ' · clic derecho cancela'); } catch (e) {}
}
function updatePlacementGhost() {
  if (!pendingPlacement) return;
  if (typeof player === 'undefined' || !player || isGamePaused) {
      if (pendingPlacement.ghost) pendingPlacement.ghost.visible = false;
      return;
  }
  let p;
  try { p = creatorAimPoint(); } catch (e) { return; }
  if (pendingPlacement.snapGround) {
      p.y = groundTopY(p.x, p.z) + 0.05;
  } else {
      p.y = Math.max(0.05, Math.round(p.y * 100) / 100);
  }
  pendingPlacement.lastPos = p;
  const ok = ghostFits(p, pendingPlacement.radius);
  pendingPlacement.lastOk = ok;
  const g = pendingPlacement.ghost;
  if (g) {
      g.position.copy(p);
      g.visible = true;
      g.traverse(o => { if (o.isMesh && o.material && o.material.color) o.material.color.setHex(ok ? 0x00ff66 : 0xff3333); });
  }
}
function confirmPlacement() {
  if (!pendingPlacement) return false;
  if (pendingPlacement.lastOk === false) {
      showPlacementMessage('No se puede colocar acá — buscá un lugar libre');
      return true;
  }
  const pos = (pendingPlacement.lastPos || creatorAimPoint()).clone();
  const fn = pendingPlacement.place;
  const cost = pendingPlacement.cost;
  const label = pendingPlacement.label;
  clearPlacementGhost();
  pendingPlacement = null;
  let ok = false;
  try { ok = fn(pos) !== false; } catch (e) { console.error(e); }
  if (!ok && cost) refundPlacementCost(cost);
  showPlacementMessage(ok ? ('Colocaste: ' + label) : 'No se pudo colocar');
  return true;
}
function cancelPlacement(refund) {
  if (!pendingPlacement) return false;
  const cost = pendingPlacement.cost;
  clearPlacementGhost();
  pendingPlacement = null;
  if (refund && cost) refundPlacementCost(cost);
  return true;
}
function refundPlacementCost(cost) {
  try {
      const inv = (typeof player !== 'undefined' && player) ? player.inventory : null;
      if (!inv) return;
      for (const k in cost) inv.resources[k] = (inv.resources[k] || 0) + cost[k];
      try { updateResourceHUD(); } catch (e) {}
      showPlacementMessage('Te devolví los materiales');
  } catch (e) {}
}

// --- Feedback de defensa de la base ---
function nearestWorkbench() {
  if (!workbenches.length || typeof player === 'undefined' || !player) return null;
  let best = null, bd = Infinity;
  for (const wb of workbenches) {
      if (!wb || wb.hp <= 0) continue;
      const d = player.container.position.distanceTo(wb.pos);
      if (d < bd) { bd = d; best = wb; }
  }
  return best ? { wb: best, dist: bd } : null;
}
function updateBaseHUD() {
  const el = document.getElementById('baseHud');
  if (!el) return;
  const near = nearestWorkbench();
  const under = (performance.now() - lastBenchDamageTs) < 3000;
  const show = near && !isGamePaused && (under || near.dist < 30);
  if (!show) {
      el.style.display = 'none';
      const bp = document.getElementById('basePointer');
      if (bp) bp.style.display = 'none';
      return;
  }
  el.style.display = 'block';
  const wb = near.wb;
  const r = Math.max(0, Math.min(1, wb.hp / wb.maxHp));
  const txt = document.getElementById('baseHpTxt');
  if (txt) txt.textContent = Math.max(0, Math.round(wb.hp)) + ' / ' + wb.maxHp;
  const bar = document.getElementById('baseHpBar');
  if (bar) {
      bar.style.width = (r * 100) + '%';
      bar.style.background = r > 0.6 ? '#4CAF50' : (r > 0.3 ? '#FFA500' : '#ff3333');
  }
  el.classList.toggle('under-attack', under);
  const dist = document.getElementById('baseDist');
  if (dist) dist.textContent = under ? '¡BAJO ATAQUE!' : (Math.round(near.dist) + ' m · E para reparar');
  updateBasePointer(near);
}
function updateBasePointer(near) {
  let el = document.getElementById('basePointer');
  if (!el) {
      el = document.createElement('div');
      el.id = 'basePointer';
      el.className = 'base-pointer';
      el.textContent = '▲';
      document.body.appendChild(el);
  }
  try {
      if (!camera) { el.style.display = 'none'; return; }
      const camPos = new THREE.Vector3();
      camera.getWorldPosition(camPos);
      const toBench = near.wb.pos.clone(); toBench.y += 1;
      const dir = toBench.sub(camPos);
      const fwd = camera.getWorldDirection(new THREE.Vector3());
      const d2 = new THREE.Vector3(dir.x, 0, dir.z).normalize();
      const f2 = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      const dot = d2.dot(f2);
      if (dot > 0.85 && near.dist < 12) { el.style.display = 'none'; return; }
      const ang = Math.atan2(d2.z * f2.x - d2.x * f2.z, dot);
      const rad = 110;
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      el.style.display = 'block';
      el.style.left = (cx + Math.sin(ang) * rad) + 'px';
      el.style.top = (cy - Math.cos(ang) * rad) + 'px';
      el.style.transform = 'translate(-50%,-50%) rotate(' + (ang * 180 / Math.PI) + 'deg)';
  } catch (e) { el.style.display = 'none'; }
}
function updateObjectiveHUD() {
  const el = document.getElementById('objectiveHud');
  if (!el) return;
  if (isGamePaused) { el.style.display = 'none'; return; }
  const inv = (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
  const hasHammer = inv && inv.items.some(i => i.toolType === 'hammer');
  const res = inv ? inv.resources : null;
  const resTotal = res ? ((res.wood || 0) + (res.stone || 0)) : 0;
  let txt;
  if (!hasHammer) {
      txt = resTotal < 6 ? '🪓 Cosechá madera y piedra (hacha y pico)' : '🔨 Crafteá un martillo (Q → Crafteo)';
  } else if (pendingPlacement) {
      txt = '📍 Apuntá y hacé clic para colocar tu base';
  } else if (!workbenches.length) {
      txt = '🛠 Crafteá y colocá tu mesa de trabajo (Q → Crafteo)';
  } else {
      txt = '🛡 Defendé tu base: construí alrededor y reparala con E';
  }
  if (el.textContent !== txt) el.textContent = txt;
  el.style.display = 'block';
}

// --- Creador: estructuras, spawns, barra en el mundo, fantasma ---
let placedStairs = [];
let placedDoors = [];
let placedStatics = []; // {kind, mesh, w,h,d,color}
function placeStaticBox(kind, pos, rotY, dims, color) {
  const defs = {
      platform: { w: 15, h: 1, d: 15, color: 0x8888ff },
      cube: { w: 3, h: 3, d: 3, color: 0x999999 },
      wall: { w: 5, h: 3, d: 1, color: 0xbbbbbb }
  };
  const def = defs[kind] || {};
  const w = (dims && dims.w) || def.w, h = (dims && dims.h) || def.h, d = (dims && dims.d) || def.d;
  const c = (typeof color !== 'undefined') ? color : def.color;
  if (!w || !h || !d || typeof c === 'undefined') return null;
  const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.1 })
  );
  mesh.position.copy(pos);
  mesh.rotation.y = rotY || 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'Static_' + kind;
  const entry = { kind, mesh, w, h, d, color: c };
  mesh.userData = { staticProp: true, kind, staticRef: entry, allowBuildingOnTop: true };
  mesh.geometry.computeBoundingBox();
  mesh.updateMatrixWorld(true);
  scene.add(mesh);
  collidableObjects.push(mesh);
  placedStatics.push(entry);
  return mesh;
}
let enemySpawns = []; // {x, z, marker}
var creatorBarBtns = [];
var paletteOpen = false;
var paletteHold = false;
let creatorGhost = null;
let creatorGhostKey = '';
let creatorGhostMats = [];

function addEnemySpawn(x, z, withMarker) {
  const sp = { x, z, marker: null };
  if (withMarker) {
      const m = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.4, 0.8, 4, 8),
          new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.5 })
      );
      m.position.set(x, 0.9, z);
      m.raycast = function () {};
      m.userData.isSpawnMarker = true;
      m.visible = (typeof creatorMode !== 'undefined' && creatorMode);
      scene.add(m);
      sp.marker = m;
      m.userData.spawnRef = sp;
  }
  enemySpawns.push(sp);
  return sp;
}
function placeStairs(pos, rotY) {
  const gr = createStaircase({
      position: new THREE.Vector3(pos.x, 0.5, pos.z),
      stepCount: 8, width: 3, height: 0.5, rise: 0.4, spacing: 1,
      material: new THREE.MeshStandardMaterial({ color: 0x8B4513 })
  });
  gr.rotation.y = rotY || 0;
  gr.userData.isStairs = true;
  scene.add(gr);
  placedStairs.push(gr);
  return gr;
}
function placeDoor(pos, rotY) {
  const door = createLockedDoor(new THREE.Vector3(pos.x, 2, pos.z));
  door.rotation.y = rotY || 0;
  placedDoors.push(door);
  return door;
}
function placeEnemySpawn(pos) {
  const x = Math.round(pos.x * 100) / 100, z = Math.round(pos.z * 100) / 100;
  addEnemySpawn(x, z, true);
  try { spawnRobot(new THREE.Vector3(x, 0, z)); } catch (e) {}
  showPlacementMessage('Puse: spawn de enemigos (las oleadas salen de acá)');
}
function clearStructures() {
  [...placedStairs].forEach(gr => {
      try {
          gr.traverse(o => { if (o.isMesh) { const i = collidableObjects.indexOf(o); if (i > -1) collidableObjects.splice(i, 1); } });
          scene.remove(gr);
      } catch (e) {}
  });
  placedStairs.length = 0;
  [...placedDoors].forEach(d => {
      try { scene.remove(d); const i = collidableObjects.indexOf(d); if (i > -1) collidableObjects.splice(i, 1); } catch (e) {}
  });
  placedDoors.length = 0;
  [...enemySpawns].forEach(sp => { try { if (sp.marker) scene.remove(sp.marker); } catch (e) {} });
  enemySpawns.length = 0;
  [...totems].forEach(t => { try { scene.remove(t.mesh); const i = collidableObjects.indexOf(t.mesh); if (i > -1) collidableObjects.splice(i, 1); } catch (e) {} });
  totems.length = 0;
}
function clearWorld() {
  try {
      try { cancelPlacement(true); } catch (e) {}
      try { if (typeof decayingBlocks !== 'undefined' && decayingBlocks) decayingBlocks.length = 0; } catch (e) {}
      clearBlocks();
      clearWorldProps();
      [...workbenches].forEach(w => destroyBench(w, true));
      clearStructures();
      [...placedStatics].forEach(x => {
          try { scene.remove(x.mesh); const i = collidableObjects.indexOf(x.mesh); if (i > -1) collidableObjects.splice(i, 1); } catch (e) {}
      });
      placedStatics.length = 0;
      [...totems].forEach(t => { try { scene.remove(t.mesh); } catch (e) {} });
      totems.length = 0;
      [...npcs].forEach(n => { try { n.die(); } catch (e) {} });
      updateSpatialPartition();
      try { if (typeof grantCreatorHammer === 'function') grantCreatorHammer(); } catch (e) {}
      showPlacementMessage('Mundo vaciado. Martillo en mano: mantené clic derecho para construir.');
  } catch (e) { console.error(e); }
}
function snappedYaw() {
  const y = (typeof player !== 'undefined' && player) ? player.container.rotation.y : 0;
  return Math.round(y / (Math.PI / 2)) * (Math.PI / 2);
}
function creatorTargetPose() {
  const mode = creatorPlaceMode;
  const p = creatorAimPoint();
  const r2 = (v) => Math.round(v * 100) / 100;
  let rotY = 0;
  if (mode.kind === 'struct') {
      rotY = snappedYaw();
      const py = (mode.id === 'door') ? 2 : (mode.id === 'stairs' ? 0.5 : Math.round(p.y * 2) / 2);
      p.set(Math.round(p.x * 2) / 2, py, Math.round(p.z * 2) / 2);
  } else if (mode.kind === 'enemy') {
      p.set(r2(p.x), 0, r2(p.z));
  } else if (mode.kind === 'item') {
      p.y = Math.max(p.y, 0.6);
      p.set(r2(p.x), r2(p.y), r2(p.z));
  } else if (mode.kind === 'node') {
      const gy = (typeof groundTopY === 'function') ? groundTopY(p.x, p.z) : 0;
      p.set(r2(p.x), gy, r2(p.z));
  } else if (mode.kind === 'prop') {
      const gy = (typeof groundTopY === 'function') ? groundTopY(p.x, p.z) : 0;
      p.set(r2(p.x), gy + 0.02, r2(p.z));
  }
  return { pos: p, rotY };
}
// --- Fantasma de vista previa ---
function clearCreatorGhost() {
  if (creatorGhost) { try { scene.remove(creatorGhost); } catch (e) {} }
  creatorGhost = null; creatorGhostKey = ''; creatorGhostMats = [];
}
function ghostMaterial(color) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false });
  creatorGhostMats.push(m);
  return m;
}
function ghostifyModel(model) {
  model.traverse(o => {
      if (o.isMesh) {
          o.material = ghostMaterial(0x00ff00);
          o.castShadow = false; o.receiveShadow = false;
          o.raycast = function () {};
      }
  });
  return model;
}
function buildCreatorGhost() {
  clearCreatorGhost();
  const mode = creatorPlaceMode;
  creatorGhostKey = mode.kind + ':' + mode.id;
  if (mode.kind === 'block' || mode.kind === 'erase') return; // blockPreview se encarga / borrar no muestra
  const g = new THREE.Group();
  const addBox = (w, h, d, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ghostMaterial(0x00ff00));
      m.position.y = y || 0; m.raycast = function () {};
      g.add(m);
  };
  if (mode.kind === 'item') {
      const def = ITEM_DEFINITIONS[mode.id];
      if (def && def.createModel) g.add(ghostifyModel(def.createModel()));
      else addBox(0.5, 0.5, 0.5, 0.3);
  } else if (mode.kind === 'node') {
      if (typeof buildResourceNodeModel === 'function') g.add(ghostifyModel(buildResourceNodeModel(mode.id)));
      else {
          const geo = (BLOCK_MATERIALS[mode.id] && BLOCK_MATERIALS[mode.id].geometry) || new THREE.BoxGeometry(1, 1, 1);
          const m = new THREE.Mesh(geo.clone(), ghostMaterial(0x00ff00));
          m.raycast = function () {}; m.position.y = 0.5;
          g.add(m);
      }
  } else if (mode.kind === 'prop') {
      if (typeof buildWorkbenchGhost === 'function') g.add(ghostifyModel(buildWorkbenchGhost(false)));
      else addBox(1.8, 1.1, 1.1, 0.55);
  } else if (mode.kind === 'struct' && mode.id === 'stairs') {
      addBox(8, 3.4, 2, 1.7);
  } else if (mode.kind === 'struct' && mode.id === 'door') {
      addBox(2, 4, 0.2, 2);
  } else if (mode.kind === 'struct' && mode.id === 'platform') {
      addBox(15, 1, 15, 0.5);
  } else if (mode.kind === 'struct' && mode.id === 'cube') {
      addBox(3, 3, 3, 1.5);
  } else if (mode.kind === 'struct' && mode.id === 'wall') {
      addBox(5, 3, 1, 1.5);
  } else if (mode.kind === 'enemy') {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.8, 4, 8), ghostMaterial(0xff3333));
      m.raycast = function () {};
      m.position.y = 0.9;
      g.add(m);
  } else {
      return;
  }
  g.visible = false;
  scene.add(g);
  creatorGhost = g;
}
function ghostRadius() {
  const mode = creatorPlaceMode;
  if (mode.kind === 'item') return 0.5;
  if (mode.kind === 'node') return 0.8;
  if (mode.kind === 'prop') return 1.4;
  if (mode.kind === 'struct' && mode.id === 'stairs') return 4.2;
  if (mode.kind === 'struct' && mode.id === 'door') return 1.2;
  if (mode.kind === 'struct' && mode.id === 'platform') return 4;
  if (mode.kind === 'struct' && mode.id === 'cube') return 2;
  if (mode.kind === 'struct' && mode.id === 'wall') return 2.5;
  if (mode.kind === 'enemy') return 0.8;
  return 0.5;
}
function ghostFits(pos, r) {
  const dxz = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  try {
      for (const b of placedBlocks) { if (dxz(b.position.x, b.position.z, pos.x, pos.z) < r + 0.7 && Math.abs(b.position.y - pos.y) < 2.5) return false; }
      for (const w of workbenches) { if (dxz(w.pos.x, w.pos.z, pos.x, pos.z) < r + 1.2) return false; }
      for (const gr of placedStairs) { if (dxz(gr.position.x, gr.position.z, pos.x, pos.z) < r + 4) return false; }
      for (const d of placedDoors) { if (dxz(d.position.x, d.position.z, pos.x, pos.z) < r + 1.2) return false; }
      for (const sp of enemySpawns) { if (Math.hypot(sp.x - pos.x, sp.z - pos.z) < r + 0.5) return false; }
  } catch (e) {}
  return true;
}
function setGhostTint(ok) {
  const c = ok ? 0x00ff00 : 0xff0000;
  creatorGhostMats.forEach(m => m.color.setHex(c));
}
function updateCreatorGhost() {
  const active = (typeof creatorMode !== 'undefined' && creatorMode) && !isGamePaused &&
      typeof player !== 'undefined' && player;
  if (!active) { if (creatorGhost) creatorGhost.visible = false; return; }
  const mode = creatorPlaceMode;
  if (mode.kind === 'block') { if (creatorGhost) creatorGhost.visible = false; return; }
  const key = mode.kind + ':' + mode.id;
  if (!creatorGhost || creatorGhostKey !== key) buildCreatorGhost();
  if (!creatorGhost) return;
  const pose = creatorTargetPose();
  creatorGhost.position.copy(pose.pos);
  creatorGhost.rotation.y = (mode.kind === 'struct') ? pose.rotY : 0;
  setGhostTint(ghostFits(pose.pos, ghostRadius()));
  creatorGhost.visible = true;
}
// --- Barra de creación en el mundo (sin pausa) ---
function renderCreatorBar() {
  let bar = document.getElementById('creatorBar');
  if (!bar) {
      bar = document.createElement('div');
      bar.id = 'creatorBar';
      document.body.appendChild(bar);
  }
  if (bar.dataset.built) return;
  bar.dataset.built = '1';
  const groups = [
      ['Bloques', [['block:wood', '🟫', 'Madera'], ['block:stone', '⬜', 'Piedra'], ['block:metal', '⬛', 'Metal']]],
      ['Objetos', [['item:pistol', '🔫', 'Pistola'], ['item:hammer', '🔨', 'Martillo'], ['item:axe', '🪓', 'Hacha'], ['item:pickaxe', '⛏️', 'Pico'], ['item:food', '🍎', 'Comida'], ['item:pistolAmmo', '📦', 'Balas'], ['item:key_golden', '🔑', 'Llave'], ['item:toxin', '☠️', 'Toxina']]],
      ['Nodos', [['node:wood', '🪵', 'Madera'], ['node:stone', '🪨', 'Piedra'], ['node:metal', '🔩', 'Metal']]],
      ['Base', [['prop:workbench', '🛠', 'Mesa']]],
      ['Estructuras', [['struct:stairs', '🪜', 'Escalera'], ['struct:door', '🚪', 'Puerta'], ['struct:platform', '🛖', 'Plataforma'], ['struct:cube', '🧱', 'Cubo'], ['struct:wall', '🚧', 'Muro']]],
      ['Enemigos', [['enemy:spawn', '👾', 'Spawn']]],
      ['Borrar', [['erase:erase', '❌', 'Sacar']]],
  ];
  groups.forEach(([glabel, opts]) => {
      const wrap = document.createElement('span');
      wrap.className = 'rg-pickgroup';
      const lab = document.createElement('span');
      lab.className = 'rg-picklabel';
      lab.textContent = glabel;
      wrap.appendChild(lab);
      opts.forEach(([v, icon, title]) => {
          const b = document.createElement('button');
          b.textContent = icon; b.title = title;
          b.dataset.pick = v;
          b.className = 'rg-pick';
          const pickIt = () => {
              const [kind, id] = v.split(':');
              creatorPlaceMode = { kind, id };
              refreshCreatorBar();
          };
          b.addEventListener('click', pickIt);
          b.addEventListener('mouseenter', () => {
              if (typeof paletteOpen !== 'undefined' && paletteOpen) pickIt();
          });
          wrap.appendChild(b);
          creatorBarBtns.push(b);
      });
      bar.appendChild(wrap);
  });
  const clr = document.createElement('button');
  clr.textContent = '🧹'; clr.title = 'Vaciar mundo';
  clr.className = 'rg-pick rg-pick-danger';
  clr.addEventListener('click', () => { if (confirm('¿Vaciar todo el mundo (bloques, objetos, base, enemigos)?')) clearWorld(); });
  bar.appendChild(clr);
  const hint = document.createElement('div');
  hint.id = 'creatorHint';
  hint.className = 'rg-hint';
  bar.appendChild(hint);
  refreshCreatorBar();
}
function renderCreatorFab() {
  let fab = document.getElementById('creatorFab');
  if (!fab) {
      fab = document.createElement('button');
      fab.id = 'creatorFab';
      fab.textContent = '🧱';
      fab.title = 'Crear';
      fab.className = 'rg-fab';
      fab.style.right = '12px';
      fab.style.bottom = '150px';
      fab.addEventListener('click', () => { if (typeof creatorMode !== 'undefined' && creatorMode) togglePalette(); });
      document.body.appendChild(fab);
  }
  const touch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
  fab.style.display = (touch && typeof creatorMode !== 'undefined' && creatorMode) ? 'block' : 'none';
}
function refreshCreatorBar() {
  const cur = creatorPlaceMode.kind + ':' + creatorPlaceMode.id;
  (creatorBarBtns || []).forEach(b => {
      b.classList.toggle('on', b.dataset.pick === cur);
  });
  const hint = document.getElementById('creatorHint');
  if (hint) {
      const b = (creatorBarBtns || []).find(x => x.dataset.pick === cur);
      hint.textContent = b ? ((creatorPlaceMode.kind === 'erase')
          ? 'A sacar: elegí, soltá y hacé clic donde apuntes'
          : ('A poner: ' + b.title + ' — elegí, soltá y hacé clic para poner' +
          (creatorPlaceMode.kind === 'block' ? ' (con el martillo)' : ''))) : '';
  }
}
function togglePalette(force) {
  paletteOpen = (typeof force === 'boolean') ? force : !paletteOpen;
  if (!paletteOpen) paletteHold = false;
  renderCreatorBar();
  refreshCreatorBar();
  const bar = document.getElementById('creatorBar');
  const show = paletteOpen && (typeof creatorMode !== 'undefined' && creatorMode) && !isGamePaused;
  if (bar) bar.style.display = show ? 'flex' : 'none';
  if (paletteOpen && !isGamePaused) {
      try { document.exitPointerLock(); } catch (e) {}
  } else if (!paletteOpen && !isGamePaused) {
      lockPointer();
  }
}
// --- Run stats (session kills, current run timer/spawn) ---
let enemiesKilled = 0;
let runStartTs = 0;
let playerSpawnPos = null;
function fmtRunTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

const PROP_ES = { wood: 'madera', stone: 'piedra', metal: 'metal', pistol: 'pistola', hammer: 'martillo', axe: 'hacha', pickaxe: 'pico', food: 'comida', toxin: 'toxina', pistol_ammo: 'balas', golden_key: 'llave dorada', workbench: 'mesa', stairs: 'escalera', door: 'puerta', spawn: 'spawn', platform: 'plataforma', cube: 'cubo', wall: 'muro', custom: 'bloque' };
function esPropName(id) { return PROP_ES[id] || id; }
function registerExistingProps() {
  // Adopt scene/default props placed at init so save/load replaces them cleanly
  try {
    collidableObjects.forEach(o => {
      if ((o.isPickupable || o.isCollectible) && !worldItems.includes(o)) {
        if (!o.userData) o.userData = {};
        if (!o.userData.itemKey) {
          let key = null;
          for (const k in ITEM_DEFINITIONS) { if (ITEM_DEFINITIONS[k].id === o.name) { key = k; break; } }
          o.userData.itemKey = key || o.name;
        }
        worldItems.push(o);
      }
      if (o.isResourceNode && !resourceNodes.includes(o)) resourceNodes.push(o);
    });
  } catch (e) {}
}
// Los modelos crafteados/regalados no están en la escena: hay que colgarlos de la cámara como hace el pickup
function attachToolModel(entry, def) {
  try {
      if (!entry) return;
      if (!entry.model && def && def.createModel) entry.model = def.createModel();
      if (entry.model) entry.model.userData.isToolModel = true;
      if (entry.model && typeof player !== 'undefined' && player && player.camera &&
          entry.model.parent !== player.camera) {
          player.camera.add(entry.model);
          if (player.heldItemOffset) entry.model.position.copy(player.heldItemOffset);
          entry.model.rotation.set(0, 0, 0);
      }
  } catch (e) {}
}
// Descolgar del camera cualquier modelo de herramienta que ya no esté en la mochila.
// Evita el "martillo trabado" cuando se resetea el inventario o se sale del modo creador.
function detachOrphanToolModels() {
  try {
      if (typeof player === 'undefined' || !player || !player.camera) return;
      const keep = new Set();
      const inv = player.inventory;
      (inv && inv.items ? inv.items : []).forEach(function (it) { if (it && it.model) keep.add(it.model); });
      if (inv && inv.equippedItem && inv.equippedItem.model) keep.add(inv.equippedItem.model);
      player.camera.children.slice().forEach(function (ch) {
          if (!ch) return;
          const isTool = (ch.userData && ch.userData.isToolModel) || ch.isToolModel;
          if (isTool && !keep.has(ch)) {
              try { player.camera.remove(ch); } catch (e) {}
          }
      });
  } catch (e) {}
}
function grantCreatorHammer() {
  try {
      if (typeof player === 'undefined' || !player || !player.inventory) return;
      const inv = player.inventory;
      let entry = inv.items.find(i => i.toolType === 'hammer');
      let granted = false;
      if (!entry) {
          const def = ITEM_DEFINITIONS.hammer;
          entry = { ...def, quantity: 1 };
          if (!inv.addItem(entry)) return;
          entry = inv.items.find(i => i.toolType === 'hammer') || entry;
          granted = true;
      }
      if (granted) entry.creatorOnly = true;
      attachToolModel(entry, ITEM_DEFINITIONS.hammer);
      player.setTool('hammer');
  } catch (e) { console.error(e); }
}
function placeWorldItem(key, position) {
  const itemDef = ITEM_DEFINITIONS[key];
  if (!itemDef || !itemDef.createModel) return null;
  const item = { ...itemDef };
  const model = itemDef.createModel();
  model.position.copy(position);
  model.rotation.y = Math.PI / 4;
  model.scale.set(0.5, 0.5, 0.5);
  model.isPickupable = true;
  model.name = itemDef.id;
  model.userData = Object.assign({}, model.userData, { collected: false, itemData: item, itemKey: key, creatorPlaced: true });
  if (itemDef.type === 'consumable') { model.isCollectible = true; model.type = itemDef.id; }
  if (itemDef.type === 'key' && typeof decorateGoldenKey === 'function') decorateGoldenKey(model);
  scene.add(model);
  collidableObjects.push(model);
  if (!worldItems.includes(model)) worldItems.push(model);
  return model;
}
function placeResourceNode(type, pos) {
  const node = createResourceNode(type, pos);
  if (!node) return null;
  scene.add(node);
  collidableObjects.push(node);
  return node;
}
function removeWorldProp(root) {
  scene.remove(root);
  let i = collidableObjects.indexOf(root); if (i > -1) collidableObjects.splice(i, 1);
  i = worldItems.indexOf(root); if (i > -1) worldItems.splice(i, 1);
  i = resourceNodes.indexOf(root); if (i > -1) resourceNodes.splice(i, 1);
  showPlacementMessage('Saqué: ' + esPropName(root.name || 'objeto'));
}
function creatorAimPoint() {
  const o = new THREE.Vector3(); camera.getWorldPosition(o);
  const d = camera.getWorldDirection(new THREE.Vector3());
  const reach = (typeof PLAYER_CONFIG !== 'undefined' && PLAYER_CONFIG.blockReach) || 6;
  const ray = new THREE.Raycaster(o, d, 0.1, reach * 2);
  const hits = ray.intersectObjects([groundMesh, ...placedBlocks], false);
  if (hits.length) {
      const h = hits[0];
      const n = (h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0)).transformDirection(h.object.matrixWorld);
      return h.point.clone().add(n.multiplyScalar(0.4));
  }
  return o.clone().add(d.multiplyScalar(3));
}
// Altura del suelo/estructura apuntando hacia abajo (para apoyar props sin que floten)
function groundTopY(x, z) {
  try {
      const origin = new THREE.Vector3(x, 30, z);
      const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, 60);
      const hits = ray.intersectObjects([groundMesh, ...placedBlocks], false);
      if (hits.length) return hits[0].point.y;
  } catch (e) {}
  return 0;
}
function creatorPlace() {
  if (typeof player === 'undefined' || !player) return;
  const mode = creatorPlaceMode;
  if (mode.kind === 'erase') { creatorDelete(); return; }
  const pose = creatorTargetPose();
  const p = pose.pos;
  if (mode.kind === 'block') {
      if (player.currentTool !== TOOLS.HAMMER) {
          setPauseStatus('Equipá el martillo para poner bloques');
          showPlacementMessage('Equipá el martillo para construir');
          return;
      }
      currentBlockType = mode.id;
      placeBlock();
      updateSpatialPartition();
  } else if (mode.kind === 'item') {
      if (placeWorldItem(mode.id, p)) showPlacementMessage('Puse: ' + esPropName(mode.id));
  } else if (mode.kind === 'node') {
      if (placeResourceNode(mode.id, p)) showPlacementMessage('Puse: ' + esPropName(mode.id));
  } else if (mode.kind === 'prop' && mode.id === 'workbench') {
      if (placeWorkbench(p)) showPlacementMessage('Puse: mesa de trabajo (tu base)');
  } else if (mode.kind === 'struct' && mode.id === 'stairs') {
      placeStairs(p, pose.rotY);
      showPlacementMessage('Puse: escalera');
  } else if (mode.kind === 'struct' && mode.id === 'door') {
      placeDoor(p, pose.rotY);
      showPlacementMessage('Puse: puerta (llave dorada)');
  } else if (mode.kind === 'struct' && (mode.id === 'platform' || mode.id === 'cube' || mode.id === 'wall')) {
      placeStaticBox(mode.id, p, pose.rotY);
      showPlacementMessage('Puse: ' + esPropName(mode.id));
  } else if (mode.kind === 'enemy') {
      placeEnemySpawn(p);
  }
}
function creatorDelete() {
  const o = new THREE.Vector3(); camera.getWorldPosition(o);
  const d = camera.getWorldDirection(new THREE.Vector3());
  const reach = (typeof PLAYER_CONFIG !== 'undefined' && PLAYER_CONFIG.blockReach) || 6;
  const ray = new THREE.Raycaster(o, d, 0.1, reach * 2);
  const inCreator = (typeof creatorMode !== 'undefined' && creatorMode);
  const targets = inCreator
      ? [...placedBlocks, ...worldItems, ...resourceNodes, ...workbenches.map(w => w.mesh),
         ...placedStairs, ...placedDoors, ...placedStatics.map(x => x.mesh), ...totems.map(t => t.mesh)]
      : [...placedBlocks];
  const hits = ray.intersectObjects(targets, true);
  for (const h of hits) {
      let root = null, benchRef = null, spawnRef = null, staticRef = null, totemRef = null, p = h.object;
      while (p) {
          if (p.userData && p.userData.benchRef) { benchRef = p.userData.benchRef; break; }
          if (p.userData && p.userData.spawnRef) { spawnRef = p.userData.spawnRef; break; }
          if (p.userData && p.userData.staticRef) { staticRef = p.userData.staticRef; break; }
          if (p.userData && p.userData.totemRef) { totemRef = p.userData.totemRef; break; }
          if (placedBlocks.includes(p) || worldItems.includes(p) || resourceNodes.includes(p) ||
              placedStairs.includes(p) || placedDoors.includes(p)) { root = p; break; }
          p = p.parent;
      }
      if (benchRef) { destroyBench(benchRef, true); return; }
      if (staticRef) {
          try { scene.remove(staticRef.mesh); const i = collidableObjects.indexOf(staticRef.mesh); if (i > -1) collidableObjects.splice(i, 1); } catch (e) {}
          placedStatics.splice(placedStatics.indexOf(staticRef), 1);
          showPlacementMessage('Saqué: ' + esPropName(staticRef.kind));
          return;
      }
      if (totemRef) {
          try { scene.remove(totemRef.mesh); const i = collidableObjects.indexOf(totemRef.mesh); if (i > -1) collidableObjects.splice(i, 1); } catch (e) {}
          totems.splice(totems.indexOf(totemRef), 1);
          showPlacementMessage('Saqué: tótem');
          return;
      }
      if (spawnRef) {
          try { if (spawnRef.marker) scene.remove(spawnRef.marker); } catch (e) {}
          enemySpawns.splice(enemySpawns.indexOf(spawnRef), 1);
          showPlacementMessage('Saqué: spawn de enemigos');
          return;
      }
      if (!root) continue;
      if (placedStairs.includes(root)) {
          try {
              root.traverse(o => { if (o.isMesh) { const i = collidableObjects.indexOf(o); if (i > -1) collidableObjects.splice(i, 1); } });
              scene.remove(root);
          } catch (e) {}
          placedStairs.splice(placedStairs.indexOf(root), 1);
          showPlacementMessage('Saqué: escalera');
          return;
      }
      if (placedDoors.includes(root)) {
          try { scene.remove(root); const i = collidableObjects.indexOf(root); if (i > -1) collidableObjects.splice(i, 1); } catch (e) {}
          placedDoors.splice(placedDoors.indexOf(root), 1);
          showPlacementMessage('Saqué: puerta');
          return;
      }
      if (placedBlocks.includes(root)) { destroyBlock(root); return; }
      removeWorldProp(root);
      return;
  }
  showPlacementMessage('No hay nada para sacar');
}
// --- Scene snapshot with props (back-compat: old saves only have blocks) ---
function serializeProps(list, isNode) {
  return list.map(o => {
    const d = {
      k: isNode ? o.type : (o.userData && o.userData.itemKey),
      x: Math.round(o.position.x * 100) / 100,
      y: Math.round(o.position.y * 100) / 100,
      z: Math.round(o.position.z * 100) / 100
    };
    if (o.userData && o.userData.autoResource) d.a = 1;
    return d;
  }).filter(d => d.k);
}
function clearWorldProps() {
  [...worldItems, ...resourceNodes].forEach(o => {
      scene.remove(o);
      const i = collidableObjects.indexOf(o);
      if (i > -1) collidableObjects.splice(i, 1);
  });
  worldItems.length = 0;
  resourceNodes.length = 0;
}
function snapshotScene() {
  registerExistingProps();
  const benchData = workbenches.map(w => ({
    x: Math.round(w.pos.x * 100) / 100,
    y: Math.round(w.pos.y * 100) / 100,
    z: Math.round(w.pos.z * 100) / 100,
    hp: Math.round(w.hp)
  }));
  return {
    blocks: serializeBlocks(),
    items: serializeProps(worldItems, false),
    nodes: serializeProps(resourceNodes, true),
    benches: benchData,
    stairs: placedStairs.map(gr => ({
      x: Math.round(gr.position.x * 100) / 100,
      y: Math.round(gr.position.y * 100) / 100,
      z: Math.round(gr.position.z * 100) / 100,
      rot: Math.round((gr.rotation.y || 0) * 100) / 100
    })),
    doors: placedDoors.map(d => ({
      x: Math.round(d.position.x * 100) / 100,
      y: Math.round(d.position.y * 100) / 100,
      z: Math.round(d.position.z * 100) / 100,
      rot: Math.round((d.rotation.y || 0) * 100) / 100
    })),
    spawns: enemySpawns.map(sp => ({ x: sp.x, z: sp.z })),
    totems: totems.map(t => ({ x: Math.round(t.pos.x * 100) / 100, z: Math.round(t.pos.z * 100) / 100, lines: t.lines })),
    statics: placedStatics.map(x => ({
      k: x.kind,
      x: Math.round(x.mesh.position.x * 100) / 100,
      y: Math.round(x.mesh.position.y * 100) / 100,
      z: Math.round(x.mesh.position.z * 100) / 100,
      rot: Math.round((x.mesh.rotation.y || 0) * 100) / 100,
      w: x.w, h: x.h, d: x.d, color: x.color
    }))
  };
}
function deserializeProps(items, nodes, benches, extras) {
  clearWorldProps();
  [...workbenches].forEach(w => destroyBench(w, true));
  (Array.isArray(benches) ? benches : []).slice(0, 20).forEach(d => {
      if (typeof d.x !== 'number' || typeof d.y !== 'number' || typeof d.z !== 'number') return;
      const wb = placeWorkbench(new THREE.Vector3(d.x, d.y, d.z));
      if (wb && typeof d.hp === 'number') { wb.hp = Math.max(1, Math.min(wb.maxHp, d.hp)); updateBenchBar(wb); }
  });
  clearStructures();
  const ex = extras || {};
  (Array.isArray(ex.stairs) ? ex.stairs : []).slice(0, 30).forEach(d => {
      if (typeof d.x !== 'number') return;
      placeStairs(new THREE.Vector3(d.x, (typeof d.y === 'number' ? d.y : 0.5), d.z), d.rot || 0);
  });
  (Array.isArray(ex.doors) ? ex.doors : []).slice(0, 30).forEach(d => {
      if (typeof d.x !== 'number') return;
      placeDoor(new THREE.Vector3(d.x, (typeof d.y === 'number' ? d.y : 2), d.z), d.rot || 0);
  });
  (Array.isArray(ex.spawns) ? ex.spawns : []).slice(0, 30).forEach(d => {
      if (typeof d.x !== 'number' || typeof d.z !== 'number') return;
      addEnemySpawn(d.x, d.z, true);
  });
  (Array.isArray(ex.totems) ? ex.totems : []).slice(0, 30).forEach(t => {
      if (typeof t.x !== 'number' || typeof t.z !== 'number' || !Array.isArray(t.lines)) return;
      placeTotem(t.lines.slice(0, 4), t.x, t.z);
  });
  (Array.isArray(ex.statics) ? ex.statics : []).slice(0, 30).forEach(x => {
      if (!x.k || typeof x.x !== 'number') return;
      placeStaticBox(x.k, new THREE.Vector3(x.x, (typeof x.y === 'number' ? x.y : 1), x.z), x.rot || 0,
          (x.w && x.h && x.d) ? { w: x.w, h: x.h, d: x.d } : null, x.color);
  });
  let n = 0;
  (Array.isArray(items) ? items : []).slice(0, 500).forEach(d => {
      if (typeof d.x !== 'number' || typeof d.y !== 'number' || typeof d.z !== 'number') return;
      const item = placeWorldItem(d.k, new THREE.Vector3(d.x, d.y, d.z));
      if (item) {
          if (d.a) item.userData.autoResource = true;
          n++;
      }
  });
  (Array.isArray(nodes) ? nodes : []).slice(0, 500).forEach(d => {
      if (typeof d.x !== 'number' || typeof d.y !== 'number' || typeof d.z !== 'number') return;
      const node = placeResourceNode(d.k, new THREE.Vector3(d.x, d.y, d.z));
      if (node) {
          if (d.a) node.userData.autoResource = true;
          n++;
      }
  });
  return n;
}
// --- Crafting: progression hands -> hammer -> axe -> pickaxe -> pistol (+ ammo/heals) ---
const CRAFT_RECIPES = [
  { id: 'hammer', label: 'Martillo de piedra', name: 'Martillo', station: 'hand', kind: 'tool', defKey: 'hammer', requires: null,
    cost: { wood: 4, stone: 2 } },
  { id: 'axe', label: 'Hacha de piedra', name: 'Hacha', station: 'hand', kind: 'tool', defKey: 'axe', requires: 'hammer',
    cost: { wood: 4, stone: 3 } },
  { id: 'pickaxe', label: 'Pico de piedra', name: 'Pico', station: 'hand', kind: 'tool', defKey: 'pickaxe', requires: 'axe',
    cost: { wood: 2, stone: 6 } },
  { id: 'torch', label: 'Antorcha (alumbra)', name: 'Antorcha', station: 'hand', kind: 'tool', defKey: 'torch', requires: null,
    cost: { wood: 2 } },
  { id: 'bench', label: 'Mesa de trabajo (tu base)', name: 'Mesa de trabajo', station: 'hand', kind: 'prop', requires: null,
    cost: { wood: 6, stone: 4 },
    run: (inv) => {
        startPlacement({
            label: 'mesa de trabajo',
            cost: { wood: 6, stone: 4 },
            radius: 1.4,
            snapGround: true,
            buildGhost: buildWorkbenchGhost,
            place: (pos) => { const wb = placeWorkbench(pos); return !!wb; }
        });
    } },
  // --- Solo en la mesa de trabajo (items avanzados) ---
  { id: 'pistol', label: 'Pistola de chatarra (+6 balas)', name: 'Pistola', station: 'bench', kind: 'tool', defKey: 'pistol', requires: 'pickaxe',
    cost: { metal: 10, wood: 4 }, ammoBonus: { pistol: 6 } },
  { id: 'ammo', label: 'Balas de pistola x12', name: 'Balas x12', station: 'bench', kind: 'ammo', requires: null,
    cost: { metal: 3, wood: 2 },
    run: (inv) => { inv.ammo.pistol = (inv.ammo.pistol || 0) + 12; try { inv.updateAmmoUI(); } catch (e) {} } },
  { id: 'dressing', label: 'Venda (+30 vida)', name: 'Venda', station: 'bench', kind: 'item', defKey: 'bandage', requires: null,
    cost: { wood: 3, stone: 1 } },
];
const CRAFT_STATION_LABEL = { hand: 'a mano', bench: 'en la mesa de trabajo' };
const TOOL_REQUIRE_NAMES = { hammer: 'Martillo', axe: 'Hacha', pickaxe: 'Pico', gun: 'Pistola' };
const RESOURCE_ES = { wood: 'madera', stone: 'piedra', metal: 'metal' };
function craftRecipeText(r) {
  let t = (r.name || r.label) + ' — ' + Object.keys(r.cost).map(k => r.cost[k] + ' ' + (RESOURCE_ES[k] || k)).join(' + ');
  if (r.requires) t += ' · requiere ' + (TOOL_REQUIRE_NAMES[r.requires] || r.requires);
  return t;
}
function craftItem(idx) {
  const r = CRAFT_RECIPES[idx];
  if (!r || typeof player === 'undefined' || !player || !player.inventory) return;
  const inv = player.inventory;
  if (r.requires && !inv.items.some(i => i.toolType === r.requires)) {
      setCraftStatus('Primero crafteá: ' + (TOOL_REQUIRE_NAMES[r.requires] || r.requires));
      return;
  }
  if (r.kind === 'tool') {
      const def = ITEM_DEFINITIONS[r.defKey];
      if (!def) return;
      if (inv.items.some(i => i.toolType === def.toolType)) { setCraftStatus('Ya la tenés: ' + def.name); return; }
  }
  for (const k in r.cost) {
      if ((inv.resources[k] || 0) < r.cost[k]) {
          setCraftStatus('Te falta ' + (RESOURCE_ES[k] || k) + ' (necesitás ' + r.cost[k] + ')');
          showPlacementMessage('Te falta ' + k);
          return;
      }
  }
  for (const k in r.cost) inv.resources[k] -= r.cost[k];
  if (r.kind === 'tool') {
      const def = ITEM_DEFINITIONS[r.defKey];
      const entry = { ...def, quantity: 1 };
      try { if (def.createModel) entry.model = def.createModel(); } catch (e) {}
      if (inv.addItem(entry)) {
          attachToolModel(inv.items.find(i => i.toolType === def.toolType) || entry, def);
          try { player.setTool(def.toolType); } catch (e) {}
          if (r.ammoBonus) for (const a in r.ammoBonus) {
              inv.ammo[a] = (inv.ammo[a] || 0) + r.ammoBonus[a];
              try { inv.updateAmmoUI(); } catch (e) {}
          }
          setCraftStatus('Crafteada y equipada: ' + def.name);
          try { playSound('pickup'); } catch (e) {}
      } else {
          for (const k in r.cost) inv.resources[k] += r.cost[k]; // refund: inventory full
          setCraftStatus('Mochila llena — te devuelvo los materiales');
      }
  } else if (r.kind === 'item') {
      const def = ITEM_DEFINITIONS[r.defKey];
      if (!def) {
          for (const k in r.cost) inv.resources[k] += r.cost[k];
          setCraftStatus('No se pudo craftear');
          refreshCraftUI();
          return;
      }
      const entry = { ...def, quantity: 1 };
      try { if (def.createModel) entry.model = def.createModel(); } catch (e) {}
      if (inv.addItem(entry)) {
          setCraftStatus('Crafteado: ' + def.name);
          try { playSound('pickup'); } catch (e) {}
      } else {
          for (const k in r.cost) inv.resources[k] += r.cost[k];
          setCraftStatus('Mochila llena — te devuelvo los materiales');
      }
  } else {
      try { r.run(inv); } catch (e) { console.error(e); }
      setCraftStatus('Crafteado: ' + (r.name || r.label));
      try { playSound('health-regen'); } catch (e) {}
  }
  try { updateResourceHUD(); } catch (e) {}
  refreshCraftUI();
  try { refreshInvModal(); } catch (e) {}
}
function refreshCraftUI() {
  const inv = (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
  const btns = document.querySelectorAll('.rg-craft');
  btns.forEach(btn => {
      const i = parseInt(btn.dataset.idx, 10);
      const r = CRAFT_RECIPES[i];
      if (!r) return;
      const ownedTool = (r.kind === 'tool' && ITEM_DEFINITIONS[r.defKey])
          ? inv && inv.items.some(it => it.toolType === ITEM_DEFINITIONS[r.defKey].toolType) : false;
      const hasReq = !r.requires || (inv && inv.items.some(it => it.toolType === r.requires));
      const missing = inv ? Object.keys(r.cost).filter(k => (inv.resources[k] || 0) < r.cost[k]) : Object.keys(r.cost);
      const ok = !!inv && hasReq && !ownedTool && missing.length === 0;

      btn.disabled = !ok;
      btn.style.opacity = ok ? '1' : '0.55';

      const costEl = btn.querySelector('.rg-craft-cost');
      if (costEl) {
          costEl.innerHTML = Object.keys(r.cost).map(k => {
              const lack = !inv || (inv.resources[k] || 0) < r.cost[k];
              return '<span class="rg-cost ' + (lack ? 'bad' : 'ok') + '">' + resIcon(k) + r.cost[k] + '</span>';
          }).join('');
      }
      const lockEl = btn.querySelector('.rg-craft-lock');
      if (lockEl) {
          if (r.requires && !hasReq) { lockEl.textContent = '🔒 ' + (TOOL_REQUIRE_NAMES[r.requires] || r.requires); lockEl.style.display = ''; }
          else lockEl.style.display = 'none';
      }
      const nameEl = btn.querySelector('.rg-craft-name');
      if (nameEl) nameEl.textContent = (r.name || r.label) + (ownedTool ? ' ✓' : '');
      btn.title = craftRecipeText(r);
  });
  try { renderMaterialChips(document.getElementById('invFoot')); renderMaterialChips(document.getElementById('benchFoot')); } catch (e) {}
}
function setCreatorMode(on) {
  creatorMode = !!on;
  if (typeof PLAYER_CONFIG !== 'undefined') {
      if (creatorMode && creatorBaseReach === null) creatorBaseReach = PLAYER_CONFIG.blockReach;
      PLAYER_CONFIG.blockReach = creatorMode ? 14 : (creatorBaseReach !== null ? creatorBaseReach : PLAYER_CONFIG.blockReach);
  }
  if (pauseUI.creatorBtn) pauseUI.creatorBtn.textContent = 'Creador: ' + (creatorMode ? 'SÍ' : 'NO');
  if (pauseUI.creatorPalette) pauseUI.creatorPalette.style.display = creatorMode ? 'block' : 'none';
  if (pauseUI.flyBtn) pauseUI.flyBtn.style.display = creatorMode ? 'inline-block' : 'none';
  if (!creatorMode && typeof player !== 'undefined' && player) player.creatorFly = false;
  if (pauseUI.flyBtn && typeof player !== 'undefined' && player && typeof player.creatorFly !== 'undefined') {
      pauseUI.flyBtn.textContent = 'Volar: ' + (player.creatorFly ? 'SÍ' : 'NO');
  }
  if (creatorMode) {
      if (typeof player !== 'undefined' && player && typeof player.creatorFly === 'undefined') player.creatorFly = true;
      registerExistingProps();
      grantCreatorHammer();
  } else {
      // Al salir del modo creador: devolver el martillo prestado y limpiar modelos huérfanos
      try {
          if (typeof player !== 'undefined' && player && player.inventory) {
              const inv = player.inventory;
              const borrowed = inv.items.filter(function (i) { return i && i.creatorOnly; });
              borrowed.forEach(function (it) {
                  try { inv.removeItem(it, it.quantity || 1); } catch (e) {}
              });
              if (borrowed.length) {
                  try {
                      const stillHammer = inv.equippedItem && inv.equippedItem.toolType === TOOLS.HAMMER;
                      if (!stillHammer || !inv.items.some(function (i) { return i.toolType === TOOLS.HAMMER; })) {
                          player.currentTool = TOOLS.HANDS;
                          inv.unequipItem();
                      } else {
                          player.setTool(TOOLS.HAMMER);
                      }
                  } catch (e) {}
                  try { player.updateToolHUD(); } catch (e) {}
                  try { inv.updateQuickSlotUI(); } catch (e) {}
                  try { updateActionButton(); } catch (e) {}
              }
          }
      } catch (e) {}
      try { if (typeof player !== 'undefined' && player) player.updateToolModelVisibility(); } catch (e) {}
      try { if (typeof detachOrphanToolModels === 'function') detachOrphanToolModels(); } catch (e) {}
  }
  try {
      enemySpawns.forEach(sp => { if (sp.marker) sp.marker.visible = creatorMode; });
  } catch (e) {}
  if (!creatorMode && typeof paletteOpen !== 'undefined' && paletteOpen) togglePalette(false);
  if (creatorMode) { renderCreatorBar(); refreshCreatorBar(); }
  else { const bar = document.getElementById('creatorBar'); if (bar) bar.style.display = 'none'; }
  try {
      const qs = document.getElementById('quickSlots');
      if (qs) qs.style.display = creatorMode ? 'none' : '';
  } catch (e) {}
  try { renderCreatorFab(); } catch (e) {}
  if (creatorGhost) creatorGhost.visible = false;
  setPauseStatus(creatorMode ? 'Modo creador: volá + construí gratis. Enemigos quietos.' : '');
}
function updateWaveManager() {
  try {
      const t = performance.now() / 1000;
      for (const tb of totems) { if (tb && tb.top) tb.top.rotation.y = t * 1.2; }
  } catch (e) {}
  if (isGamePaused) return;
  if (typeof creatorMode !== 'undefined' && creatorMode) return;
  try {
    if (typeof player !== 'undefined' && player && player.health <= 0) return; // no respawn after game over
  } catch (e) {}
  // Sin puntos de spawn de enemigos en este mundo, no hay oleadas
  // (evita que aparezcan enemigos "heredados" de otro nivel).
  if (typeof enemySpawns === 'undefined' || !enemySpawns.length) { waveRespawnAt = 0; return; }
  const alive = npcs.filter((n) => n && n.health > 0).length;
  if (alive > 0) { waveRespawnAt = 0; return; }
  if (!waveRespawnAt) {
      waveRespawnAt = performance.now() + 5000;
      if (typeof showMessage === 'function') showMessage('¡Oleada superada! La próxima en 5s...');
      return;
  }
  if (performance.now() >= waveRespawnAt) {
      waveRespawnAt = 0;
      waveNumber++;
      const count = Math.min(2 + waveNumber, 6);
      const pts = enemySpawns;
      for (let k = 0; k < count; k++) {
          const sp = pts[k % pts.length];
          spawnRobot(new THREE.Vector3(sp.x + (Math.random() - 0.5) * 4, 0, sp.z + (Math.random() - 0.5) * 4));
      }
      // De vez en cuando rebrota un cluster de recursos en un punto lejano del mapa
      try {
          if (typeof spawnResourceCluster === 'function' && Math.random() < 0.6) {
              const types = ['wood', 'stone', 'metal'];
              const t = types[(Math.random() * types.length) | 0];
              const a = Math.random() * Math.PI * 2;
              const rr = 22 + Math.random() * 12;
              spawnResourceCluster(t, Math.cos(a) * rr, Math.sin(a) * rr, 3 + ((Math.random() * 3) | 0));
          }
      } catch (e) {}
      if (typeof showMessage === 'function') showMessage('¡Oleada ' + waveNumber + ': ' + count + ' enemigos en camino!');
  }
}

