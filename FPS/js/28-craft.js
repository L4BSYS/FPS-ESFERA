// js/28-craft.js — Recetas, craftItem, refreshCraftUI, unlock, iconos de craft.
// Extraído/reordenado desde 02-systems + 15-ui (review: god-file + craft spray).
// --- Crafting: progression hands -> hammer -> axe -> pickaxe -> pistol (+ ammo/heals) ---
// A mano: el par en la bandeja elige la receta (gesto). El coste total se paga
// con 1 ficha de cada tipo en A/B + el resto del pool de la mochila.
const CRAFT_RECIPES = [
  { id: 'hammer', label: 'Martillo de piedra', name: 'Martillo', station: 'hand', kind: 'tool', defKey: 'hammer', requires: null,
    pair: ['stone', 'stone'], cost: { stone: 4 } },
  { id: 'axe', label: 'Hacha de piedra', name: 'Hacha', station: 'hand', kind: 'tool', defKey: 'axe', requires: 'hammer',
    pair: ['wood', 'stone'], cost: { wood: 4, stone: 3 } },
  { id: 'pickaxe', label: 'Pico de piedra', name: 'Pico', station: 'hand', kind: 'tool', defKey: 'pickaxe', requires: 'axe',
    pair: ['stone', 'metal'], cost: { stone: 4, metal: 2 } },
  { id: 'torch', label: 'Antorcha (alumbra)', name: 'Antorcha', station: 'hand', kind: 'tool', defKey: 'torch', requires: null,
    pair: ['wood', 'wood'], cost: { wood: 2 } },
  { id: 'bench', label: 'Mesa de trabajo (tu base)', name: 'Mesa de trabajo', station: 'hand', kind: 'prop', requires: 'hammer',
    pair: ['wood', 'metal'], cost: { wood: 6, metal: 4 },
    run: (inv) => {
        startPlacement({
            label: 'mesa de trabajo',
            cost: { wood: 6, metal: 4 },
            radius: 1.4,
            snapGround: true,
            buildGhost: buildWorkbenchGhost,
            place: (pos) => { const wb = placeWorkbench(pos); return !!wb; }
        });
    } },
  // --- Solo en la mesa de trabajo (gesto = par; coste del pool) ---
  { id: 'pistol', label: 'Pistola de chatarra (+6 balas)', name: 'Pistola', station: 'bench', kind: 'tool', defKey: 'pistol', requires: 'pickaxe',
    pair: ['metal', 'metal'], cost: { metal: 10, wood: 4 }, ammoBonus: { pistol: 6 } },
  { id: 'ammo', label: 'Balas de pistola x12', name: 'Balas x12', station: 'bench', kind: 'ammo', requires: null,
    pair: ['wood', 'metal'], cost: { metal: 3, wood: 2 },
    run: (inv) => {
      const want = 12;
      let added = 0;
      if (typeof inv.addAmmo === 'function') added = inv.addAmmo('pistol', want) || 0;
      else {
        inv.ammo.pistol = (inv.ammo.pistol || 0) + want;
        added = want;
        try { inv.updateAmmoUI(); } catch (e) {}
      }
      if (added <= 0) throw new Error('Mochila llena: no entra munición');
      if (added < want) {
        try { setCraftStatus('Solo entraron ' + added + ' de ' + want + ' balas (tope de reserva)'); } catch (e) {}
      }
    } },
  { id: 'dressing', label: 'Venda (+30 vida)', name: 'Venda', station: 'bench', kind: 'item', defKey: 'bandage', requires: null,
    pair: ['wood', 'stone'], cost: { wood: 3, stone: 1 } },
  // --- Mochilas (Sebastian): sin gesto de bandeja — craft desde árbol / craftItem ---
  { id: 'backpack1', label: 'Mochila de lona (+6 espacios)', name: 'Mochila de lona', station: 'hand', kind: 'upgrade', bagTier: 1, requires: 'hammer',
    cost: { wood: 8, stone: 2 },
    run: (inv) => { if (!inv.upgradeBackpack(1)) throw new Error('Ya tenés esa mochila'); } },
  { id: 'backpack2', label: 'Mochila reforzada (+6 espacios)', name: 'Mochila reforzada', station: 'bench', kind: 'upgrade', bagTier: 2, requires: 'pickaxe',
    cost: { wood: 12, metal: 4 },
    run: (inv) => { if (!inv.upgradeBackpack(2)) throw new Error('Ya tenés esa mochila'); } },
  { id: 'backpack3', label: 'Mochila de explorador (+6 espacios)', name: 'Mochila de explorador', station: 'bench', kind: 'upgrade', bagTier: 3, requires: 'pickaxe',
    cost: { wood: 16, metal: 10 },
    run: (inv) => { if (!inv.upgradeBackpack(3)) throw new Error('Ya tenés esa mochila'); } },
  // --- Cofre / dispenser colocables (dentro del claim de la mesa) ---
  { id: 'chest', label: 'Cofre (colocar en tu base)', name: 'Cofre del mundo', station: 'bench', kind: 'prop', requires: 'pickaxe', repeatable: true,
    cost: { wood: 10, stone: 6 },
    run: () => { beginContainerPlacement('chest', { wood: 10, stone: 6 }); } },
  { id: 'dispenser', label: 'Dispenser suelto (colocar en base)', name: 'Dispenser del mundo', station: 'bench', kind: 'prop', requires: 'pickaxe', repeatable: true,
    cost: { metal: 10, stone: 6, wood: 4 },
    run: () => { beginContainerPlacement('dispenser', { metal: 10, stone: 6, wood: 4 }); } },
];
const CRAFT_STATION_LABEL = { hand: 'a mano', bench: 'en la mesa de trabajo' };
const TOOL_REQUIRE_NAMES = { hammer: 'Martillo', axe: 'Hacha', pickaxe: 'Pico', gun: 'Pistola' };
const RESOURCE_ES = { wood: 'madera', stone: 'piedra', metal: 'metal' };
function craftRecipeText(r) {
  let t = (r.name || r.label) + ' — ' + Object.keys(r.cost).map(k => r.cost[k] + ' ' + (RESOURCE_ES[k] || k)).join(' + ');
  if (r.pair && r.pair.length) {
      t += ' · gesto ' + r.pair.map(k => RESOURCE_ES[k] || k).join(' + ');
  }
  if (r.requires) t += ' · requiere ' + (TOOL_REQUIRE_NAMES[r.requires] || r.requires);
  return t;
}
function craftItem(idx, opts) {
  const r = CRAFT_RECIPES[idx];
  if (!r || typeof player === 'undefined' || !player || !player.inventory) return;
  const skipCost = !!(opts && opts.skipCost);
  // Tutorial: craft a mano solo con mochila desbloqueada (kit del paso 3).
  if (r.station === 'hand' && typeof canOpenInventory === 'function' && !canOpenInventory()) {
      const msg = (typeof inventoryLockedMessage === 'function')
          ? inventoryLockedMessage()
          : 'Mochila bloqueada';
      try { setCraftStatus(msg); } catch (e) {}
      try { if (typeof lvToast === 'function') lvToast(msg); } catch (e) {}
      return;
  }
  const inv = player.inventory;
  const ownsReq = (t) => (typeof inv.ownsToolType === 'function')
      ? inv.ownsToolType(t)
      : inv.items.some(i => i.toolType === t);
  if (r.requires && !ownsReq(r.requires)) {
      setCraftStatus('Primero crafteá: ' + (TOOL_REQUIRE_NAMES[r.requires] || r.requires));
      return;
  }
  if (r.kind === 'tool' && (!r.defKey || !ITEM_DEFINITIONS[r.defKey])) return;
  if (!skipCost) {
      for (const k in r.cost) {
          const have = (typeof inv.getResourceCount === 'function') ? inv.getResourceCount(k) : (inv.resources[k] || 0);
          if (have < r.cost[k]) {
              setCraftStatus('Te falta ' + (RESOURCE_ES[k] || k) + ' (necesitás ' + r.cost[k] + ')');
              showPlacementMessage('Te falta ' + k);
              return;
          }
      }
  }
  const spentKeys = [];
  if (!skipCost) {
      for (const k in r.cost) {
          if (typeof inv.spendResource === 'function') {
              if (!inv.spendResource(k, r.cost[k])) {
                  spentKeys.forEach(sk => inv.addResource(sk.key, sk.n));
                  setCraftStatus('Te falta ' + (RESOURCE_ES[k] || k));
                  return;
              }
              spentKeys.push({ key: k, n: r.cost[k] });
          } else {
              inv.resources[k] -= r.cost[k];
              spentKeys.push({ key: k, n: r.cost[k] });
          }
      }
  }
  const refundCost = () => {
      if (skipCost) return; // coste ya descontado de la bandeja
      spentKeys.forEach(sk => {
          if (typeof inv.addResource === 'function') inv.addResource(sk.key, sk.n);
          else inv.resources[sk.key] = (inv.resources[sk.key] || 0) + sk.n;
      });
  };
  let craftedOk = false;
  if (r.kind === 'tool') {
      const def = ITEM_DEFINITIONS[r.defKey];
      const entry = { ...def, quantity: 1 };
      try { if (def.createModel) entry.model = def.createModel(); } catch (e) {}
      if (inv.addItem(entry)) {
          craftedOk = true;
          // Tras addItem+assign, la tool puede estar solo en el cinturón
          const added = (typeof inv.findItemEverywhere === 'function'
              ? (inv.findItemEverywhere(it => it.toolType === def.toolType) || {}).item
              : null) || inv.items.find(i => i.toolType === def.toolType) || entry;
          attachToolModel(added, def);
          try {
              if (added.type === 'weapon' || added.type === 'tool') {
                  const emptySlot = inv.quickSlots.findIndex(slot => !slot);
                  if (emptySlot >= 0) inv.assignToQuickSlot(added, emptySlot);
                  if (typeof player.autoAssignQuickSlots === 'function') player.autoAssignQuickSlots();
                  else inv.updateQuickSlotUI();
              }
          } catch (e) {}
          try { player.setTool(def.toolType); } catch (e) {}
          if (r.ammoBonus) for (const a in r.ammoBonus) {
              try {
                  const want = r.ammoBonus[a];
                  const added = (typeof inv.addAmmo === 'function') ? (inv.addAmmo(a, want) || 0) : want;
                  if (typeof inv.addAmmo !== 'function') {
                      inv.ammo[a] = (inv.ammo[a] || 0) + want;
                      try { inv.updateAmmoUI(); } catch (e2) {}
                  }
                  if (added < want) {
                      try { setCraftStatus('Pistola lista · solo +' + added + ' balas (reserva casi llena)'); } catch (e2) {}
                  }
              } catch (e) {
                  inv.ammo[a] = (inv.ammo[a] || 0) + r.ammoBonus[a];
                  try { inv.updateAmmoUI(); } catch (e2) {}
              }
          }
          setCraftStatus('Crafteada y equipada: ' + def.name);
          try { playSound('pickup'); } catch (e) {}
          if ((r.id === 'hammer' || def.id === 'hammer') && typeof directorOnHammerCrafted === 'function') {
              try { directorOnHammerCrafted(); } catch (e) {}
          }
      } else {
          refundCost();
          setCraftStatus('Mochila llena — te devuelvo los materiales');
      }
  } else if (r.kind === 'item') {
      const def = ITEM_DEFINITIONS[r.defKey];
      if (!def) {
          refundCost();
          setCraftStatus('No se pudo craftear');
          refreshCraftUI();
          return;
      }
      const entry = { ...def, quantity: 1 };
      try { if (def.createModel) entry.model = def.createModel(); } catch (e) {}
      if (inv.addItem(entry)) {
          craftedOk = true;
          setCraftStatus('Crafteado: ' + def.name);
          try { playSound('pickup'); } catch (e) {}
      } else {
          refundCost();
          setCraftStatus('Mochila llena — te devuelvo los materiales');
      }
  } else if (r.kind === 'upgrade') {
      try {
          if (typeof inv.upgradeBackpack !== 'function' || !r.bagTier) {
              refundCost();
              setCraftStatus('Mejora de mochila no disponible');
              refreshCraftUI();
              return;
          }
          if ((inv.bagTier | 0) >= r.bagTier) {
              refundCost();
              setCraftStatus('Ya tenés: ' + (inv.bagTierName || 'esa mochila'));
              refreshCraftUI();
              return;
          }
          if (typeof r.run === 'function') r.run(inv);
          else if (!inv.upgradeBackpack(r.bagTier)) {
              refundCost();
              setCraftStatus('No se pudo mejorar la mochila');
              refreshCraftUI();
              return;
          }
          craftedOk = true;
          setCraftStatus('Mejora: ' + (r.name || r.label) + ' · ' + inv.capacity + ' espacios');
          try { playSound('health-regen'); } catch (e) {}
      } catch (e) {
          refundCost();
          setCraftStatus((e && e.message) ? e.message : 'No se pudo mejorar la mochila');
          refreshCraftUI();
          return;
      }
  } else {
      try { r.run(inv); craftedOk = true; } catch (e) {
          console.error(e);
          refundCost();
          setCraftStatus((e && e.message) ? e.message : 'No se pudo craftear');
          refreshCraftUI();
          return;
      }
      setCraftStatus('Crafteado: ' + (r.name || r.label));
      try { playSound('health-regen'); } catch (e) {}
  }
  if (craftedOk && r.id && typeof unlockRecipe === 'function') {
      try {
          if (unlockRecipe(r.id)) {
              const m = document.getElementById(
                  (typeof benchOpen !== 'undefined' && benchOpen) ? 'benchMsg' : 'invMsg'
              );
              if (m && m.textContent) m.textContent += ' · ¡receta aprendida!';
              else setCraftStatus('¡Receta aprendida: ' + (r.name || r.label) + '!');
          }
      } catch (e) {}
  }
  try { updateResourceHUD(); } catch (e) {}
  refreshCraftUI();
  try { refreshOpenStation(); } catch (e) {}
  return craftedOk;
}

var RECIPE_UNLOCK_KEY = 'lagrieta_recipes';
function getUnlockedRecipeIds() {
  try { return JSON.parse(localStorage.getItem(RECIPE_UNLOCK_KEY) || '[]'); } catch (e) { return []; }
}
function isRecipeUnlocked(id) {
  return getUnlockedRecipeIds().indexOf(id) >= 0;
}
function unlockRecipe(id) {
  if (!id || isRecipeUnlocked(id)) return false;
  const u = getUnlockedRecipeIds();
  u.push(id);
  try { localStorage.setItem(RECIPE_UNLOCK_KEY, JSON.stringify(u)); } catch (e) {}
  return true;
}

function refreshOpenStation() {
  if (typeof containerOpen !== 'undefined' && containerOpen && typeof refreshContainerModal === 'function') {
      refreshContainerModal();
      return;
  }
  if (typeof benchOpen !== 'undefined' && benchOpen) {
      try { if (typeof refreshBenchModal === 'function') refreshBenchModal(); } catch (e) {}
      try { if (typeof refreshBenchModalLists === 'function') refreshBenchModalLists(); } catch (e) {}
      try { if (typeof updateBenchTrayUI === 'function') updateBenchTrayUI(); } catch (e) {}
      return;
  }
  try { if (typeof refreshInvModal === 'function') refreshInvModal(); } catch (e) {}
  try { if (typeof updateInvTrayUI === 'function') updateInvTrayUI(); } catch (e) {}
}

function refreshCraftUI() {
  const inv = (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
  const btns = document.querySelectorAll('.rg-craft');
  btns.forEach(btn => {
      const i = parseInt(btn.dataset.idx, 10);
      const r = CRAFT_RECIPES[i];
      if (!r) return;
      const ownedTool = (r.kind === 'tool' && ITEM_DEFINITIONS[r.defKey])
          ? inv && (typeof inv.ownsToolType === 'function'
              ? inv.ownsToolType(ITEM_DEFINITIONS[r.defKey].toolType)
              : inv.items.some(it => it.toolType === ITEM_DEFINITIONS[r.defKey].toolType))
          : (r.kind === 'upgrade' && r.bagTier != null && inv)
              ? ((inv.bagTier | 0) >= r.bagTier)
              : false;
      const hasReq = !r.requires || (inv && (typeof inv.ownsToolType === 'function'
          ? inv.ownsToolType(r.requires)
          : inv.items.some(it => it.toolType === r.requires)));
      const missing = inv ? Object.keys(r.cost).filter(k => {
          const have = (typeof inv.getResourceCount === 'function') ? inv.getResourceCount(k) : (inv.resources[k] || 0);
          return have < r.cost[k];
      }) : Object.keys(r.cost);
      // Libro: no craft por click; solo indica si podrías costear el gesto
      const ok = !!inv && hasReq && missing.length === 0;

      btn.disabled = false;
      btn.style.opacity = ok ? '1' : '0.7';
      btn.classList.toggle('rg-craft-ready', ok);

      const costEl = btn.querySelector('.rg-craft-cost');
      if (costEl) {
          costEl.innerHTML = Object.keys(r.cost).map(k => {
              const have = inv
                  ? ((typeof inv.getResourceCount === 'function') ? inv.getResourceCount(k) : (inv.resources[k] || 0))
                  : 0;
              const lack = !inv || have < r.cost[k];
              return '<span class="rg-cost ' + (lack ? 'bad' : 'ok') + '">' +
                  ((typeof resIcon === 'function') ? resIcon(k) : '') + r.cost[k] + '</span>';
          }).join('');
      }
      const lockEl = btn.querySelector('.rg-craft-lock');
      if (lockEl) {
          if (r.requires && !hasReq) { lockEl.textContent = '🔒 ' + (TOOL_REQUIRE_NAMES[r.requires] || r.requires); lockEl.style.display = ''; }
          else lockEl.style.display = 'none';
      }
      const nameEl = btn.querySelector('.rg-craft-name');
      if (nameEl) nameEl.textContent = (r.name || r.label) + (ownedTool ? ' ✓' : '');
      btn.title = craftRecipeText(r) + (ok ? '' : ' · faltan mats o requisito');
  });
  try { if (typeof updateInvTrayUI === 'function') updateInvTrayUI(); } catch (e) {}
  try { if (typeof updateBenchTrayUI === 'function') updateBenchTrayUI(); } catch (e) {}
}
