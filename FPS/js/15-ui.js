// js/15-ui.js (part 15/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Pause menu helpers: status, stats, account UI ---
// --- Mochila: icono compartido HUD/lista ---
function itemIcon(item) {
  if (!item) return '-';
  if (item.type === 'weapon') return '🔫 ';
  if (item.type === 'tool' || item.toolType) {
      if (item.id === 'hammer') return '🔨 ';
      if (item.id === 'axe') return '🪓 ';
      if (item.id === 'pickaxe') return '⛏️ ';
      if (item.id === 'torch') return '🔥 ';
      return '🔧 ';
  }
  if (item.id === 'bandage') return '🩹 ';
  if (item.type === 'consumable' || item.id === 'food') return '🍎 ';
  if (item.id === 'toxin') return '☠️ ';
  if (item.type === 'ammo') return '📦 ';
  if (item.type === 'key') return '🔑 ';
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
  CRAFT_RECIPES.forEach((r, i) => {
      if (station && r.station !== station) return;
      const b = document.createElement('button');
      b.className = 'rg-btn rg-btn-small rg-craft';
      b.dataset.idx = i;
      b.innerHTML =
          '<span class="rg-craft-ico">' + recipeIcon(r) + '</span>' +
          '<span class="rg-craft-body">' +
              '<span class="rg-craft-name">' + (r.name || r.label) + '</span>' +
              '<span class="rg-craft-cost"></span>' +
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
      resIcon(k) + '<b>' + (inv.resources[k] || 0) + '</b></span>').join('');
  const ammoTxt = Object.keys(inv.ammo || {}).map(a => a + ': ' + inv.ammo[a]).join(' · ');
  if (ammoTxt) html += '<span class="rg-mat rg-mat-ammo">📦 ' + ammoTxt + '</span>';
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
function invShowTab(which) {
  const items = document.getElementById('invItems');
  const craft = document.getElementById('invCraft');
  if (!items || !craft) return;
  items.style.display = which === 'items' ? 'block' : 'none';
  craft.style.display = which === 'craft' ? 'block' : 'none';
  if (which === 'craft') { renderCraftButtons(craft, 'hand'); try { refreshCraftUI(); } catch (e) {} }
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
      invShowTab('items');
      refreshInvModal();
      modal.style.display = 'flex';
      invOpen = true;
      openModal = 'inv';
  }
}
function refreshInvModal() {
  const grid = document.getElementById('invItems');
  const inv = (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
  if (!grid || !inv) return;
  grid.innerHTML = '';
  if (!inv.items.length) grid.innerHTML = '<div style="color:#888;">Mochila vacía. ¡Salí a buscar cosas!</div>';
  inv.items.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'rg-row';
      const eq = inv.equippedItem === item;
      const info = document.createElement('span');
      info.style.flex = '1';
      info.className = 'rg-drag-handle';
      info.setAttribute('data-idx', idx);
      info.innerHTML = '<span style="font-size:20px;">' + itemIcon(item) + '</span> ' + item.name +
          ((item.stackable && item.quantity > 1) ? ' x' + item.quantity : '') +
          (eq ? ' <b style="color:#4CAF50;">(equipada)</b>' : '');
      row.appendChild(info);
      const useBtn = document.createElement('button');
      const usable = !!item.toolType || item.healAmount > 0;
      useBtn.textContent = item.healAmount > 0 ? 'Usar' : (eq ? 'En uso' : 'Equipar');
      useBtn.className = 'rg-btn rg-btn-small';
      useBtn.disabled = !usable;
      useBtn.addEventListener('click', () => invUseItem(idx));
      row.appendChild(useBtn);
      const dropBtn = document.createElement('button');
      dropBtn.textContent = 'Soltar';
      dropBtn.className = 'rg-btn rg-btn-small';
      dropBtn.addEventListener('click', () => invDropItem(idx));
      row.appendChild(dropBtn);
      grid.appendChild(row);
  });
  renderBelt();
  const foot = document.getElementById('invFoot');
  if (foot) renderMaterialChips(foot);
}

// --- Cinturón (atajos 1-5): se puede arrastrar y soltar ---
function renderBelt() {
  const belt = document.getElementById('invBelt');
  if (!belt || typeof player === 'undefined' || !player) return;
  const inv = player.inventory;
  belt.innerHTML = '';
  inv.quickSlots.forEach((_, index) => {
      const slot = document.createElement('div');
      slot.className = 'quick-slot';
      slot.setAttribute('data-slot', index);
      slot.addEventListener('click', () => { try { inv.quickSelect(index); renderBelt(); } catch (e) {} });
      belt.appendChild(slot);
  });
  inv.updateQuickSlotUI();
}

let _beltDrag = null;
function _beltSlotUnder(x, y) {
  const els = document.querySelectorAll('#invBelt .quick-slot');
  for (const el of Array.from(els)) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return parseInt(el.getAttribute('data-slot'), 10);
  }
  return -1;
}
function _beltGhost(item, x, y) {
  let g = document.getElementById('beltGhost');
  if (!g) {
      g = document.createElement('div');
      g.id = 'beltGhost';
      g.className = 'rg-drag-ghost';
      document.body.appendChild(g);
  }
  g.textContent = itemIcon(item) + ' ' + item.name;
  g.style.left = x + 'px';
  g.style.top = y + 'px';
  return g;
}
function startBeltDrag(item, fromSlot, x, y) {
  if (!item) return;
  _beltDrag = { item, fromSlot, moved: false, x, y };
  _beltGhost(item, x, y);
}
function moveBeltDrag(x, y) {
  if (!_beltDrag) return;
  if (Math.abs(x - _beltDrag.x) + Math.abs(y - _beltDrag.y) > 6) _beltDrag.moved = true;
  const g = document.getElementById('beltGhost');
  if (g) { g.style.left = x + 'px'; g.style.top = y + 'px'; }
}
function endBeltDrag(x, y) {
  if (!_beltDrag) return;
  const drag = _beltDrag;
  _beltDrag = null;
  const g = document.getElementById('beltGhost');
  if (g) g.remove();
  if (!drag.moved) {
      if (drag.fromSlot >= 0) { try { player.inventory.quickSelect(drag.fromSlot); } catch (e) {} }
      return;
  }
  const inv = (typeof player !== 'undefined' && player) ? player.inventory : null;
  if (!inv) return;
  const target = _beltSlotUnder(x, y);
  if (target >= 0) {
      const existing = inv.quickSlots.findIndex(s => s && drag.item && s.id === drag.item.id);
      if (drag.fromSlot >= 0) {
          const tmp = inv.quickSlots[target];
          inv.quickSlots[target] = inv.quickSlots[drag.fromSlot];
          inv.quickSlots[drag.fromSlot] = tmp;
      } else {
          if (existing >= 0 && existing !== target) inv.quickSlots[existing] = null;
          inv.quickSlots[target] = drag.item;
      }
  } else if (drag.fromSlot >= 0) {
      inv.clearQuickSlot(drag.fromSlot);
      return;
  } else {
      return; // dropped nothing meaningful
  }
  inv.updateQuickSlotUI();
}

document.addEventListener('pointerdown', (e) => {
  if (!invOpen) return;
  if (e.target && e.target.closest && e.target.closest('button')) return;
  const handle = e.target && e.target.closest ? e.target.closest('.rg-drag-handle') : null;
  if (handle) {
      const idx = parseInt(handle.getAttribute('data-idx'), 10);
      const inv = (typeof player !== 'undefined' && player) ? player.inventory : null;
      if (inv && inv.items[idx]) { e.preventDefault(); startBeltDrag(inv.items[idx], -1, e.clientX, e.clientY); }
      return;
  }
  const slotEl = e.target && e.target.closest ? e.target.closest('#invBelt .quick-slot') : null;
  if (slotEl) {
      const idx = parseInt(slotEl.getAttribute('data-slot'), 10);
      const inv = (typeof player !== 'undefined' && player) ? player.inventory : null;
      if (inv && inv.quickSlots[idx]) { e.preventDefault(); startBeltDrag(inv.quickSlots[idx], idx, e.clientX, e.clientY); }
  }
});
document.addEventListener('pointermove', (e) => { if (_beltDrag) moveBeltDrag(e.clientX, e.clientY); });
document.addEventListener('pointerup', (e) => { if (_beltDrag) endBeltDrag(e.clientX, e.clientY); });
document.addEventListener('pointercancel', (e) => { if (_beltDrag) endBeltDrag(e.clientX, e.clientY); });
function invUseItem(idx) {
  const inv = (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
  if (!inv || !inv.items[idx]) return;
  const item = inv.items[idx];
  if (item.healAmount > 0) {
      player.health = Math.min(player.maxHealth || 100, player.health + (item.healAmount || 30));
      inv.removeItem(item, 1);
      try { player.updateStatsHUD(); playSound('health-regen'); } catch (e) {}
      try { if (typeof directorOnFoodLesson === 'function') directorOnFoodLesson(); } catch (e) {}
      refreshInvModal();
      return;
  }
  if (item.toolType) {
      try { player.setTool(item.toolType); } catch (e) {}
      refreshInvModal();
      return;
  }
}
function invDropItem(idx) {
  const inv = (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
  if (!inv || !inv.items[idx]) return;
  const item = inv.items[idx];
  const key = defKeyById(item.id);
  if (!key || !ITEM_DEFINITIONS[key].createModel) {
      setCraftStatus('Eso no se puede soltar');
      return;
  }
  const p = player.container.position.clone();
  const fwd = new THREE.Vector3();
  player.camera.getWorldDirection(fwd); fwd.y = 0;
  if (fwd.lengthSq() < 0.001) fwd.set(0, 0, -1);
  fwd.normalize();
  p.add(fwd.multiplyScalar(1.2));
  p.y = Math.max(p.y, 0.6);
  if (inv.removeItem(item, 1)) {
      try { if (item.model && item.model.parent) item.model.parent.remove(item.model); } catch (e) {}
      placeWorldItem(key, p);
      try { player.setTool(TOOLS.HANDS); player.updateToolHUD(); } catch (e) {}
  }
  refreshInvModal();
}
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
  if (name === 'craft' && typeof canOpenInventory === 'function' && !canOpenInventory()) {
      try {
          const msg = (typeof inventoryLockedMessage === 'function')
              ? inventoryLockedMessage()
              : 'Mochila bloqueada';
          if (typeof setPauseStatus === 'function') setPauseStatus(msg);
          else if (typeof lvToast === 'function') lvToast(msg);
      } catch (e) {}
      name = 'play';
  }
  pauseUI.activeTab = name;
  applyPausePanels();
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
    stairs: d.stairs, doors: d.doors, spawns: d.spawns, statics: d.statics, totems: d.totems, zones: d.zones
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

