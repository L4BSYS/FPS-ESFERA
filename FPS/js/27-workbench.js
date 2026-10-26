// js/27-workbench.js — Mesas de trabajo, placement y HUD de base.
// Extraído de 02-systems.js (review: god-file / >1k lines).
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
  // Tutorial paso 4: soft gate — solo cuenta / permite en el círculo marcado (SO).
  try {
    if (typeof DIRECTOR !== 'undefined' && DIRECTOR.active &&
        DIRECTOR.step4Revealed && !DIRECTOR.step4Done && DIRECTOR.benchSpot) {
      const dx = pos.x - DIRECTOR.benchSpot.x;
      const dz = pos.z - DIRECTOR.benchSpot.z;
      const lim = DIRECTOR.benchSpotRadius || 3.5;
      if (Math.sqrt(dx * dx + dz * dz) > lim) {
        try { showPlacementMessage('Colocala en el círculo azul (suroeste)'); } catch (e) {}
        return null;
      }
    }
  } catch (e) {}
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
  try { if (typeof directorOnWorkbenchPlaced === 'function') directorOnWorkbenchPlaced(wb); } catch (e) {}
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
  try { if (typeof refreshBenchModalLists === 'function') refreshBenchModalLists(); } catch (e) {}
  try { if (typeof ensureBenchCraftUI === 'function') ensureBenchCraftUI(); } catch (e) {}
  try { if (typeof updateBenchTrayUI === 'function') updateBenchTrayUI(); } catch (e) {}
}
function repairBench() {
  const wb = (typeof currentBench !== 'undefined') ? currentBench : null;
  if (!wb || wb.hp <= 0) return;
  const inv = (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
  if (!inv) return;
  if (wb.hp >= wb.maxHp) { setCraftStatus('La mesa ya está entera'); return; }
  if ((inv.getResourceCount ? inv.getResourceCount('wood') : (inv.resources.wood || 0)) < 3 ||
      (inv.getResourceCount ? inv.getResourceCount('stone') : (inv.resources.stone || 0)) < 2) {
      setCraftStatus('Te faltan materiales (3 madera + 2 piedra)');
      return;
  }
  if (typeof inv.spendResource === 'function') {
      if (!inv.spendResource('wood', 3) || !inv.spendResource('stone', 2)) {
          setCraftStatus('Te faltan materiales (3 madera + 2 piedra)');
          return;
      }
  } else {
      inv.resources.wood -= 3; inv.resources.stone -= 2;
  }
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
      if (typeof containerOpen !== 'undefined' && containerOpen && typeof toggleContainer === 'function') {
          try { toggleContainer(false); } catch (e) {}
      }
      if (typeof pauseMenu !== 'undefined' && pauseMenu) pauseMenu.style.display = 'none';
      isGamePaused = true;
      try { document.exitPointerLock(); } catch (e) {}
      try { if (typeof ensureBenchCraftUI === 'function') ensureBenchCraftUI(); } catch (e) {}
      refreshBenchModal();
      try { refreshCraftUI(); } catch (e) {}
      modal.style.display = 'flex';
      benchOpen = true;
      openModal = 'bench';
      try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (e) {}
  } else {
      try { if (typeof clearBenchTrayToBag === 'function') clearBenchTrayToBag(); } catch (e) {}
      modal.style.display = 'none';
      benchOpen = false;
      currentBench = null;
      if (typeof openModal !== 'undefined' && openModal === 'bench') openModal = null;
      try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (e) {}
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
      for (const k in cost) {
          if (typeof inv.addResource === 'function') inv.addResource(k, cost[k]);
          else inv.resources[k] = (inv.resources[k] || 0) + cost[k];
      }
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
