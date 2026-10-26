// js/29-tray.js — Bandeja A+B unificada por estación (hand | bench).
// Reemplaza los twins invTray* / benchTray* de 15-ui.js.

var TRAY_STATIONS = {};

function recipePairKey(r) {
  if (!r) return '';
  if (Array.isArray(r.pair) && r.pair.length) return r.pair.slice().sort().join('+');
  return Object.keys(r.cost || {}).sort().join('+');
}

function trayItemKey(item) {
  if (!item) return null;
  if (item.type === 'resource') return item.resourceKey || item.id;
  return null;
}

function canPlaceInTray(item) {
  return !!(item && item.type === 'resource' && trayItemKey(item));
}

function fillCraftTraySlot(el, ico, lbl) {
  if (!el) return;
  const icoEl = el.querySelector('.rg-inv-slot-ico');
  const lblEl = el.querySelector('.rg-inv-slot-lbl');
  if (icoEl) icoEl.textContent = ico;
  if (lblEl) lblEl.textContent = lbl;
}

function createTrayStation(cfg) {
  const st = {
    id: cfg.id,
    station: cfg.station,
    hold: { a: null, b: null },
    recipeIdx: null,
    ids: cfg.ids, // { a, b, out, craftBtn, book }
    refreshLists: cfg.refreshLists || function () {},
    emptyBookHint: cfg.emptyBookHint || 'Todavía no descubriste recetas. Probá A + B.'
  };

  function pairKey() {
    const ka = trayItemKey(st.hold.a);
    const kb = trayItemKey(st.hold.b);
    if (!ka || !kb) return null;
    return [ka, kb].sort().join('+');
  }

  function plusBagCount(inv, key) {
    let n = (typeof inv.getResourceCount === 'function') ? inv.getResourceCount(key) : (inv.resources[key] || 0);
    ['a', 'b'].forEach(function (slot) {
      const it = st.hold[slot];
      if (trayItemKey(it) === key) n += (it.quantity || 0);
    });
    return n;
  }

  function canAfford(inv, r) {
    if (!inv || !r) return false;
    for (const k in (r.cost || {})) {
      if (plusBagCount(inv, k) < r.cost[k]) return false;
    }
    return true;
  }

  function findMatch() {
    if (typeof CRAFT_RECIPES === 'undefined') return { recipe: null, idx: -1, hint: '' };
    const ka = trayItemKey(st.hold.a);
    const kb = trayItemKey(st.hold.b);
    if (!ka && !kb) return { recipe: null, idx: -1, hint: 'Arrastrá 1 ficha a A y 1 a B' };
    if (!ka || !kb) {
      const have = ka || kb;
      const name = (typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[have]) || have;
      return { recipe: null, idx: -1, hint: 'Tenés ' + name + ' · completá el otro slot' };
    }
    const sig = pairKey();
    for (let i = 0; i < CRAFT_RECIPES.length; i++) {
      const r = CRAFT_RECIPES[i];
      if (r.station !== st.station) continue;
      if (recipePairKey(r) === sig) return { recipe: r, idx: i, hint: '' };
    }
    const names = (typeof RESOURCE_ES !== 'undefined') ? RESOURCE_ES : {};
    return {
      recipe: null,
      idx: -1,
      hint: 'No conozco ' + (names[ka] || ka) + ' + ' + (names[kb] || kb)
    };
  }

  function returnSlot(slot) {
    const inv = (typeof player !== 'undefined' && player) ? player.inventory : null;
    const item = st.hold[slot];
    if (!inv || !item) return;
    const k = trayItemKey(item);
    if (k && typeof inv.addResource === 'function') inv.addResource(k, item.quantity || 1);
    else if (typeof inv.addItem === 'function') inv.addItem(item);
    else inv.items.push(item);
    if (item.type === 'resource' && typeof inv.syncResourceCounters === 'function') inv.syncResourceCounters();
    try { inv.updateInventoryUI(); } catch (e) {}
    st.hold[slot] = null;
    updateUI();
    st.refreshLists();
  }

  function clearToBag() {
    returnSlot('a');
    returnSlot('b');
  }

  function putItem(slot, item) {
    const inv = (typeof player !== 'undefined' && player) ? player.inventory : null;
    if (!inv || !item || !canPlaceInTray(item)) {
      try { setCraftStatus('La bandeja solo acepta recursos (madera/piedra/metal)'); } catch (e) {}
      return false;
    }
    const idx = inv.items.indexOf(item);
    if (idx < 0) return false;
    let token;
    if ((item.quantity || 1) > 1) {
      item.quantity -= 1;
      token = {
        id: item.id,
        name: item.name,
        type: 'resource',
        resourceKey: item.resourceKey || item.id,
        stackable: true,
        maxStack: item.maxStack || 10,
        quantity: 1
      };
    } else {
      inv.items.splice(idx, 1);
      token = item;
      token.quantity = 1;
    }
    if (st.hold[slot]) {
      const prev = st.hold[slot];
      const pk = trayItemKey(prev);
      if (pk && typeof inv.addResource === 'function') inv.addResource(pk, prev.quantity || 1);
      else inv.items.push(prev);
    }
    st.hold[slot] = token;
    if (typeof inv.syncResourceCounters === 'function') inv.syncResourceCounters();
    try { inv.updateInventoryUI(); } catch (e) {}
    updateUI();
    st.refreshLists();
    return true;
  }

  function spendGestureThenBag(cost) {
    const inv = (typeof player !== 'undefined' && player) ? player.inventory : null;
    if (!inv || !cost) return false;
    if (!canAfford(inv, { cost: cost })) return false;
    const need = Object.assign({}, cost);
    ['a', 'b'].forEach(function (slot) {
      const it = st.hold[slot];
      if (!it) return;
      const k = trayItemKey(it);
      if (!k || need[k] == null || need[k] <= 0) return;
      const take = Math.min(it.quantity || 0, need[k]);
      it.quantity -= take;
      need[k] -= take;
      if (it.quantity <= 0) st.hold[slot] = null;
    });
    for (const k in need) {
      if (need[k] <= 0) continue;
      if (typeof inv.spendResource === 'function') {
        if (!inv.spendResource(k, need[k])) return false;
      } else {
        inv.resources[k] -= need[k];
      }
      need[k] = 0;
    }
    ['a', 'b'].forEach(function (slot) {
      if (!st.hold[slot]) return;
      const left = st.hold[slot];
      st.hold[slot] = null;
      const lk = trayItemKey(left);
      if (lk && typeof inv.addResource === 'function') inv.addResource(lk, left.quantity || 1);
      else inv.items.push(left);
    });
    if (typeof inv.syncResourceCounters === 'function') inv.syncResourceCounters();
    return true;
  }

  function updateUI() {
    const a = document.getElementById(st.ids.a);
    const b = document.getElementById(st.ids.b);
    const out = document.getElementById(st.ids.out);
    const craftBtn = document.getElementById(st.ids.craftBtn);
    const paint = function (el, item, fallbackLbl) {
      if (!item) fillCraftTraySlot(el, '?', fallbackLbl);
      else fillCraftTraySlot(el, (typeof itemIcon === 'function' ? itemIcon(item) : '?').trim(), '×' + (item.quantity || 1));
    };
    paint(a, st.hold.a, 'A');
    paint(b, st.hold.b, 'B');
    const match = findMatch();
    st.recipeIdx = match.idx >= 0 ? match.idx : null;
    const inv = (typeof player !== 'undefined' && player) ? player.inventory : null;
    if (match.recipe) {
      fillCraftTraySlot(out, (typeof recipeIcon === 'function' ? recipeIcon(match.recipe) : '🧰').trim(), match.recipe.name || 'out');
      let ok = true;
      let status = 'Listo: ' + (match.recipe.name || match.recipe.label);
      if (match.recipe.requires && inv && typeof inv.ownsToolType === 'function' && !inv.ownsToolType(match.recipe.requires)) {
        ok = false;
        status = 'Necesitás: ' + ((typeof TOOL_REQUIRE_NAMES !== 'undefined' && TOOL_REQUIRE_NAMES[match.recipe.requires]) || match.recipe.requires);
      }
      if (ok && !canAfford(inv, match.recipe)) {
        ok = false;
        const short = Object.keys(match.recipe.cost || {}).find(function (k) {
          return plusBagCount(inv, k) < match.recipe.cost[k];
        });
        status = short
          ? ('Te faltan ' + (match.recipe.cost[short] - plusBagCount(inv, short)) + ' de ' +
              ((typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[short]) || short) + ' en la mochila')
          : 'Te faltan materiales en la mochila';
      }
      if (craftBtn) craftBtn.disabled = !ok;
      try { setCraftStatus(status); } catch (e) {}
    } else {
      fillCraftTraySlot(out, '?', 'out');
      if (craftBtn) craftBtn.disabled = true;
      if (st.hold.a || st.hold.b) {
        try { setCraftStatus(match.hint || ''); } catch (e) {}
      }
    }
  }

  function craftFromTray() {
    const inv = (typeof player !== 'undefined' && player) ? player.inventory : null;
    if (!inv) return;
    const match = findMatch();
    if (!match.recipe) {
      try { setCraftStatus(match.hint || 'Combinación inválida'); } catch (e) {}
      return;
    }
    const r = match.recipe;
    if (r.requires && typeof inv.ownsToolType === 'function' && !inv.ownsToolType(r.requires)) {
      try { setCraftStatus('Necesitás: ' + ((TOOL_REQUIRE_NAMES && TOOL_REQUIRE_NAMES[r.requires]) || r.requires)); } catch (e) {}
      return;
    }
    if (!canAfford(inv, r)) {
      try { setCraftStatus('Te faltan materiales en la mochila'); } catch (e) {}
      updateUI();
      return;
    }
    const spentCost = Object.assign({}, r.cost);
    if (!spendGestureThenBag(r.cost)) {
      try { setCraftStatus('No alcanzan los materiales'); } catch (e) {}
      updateUI();
      return;
    }
    const ok = craftItem(match.idx, { skipCost: true });
    if (!ok) {
      Object.keys(spentCost).forEach(function (k) {
        if (typeof inv.addResource === 'function') inv.addResource(k, spentCost[k]);
      });
      inv.syncResourceCounters();
    }
    updateUI();
    st.refreshLists();
    try { ensureTrayBook(st.id); } catch (e) {}
  }

  function selectRecipe(idx) {
    st.recipeIdx = idx;
    try {
      const book = document.getElementById(st.ids.book);
      if (!book) return;
      book.querySelectorAll('.rg-craft').forEach(function (b) {
        b.classList.toggle('on', parseInt(b.dataset.idx, 10) === idx);
      });
    } catch (e) {}
    // Autollenar hint de gesto si la receta tiene pair
    try {
      const r = CRAFT_RECIPES[idx];
      if (r && r.pair) {
        setCraftStatus('Gesto: ' + r.pair.map(function (k) {
          return (RESOURCE_ES && RESOURCE_ES[k]) || k;
        }).join(' + ') + ' · arrastrá a A/B y crafteá');
      }
    } catch (e) {}
  }

  function wire() {
    const btn = document.getElementById(st.ids.craftBtn);
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.addEventListener('click', function () { craftFromTray(); });
    }
    ['a', 'b'].forEach(function (slot) {
      const el = document.getElementById(slot === 'a' ? st.ids.a : st.ids.b);
      if (!el || el.dataset.wiredClick) return;
      el.dataset.wiredClick = '1';
      el.addEventListener('contextmenu', function (e) { e.preventDefault(); returnSlot(slot); });
      el.addEventListener('dblclick', function () { returnSlot(slot); });
    });
  }

  st.pairKey = pairKey;
  st.plusBagCount = plusBagCount;
  st.canAfford = canAfford;
  st.findMatch = findMatch;
  st.returnSlot = returnSlot;
  st.clearToBag = clearToBag;
  st.putItem = putItem;
  st.updateUI = updateUI;
  st.craftFromTray = craftFromTray;
  st.selectRecipe = selectRecipe;
  st.wire = wire;
  TRAY_STATIONS[st.id] = st;
  return st;
}

function getTrayStation(id) {
  return TRAY_STATIONS[id] || null;
}

function activeTrayStation() {
  if (typeof benchOpen !== 'undefined' && benchOpen) return TRAY_STATIONS.bench || null;
  if (typeof invOpen !== 'undefined' && invOpen) return TRAY_STATIONS.hand || null;
  return null;
}

function ensureTrayBook(stationId) {
  const st = TRAY_STATIONS[stationId];
  if (!st) return;
  const craft = document.getElementById(st.ids.book);
  if (!craft) return;
  craft.innerHTML = '';
  delete craft.dataset.rendered;
  const unlocked = (typeof getUnlockedRecipeIds === 'function' ? getUnlockedRecipeIds() : []).filter(function (id) {
    return CRAFT_RECIPES.some(function (r) { return r.station === st.station && r.id === id; });
  });
  if (!unlocked.length) {
    craft.innerHTML = '<div class="rg-home-hint">' + st.emptyBookHint + '</div>';
  } else {
    renderCraftButtons(craft, st.station, {
      unlockedOnly: true,
      craftOnClick: false,
      onSelect: function (i) { st.selectRecipe(i); }
    });
  }
  st.wire();
  try { refreshCraftUI(); } catch (e) {}
  st.updateUI();
}

function initTrayStations() {
  if (!TRAY_STATIONS.hand) {
    createTrayStation({
      id: 'hand',
      station: 'hand',
      ids: { a: 'invTrayA', b: 'invTrayB', out: 'invTrayOut', craftBtn: 'invTrayCraft', book: 'invCraft' },
      refreshLists: function () {
        try { if (typeof refreshInvModal === 'function') refreshInvModal(); } catch (e) {}
      },
      emptyBookHint: 'Todavía no descubriste recetas. Probá combinaciones en A + B.'
    });
  }
  if (!TRAY_STATIONS.bench) {
    createTrayStation({
      id: 'bench',
      station: 'bench',
      ids: { a: 'benchTrayA', b: 'benchTrayB', out: 'benchTrayOut', craftBtn: 'benchTrayCraft', book: 'benchCraft' },
      refreshLists: function () {
        try { if (typeof refreshBenchModalLists === 'function') refreshBenchModalLists(); } catch (e) {}
      },
      emptyBookHint: 'Todavía no descubriste recetas de mesa. Probá combinaciones en A + B.'
    });
  }
}

// Compat wrappers usados por toggleInventory / toggleBench / refreshCraftUI
function ensureInvCraftUI() {
  initTrayStations();
  ensureTrayBook('hand');
}
function ensureBenchCraftUI() {
  initTrayStations();
  ensureTrayBook('bench');
}
function updateInvTrayUI() {
  initTrayStations();
  if (TRAY_STATIONS.hand) TRAY_STATIONS.hand.updateUI();
}
function updateBenchTrayUI() {
  initTrayStations();
  if (TRAY_STATIONS.bench) TRAY_STATIONS.bench.updateUI();
}
function clearHandTrayToBag() {
  initTrayStations();
  if (TRAY_STATIONS.hand) TRAY_STATIONS.hand.clearToBag();
}
function clearBenchTrayToBag() {
  initTrayStations();
  if (TRAY_STATIONS.bench) TRAY_STATIONS.bench.clearToBag();
}
function putItemInHandTray(slot, item) {
  initTrayStations();
  return TRAY_STATIONS.hand ? TRAY_STATIONS.hand.putItem(slot, item) : false;
}
function putItemInBenchTray(slot, item) {
  initTrayStations();
  return TRAY_STATIONS.bench ? TRAY_STATIONS.bench.putItem(slot, item) : false;
}
function canPlaceInHandTray(item) { return canPlaceInTray(item); }
