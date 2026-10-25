// js/23-world-container.js — Cofre/dispenser reutilizable (modos storage | dispenser).
var worldContainers = [];
var currentContainer = null;
var containerOpen = false;

function buildWorldContainerMesh(mode) {
  const g = new THREE.Group();
  const isDisp = mode === 'dispenser';
  const bodyMat = new THREE.MeshStandardMaterial({
    color: isDisp ? 0x3a4a55 : 0x5c4030,
    roughness: 0.85,
    metalness: isDisp ? 0.35 : 0.08
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: isDisp ? 0x7a8a99 : 0x3d2a1a,
    roughness: 0.7,
    metalness: isDisp ? 0.5 : 0.05
  });
  const accent = new THREE.MeshStandardMaterial({
    color: isDisp ? 0x4caf50 : 0xc4a574,
    emissive: isDisp ? 0x1b5e20 : 0x5c4030,
    emissiveIntensity: 0.35,
    roughness: 0.5,
    metalness: 0.2
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.85, 0.75), bodyMat);
  body.position.y = 0.45;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.12, 0.78), trimMat);
  lid.position.y = 0.92;
  lid.castShadow = true;
  g.add(lid);

  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.08), accent);
  latch.position.set(0, 0.7, 0.4);
  g.add(latch);

  if (isDisp) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.06), accent);
    slot.position.set(0, 0.5, 0.4);
    g.add(slot);
  }

  g.name = isDisp ? 'WorldDispenser' : 'WorldChest';
  return g;
}

function resolveContainerDef(id) {
  if (typeof ITEM_DEFINITIONS !== 'undefined') {
    if (ITEM_DEFINITIONS[id]) return ITEM_DEFINITIONS[id];
    for (const k in ITEM_DEFINITIONS) {
      if (ITEM_DEFINITIONS[k] && ITEM_DEFINITIONS[k].id === id) return ITEM_DEFINITIONS[k];
    }
  }
  if (id === 'wood' || id === 'stone' || id === 'metal') {
    return { id: id, name: (typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[id]) || id, type: 'resource' };
  }
  return { id: id, name: id, type: 'item' };
}

function containerItemLabel(entry) {
  if (!entry) return '—';
  const n = entry.name || entry.id || '?';
  const q = entry.quantity || entry.amount || 1;
  return q > 1 ? (n + ' ×' + q) : n;
}

// opts: { mode, x, z, y?, rotY?, slots?, stock?, cooldown?, label?, seed? }
function placeWorldContainer(opts) {
  opts = opts || {};
  const mode = opts.mode === 'dispenser' ? 'dispenser' : 'storage';
  const x = (typeof opts.x === 'number') ? opts.x : 0;
  const z = (typeof opts.z === 'number') ? opts.z : 0;
  const y = (typeof opts.y === 'number') ? opts.y : 0;
  const rotY = (typeof opts.rotY === 'number') ? opts.rotY : 0;
  const label = opts.label || (mode === 'dispenser' ? 'Dispenser' : 'Cofre');
  const slotCount = Math.max(1, Math.min(24, opts.slots || 12));

  const mesh = buildWorldContainerMesh(mode);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.isStatic = true;
  mesh.userData.solid = true;
  try {
    mesh.updateMatrixWorld(true);
    mesh.userData.worldBoundingBox = new THREE.Box3().setFromObject(mesh, true);
  } catch (e) {}

  const ref = {
    mode: mode,
    label: label,
    mesh: mesh,
    pos: new THREE.Vector3(x, y, z),
    slots: [],
    stock: null,
    cooldown: (typeof opts.cooldown === 'number') ? opts.cooldown : 1.25,
    lastTakeAt: 0
  };

  if (mode === 'storage') {
    for (let i = 0; i < slotCount; i++) ref.slots.push(null);
    if (Array.isArray(opts.seed)) {
      opts.seed.forEach(function (s, i) {
        if (i >= ref.slots.length || !s) return;
        ref.slots[i] = Object.assign({}, s);
      });
    }
  } else {
    const sid = (opts.stock && opts.stock.id) || 'pistol_ammo';
    const def = resolveContainerDef(sid);
    ref.stock = {
      id: sid,
      name: (opts.stock && opts.stock.name) || def.name || sid,
      type: def.type || 'ammo',
      ammoType: def.ammoType || (sid.indexOf('ammo') >= 0 ? 'pistol' : undefined),
      amount: (opts.stock && typeof opts.stock.amount === 'number') ? opts.stock.amount : 24,
      healAmount: def.healAmount
    };
  }

  mesh.userData.containerRef = ref;
  mesh.userData.isWorldContainer = true;
  scene.add(mesh);
  if (typeof collidableObjects !== 'undefined' && collidableObjects.indexOf(mesh) === -1) {
    collidableObjects.push(mesh);
  }
  worldContainers.push(ref);
  return ref;
}

function clearWorldContainers() {
  [...worldContainers].forEach(function (c) {
    try {
      scene.remove(c.mesh);
      const i = collidableObjects.indexOf(c.mesh);
      if (i > -1) collidableObjects.splice(i, 1);
      c.mesh.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(function (m) { m.dispose(); });
          else o.material.dispose();
        }
      });
    } catch (e) {}
  });
  worldContainers.length = 0;
  if (containerOpen) try { toggleContainer(false); } catch (e) {}
}

function setContainerStatus(msg) {
  const el = document.getElementById('containerMsg');
  if (el) el.textContent = msg || '';
}

function refreshContainerModal() {
  const ref = currentContainer;
  const body = document.getElementById('containerBody');
  const title = document.getElementById('containerTitle');
  if (!ref || !body) return;
  if (title) title.textContent = (ref.mode === 'dispenser' ? '📦 ' : '🧰 ') + (ref.label || 'Contenedor');

  if (ref.mode === 'dispenser') {
    const s = ref.stock || { name: '?', amount: 0 };
    const left = s.amount || 0;
    const now = performance.now() / 1000;
    const wait = Math.max(0, (ref.lastTakeAt + ref.cooldown) - now);
    body.innerHTML =
      '<div class="rg-hint" style="margin-bottom:8px;">Saca de a 1 · stock limitado</div>' +
      '<div style="font-size:22px;margin-bottom:8px;">' + escHtml(s.name || s.id) + '</div>' +
      '<div style="font-size:20px;margin-bottom:12px;">Stock: <b>' + left + '</b></div>' +
      '<button class="rg-btn rg-btn-primary" id="containerTakeBtn"' +
      (left <= 0 || wait > 0.05 ? ' disabled' : '') + '>' +
      (left <= 0 ? 'Vacío' : (wait > 0.05 ? ('Esperá ' + wait.toFixed(1) + 's') : 'Tomar 1')) +
      '</button>';
    const btn = document.getElementById('containerTakeBtn');
    if (btn) btn.onclick = function () { containerDispenseOne(); };
    return;
  }

  // storage
  let html = '<div class="rg-hint" style="margin-bottom:6px;">Click en un slot del cofre = sacar · click en mochila/recurso = guardar</div>';
  html += '<div style="font-size:18px;margin:6px 0;">Cofre</div><div class="rg-matbar" style="flex-wrap:wrap;gap:6px;">';
  ref.slots.forEach(function (slot, idx) {
    html += '<button class="rg-btn rg-btn-small" data-cslot="' + idx + '">' +
      escHtml(slot ? containerItemLabel(slot) : '· vacío ·') + '</button>';
  });
  html += '</div>';

  html += '<div style="font-size:18px;margin:12px 0 6px;">Tu mochila</div><div class="rg-matbar" style="flex-wrap:wrap;gap:6px;">';
  const inv = (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
  if (inv) {
    inv.items.forEach(function (it, idx) {
      if (!it) return;
      html += '<button class="rg-btn rg-btn-small" data-inv="' + idx + '">' +
        escHtml(containerItemLabel(it)) + '</button>';
    });
    if (!inv.items.length) html += '<span class="rg-hint">Mochila vacía de objetos</span>';
  }
  html += '</div>';

  html += '<div style="font-size:18px;margin:12px 0 6px;">Recursos (guardar 1)</div><div class="rg-matbar" style="gap:6px;">';
  ['wood', 'stone', 'metal'].forEach(function (r) {
    const n = inv ? (inv.resources[r] || 0) : 0;
    const label = (typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[r]) || r;
    html += '<button class="rg-btn rg-btn-small" data-res="' + r + '"' + (n <= 0 ? ' disabled' : '') + '>' +
      escHtml(label) + ' (' + n + ')</button>';
  });
  html += '</div>';

  // Ammo reserve deposit
  if (inv && inv.ammo) {
    html += '<div style="font-size:18px;margin:12px 0 6px;">Munición reserva (guardar 5)</div><div class="rg-matbar" style="gap:6px;">';
    Object.keys(inv.ammo).forEach(function (t) {
      const n = inv.ammo[t] || 0;
      if (n <= 0 && t !== 'pistol') return;
      html += '<button class="rg-btn rg-btn-small" data-ammo="' + t + '"' + (n <= 0 ? ' disabled' : '') + '>' +
        escHtml(t) + ' (' + n + ')</button>';
    });
    html += '</div>';
  }

  body.innerHTML = html;
  body.querySelectorAll('[data-cslot]').forEach(function (b) {
    b.onclick = function () { containerWithdrawSlot(parseInt(b.getAttribute('data-cslot'), 10)); };
  });
  body.querySelectorAll('[data-inv]').forEach(function (b) {
    b.onclick = function () { containerDepositInv(parseInt(b.getAttribute('data-inv'), 10)); };
  });
  body.querySelectorAll('[data-res]').forEach(function (b) {
    b.onclick = function () { containerDepositResource(b.getAttribute('data-res')); };
  });
  body.querySelectorAll('[data-ammo]').forEach(function (b) {
    b.onclick = function () { containerDepositAmmo(b.getAttribute('data-ammo')); };
  });
}

function findFreeOrStackSlot(ref, entry) {
  if (!ref || !entry) return -1;
  for (let i = 0; i < ref.slots.length; i++) {
    const s = ref.slots[i];
    if (s && s.id === entry.id && s.type === entry.type &&
        (s.ammoType || null) === (entry.ammoType || null)) {
      return i;
    }
  }
  for (let j = 0; j < ref.slots.length; j++) {
    if (!ref.slots[j]) return j;
  }
  return -1;
}

function containerDepositInv(idx) {
  const ref = currentContainer;
  const inv = player && player.inventory;
  if (!ref || ref.mode !== 'storage' || !inv) return;
  const item = inv.items[idx];
  if (!item) return;
  if (inv.equippedItem === item) {
    setContainerStatus('Desequipá el ítem antes de guardarlo');
    return;
  }
  const entry = {
    id: item.id,
    name: item.name,
    type: item.type,
    quantity: item.stackable ? (item.quantity || 1) : 1,
    toolType: item.toolType,
    ammoType: item.ammoType,
    magazineSize: item.magazineSize,
    healAmount: item.healAmount,
    damageAmount: item.damageAmount,
    efficiency: item.efficiency,
    stackable: !!item.stackable
  };
  const slot = findFreeOrStackSlot(ref, entry);
  if (slot < 0) { setContainerStatus('Cofre lleno'); return; }
  if (ref.slots[slot] && ref.slots[slot].id === entry.id) {
    ref.slots[slot].quantity = (ref.slots[slot].quantity || 1) + entry.quantity;
  } else {
    ref.slots[slot] = entry;
  }
  inv.removeItem(item, item.stackable ? (item.quantity || 1) : 1);
  try { playSound('pickup'); } catch (e) {}
  setContainerStatus('Guardado: ' + entry.name);
  refreshContainerModal();
  try { inv.updateInventoryUI(); inv.updateQuickSlotUI(); } catch (e) {}
}

function containerDepositResource(resId) {
  const ref = currentContainer;
  const inv = player && player.inventory;
  if (!ref || ref.mode !== 'storage' || !inv) return;
  if ((inv.resources[resId] || 0) < 1) return;
  const entry = {
    id: resId,
    name: (typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[resId]) || resId,
    type: 'resource',
    quantity: 1,
    stackable: true
  };
  const slot = findFreeOrStackSlot(ref, entry);
  if (slot < 0) { setContainerStatus('Cofre lleno'); return; }
  inv.resources[resId] -= 1;
  if (ref.slots[slot] && ref.slots[slot].id === resId) {
    ref.slots[slot].quantity = (ref.slots[slot].quantity || 1) + 1;
  } else {
    ref.slots[slot] = entry;
  }
  try { updateResourceHUD(); playSound('pickup'); } catch (e) {}
  setContainerStatus('Guardado: ' + entry.name);
  refreshContainerModal();
}

function containerDepositAmmo(ammoType) {
  const ref = currentContainer;
  const inv = player && player.inventory;
  if (!ref || ref.mode !== 'storage' || !inv) return;
  const have = inv.ammo[ammoType] || 0;
  if (have <= 0) return;
  const take = Math.min(5, have);
  const entry = {
    id: ammoType + '_ammo',
    name: 'Balas ' + ammoType,
    type: 'ammo',
    ammoType: ammoType,
    quantity: take,
    amount: take,
    stackable: true
  };
  const slot = findFreeOrStackSlot(ref, entry);
  if (slot < 0) { setContainerStatus('Cofre lleno'); return; }
  inv.ammo[ammoType] = have - take;
  if (ref.slots[slot] && ref.slots[slot].ammoType === ammoType && ref.slots[slot].type === 'ammo') {
    ref.slots[slot].quantity = (ref.slots[slot].quantity || 0) + take;
    ref.slots[slot].amount = ref.slots[slot].quantity;
  } else {
    ref.slots[slot] = entry;
  }
  try { inv.updateAmmoUI(); playSound('ammo-pickup'); } catch (e) {}
  setContainerStatus('Guardadas ' + take + ' balas');
  refreshContainerModal();
}

function containerWithdrawSlot(idx) {
  const ref = currentContainer;
  const inv = player && player.inventory;
  if (!ref || ref.mode !== 'storage' || !inv) return;
  const slot = ref.slots[idx];
  if (!slot) return;

  if (slot.type === 'resource') {
    inv.resources[slot.id] = (inv.resources[slot.id] || 0) + (slot.quantity || 1);
    ref.slots[idx] = null;
    try { updateResourceHUD(); playSound('pickup'); } catch (e) {}
    setContainerStatus('Sacaste ' + slot.name);
    refreshContainerModal();
    return;
  }

  if (slot.type === 'ammo') {
    const amt = slot.quantity || slot.amount || 1;
    inv.addAmmo(slot.ammoType || 'pistol', amt);
    ref.slots[idx] = null;
    setContainerStatus('Sacaste munición ×' + amt);
    refreshContainerModal();
    return;
  }

  // item / tool / consumable / weapon
  const def = (typeof ITEM_DEFINITIONS !== 'undefined' && ITEM_DEFINITIONS[slot.id]) || null;
  const entry = Object.assign({}, def || {}, {
    id: slot.id,
    name: slot.name,
    type: slot.type,
    quantity: slot.quantity || 1,
    toolType: slot.toolType,
    ammoType: slot.ammoType,
    magazineSize: slot.magazineSize,
    healAmount: slot.healAmount,
    damageAmount: slot.damageAmount,
    efficiency: slot.efficiency,
    stackable: slot.stackable
  });
  try {
    if (def && def.createModel && (entry.type === 'weapon' || entry.type === 'tool')) {
      entry.model = def.createModel();
    }
  } catch (e) {}
  if (!inv.addItem(entry)) {
    setContainerStatus('Mochila llena');
    return;
  }
  ref.slots[idx] = null;
  try { playSound('pickup'); } catch (e) {}
  setContainerStatus('Sacaste ' + entry.name);
  refreshContainerModal();
  try { inv.updateInventoryUI(); inv.updateQuickSlotUI(); } catch (e) {}
}

function containerDispenseOne() {
  const ref = currentContainer;
  if (!ref || ref.mode !== 'dispenser' || !ref.stock) return;
  const now = performance.now() / 1000;
  if (now < ref.lastTakeAt + ref.cooldown) {
    setContainerStatus('Cooldown…');
    refreshContainerModal();
    return;
  }
  if ((ref.stock.amount || 0) <= 0) {
    setContainerStatus('Vacío');
    refreshContainerModal();
    return;
  }
  const inv = player && player.inventory;
  if (!inv) return;
  const s = ref.stock;
  let ok = false;
  if (s.type === 'ammo' || s.ammoType) {
    ok = inv.addAmmo(s.ammoType || 'pistol', 1);
  } else if (s.type === 'consumable' || s.healAmount || s.id === 'food' || s.id === 'toxin') {
    const def = resolveContainerDef(s.id);
    const entry = Object.assign({}, def, { quantity: 1 });
    try { if (def.createModel) entry.model = def.createModel(); } catch (e) {}
    ok = inv.addItem(entry);
  } else if (s.type === 'resource') {
    inv.resources[s.id] = (inv.resources[s.id] || 0) + 1;
    ok = true;
    try { updateResourceHUD(); } catch (e) {}
  } else {
    const def = resolveContainerDef(s.id);
    const entry = Object.assign({}, def, { quantity: 1 });
    try { if (def.createModel) entry.model = def.createModel(); } catch (e) {}
    ok = inv.addItem(entry);
  }
  if (!ok) {
    setContainerStatus('No pudiste recibir el ítem (mochila?)');
    return;
  }
  ref.stock.amount -= 1;
  ref.lastTakeAt = now;
  try { playSound('pickup'); } catch (e) {}
  setContainerStatus('Tomaste 1 × ' + (s.name || s.id));
  refreshContainerModal();
  // Refrescar botón cuando termine el cooldown.
  try {
    setTimeout(function () {
      if (containerOpen && currentContainer === ref) refreshContainerModal();
    }, Math.ceil(ref.cooldown * 1000) + 30);
  } catch (e) {}
}

function toggleContainer(open, ref) {
  const modal = document.getElementById('containerModal');
  if (!modal) return;
  if (open) {
    currentContainer = ref || currentContainer;
    if (!currentContainer) return;
    if (typeof invOpen !== 'undefined' && invOpen) toggleInventory();
    if (typeof benchOpen !== 'undefined' && benchOpen) toggleBench(false);
    if (typeof totemOpen !== 'undefined' && totemOpen) toggleTotem(false);
    if (typeof cartelOpen !== 'undefined' && cartelOpen) toggleCartel(false);
    if (typeof pauseMenu !== 'undefined' && pauseMenu) pauseMenu.style.display = 'none';
    isGamePaused = true;
    try { document.exitPointerLock(); } catch (e) {}
    setContainerStatus('');
    refreshContainerModal();
    modal.style.display = 'flex';
    containerOpen = true;
    openModal = 'container';
  } else {
    modal.style.display = 'none';
    containerOpen = false;
    currentContainer = null;
    if (typeof openModal !== 'undefined' && openModal === 'container') openModal = null;
    if ((typeof invOpen === 'undefined' || !invOpen) && (typeof benchOpen === 'undefined' || !benchOpen)) {
      isGamePaused = false;
      lockPointer();
    }
  }
}

function tryOpenWorldContainer() {
  if (typeof player === 'undefined' || !player || !worldContainers.length) return false;
  const o = new THREE.Vector3(); camera.getWorldPosition(o);
  const d = camera.getWorldDirection(new THREE.Vector3());
  const ray = new THREE.Raycaster(o, d, 0.1, 3.4);
  const hits = ray.intersectObjects(worldContainers.map(function (c) { return c.mesh; }), true);
  for (let i = 0; i < hits.length; i++) {
    let p = hits[i].object, ref = null;
    while (p) {
      if (p.userData && p.userData.containerRef) { ref = p.userData.containerRef; break; }
      p = p.parent;
    }
    if (ref) {
      if (containerOpen && currentContainer === ref) toggleContainer(false);
      else toggleContainer(true, ref);
      return true;
    }
  }
  return false;
}

function containerLookPrompt() {
  if (typeof camera === 'undefined' || !camera || !worldContainers.length) return '';
  const o = new THREE.Vector3(); camera.getWorldPosition(o);
  const d = camera.getWorldDirection(new THREE.Vector3());
  const ray = new THREE.Raycaster(o, d, 0.1, 3.4);
  const hits = ray.intersectObjects(worldContainers.map(function (c) { return c.mesh; }), true);
  if (!hits.length) return '';
  let p = hits[0].object;
  while (p) {
    if (p.userData && p.userData.containerRef) {
      const ref = p.userData.containerRef;
      return ref.mode === 'dispenser' ? '[E] Usar dispenser' : '[E] Abrir cofre';
    }
    p = p.parent;
  }
  return '';
}
