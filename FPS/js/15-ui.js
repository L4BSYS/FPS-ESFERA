// js/15-ui.js (part 15/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Pause menu helpers: status, stats, account UI ---
// --- Mochila: icono compartido HUD/lista ---
function itemIcon(item) {
  if (!item) return '-';
  if (item.icon) return item.icon;
  if (item.type === 'resource') return resIcon(item.resourceKey || item.id);
  if (item.type === 'weapon') return '🔫';
  if (item.type === 'tool' || item.toolType) {
      if (item.id === 'hammer') return '🔨';
      if (item.id === 'axe') return '🪓';
      if (item.id === 'pickaxe') return '⛏️';
      if (item.id === 'torch') return '🔥';
      return '🔧';
  }
  if (item.id === 'bandage') return '🩹';
  if (item.type === 'consumable' || item.id === 'food') return '🍎';
  if (item.id === 'toxin') return '☠️';
  if (item.type === 'ammo') return '📦';
  if (item.type === 'key') return '🔑';
  if (item.type === 'prop') return item.id === 'chest' ? '🧰' : '📦';
  if (item.type === 'gear') return '🎒';
  return '-';
}
function defKeyById(id) {
  for (const k in ITEM_DEFINITIONS) { if (ITEM_DEFINITIONS[k].id === id) return k; }
  return null;
}
// --- Crafteo compartido (pausa + mochila + mesa) ---
function resIcon(k) {
  if (k === 'wood') return '🪵';
  if (k === 'stone') return '🪨';
  if (k === 'metal') return '⚙️';
  return '▫️';
}
function recipeIcon(r) {
  try {
      if ((r.kind === 'tool' || r.kind === 'item') && ITEM_DEFINITIONS[r.defKey]) {
          return itemIcon({ ...ITEM_DEFINITIONS[r.defKey] });
      }
  } catch (e) {}
  if (r.id === 'bench') return '🛠️ ';
  if (r.id === 'ammo') return '📦 ';
  if (r.id === 'dressing') return '🩹 ';
  return '🧰 ';
}
// station: 'hand' (mochila/pausa) o 'bench' (mesa de trabajo). Sin station = todas.
function renderCraftButtons(container, station) {
  if (!container || container.dataset.rendered) return;
  container.dataset.rendered = '1';
  container.innerHTML = '';
  CRAFT_RECIPES.forEach((r, i) => {
      if (station && r.station !== station) return;
      const b = document.createElement('button');
      b.className = 'rg-btn rg-btn-small rg-craft';
      b.dataset.idx = i;
      b.dataset.station = r.station || 'hand';
      b.innerHTML =
          '<span class="rg-craft-ico">' + recipeIcon(r) + '</span>' +
          '<span class="rg-craft-body">' +
              '<span class="rg-craft-name">' + (r.name || r.label) + '</span>' +
              '<span class="rg-craft-cost"></span>' +
              '<span class="rg-craft-note">' + (r.station === 'bench' ? '🛠 mesa' : '✋ a mano') + '</span>' +
          '</span>' +
          '<span class="rg-craft-lock" style="display:none;"></span>';
      b.addEventListener('click', () => craftItem(i));
      container.appendChild(b);
  });
  try { refreshCraftUI(); } catch (e) {}
}
// Chips de materiales disponibles (madera/piedra/metal + balas)
function renderMaterialChips(el) {
  if (!el) return;
  const inv = (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
  if (!inv) { el.innerHTML = ''; return; }
  const names = (typeof RESOURCE_ES !== 'undefined') ? RESOURCE_ES : {};
  let html = ['wood', 'stone', 'metal'].map(k =>
      '<span class="rg-mat rg-mat-' + k + '" title="' + (names[k] || k) + '">' +
      resIcon(k) + '<b>' + (inv.countResource ? inv.countResource(k) : (inv.resources[k] || 0)) + '</b></span>').join('');
  const ammoTxt = Object.keys(inv.ammo || {}).map(a => a + ': ' + inv.ammo[a]).filter(s => !s.endsWith(': 0')).join(' · ');
  if (ammoTxt) html += '<span class="rg-mat rg-mat-ammo">📦 ' + ammoTxt + '</span>';
  if (typeof inv.capacity === 'number') {
      html += '<span class="rg-mat rg-mat-bag" title="Espacios ocupados de la mochila">🎒 <b>' + inv.usedBagSlots + '/' + inv.capacity + '</b></span>';
  }
  el.innerHTML = html;
}
function setCraftStatus(t) {
  setPauseStatus(t);
  try {
      if (typeof invOpen !== 'undefined' && invOpen) {
          const m = document.getElementById('invMsg');
          if (m) m.textContent = t || '';
      }
      if (typeof benchOpen !== 'undefined' && benchOpen) {
          const bm = document.getElementById('benchMsg');
          if (bm) bm.textContent = t || '';
      }
  } catch (e) {}
}
// --- Ventana de mochila ---
var invOpen = false;
var benchOpen = false;
var openModal = null;
function closeTopModal() {
  if (openModal === 'inv') { toggleInventory(); return true; }
  if (openModal === 'totem') { toggleTotem(false); return true; }
  if (openModal === 'cartel' && typeof toggleCartel === 'function') { toggleCartel(false); return true; }
  if (openModal === 'bench' && typeof toggleBench === 'function') { toggleBench(false); return true; }
  if (openModal === 'container' && typeof toggleContainer === 'function') { toggleContainer(false); return true; }
  return false;
}
// La mochila ahora integra inventario + crafteo en un solo panel; se mantiene
// la función por compatibilidad con llamadas viejas.
function invShowTab(which) {
  if (which === 'craft') {
      const craft = document.getElementById('invCraft');
      if (craft) {
          renderCraftButtons(craft, 'hand');
          try { craft.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
          try { refreshCraftUI(); } catch (e) {}
      }
  }
}
function renderInvFab() {
  let fab = document.getElementById('invFab');
  if (!fab) {
      fab = document.createElement('button');
      fab.id = 'invFab';
      fab.textContent = '🎒';
      fab.title = 'Mochila';
      fab.className = 'rg-fab';
      fab.style.left = '12px';
      fab.style.bottom = '150px';
      fab.addEventListener('click', () => toggleInventory());
      document.body.appendChild(fab);
  }
  const touch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
  fab.style.display = touch ? 'block' : 'none';
}
function toggleInventory() {
  const modal = document.getElementById('invModal');
  if (!modal || typeof player === 'undefined' || !player) return;
  if (invOpen) {
      modal.style.display = 'none';
      invOpen = false;
      openModal = null;
      isGamePaused = false;
      lockPointer();
  } else {
      if (typeof canOpenInventory === 'function' && !canOpenInventory()) {
          try {
              const msg = (typeof inventoryLockedMessage === 'function')
                  ? inventoryLockedMessage()
                  : 'Mochila bloqueada';
              if (typeof lvToast === 'function') lvToast(msg);
              else if (typeof showMessage === 'function') showMessage(msg);
          } catch (e) {}
          return;
      }
      if (benchOpen) toggleBench(false);
      if (typeof pauseMenu !== 'undefined' && pauseMenu) pauseMenu.style.display = 'none';
      isGamePaused = true;
      try { document.exitPointerLock(); } catch (e) {}
      invSelected = null;
      refreshInvModal();
      modal.style.display = 'flex';
      invOpen = true;
      openModal = 'inv';
  }
}
// --- Mochila: grilla de slots + panel de detalle integrado al crafteo ---
var invSelected = null;

function invStatusMsg(t) {
  const m = document.getElementById('invMsg');
  if (m) m.textContent = t || '';
}

function refreshInvModal() {
  const inv = getPlayerInv();
  const modal = document.getElementById('invModal');
  if (!inv || !modal) return;
  if (invSelected && !inv.itemAt(invSelected.area, invSelected.idx)) invSelected = null;
  renderInvCapacity();
  renderBelt();
  renderInvBag();
  renderInvDetail();
  const craft = document.getElementById('invCraft');
  if (craft) renderCraftButtons(craft, 'hand');
  const foot = document.getElementById('invFoot');
  if (foot) renderMaterialChips(foot);
  try { refreshCraftUI(); } catch (e) {}
  markInvSelection();
}

function renderInvCapacity() {
  const inv = getPlayerInv();
  if (!inv) return;
  const txt = document.getElementById('invCapTxt');
  if (txt) txt.textContent = inv.usedBagSlots + '/' + inv.capacity;
  const bar = document.getElementById('invCapBar');
  if (bar) {
      const pct = inv.capacity ? Math.round((inv.usedBagSlots / inv.capacity) * 100) : 0;
      bar.style.width = pct + '%';
      bar.className = pct >= 100 ? 'bad' : (pct > 75 ? 'warn' : '');
  }
  const tier = document.getElementById('invBagTierTxt');
  if (tier) {
      const next = inv.nextBagTier;
      tier.textContent = inv.bagTierName + (next ? ' · próxima: ' + next.name + ' (+' + (next.slots - inv.capacity) + ')' : ' · al máximo');
  }
}

function invSlotEl(area, idx, item) {
  const inv = getPlayerInv();
  const el = document.createElement('div');
  el.className = 'inv-slot';
  el.dataset.area = area;
  el.dataset.idx = String(idx);
  if (!item) el.classList.add('empty');
  if (item && inv && inv.equippedItem === item) el.classList.add('equipped');
  if (item) {
      const ico = document.createElement('span');
      ico.className = 'inv-slot-ico';
      ico.textContent = itemIcon(item);
      el.appendChild(ico);
      if (item.stackable && (item.quantity || 1) > 1) {
          const q = document.createElement('span');
          q.className = 'inv-slot-qty';
          q.textContent = item.quantity;
          el.appendChild(q);
      }
      el.title = item.name +
          (item.quantity > 1 ? ' ×' + item.quantity : '') +
          (inv && inv.equippedItem === item ? ' · equipado' : '') +
          '\nArrastrá para mover · doble clic para usar/equipar · clic derecho para soltar';
  } else {
      const ico = document.createElement('span');
      ico.className = 'inv-slot-ico';
      ico.textContent = '·';
      el.appendChild(ico);
      el.title = area === 'belt' ? 'Casillero del cinturón (tecla ' + (idx + 1) + ')' : 'Espacio libre de la mochila';
  }
  if (area === 'belt') {
      const k = document.createElement('span');
      k.className = 'inv-slot-key';
      k.textContent = idx + 1;
      el.appendChild(k);
  }
  return el;
}

// Cinturón (atajos 1-5): es almacenamiento real, no solo un atajo.
function renderBelt() {
  const belt = document.getElementById('invBelt');
  const inv = getPlayerInv();
  if (!belt || !inv) return;
  belt.innerHTML = '';
  for (let i = 0; i < inv.quickSlots.length; i++) {
      belt.appendChild(invSlotEl('belt', i, inv.quickSlots[i]));
  }
}

function renderInvBag() {
  const bag = document.getElementById('invItems');
  const inv = getPlayerInv();
  if (!bag || !inv) return;
  bag.innerHTML = '';
  for (let i = 0; i < inv.capacity; i++) {
      bag.appendChild(invSlotEl('bag', i, inv.slots[i]));
  }
  if (inv.capacity < INV_MAX_BAG_SLOTS) {
      const next = inv.nextBagTier;
      const tile = document.createElement('div');
      tile.className = 'inv-slot inv-upgrade-tile';
      tile.title = next.name + ' — crafteala para sumar ' + (next.slots - inv.capacity) + ' espacios';
      const ico = document.createElement('span');
      ico.className = 'inv-slot-ico';
      ico.textContent = '🔒';
      const q = document.createElement('span');
      q.className = 'inv-slot-qty';
      q.textContent = '+' + (next.slots - inv.capacity);
      tile.appendChild(ico);
      tile.appendChild(q);
      tile.addEventListener('click', () => {
          invStatusMsg('Crafteá ' + next.name + ' para sumar ' + (next.slots - inv.capacity) + ' espacios');
          const craft = document.getElementById('invCraft');
          if (craft) try { craft.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
      });
      bag.appendChild(tile);
  }
}

function markInvSelection() {
  document.querySelectorAll('#invModal .inv-slot').forEach(el => {
      const on = !!invSelected && el.dataset.area === invSelected.area &&
          parseInt(el.dataset.idx, 10) === invSelected.idx;
      el.classList.toggle('sel', on);
  });
}

function selectInvSlot(area, idx) {
  const inv = getPlayerInv();
  if (!inv) return;
  if (!inv.itemAt(area, idx)) invSelected = null;
  else invSelected = { area: area, idx: idx };
  renderInvDetail();
  markInvSelection();
}

function invSelectedItem() {
  const inv = getPlayerInv();
  if (!inv || !invSelected) return null;
  return inv.itemAt(invSelected.area, invSelected.idx);
}

function invTypeLabel(item) {
  if (!item) return '';
  if (item.type === 'resource') return 'Recurso';
  if (item.type === 'ammo') return 'Munición de reserva';
  if (item.type === 'tool') return 'Herramienta';
  if (item.type === 'weapon') return 'Arma';
  if (item.type === 'consumable') return 'Consumible';
  if (item.type === 'gear') return 'Equipamiento';
  if (item.type === 'prop') return 'Estructura colocable';
  if (item.type === 'key') return 'Llave';
  return 'Objeto';
}

function invItemDesc(item, inv) {
  if (!item) return '';
  if (item.type === 'resource') {
      return 'Se apila hasta ' + INV_RESOURCE_STACK + '. Lo usás para construir y craftear.';
  }
  if (item.type === 'ammo') {
      const eq = inv && inv.equippedItem;
      return 'Reserva de munición. Se carga con R' +
          (eq && eq.ammoType === item.ammoType ? ' (arma equipada)' : ' teniendo el arma equipada') + '.';
  }
  if (item.type === 'tool' || item.type === 'weapon') {
      let d = 'Se equipa y ocupa un casillero del cinturón o de la mochila.';
      if (item.ammoType) {
          inv.ensureWeaponMagazine(item);
          d += '\nCargador: ' + (item.magazine || 0) + '/' + item.magazineSize +
              ' · Reserva: ' + inv.countAmmo(item.ammoType);
      }
      return d;
  }
  if (item.type === 'consumable' && item.healAmount > 0) {
      return 'Cura ' + item.healAmount + ' de vida al usarlo.';
  }
  if (item.type === 'gear') return item.desc || 'Mejora la capacidad de tu mochila.';
  if (item.type === 'prop') return item.desc || 'Se coloca dentro del área de tu mesa de trabajo.';
  return item.desc || '';
}

function invDetailBtn(label, cls, fn) {
  const b = document.createElement('button');
  b.className = 'rg-btn rg-btn-small ' + (cls || '');
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function renderInvDetail() {
  const box = document.getElementById('invDetail');
  const inv = getPlayerInv();
  if (!box || !inv) return;
  box.innerHTML = '';
  const item = invSelectedItem();
  if (!item) {
      const h = document.createElement('div');
      h.className = 'rg-inv-detail-empty';
      h.innerHTML = '<b>Seleccioná un objeto</b><br>' +
          'Arrastrá entre <b>cinturón</b> (1-5) y <b>mochila</b> para repartir lo que llevás.<br>' +
          'Doble clic: usar / equipar. Clic derecho: soltar.';
      box.appendChild(h);
      return;
  }
  const title = document.createElement('div');
  title.className = 'inv-detail-title';
  title.textContent = itemIcon(item) + ' ' + item.name + (item.quantity > 1 ? ' ×' + item.quantity : '');
  box.appendChild(title);
  const meta = document.createElement('div');
  meta.className = 'inv-detail-meta';
  meta.textContent = invTypeLabel(item) +
      (invSelected.area === 'belt' ? ' · cinturón ' + (invSelected.idx + 1) : ' · mochila') +
      (inv.equippedItem === item ? ' · EN USO' : '');
  box.appendChild(meta);
  const desc = document.createElement('div');
  desc.className = 'inv-detail-desc';
  desc.textContent = invItemDesc(item, inv);
  box.appendChild(desc);

  const actions = document.createElement('div');
  actions.className = 'inv-detail-actions';
  if (item.toolType || item.type === 'weapon') {
      if (inv.equippedItem === item) {
          actions.appendChild(invDetailBtn('Desequipar', '', () => {
              inv.unequipItem();
              try { player.currentTool = TOOLS.HANDS; player.updateToolHUD(); } catch (e) {}
              renderInvDetail();
          }));
      } else {
          actions.appendChild(invDetailBtn('Equipar', 'rg-btn-primary', () => {
              inv.equipItem(item);
              try { player.updateToolHUD(); updateActionButton(); } catch (e) {}
              renderInvDetail();
          }));
      }
  } else if (item.type === 'consumable' && item.healAmount > 0) {
      actions.appendChild(invDetailBtn('Usar', 'rg-btn-primary', () => {
          inv.useItem(item);
          try { if (typeof directorOnFoodLesson === 'function') directorOnFoodLesson(); } catch (e) {}
          renderInvDetail();
      }));
  } else if (item.type === 'ammo') {
      actions.appendChild(invDetailBtn('Recargar arma', 'rg-btn-primary', () => {
          if (!inv.equippedItem || !inv.equippedItem.ammoType) invStatusMsg('Equipá un arma para recargar');
          else inv.reloadWeapon();
          renderInvDetail();
      }));
  }
  if (invSelected.area === 'belt') {
      actions.appendChild(invDetailBtn('A la mochila', '', () => invMoveSelected()));
  } else {
      actions.appendChild(invDetailBtn('Al cinturón', '', () => invMoveSelected()));
  }
  if (invCanDrop(item)) {
      actions.appendChild(invDetailBtn('Soltar', 'rg-btn-warn', () => invDropSlot(invSelected.area, invSelected.idx)));
  }
  box.appendChild(actions);
}

function invCanDrop(item) {
  if (!item) return false;
  if (item.type === 'resource' || item.type === 'ammo') return true;
  const key = defKeyById(item.id);
  return !!(key && ITEM_DEFINITIONS[key] && ITEM_DEFINITIONS[key].createModel && item.type !== 'prop');
}

function invPrimarySelected() {
  const item = invSelectedItem();
  const inv = getPlayerInv();
  if (!item || !inv) return;
  if (item.type === 'consumable' && item.healAmount > 0) {
      inv.useItem(item);
      try { if (typeof directorOnFoodLesson === 'function') directorOnFoodLesson(); } catch (e) {}
  } else if (item.toolType || item.type === 'weapon') {
      if (inv.equippedItem === item) {
          inv.unequipItem();
          try { player.currentTool = TOOLS.HANDS; player.updateToolHUD(); } catch (e) {}
      } else {
          inv.equipItem(item);
          try { player.updateToolHUD(); updateActionButton(); } catch (e) {}
      }
  } else if (item.type === 'ammo') {
      inv.reloadWeapon();
  } else {
      invStatusMsg(item.name + ' no se puede usar directamente');
  }
  renderInvDetail();
}

function invMoveSelected() {
  const inv = getPlayerInv();
  const sel = invSelected;
  if (!inv || !sel) return;
  const item = inv.itemAt(sel.area, sel.idx);
  if (!item) return;
  if (sel.area === 'belt') {
      if (inv.clearQuickSlot(sel.idx)) {
          const loc = inv.findSlot(item);
          if (loc) invSelected = loc;
          invStatusMsg('Movido a la mochila');
      }
  } else {
      const free = inv.quickSlots.findIndex(s => !s);
      if (free < 0) { invStatusMsg('Cinturón lleno (1-5)'); return; }
      if (inv.moveItem('bag', sel.idx, 'belt', free)) {
          invSelected = { area: 'belt', idx: free };
          invStatusMsg('Movido al cinturón (' + (free + 1) + ')');
      }
  }
  refreshInvModal();
}

function invDropSlot(area, idx) {
  const inv = getPlayerInv();
  if (!inv) return;
  const item = inv.itemAt(area, idx);
  if (!item) return;
  let key = null;
  if (item.type === 'resource') {
      key = { wood: 'branch', stone: 'pebble', metal: 'scrap' }[item.resourceKey || item.id] || null;
  } else if (item.type === 'ammo') {
      key = item.ammoType === 'pistol' ? 'pistolAmmo' : null;
  } else {
      key = defKeyById(item.id);
  }
  if (!key || !ITEM_DEFINITIONS[key] || !ITEM_DEFINITIONS[key].createModel) {
      invStatusMsg('Eso no se puede soltar');
      return;
  }
  const p = player.container.position.clone();
  const fwd = new THREE.Vector3();
  player.camera.getWorldDirection(fwd); fwd.y = 0;
  if (fwd.lengthSq() < 0.001) fwd.set(0, 0, -1);
  fwd.normalize();
  p.add(fwd.multiplyScalar(1.2));
  p.y = Math.max(p.y, 0.6);
  const wasEquipped = inv.equippedItem === item;
  if (inv.removeItem(item, 1)) {
      try { if (wasEquipped && item.model && item.model.parent) item.model.parent.remove(item.model); } catch (e) {}
      try {
          const dropped = placeWorldItem(key, p);
          // Al soltar 1 unidad de un stack, el objeto del mundo vale 1 (no el default de la definición).
          if (dropped && dropped.userData && (item.type === 'resource' || item.type === 'ammo')) {
              dropped.userData.amount = 1;
              dropped.userData.ammoType = item.ammoType || dropped.userData.ammoType;
          }
      } catch (e) {}
      if (wasEquipped) {
          try { player.setTool(TOOLS.HANDS); player.updateToolHUD(); } catch (e) {}
      }
      invStatusMsg('Soltaste ' + item.name);
  }
  refreshInvModal();
}

// --- Drag & drop entre cinturón y mochila (mouse + touch) ---
var _invDrag = null;

function invSlotUnder(x, y) {
  const els = document.querySelectorAll('#invModal .inv-slot[data-area]');
  for (const el of els) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          return { area: el.dataset.area, idx: parseInt(el.dataset.idx, 10) };
      }
  }
  return null;
}

function invDragGhost(item, x, y) {
  let g = document.getElementById('invDragGhost');
  if (!g) {
      g = document.createElement('div');
      g.id = 'invDragGhost';
      g.className = 'rg-drag-ghost';
      document.body.appendChild(g);
  }
  g.textContent = itemIcon(item) + ' ' + item.name + (item.quantity > 1 ? ' ×' + item.quantity : '');
  g.style.left = x + 'px';
  g.style.top = y + 'px';
}

function invDragEnd(x, y) {
  if (!_invDrag) return;
  const drag = _invDrag;
  _invDrag = null;
  const g = document.getElementById('invDragGhost');
  if (g) g.remove();
  const inv = getPlayerInv();
  if (!inv) return;
  if (!drag.moved) return;
  const target = invSlotUnder(x, y);
  if (target && target.area && target.idx >= 0) {
      if (inv.moveItem(drag.area, drag.idx, target.area, target.idx)) {
          invSelected = target;
      }
  } else if (drag.area === 'belt') {
      // Soltar fuera de un casillero: vuelve a la mochila si hay lugar.
      const free = inv.firstEmpty('bag');
      if (free >= 0 && inv.moveItem('belt', drag.idx, 'bag', free)) invSelected = { area: 'bag', idx: free };
  }
  refreshInvModal();
}

document.addEventListener('pointerdown', (e) => {
  if (!invOpen) return;
  if (e.target && e.target.closest && e.target.closest('button')) return;
  const el = e.target && e.target.closest ? e.target.closest('#invModal .inv-slot[data-area]') : null;
  if (!el) return;
  const area = el.dataset.area;
  const idx = parseInt(el.dataset.idx, 10);
  selectInvSlot(area, idx);
  const inv = getPlayerInv();
  const item = inv ? inv.itemAt(area, idx) : null;
  if (!item) return;
  e.preventDefault();
  _invDrag = { area: area, idx: idx, item: item, x: e.clientX, y: e.clientY, moved: false };
});
document.addEventListener('pointermove', (e) => {
  if (!_invDrag) return;
  if (Math.abs(e.clientX - _invDrag.x) + Math.abs(e.clientY - _invDrag.y) > 6) {
      _invDrag.moved = true;
      invDragGhost(_invDrag.item, e.clientX, e.clientY);
  }
});
document.addEventListener('pointerup', (e) => { if (_invDrag) invDragEnd(e.clientX, e.clientY); });
document.addEventListener('pointercancel', (e) => { if (_invDrag) invDragEnd(e.clientX, e.clientY); });

document.addEventListener('dblclick', (e) => {
  if (!invOpen) return;
  const el = e.target && e.target.closest ? e.target.closest('#invModal .inv-slot[data-area]') : null;
  if (!el) return;
  selectInvSlot(el.dataset.area, parseInt(el.dataset.idx, 10));
  invPrimarySelected();
});

document.addEventListener('contextmenu', (e) => {
  if (!invOpen) return;
  const el = e.target && e.target.closest ? e.target.closest('#invModal .inv-slot[data-area]') : null;
  if (!el) return;
  e.preventDefault();
  invDropSlot(el.dataset.area, parseInt(el.dataset.idx, 10));
});

// --- Teclas configurables (estilo RUST, humilde: solo acciones, WASD fijo) ---
var KeyMap = { interact: 'e', inventory: 'q', palette: 'b', creator: 'g', reload: 'r' };
const KEY_RESERVED = ['w', 'a', 's', 'd', ' ', 'shift', 'escape', 'tab', '1', '2', '3', '4', '5'];
try {
  const saved = JSON.parse(localStorage.getItem('lagrieta_keys') || 'null');
  if (saved) for (const k of ['interact', 'inventory', 'palette', 'creator', 'reload']) {
      if (typeof saved[k] === 'string' && saved[k].length === 1) {
          const v = saved[k].toLowerCase();
          if (!KEY_RESERVED.includes(v)) KeyMap[k] = v;
      }
  }
} catch (e) {}
function isTypingTarget(e) {
  return !!(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA'));
}
function renderKeyRows() {
  const box = document.getElementById('keyRows');
  if (!box) return;
  box.innerHTML = '';
  [['interact', 'Usar / interactuar'], ['inventory', 'Mochila'], ['reload', 'Recargar arma'], ['palette', 'Barra creador'], ['creator', 'Modo creador']].forEach(([k, label]) => {
      const row = document.createElement('div');
      row.className = 'rg-keys-row';
      const lab = document.createElement('span');
      lab.style.flex = '1';
      lab.className = 'rg-rownote';
      lab.textContent = label;
      const b = document.createElement('button');
      b.textContent = (KeyMap[k] || '?').toUpperCase();
      b.className = 'rg-btn rg-btn-small';
      b.addEventListener('click', () => {
          b.textContent = '…';
          b.disabled = true;
          setPauseStatus('Apretá una tecla para "' + label + '" (ESC cancela)');
          const once = (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              document.removeEventListener('keydown', once, true);
              b.disabled = false;
              const v = (ev.key || '').toLowerCase();
              if (ev.key === 'Escape') { b.textContent = KeyMap[k].toUpperCase(); setPauseStatus(''); return; }
              if (v.length !== 1 || KEY_RESERVED.includes(v)) {
                  b.textContent = KeyMap[k].toUpperCase();
                  setPauseStatus('Esa tecla está reservada (WASD, espacio, shift, números)');
                  return;
              }
              const clash = Object.keys(KeyMap).find(x => x !== k && KeyMap[x] === v);
              if (clash) {
                  b.textContent = KeyMap[k].toUpperCase();
                  setPauseStatus('Esa tecla ya la usa otra acción');
                  return;
              }
              KeyMap[k] = v;
              try { localStorage.setItem('lagrieta_keys', JSON.stringify(KeyMap)); } catch (e) {}
              b.textContent = v.toUpperCase();
              setPauseStatus('Tecla guardada');
          };
          document.addEventListener('keydown', once, true);
      });
      row.appendChild(lab);
      row.appendChild(b);
      box.appendChild(row);
  });
}
function showPauseTab(name) {
  if (typeof pauseUI === 'undefined' || !pauseUI.panels) return;
  pauseUI.activeTab = name;
  applyPausePanels();
  if (name === 'craft') {
      try { renderTechTree(); } catch (e) { console.warn('tech tree', e); }
      try { renderMaterialChips(document.getElementById('techFoot')); } catch (e) {}
  }
  if (name === 'build') refreshCreatorHint();
  if (name === 'play' && typeof renderLevelsPanel === 'function') { try { renderLevelsPanel(); } catch (e) {} }
  if (name === 'account' && typeof refreshOnlineTab === 'function') { try { refreshOnlineTab(); } catch (e) {} }
  if (pauseUI.tabs) for (const k in pauseUI.tabs) {
    if (pauseUI.tabs[k]) pauseUI.tabs[k].classList.toggle('on', k === name);
  }
}
function refreshCreatorHint() {
  try {
      const h = document.getElementById('creatorKeysHint');
      if (h) {
          const b = (typeof KeyMap !== 'undefined' && KeyMap.palette ? KeyMap.palette : 'b').toUpperCase();
          h.innerHTML = '1) Apretá <b>' + b + '</b> o <b>mantené clic derecho</b> para la barra (el juego sigue).<br>' +
          '2) Pasá el mouse para elegir qué poner (bloques, objetos, nodos, mesa, escalera, puerta, plataforma, cubo, muro, spawn).<br>' +
          '3) Soltá para volver y hacé <b>clic para ponerlo</b> (bloques: con el martillo). Para sacar, elegí ❌ y hacé clic.<br>' +
          'Volá con Espacio/Shift. En creador los enemigos no atacan. Todo lo que pongas se guarda en Mundo.';
      }
  } catch (e) {}
}
function applyPausePanels() {
  if (typeof pauseUI === 'undefined' || !pauseUI.panels) return;
  const active = pauseUI.activeTab || 'play';
  for (const k in pauseUI.panels) {
    const vis = (active === k);
    pauseUI.panels[k].forEach(el => { if (el) el.style.display = vis ? 'block' : 'none'; });
  }
}
function showGameOver() {
  try { if (typeof player !== 'undefined' && player) player.health = Math.min(player.health, 0); } catch (e) {}
  try { if (typeof cancelPlacement === 'function') cancelPlacement(true); } catch (e) {}
  const go = document.getElementById('gameOver');
  if (go && go.style.display !== 'flex') {
      const stats = document.getElementById('gameOverStats');
      if (stats) {
          let waveTxt = '0';
          try { waveTxt = String(waveNumber); } catch (e) {}
          let kills = 0;
          try { kills = enemiesKilled; } catch (e) {}
          let t = '0:00';
          try { t = fmtRunTime(Date.now() - runStartTs); } catch (e) {}
          stats.innerHTML = 'Sobreviviste ' + t + ' &middot; Bajas ' + kills +
              ' &middot; Oleada ' + waveTxt + ' &middot; Bloques ' + placedBlocks.length;
      }
      go.style.display = 'flex';
  }
  console.log("Player defeated!");
  isGamePaused = true;
  try { document.exitPointerLock(); } catch (e) {}
}
function respawnPlayer() {
  if (typeof player === 'undefined' || !player) return;
  try {
      player.health = player.maxHealth || 100;
      if (typeof playerSpawnPos !== 'undefined' && playerSpawnPos) player.container.position.copy(playerSpawnPos);
      player.velocity.set(0, 0, 0);
      player.updateColliderPosition();
      player.updateColliderBox();
      if (player.inventory) {
          player.inventory.ammo.pistol = Math.max(player.inventory.ammo.pistol || 0, 12);
          try { player.inventory.updateAmmoUI(); } catch (e) {}
      }
      player.updateStatsHUD();
  } catch (e) {}
  runStartTs = Date.now();
  const go = document.getElementById('gameOver');
  if (go) go.style.display = 'none';
  isGamePaused = false;
  if (typeof pauseMenu !== 'undefined' && pauseMenu) pauseMenu.style.display = 'none';
  lockPointer();
}
function setPauseStatus(t) {
  const el = document.getElementById('pauseStatus');
  if (el) el.textContent = t || '';
}
function refreshPauseStats() {
  if (!pauseUI.stats) return;
  let alive = 0;
  try {
    if (typeof npcs !== 'undefined' && npcs) {
      alive = npcs.filter((n) => n && n.health > 0).length;
    }
  } catch (e) {}
  let hp = '-';
  try {
    if (typeof player !== 'undefined' && player) hp = Math.max(0, Math.round(player.health));
  } catch (e) {}
  let waveTxt = '';
  try { if (typeof waveNumber !== 'undefined') waveTxt = '  |  Oleada: ' + waveNumber; } catch (e) {}
  let netTxt = '';
  try { if (typeof netNeighborCount === 'function') { const nb = netNeighborCount(); if (nb > 0) netTxt = '  |  Vecinos: ' + nb; } } catch (e) {}
  pauseUI.stats.textContent = 'Vida: ' + hp + '  |  Bloques: ' + placedBlocks.length + '  |  Enemigos: ' + alive + waveTxt + netTxt;
}
function updatePauseAuthUI(user) {
  const name = user ? (user.displayName || user.email || user.uid) : null;
  if (pauseUI.userInfo) pauseUI.userInfo.textContent = name ? ('Sesión: ' + name) : 'Sin sesión';
  if (pauseUI.loginBtn) pauseUI.loginBtn.style.display = name ? 'none' : 'inline-block';
  if (pauseUI.logoutBtn) pauseUI.logoutBtn.style.display = name ? 'inline-block' : 'none';
  const locked = !name;
  if (pauseUI.sceneSection) {
      pauseUI.sceneSection.querySelectorAll('button, select, input').forEach(el => { el.style.display = locked ? 'none' : ''; });
  }
  if (pauseUI.sceneHint) pauseUI.sceneHint.style.display = locked ? 'block' : 'none';
  applyPausePanels();
  if (name) refreshSceneList();
}
// --- Scene persistence (one Firestore write per explicit save only) ---
var lastSaveTs = 0;
function fpsSceneDoc(user, name) {
  return firebase.firestore().collection('fps').doc('scenes').collection(user.uid).doc(name);
}
async function saveSceneToFirestore() {
  if (!window.firebase || !firebase.auth || !firebase.firestore) { setPauseStatus('Los servicios se están cargando, probá de nuevo'); return; }
  const user = firebase.auth().currentUser;
  if (!user) { setPauseStatus('Ingresá para guardar escenas'); return; }
  const name = (pauseUI.sceneName && pauseUI.sceneName.value.trim()) || 'default';
  const snap = snapshotScene();
  const total = snap.blocks.length + snap.items.length + snap.nodes.length + snap.benches.length +
      (snap.stairs || []).length + (snap.doors || []).length + (snap.spawns || []).length +
      (snap.statics || []).length + (snap.totems || []).length + (snap.zones || []).length;
  if (total > 2000) { setPauseStatus('Escena muy grande (máx. 2000 objetos)'); return; }
  try {
    setPauseStatus('Guardando "' + name + '"...');
    await fpsSceneDoc(user, name).set({
      blocks: snap.blocks,
      items: snap.items,
      nodes: snap.nodes,
      benches: snap.benches,
      containers: snap.containers || [],
      stairs: snap.stairs,
      doors: snap.doors,
      spawns: snap.spawns,
      statics: snap.statics,
      totems: snap.totems,
      zones: snap.zones || [],
      blockCount: snap.blocks.length,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      owner: user.uid
    }, { merge: true });
    lastSaveTs = Date.now();
    setPauseStatus('Guardada "' + name + '" (' + total + ' objetos)');
    setTimeout(() => { if (Date.now() - lastSaveTs > 4000) setPauseStatus(''); }, 4500);
    refreshSceneList();
  } catch (e) {
    console.error(e);
    const msg = (e && e.code === 'unavailable') ? 'Sin conexión al servidor (¿offline?)' : ('No se pudo guardar: ' + ((e && e.message) || e));
    setPauseStatus(msg);
  }
}
async function loadSceneFromFirestore() {
  if (!window.firebase || !firebase.auth || !firebase.firestore) { setPauseStatus('Los servicios se están cargando, probá de nuevo'); return; }
  const user = firebase.auth().currentUser;
  if (!user) { setPauseStatus('Ingresá para cargar escenas'); return; }
  const name = (pauseUI.sceneName && pauseUI.sceneName.value.trim()) || 'default';
  try {
    setPauseStatus('Cargando "' + name + '"...');
    const snap = await fpsSceneDoc(user, name).get();
    if (!snap.exists) { setPauseStatus('No existe la escena "' + name + '"'); return; }
    const d = snap.data();
    const { n, m } = applySceneData(d);
    setPauseStatus('Cargada "' + name + '" (' + n + ' bloques, ' + m + ' objetos)');
  } catch (e) {
    console.error(e);
    setPauseStatus('No se pudo cargar: ' + ((e && e.message) || e));
  }
}
function applySceneData(d) {
  try { if (typeof trialStop === 'function') trialStop(true); } catch (e) {}
  const n = deserializeBlocks(d.blocks || []);
  const m = deserializeProps(d.items || [], d.nodes || [], d.benches || [], {
    stairs: d.stairs, doors: d.doors, spawns: d.spawns, statics: d.statics, totems: d.totems, zones: d.zones,
    containers: d.containers
  });
  return { n, m };
}
function sharedSceneDoc() {
  return firebase.firestore().collection('fpsShared').doc('world');
}
function sharedMeta() {
  try { return JSON.parse(localStorage.getItem('lagrieta_shared_ts') || 'null'); } catch (e) { return null; }
}
async function loadSharedScene() {
  if (!window.firebase || !firebase.auth || !firebase.firestore) { setPauseStatus('Los servicios se están cargando, probá de nuevo'); return; }
  if (!firebase.auth().currentUser) { setPauseStatus('Ingresá para el online'); return; }
  try {
      setPauseStatus('Bajando escena compartida...');
      const snap = await sharedSceneDoc().get();
      if (!snap.exists) { setPauseStatus('Nadie publicó escena todavía'); return; }
      const d = snap.data();
      const { n, m } = applySceneData(d);
      try {
          if (d.updatedAt && d.updatedAt.toMillis) localStorage.setItem('lagrieta_shared_ts', JSON.stringify({ ts: d.updatedAt.toMillis() }));
      } catch (e) {}
      setPauseStatus('Compartida cargada (' + n + ' bloques, ' + m + ' objetos)');
      try { showMessage('Escena compartida cargada'); } catch (e) {}
      refreshOnlineTab();
  } catch (e) {
      console.error(e);
      setPauseStatus('No se pudo bajar: ' + ((e && e.message) || e));
  }
}
async function publishSharedScene() {
  if (!window.firebase || !firebase.auth || !firebase.firestore) { setPauseStatus('Los servicios se están cargando, probá de nuevo'); return; }
  const user = firebase.auth().currentUser;
  if (!user) { setPauseStatus('Ingresá para el online'); return; }
  if (!confirm('¿Publicar tu mundo como escena compartida? Pisa la versión anterior.')) return;
  try {
      setPauseStatus('Publicando escena compartida...');
      const snap = snapshotScene();
      const total = snap.blocks.length + (snap.items || []).length + (snap.nodes || []).length + (snap.benches || []).length +
          (snap.stairs || []).length + (snap.doors || []).length + (snap.spawns || []).length + (snap.statics || []).length + (snap.totems || []).length;
      if (total > 2000) { setPauseStatus('Escena muy grande (máx. 2000 objetos)'); return; }
      await sharedSceneDoc().set({
          ...snap,
          blockCount: snap.blocks.length,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          owner: user.uid,
          updatedByName: user.displayName || (user.email ? user.email.split('@')[0] : 'alguien')
      });
      try {
          const back = await sharedSceneDoc().get();
          const dd = back.data();
          if (dd && dd.updatedAt && dd.updatedAt.toMillis) localStorage.setItem('lagrieta_shared_ts', JSON.stringify({ ts: dd.updatedAt.toMillis() }));
      } catch (e) {}
      setPauseStatus('¡Publicada! Otros la ven en Online.');
      refreshOnlineTab();
  } catch (e) {
      console.error(e);
      setPauseStatus('No se pudo publicar: ' + ((e && e.message) || e));
  }
}
async function refreshOnlineTab() {
  const st = document.getElementById('onlineStatus');
  const pl = document.getElementById('onlinePlayers');
  const si = document.getElementById('sharedInfo');
  const online = (typeof netOn !== 'undefined' && netOn);
  const nb = (typeof netNeighborCount === 'function') ? netNeighborCount() : 0;
  let sector = '?';
  try { if (typeof netSector !== 'undefined' && netSector) sector = netSector; } catch (e) {}
  if (st) {
      let lvl = '';
      try { if (typeof LEVEL !== 'undefined' && LEVEL.current) { const d = (typeof resolveLevelDef === 'function') ? resolveLevelDef(LEVEL.current) : null; lvl = ' · ' + ((d && d.name) || LEVEL.current); } } catch (e) {}
      st.textContent = online ? ('Conectado' + lvl + ' · sector ' + sector + ' · vecinos: ' + nb) : 'Sin conexión (ingresá con Google para el online)';
      try { if (typeof netError !== 'undefined' && netError) st.textContent += ' · red: ' + netError; } catch (e) {}
  }
  if (pl) {
      pl.innerHTML = '';
      const ids = (typeof remotes !== 'undefined') ? Object.keys(remotes) : [];
      if (!ids.length) pl.textContent = online ? 'Nadie cerca todavía. ¡Invitá a alguien!' : '';
      else ids.slice(0, 12).forEach(uid => {
          const r = remotes[uid];
          const div = document.createElement('div');
          div.textContent = '● ' + ((r && r.name) || uid.slice(0, 6));
          try { div.style.color = (r && r.mesh && r.mesh.material && r.mesh.material.color && ('#' + r.mesh.material.color.getHexString())) || '#fff'; } catch (e) {}
          pl.appendChild(div);
      });
  }
  if (si) {
      try {
          if (!window.firebase || !firebase.firestore) { si.textContent = ''; return; }
          const snap = await sharedSceneDoc().get();
          if (!snap.exists) { si.textContent = 'Aún nadie publicó escena compartida.'; return; }
          const d = snap.data();
          const when = (d.updatedAt && d.updatedAt.toDate) ? d.updatedAt.toDate() : null;
          const meta = sharedMeta();
          const fresh = meta && d.updatedAt && d.updatedAt.toMillis && meta.ts === d.updatedAt.toMillis();
          si.textContent = 'Compartida por ' + (d.updatedByName || '?') +
              (when ? ' el ' + when.toLocaleString() : '') +
              (fresh ? ' (ya la tenés)' : ' ¡HAY VERSIÓN NUEVA!');
      } catch (e) { si.textContent = ''; }
  }
}
async function refreshSceneList() {
  if (!window.firebase || !firebase.auth || !firebase.firestore) return;
  const user = firebase.auth().currentUser;
  if (!user || !pauseUI.sceneSelect) return;
  try {
    const qs = await firebase.firestore().collection('fps').doc('scenes').collection(user.uid).orderBy('updatedAt', 'desc').limit(20).get();
    const sel = pauseUI.sceneSelect;
    const current = pauseUI.sceneName ? pauseUI.sceneName.value : '';
    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = qs.empty ? '(no hay escenas)' : '(elegí una guardada)';
    sel.appendChild(placeholder);
    qs.forEach((doc) => {
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = doc.id + ' (' + ((doc.data() && doc.data().blockCount) || 0) + ')';
      sel.appendChild(opt);
    });
    if (current && pauseUI.sceneName) pauseUI.sceneName.value = current;
  } catch (e) {
    console.error('Scene list failed:', e);
  }
}
// --- Single auth wiring (popup keeps game state; redirect as fallback) ---
var pauseAuthWired = false;
function ensureFirebaseApp() {
  try {
    if (window.firebase && !firebase.apps.length && window.LAGRIETA_FIREBASE_CONFIG) {
      firebase.initializeApp(window.LAGRIETA_FIREBASE_CONFIG);
    }
  } catch (e) { console.error('Firebase init failed:', e); }
}
function wirePauseAuth() {
  if (pauseAuthWired) return;
  if (!window.firebase || !firebase.auth) { setTimeout(wirePauseAuth, 300); return; }
  ensureFirebaseApp();
  try {
    if (!firebase.apps.length) { setTimeout(wirePauseAuth, 300); return; }
  } catch (e) { setTimeout(wirePauseAuth, 300); return; }
  pauseAuthWired = true;
  try {
    firebase.auth().getRedirectResult().then((res) => {
      if (res && res.user) {
        updatePauseAuthUI(res.user);
        setPauseStatus('Sesión: ' + (res.user.displayName || res.user.email));
      }
    }).catch((e) => console.error('Redirect result error:', e));
  } catch (e) {}
  try {
    firebase.auth().onAuthStateChanged((user) => updatePauseAuthUI(user));
  } catch (e) {
    console.error('Auth listener failed:', e);
    pauseAuthWired = false;
    setTimeout(wirePauseAuth, 1000);
  }
}

