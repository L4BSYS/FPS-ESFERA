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
    takeAmount: (typeof opts.takeAmount === 'number') ? Math.max(1, opts.takeAmount | 0) : 10,
    stockMax: 0,
    lastTakeAt: 0
  };

  if (mode === 'storage') {
    for (let i = 0; i < slotCount; i++) ref.slots.push(null);
    if (Array.isArray(opts.seed)) {
      opts.seed.forEach(function (s, i) {
        if (i >= ref.slots.length || !s) return;
        ref.slots[i] = normalizeChestEntry(Object.assign({}, s));
      });
    }
  } else {
    const sid = (opts.stock && opts.stock.id) || 'pistol_ammo';
    const def = resolveContainerDef(sid);
    const amount = (opts.stock && typeof opts.stock.amount === 'number') ? opts.stock.amount : 24;
    ref.stock = {
      id: sid,
      name: (opts.stock && opts.stock.name) || def.name || sid,
      type: def.type || 'ammo',
      ammoType: def.ammoType || (sid.indexOf('ammo') >= 0 ? 'pistol' : undefined),
      amount: amount,
      healAmount: def.healAmount
    };
    ref.stockMax = (typeof opts.stockMax === 'number') ? opts.stockMax : amount;
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

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function chestStackCap(entry) {
  if (!entry) return 1;
  if (entry.type === 'resource') return entry.maxStack || 10;
  if (entry.type === 'ammo') {
    if (entry.maxStack) return entry.maxStack;
    if (typeof player !== 'undefined' && player && player.inventory && typeof player.inventory.getMaxAmmo === 'function') {
      return player.inventory.getMaxAmmo(entry.ammoType || 'pistol') || 60;
    }
    return 60;
  }
  if (entry.stackable) return entry.maxStack || 99;
  return 1;
}

function chestEntriesMatch(a, b) {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.type === 'resource') {
    return (a.resourceKey || a.id) === (b.resourceKey || b.id);
  }
  if (a.type === 'ammo') {
    return (a.ammoType || null) === (b.ammoType || null);
  }
  return a.id === b.id;
}

function normalizeChestEntry(raw) {
  if (!raw) return null;
  const entry = Object.assign({}, raw);
  if (entry.type === 'resource' || entry.resourceKey ||
      entry.id === 'wood' || entry.id === 'stone' || entry.id === 'metal') {
    const key = entry.resourceKey || entry.id;
    entry.type = 'resource';
    entry.id = key;
    entry.resourceKey = key;
    entry.name = entry.name || ((typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[key]) || key);
    entry.stackable = true;
    entry.maxStack = entry.maxStack || 10;
  } else if (entry.type === 'ammo' || entry.ammoType) {
    entry.type = 'ammo';
    entry.stackable = true;
    entry.ammoType = entry.ammoType || 'pistol';
    entry.id = entry.id || (entry.ammoType + '_ammo');
    entry.name = entry.name || ('Balas ' + entry.ammoType);
    entry.amount = entry.quantity || entry.amount || 1;
    entry.quantity = entry.amount;
  } else {
    entry.quantity = entry.stackable ? (entry.quantity || 1) : 1;
  }
  return entry;
}

function chestCanFitEntry(ref, entry) {
  if (!ref || !entry) return false;
  let left = entry.stackable ? (entry.quantity || 1) : 1;
  const cap = chestStackCap(entry);
  for (let i = 0; i < ref.slots.length; i++) {
    const s = ref.slots[i];
    if (s && chestEntriesMatch(s, entry)) {
      const space = cap - (s.quantity || 0);
      if (space > 0) left -= Math.min(space, left);
    }
  }
  if (left <= 0) return true;
  for (let j = 0; j < ref.slots.length; j++) {
    if (!ref.slots[j]) {
      left -= Math.min(cap, left);
      if (left <= 0) return true;
    }
  }
  return left <= 0;
}

function chestInsertEntry(ref, entry) {
  if (!ref || !entry) return false;
  const normalized = normalizeChestEntry(entry);
  if (!normalized) return false;
  if (!chestCanFitEntry(ref, normalized)) return false;
  let left = normalized.stackable ? (normalized.quantity || 1) : 1;
  const cap = chestStackCap(normalized);
  for (let i = 0; i < ref.slots.length && left > 0; i++) {
    const s = ref.slots[i];
    if (!s || !chestEntriesMatch(s, normalized)) continue;
    const space = cap - (s.quantity || 0);
    if (space <= 0) continue;
    const take = Math.min(space, left);
    s.quantity = (s.quantity || 0) + take;
    if (s.type === 'ammo') s.amount = s.quantity;
    left -= take;
  }
  while (left > 0) {
    let free = -1;
    for (let j = 0; j < ref.slots.length; j++) {
      if (!ref.slots[j]) { free = j; break; }
    }
    if (free < 0) return false;
    const take = Math.min(cap, left);
    const slotEntry = Object.assign({}, normalized, { quantity: take });
    if (slotEntry.type === 'ammo') slotEntry.amount = take;
    ref.slots[free] = slotEntry;
    left -= take;
  }
  return true;
}

function chestSlotIcon(slot) {
  if (!slot) return '·';
  if (typeof itemIcon === 'function') {
    return itemIcon({
      id: slot.id,
      type: slot.type,
      resourceKey: slot.resourceKey || (slot.type === 'resource' ? slot.id : undefined),
      toolType: slot.toolType,
      ammoType: slot.ammoType
    }).trim();
  }
  return '▫️';
}

function renderChestSlotsGrid(ref) {
  const slotsBox = document.getElementById('containerSlots');
  if (!slotsBox || !ref) return;
  slotsBox.innerHTML = '';
  slotsBox.classList.add('rg-inv-grid');
  (ref.slots || []).forEach(function (slot, idx) {
    const cell = document.createElement('div');
    cell.className = 'rg-inv-slot-cell' + (slot ? '' : ' is-empty');
    cell.setAttribute('data-chest-idx', idx);
    if (slot) {
      cell.classList.add('rg-drag-handle');
      cell.setAttribute('data-chest-drag', idx);
      const qty = slot.quantity || slot.amount || 1;
      cell.innerHTML =
        '<span class="rg-inv-slot-ico">' + chestSlotIcon(slot) + '</span>' +
        '<span class="rg-inv-slot-name">' + (slot.name || slot.id || '') + '</span>' +
        (qty > 1 ? ('<span class="rg-inv-slot-qty">×' + qty + '</span>') : '');
      cell.title = containerItemLabel(slot) + ' · click / arrastrá → mochila';
    } else {
      cell.innerHTML = '<span class="rg-inv-slot-ico">·</span>';
    }
    slotsBox.appendChild(cell);
  });
}

function dispenserProductIcon(stock) {
  if (!stock) return '📦';
  if (typeof itemIcon === 'function') {
    return itemIcon({
      id: stock.id,
      type: stock.type,
      ammoType: stock.ammoType,
      resourceKey: stock.type === 'resource' ? stock.id : undefined,
      healAmount: stock.healAmount
    }).trim() || '📦';
  }
  if (stock.type === 'ammo' || stock.ammoType) return '📦';
  if (stock.type === 'resource') {
    if (stock.id === 'wood') return '🪵';
    if (stock.id === 'stone') return '🪨';
    if (stock.id === 'metal') return '⚙️';
  }
  return '📦';
}

function refreshContainerModal() {
  const ref = currentContainer;
  const title = document.getElementById('containerTitle');
  const hint = document.getElementById('containerHint');
  const storageEl = document.getElementById('containerStorage');
  const dispEl = document.getElementById('containerDispenser');
  const card = document.querySelector('#containerModal .rg-chest-card');
  if (!ref) return;
  if (title) title.textContent = (ref.mode === 'dispenser' ? '📦 ' : '🧰 ') + (ref.label || (ref.mode === 'dispenser' ? 'Dispenser' : 'Cofre'));
  if (card) card.classList.toggle('is-dispenser', ref.mode === 'dispenser');

  const inv = (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
  try { if (inv && typeof inv.ensureResourceStacksMigrated === 'function') inv.ensureResourceStacksMigrated(); } catch (e) {}

  if (ref.mode === 'dispenser') {
    if (hint) hint.textContent = 'Tomá de a ' + (ref.takeAmount || 10) + ' · mirá tu mochila a la izquierda · stock limitado';
    if (storageEl) storageEl.style.display = 'none';
    if (dispEl) dispEl.style.display = '';
    if (typeof renderPlayerItemsInto === 'function') {
      renderPlayerItemsInto(document.getElementById('containerDispItems'), {
        allowDrag: false,
        showDrop: false,
        asGrid: true,
        disableUse: true
      });
    }
    const s = ref.stock || { name: '?', amount: 0 };
    const left = s.amount || 0;
    const max = Math.max(1, ref.stockMax || left || 1);
    const takeN = ref.takeAmount || 10;
    const now = performance.now() / 1000;
    const wait = Math.max(0, (ref.lastTakeAt + ref.cooldown) - now);
    const ico = document.getElementById('containerDispIco');
    const nameEl = document.getElementById('containerDispName');
    const stockTxt = document.getElementById('containerDispStockTxt');
    const stockBar = document.getElementById('containerDispStockBar');
    const cdEl = document.getElementById('containerDispCd');
    const btn = document.getElementById('containerTakeBtn');
    if (ico) ico.textContent = dispenserProductIcon(s);
    if (nameEl) nameEl.textContent = s.name || s.id || '—';
    if (stockTxt) stockTxt.textContent = left + ' / ' + max;
    if (stockBar) {
      const r = Math.max(0, Math.min(1, left / max));
      stockBar.style.width = (r * 100) + '%';
      stockBar.style.background = r > 0.4 ? '#4CAF50' : (r > 0.15 ? '#FFA500' : '#ff3333');
    }
    const canTake = left > 0 && wait <= 0.05;
    if (btn) {
      btn.disabled = !canTake;
      if (left <= 0) btn.textContent = 'Vacío';
      else if (wait > 0.05) btn.textContent = 'Esperá ' + wait.toFixed(1) + 's';
      else btn.textContent = 'Tomar ' + Math.min(takeN, left);
      btn.onclick = function () { containerDispenseBatch(); };
    }
    if (cdEl) {
      cdEl.textContent = left <= 0
        ? 'Sin stock'
        : (wait > 0.05 ? ('Cooldown ' + wait.toFixed(1) + 's') : ('Listo · suelta hasta ' + takeN));
    }
    if (wait > 0.05) {
      try {
        clearTimeout(ref._cdTimer);
        ref._cdTimer = setTimeout(function () {
          if (containerOpen && currentContainer === ref) refreshContainerModal();
        }, Math.ceil(wait * 1000) + 40);
      } catch (e) {}
    }
    return;
  }

  // --- storage (cofre) ---
  if (hint) hint.textContent = 'Arrastrá fichas entre Cosas y Cofre · click guarda/saca el stack';
  if (storageEl) storageEl.style.display = '';
  if (dispEl) dispEl.style.display = 'none';

  if (typeof renderPlayerItemsInto === 'function') {
    renderPlayerItemsInto(document.getElementById('containerInvItems'), {
      allowDrag: true,
      showDrop: false,
      asGrid: true,
      disableUse: true,
      titleSuffix: ' · click → cofre'
    });
  }
  renderChestSlotsGrid(ref);
}

function findFreeOrStackSlot(ref, entry) {
  if (!ref || !entry) return -1;
  const norm = normalizeChestEntry(entry);
  const cap = chestStackCap(norm);
  for (let i = 0; i < ref.slots.length; i++) {
    const s = ref.slots[i];
    if (s && chestEntriesMatch(s, norm) && (s.quantity || 0) < cap) return i;
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
  const entry = normalizeChestEntry({
    id: item.id,
    name: item.name,
    type: item.type,
    quantity: item.stackable ? (item.quantity || 1) : 1,
    resourceKey: item.resourceKey,
    toolType: item.toolType,
    ammoType: item.ammoType,
    magazineSize: item.magazineSize,
    healAmount: item.healAmount,
    damageAmount: item.damageAmount,
    efficiency: item.efficiency,
    stackable: !!item.stackable,
    maxStack: item.maxStack
  });
  if (!chestInsertEntry(ref, entry)) {
    setContainerStatus('Cofre lleno');
    return;
  }
  const qty = item.stackable ? (item.quantity || 1) : 1;
  inv.removeItem(item, qty);
  try { playSound('pickup'); } catch (e) {}
  setContainerStatus('Guardado: ' + entry.name);
  refreshContainerModal();
  try { inv.updateInventoryUI(); inv.updateQuickSlotUI(); } catch (e) {}
}

// Legacy helpers (por si quedan callers): depositan 1 recurso / hasta 5 balas como ficha
function containerDepositResource(resId) {
  const inv = player && player.inventory;
  if (!inv) return;
  const idx = inv.items.findIndex(function (it) {
    return it && it.type === 'resource' && (it.resourceKey || it.id) === resId;
  });
  if (idx >= 0) containerDepositInv(idx);
}

function containerDepositAmmo(ammoType) {
  const inv = player && player.inventory;
  if (!inv) return;
  const idx = inv.items.findIndex(function (it) {
    return it && it.type === 'ammo' && it.ammoType === ammoType;
  });
  if (idx >= 0) containerDepositInv(idx);
}

function containerWithdrawSlot(idx) {
  const ref = currentContainer;
  const inv = player && player.inventory;
  if (!ref || ref.mode !== 'storage' || !inv) return;
  const slot = ref.slots[idx];
  if (!slot) return;

  if (slot.type === 'resource') {
    const key = slot.resourceKey || slot.id;
    if (typeof inv.addResource === 'function') inv.addResource(key, slot.quantity || 1);
    else inv.resources[key] = (inv.resources[key] || 0) + (slot.quantity || 1);
    ref.slots[idx] = null;
    try { updateResourceHUD(); playSound('pickup'); } catch (e) {}
    setContainerStatus('Sacaste ' + (slot.name || key));
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

function containerDispenseBatch() {
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
  const want = Math.min(ref.takeAmount || 10, ref.stock.amount || 0);
  if (want <= 0) return;
  let given = 0;

  if (s.type === 'ammo' || s.ammoType) {
    const at = s.ammoType || 'pistol';
    const before = inv.ammo[at] || 0;
    const ok = inv.addAmmo(at, want);
    const after = inv.ammo[at] || 0;
    given = Math.max(0, after - before);
    if ((!ok && given <= 0) || given <= 0) {
      setContainerStatus(before >= (inv.getMaxAmmo ? inv.getMaxAmmo(at) : 60)
        ? 'Ya estás al tope de balas'
        : 'No pudiste recibir munición (mochila?)');
      return;
    }
  } else if (s.type === 'resource') {
    const key = s.resourceKey || s.id;
    if (typeof inv.addResource === 'function') {
      const before = inv.getResourceCount ? inv.getResourceCount(key) : (inv.resources[key] || 0);
      inv.addResource(key, want);
      const after = inv.getResourceCount ? inv.getResourceCount(key) : (inv.resources[key] || 0);
      given = Math.max(0, after - before);
    } else {
      inv.resources[key] = (inv.resources[key] || 0) + want;
      given = want;
      try { updateResourceHUD(); } catch (e) {}
    }
    if (given <= 0) {
      setContainerStatus('Mochila llena');
      return;
    }
  } else if (s.type === 'consumable' || s.healAmount || s.id === 'food' || s.id === 'toxin') {
    const def = resolveContainerDef(s.id);
    for (let i = 0; i < want; i++) {
      const entry = Object.assign({}, def, { quantity: 1 });
      try { if (def.createModel) entry.model = def.createModel(); } catch (e) {}
      if (!inv.addItem(entry)) break;
      given++;
    }
    if (given <= 0) {
      setContainerStatus('Mochila llena');
      return;
    }
  } else {
    const def = resolveContainerDef(s.id);
    for (let i = 0; i < want; i++) {
      const entry = Object.assign({}, def, { quantity: 1 });
      try { if (def.createModel) entry.model = def.createModel(); } catch (e) {}
      if (!inv.addItem(entry)) break;
      given++;
    }
    if (given <= 0) {
      setContainerStatus('Mochila llena');
      return;
    }
  }

  ref.stock.amount = Math.max(0, (ref.stock.amount || 0) - given);
  ref.lastTakeAt = now;
  try { playSound(s.type === 'ammo' || s.ammoType ? 'ammo-pickup' : 'pickup'); } catch (e) {}
  setContainerStatus('Tomaste ' + given + ' × ' + (s.name || s.id));
  refreshContainerModal();
  try {
    clearTimeout(ref._cdTimer);
    ref._cdTimer = setTimeout(function () {
      if (containerOpen && currentContainer === ref) refreshContainerModal();
    }, Math.ceil(ref.cooldown * 1000) + 40);
  } catch (e) {}
}
// alias legacy
function containerDispenseOne() { containerDispenseBatch(); }

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
    try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (e) {}
  } else {
    modal.style.display = 'none';
    containerOpen = false;
    currentContainer = null;
    if (typeof openModal !== 'undefined' && openModal === 'container') openModal = null;
    try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (e) {}
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

// DnD Cosas↔Cofre → js/30-station-drag.js
