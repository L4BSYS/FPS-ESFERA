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

var containerSelected = null;

function containerSlotEl(area, idx, item, ref) {
  return makeItemSlot(item, {
    surface: 'container',
    area: area,
    idx: idx,
    selected: !!(containerSelected && containerSelected.area === area && containerSelected.idx === idx),
    emptyIcon: '·',
    emptyTitle: area === 'chest' ? 'Espacio libre del cofre' : (area === 'belt' ? 'Casillero del cinturón' : 'Espacio libre de la mochila'),
    keyLabel: area === 'belt' ? String(idx + 1) : ''
  });
}

function containerSelectedItem(ref) {
  if (!containerSelected) return null;
  if (containerSelected.area === 'chest') return (ref && ref.slots) ? (ref.slots[containerSelected.idx] || null) : null;
  const inv = getPlayerInv();
  return inv ? inv.itemAt(containerSelected.area, containerSelected.idx) : null;
}

function renderContainerDetail(ref) {
  const detail = document.getElementById('containerDetail');
  const actions = document.getElementById('containerActions');
  if (!detail || !actions) return;
  detail.innerHTML = '';
  actions.innerHTML = '';
  const item = containerSelectedItem(ref);
  if (!item) {
    detail.innerHTML = '<b>Seleccioná un objeto</b><br>' +
      'Clic para elegir; doble clic para mover entre cofre, cinturón y mochila. ' +
      'También podés arrastrar de un lado al otro.';
    return;
  }
  const sel = containerSelected;
  const title = document.createElement('div');
  title.className = 'inv-detail-title';
  title.textContent = itemIcon(item) + ' ' + item.name + ((item.quantity || 1) > 1 ? ' ×' + item.quantity : '');
  detail.appendChild(title);
  const meta = document.createElement('div');
  meta.className = 'inv-detail-meta';
  meta.textContent = invTypeLabel(item) + (sel.area === 'chest' ? ' · cofre' : (sel.area === 'belt' ? ' · cinturón ' + (sel.idx + 1) : ' · mochila'));
  detail.appendChild(meta);
  const desc = document.createElement('div');
  desc.className = 'inv-detail-desc';
  desc.textContent = invItemDesc(item, getPlayerInv());
  detail.appendChild(desc);

  if (sel.area === 'chest') {
    actions.appendChild(invDetailBtn('Pasar a la mochila', 'rg-btn-primary', () => {
      containerWithdrawSlot(sel.idx);
      containerSelected = null;
      refreshContainerModal();
    }));
    return;
  }

  const inv = getPlayerInv();
  if (item.toolType || item.type === 'weapon') {
    if (inv && inv.equippedItem === item) {
      actions.appendChild(invDetailBtn('Desequipar', '', () => {
        inv.unequipItem();
        try { player.currentTool = TOOLS.HANDS; player.updateToolHUD(); } catch (e) {}
        renderContainerDetail(ref);
      }));
    } else {
      actions.appendChild(invDetailBtn('Equipar', 'rg-btn-primary', () => {
        if (inv) inv.equipItem(item);
        try { player.updateToolHUD(); updateActionButton(); } catch (e) {}
        renderContainerDetail(ref);
      }));
    }
  } else if (item.type === 'consumable' && item.healAmount > 0) {
    actions.appendChild(invDetailBtn('Usar', 'rg-btn-primary', () => {
      if (inv) inv.useItem(item);
      try { if (typeof directorOnFoodLesson === 'function') directorOnFoodLesson(); } catch (e) {}
      renderContainerDetail(ref);
    }));
  } else if (item.type === 'ammo') {
    actions.appendChild(invDetailBtn('Recargar arma', 'rg-btn-primary', () => {
      if (inv && inv.equippedItem && inv.equippedItem.ammoType) inv.reloadWeapon();
      else setContainerStatus('Equipá un arma para recargar');
      renderContainerDetail(ref);
    }));
  }
  const equipped = !!(inv && inv.equippedItem === item);
  actions.appendChild(invDetailBtn('Guardar en cofre', 'rg-btn-primary', () => {
    if (equipped) { setContainerStatus('Desequipá el ítem antes de guardarlo'); return; }
    containerDepositInv(sel.area, sel.idx);
    containerSelected = null;
    refreshContainerModal();
  }));
  if (invCanDrop(item)) {
    actions.appendChild(invDetailBtn('Soltar', 'rg-btn-warn', () => {
      invDropSlot(sel.area, sel.idx);
      containerSelected = null;
      refreshContainerModal();
    }));
  }
}

function refreshContainerModal() {
  const ref = currentContainer;
  const body = document.getElementById('containerBody');
  const title = document.getElementById('containerTitle');
  if (!ref || !body) return;
  if (title) title.textContent = (ref.mode === 'dispenser' ? '📦 ' : '🧰 ') + (ref.label || 'Contenedor');
  if (containerSelected && !containerSelectedItem(ref)) containerSelected = null;

  const inv = getPlayerInv();
  body.innerHTML = '';

  // ---- Columna izquierda: cofre o dispenser ----
  const left = document.createElement('section');
  left.className = 'rg-item-col';
  if (ref.mode === 'dispenser') {
    left.innerHTML = '<div class="rg-inv-label">DISPENSER <span>saca de a 1</span></div>';
    const box = document.createElement('div');
    box.className = 'rg-inv-detail';
    const s = ref.stock || { name: 'Balas', amount: 0 };
    const stock = s.amount || 0;
    const now = performance.now() / 1000;
    const wait = Math.max(0, (ref.lastTakeAt + ref.cooldown) - now);
    const h = document.createElement('div');
    h.className = 'inv-detail-title';
    h.textContent = '📦 ' + (s.name || 'Balas');
    box.appendChild(h);
    const d = document.createElement('div');
    d.className = 'inv-detail-desc';
    d.textContent = 'Stock: ' + stock + ' balas.\nTomá munición de a una; con una mesa asociada podés producir lotes usando el almacén.';
    box.appendChild(d);

    const takeBtn = document.createElement('button');
    takeBtn.className = 'rg-btn rg-btn-primary';
    takeBtn.disabled = stock <= 0 || wait > 0.05;
    takeBtn.textContent = stock <= 0 ? 'Vacío' : (wait > 0.05 ? ('Esperá ' + wait.toFixed(1) + 's') : 'Tomar 1');
    takeBtn.addEventListener('click', () => containerDispenseOne());
    box.appendChild(takeBtn);

    const linked = (typeof containerLinkedBench === 'function') ? containerLinkedBench(ref) : null;
    if (linked && typeof benchStorageTotals === 'function') {
      const totals = benchStorageTotals(linked);
      const cost = (typeof BENCH_AMMO_COST !== 'undefined') ? BENCH_AMMO_COST : { metal: 2, wood: 1 };
      const batch = (typeof BENCH_AMMO_BATCH !== 'undefined') ? BENCH_AMMO_BATCH : 12;
      const can = Object.keys(cost).every(k => (totals[k] || 0) >= cost[k]);
      const link = document.createElement('div');
      link.className = 'rg-hint';
      link.style.margin = '8px 0 4px';
      link.textContent = 'Mesa asociada · almacén: 🪵 ' + (totals.wood || 0) + ' · 🪨 ' + (totals.stone || 0) + ' · ⚙️ ' + (totals.metal || 0);
      box.appendChild(link);
      const prodBtn = document.createElement('button');
      prodBtn.className = 'rg-btn rg-btn-small rg-btn-primary';
      prodBtn.disabled = !can;
      prodBtn.textContent = 'Producir ' + batch + ' balas (' + cost.metal + ' metal + ' + cost.wood + ' madera)';
      prodBtn.addEventListener('click', () => containerProduceAmmo());
      box.appendChild(prodBtn);
    } else {
      const hint = document.createElement('div');
      hint.className = 'rg-hint';
      hint.textContent = 'Colocá este dispenser dentro del área de una mesa para producir munición con recursos del almacén.';
      box.appendChild(hint);
    }
    left.appendChild(box);
  } else {
    left.innerHTML = '<div class="rg-inv-label">COFRE <span>' + ref.slots.length + ' espacios</span></div>';
    const grid = document.createElement('div');
    grid.className = 'rg-item-grid';
    ref.slots.forEach((slot, idx) => grid.appendChild(containerSlotEl('chest', idx, slot, ref)));
    left.appendChild(grid);
  }
  body.appendChild(left);

  // ---- Columna central: cinturón + mochila ----
  const mid = document.createElement('section');
  mid.className = 'rg-item-col';
  if (inv) {
    const beltLabel = document.createElement('div');
    beltLabel.className = 'rg-inv-label';
    beltLabel.innerHTML = 'CINTURÓN <span>teclas 1-5</span>';
    mid.appendChild(beltLabel);
    const belt = document.createElement('div');
    belt.className = 'rg-item-grid rg-belt-grid';
    for (let i = 0; i < inv.quickSlots.length; i++) belt.appendChild(containerSlotEl('belt', i, inv.quickSlots[i], ref));
    mid.appendChild(belt);
    const bagLabel = document.createElement('div');
    bagLabel.className = 'rg-inv-label';
    bagLabel.innerHTML = 'MOCHILA <span>' + inv.usedBagSlots + '/' + inv.capacity + '</span>';
    mid.appendChild(bagLabel);
    const bag = document.createElement('div');
    bag.className = 'rg-item-grid';
    for (let i = 0; i < inv.capacity; i++) bag.appendChild(containerSlotEl('bag', i, inv.slots[i], ref));
    mid.appendChild(bag);
  }
  body.appendChild(mid);

  // ---- Columna derecha: detalle ----
  const side = document.createElement('aside');
  side.className = 'rg-item-side';
  const detail = document.createElement('div');
  detail.id = 'containerDetail';
  detail.className = 'rg-inv-detail';
  side.appendChild(detail);
  const actions = document.createElement('div');
  actions.id = 'containerActions';
  actions.className = 'rg-item-actions';
  side.appendChild(actions);
  body.appendChild(side);

  renderContainerDetail(ref);
  document.querySelectorAll('#containerBody .inv-slot[data-surface="container"]').forEach((el) => {
    const area = el.dataset.area;
    const idx = parseInt(el.dataset.idx, 10);
    el.addEventListener('click', () => {
      containerSelected = { area: area, idx: idx };
      refreshContainerModal();
    });
    el.addEventListener('dblclick', () => {
      if (area === 'chest') containerWithdrawSlot(idx);
      else containerDepositInv(area, idx);
      containerSelected = null;
      refreshContainerModal();
    });
  });
  try { renderMaterialChips(document.getElementById('containerFoot')); } catch (e) {}
  const hint = document.getElementById('containerHint');
  if (hint) hint.textContent = ref.mode === 'dispenser'
    ? 'Clic para seleccionar · doble clic mueve objetos · el stock de balas se toma con los botones'
    : 'Clic para seleccionar · doble clic para mover · arrastrá entre cofre, cinturón y mochila';
}

// --- Mover/ordenar dentro del cofre y arrastrar entre cofre e inventario ---
function containerMoveSlot(from, to) {
  const ref = currentContainer;
  if (!ref || ref.mode !== 'storage' || !ref.slots) return;
  if (from === to) return;
  const a = ref.slots[from];
  if (!a) return;
  const b = ref.slots[to];
  const same = b && a.id === b.id && a.type === b.type && (a.ammoType || null) === (b.ammoType || null);
  if (same) {
    const max = a.type === 'resource' ? 200 : ((typeof INV_AMMO_STACK !== 'undefined' && INV_AMMO_STACK[a.ammoType]) || 200);
    const space = Math.max(0, max - (b.quantity || 0));
    const take = Math.min(space, a.quantity || 1);
    if (take > 0) {
      b.quantity = (b.quantity || 0) + take;
      a.quantity = (a.quantity || 0) - take;
      if ((a.quantity || 0) <= 0) ref.slots[from] = null;
    }
  } else {
    ref.slots[to] = a;
    ref.slots[from] = b || null;
  }
  refreshContainerModal();
}

function containerSlotUnder(x, y) {
  const els = document.querySelectorAll('#containerBody .inv-slot[data-surface="container"]');
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return { area: el.dataset.area, idx: parseInt(el.dataset.idx, 10) };
    }
  }
  return null;
}

var _containerDrag = null;
document.addEventListener('pointerdown', (e) => {
  if (!containerOpen) return;
  if (e.target && e.target.closest && e.target.closest('button')) return;
  const el = e.target && e.target.closest ? e.target.closest('#containerBody .inv-slot[data-surface="container"]') : null;
  if (!el) return;
  const area = el.dataset.area;
  const idx = parseInt(el.dataset.idx, 10);
  const ref = currentContainer;
  const item = area === 'chest' ? (ref && ref.slots ? ref.slots[idx] : null) : (getPlayerInv() ? getPlayerInv().itemAt(area, idx) : null);
  if (!item) return;
  containerSelected = { area: area, idx: idx };
  e.preventDefault();
  _containerDrag = { area: area, idx: idx, item: item, x: e.clientX, y: e.clientY, moved: false };
});
document.addEventListener('pointermove', (e) => {
  if (!_containerDrag) return;
  if (Math.abs(e.clientX - _containerDrag.x) + Math.abs(e.clientY - _containerDrag.y) > 6) {
    _containerDrag.moved = true;
    try { invDragGhost(_containerDrag.item, e.clientX, e.clientY); } catch (err) {}
  }
});
document.addEventListener('pointerup', (e) => {
  if (!_containerDrag) return;
  const drag = _containerDrag;
  _containerDrag = null;
  const g = document.getElementById('invDragGhost');
  if (g) g.remove();
  if (!drag.moved) return;
  const target = containerSlotUnder(e.clientX, e.clientY);
  const inv = getPlayerInv();
  if (target) {
    if (drag.area === 'chest' && target.area === 'chest') {
      containerMoveSlot(drag.idx, target.idx);
    } else if (drag.area !== 'chest' && target.area === 'chest') {
      containerDepositInv(drag.area, drag.idx);
    } else if (drag.area === 'chest' && target.area !== 'chest') {
      containerWithdrawSlot(drag.idx);
    } else if (inv && drag.area !== 'chest' && target.area !== 'chest') {
      inv.moveItem(drag.area, drag.idx, target.area, target.idx);
    }
  }
  containerSelected = target;
  refreshContainerModal();
});
document.addEventListener('pointercancel', () => {
  if (!_containerDrag) return;
  _containerDrag = null;
  const g = document.getElementById('invDragGhost');
  if (g) g.remove();
  refreshContainerModal();
});


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

function containerDepositInv(area, idx) {
  const ref = currentContainer;
  const inv = player && player.inventory;
  if (!ref || ref.mode !== 'storage' || !inv) return;
  const item = (typeof inv.itemAt === 'function') ? inv.itemAt(area, idx) : inv.items[idx];
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
  if ((inv.countResource ? inv.countResource(resId) : (inv.resources[resId] || 0)) < 1) return;
  const entry = {
    id: resId,
    name: (typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[resId]) || resId,
    type: 'resource',
    quantity: 1,
    stackable: true
  };
  const slot = findFreeOrStackSlot(ref, entry);
  if (slot < 0) { setContainerStatus('Cofre lleno'); return; }
  inv.removeResource(resId, 1);
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
  const have = (inv.countAmmo ? inv.countAmmo(ammoType) : (inv.ammo[ammoType] || 0));
  if (have <= 0) return;
  const want = Math.min(5, have);
  const entry = {
    id: ammoType + '_ammo',
    name: 'Balas ' + ammoType,
    type: 'ammo',
    ammoType: ammoType,
    quantity: want,
    amount: want,
    stackable: true
  };
  const slot = findFreeOrStackSlot(ref, entry);
  if (slot < 0) { setContainerStatus('Cofre lleno'); return; }
  const take = inv.removeAmmo(ammoType, want);
  if (take <= 0) return;
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
    const moved = inv.addResource(slot.id, slot.quantity || 1);
    if (moved <= 0) { setContainerStatus('Mochila llena'); return; }
    slot.quantity = (slot.quantity || 1) - moved;
    if (slot.quantity <= 0) ref.slots[idx] = null;
    try { updateResourceHUD(); playSound('pickup'); } catch (e) {}
    setContainerStatus('Sacaste ' + moved + ' ' + slot.name);
    refreshContainerModal();
    return;
  }

  if (slot.type === 'ammo') {
    const amt = slot.quantity || slot.amount || 1;
    const moved = inv.addAmmoAmount ? inv.addAmmoAmount(slot.ammoType || 'pistol', amt) : (inv.addAmmo(slot.ammoType || 'pistol', amt) ? amt : 0);
    if (moved <= 0) { setContainerStatus('Mochila llena'); return; }
    slot.quantity = amt - moved;
    slot.amount = slot.quantity;
    if (slot.quantity <= 0) ref.slots[idx] = null;
    setContainerStatus('Sacaste munición ×' + moved);
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
  const qty = Math.max(1, Math.floor(entry.quantity || 1));
  let moved = 0;
  if (entry.stackable && qty > 1) {
    // Alta de a una: si la mochila se llena a mitad de camino no duplicamos.
    for (let k = 0; k < qty; k++) {
      if (!inv.addItem(Object.assign({}, entry, { quantity: 1 }))) break;
      moved++;
    }
  } else if (inv.addItem(entry)) {
    moved = qty;
  }
  if (moved <= 0) {
    setContainerStatus('Mochila llena');
    return;
  }
  if (entry.stackable) {
    slot.quantity = qty - moved;
    if (slot.quantity <= 0) ref.slots[idx] = null;
  } else {
    ref.slots[idx] = null;
  }
  try { playSound('pickup'); } catch (e) {}
  setContainerStatus('Sacaste ' + entry.name + (moved > 1 ? ' ×' + moved : ''));
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
    ok = inv.addResource(s.id, 1) > 0;
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

// Produce munición usando el almacén de la mesa asociada (mesa o cofres).
function containerProduceAmmo() {
  const ref = currentContainer;
  if (!ref || ref.mode !== 'dispenser' || !ref.stock) return;
  const linked = (typeof containerLinkedBench === 'function') ? containerLinkedBench(ref) : null;
  if (!linked) { setContainerStatus('Este dispenser no está en el área de una mesa'); return; }
  const cost = (typeof BENCH_AMMO_COST !== 'undefined') ? BENCH_AMMO_COST : { metal: 2, wood: 1 };
  const batch = (typeof BENCH_AMMO_BATCH !== 'undefined') ? BENCH_AMMO_BATCH : 12;
  if (!benchConsumeBase(linked, cost)) {
    setContainerStatus('Faltan recursos en la mesa o en los cofres asociados');
    return;
  }
  ref.stock.amount = (ref.stock.amount || 0) + batch;
  setContainerStatus('Dispenser cargado: +' + batch + ' balas');
  try { playSound('ammo-pickup'); } catch (e) {}
  refreshContainerModal();
}

function toggleContainer(open, ref) {
  const modal = document.getElementById('containerModal');
  if (!modal) return;
  if (open) {
    currentContainer = ref || currentContainer;
    if (!currentContainer) return;
    containerSelected = null;
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
    containerSelected = null;
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
