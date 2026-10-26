// js/32-bench-upgrades.js — Mejoras instaladas en la mesa (Sebastian → craft ficha).
// Cofre de mesa (12 slots) + dispenser (produce balas desde almacén/cofres del claim).
// Fail-safe: sin DOM / sin inv / sin mesa → no-op.

(function () {
  'use strict';

  var BENCH_UPGRADE_COSTS = {
    chest: { wood: 10, stone: 6, metal: 2 },
    dispenser: { metal: 12, stone: 8, wood: 6 }
  };
  var BENCH_AMMO_COST = { metal: 2, wood: 1 };
  var BENCH_AMMO_BATCH = 12;
  var BENCH_STORAGE_STACK = 10; // alinea con ficha / cofre mundo

  function inv() {
    try {
      if (typeof getPlayerInv === 'function') return getPlayerInv();
      return (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
    } catch (e) { return null; }
  }

  function resName(k) {
    if (typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[k]) return RESOURCE_ES[k];
    if (typeof INV_RESOURCE_NAMES !== 'undefined' && INV_RESOURCE_NAMES[k]) return INV_RESOURCE_NAMES[k];
    return k;
  }

  function ico(k) {
    try { if (typeof resIcon === 'function') return resIcon(k); } catch (e) {}
    return k === 'wood' ? '🪵' : (k === 'stone' ? '🪨' : (k === 'metal' ? '⚙️' : k));
  }

  function status(msg) {
    try { if (typeof setCraftStatus === 'function') setCraftStatus(msg); } catch (e) {}
  }

  function invCount(bag, key) {
    if (!bag) return 0;
    if (typeof bag.getResourceCount === 'function') return bag.getResourceCount(key) || 0;
    return (bag.resources && bag.resources[key]) || 0;
  }

  function invSpendAll(bag, cost) {
    if (!bag || !cost) return false;
    for (var k in cost) {
      if (invCount(bag, k) < cost[k]) return false;
    }
    for (var k2 in cost) {
      if (typeof bag.spendResource === 'function') {
        if (!bag.spendResource(k2, cost[k2])) return false;
      } else {
        bag.resources[k2] -= cost[k2];
      }
    }
    try { if (typeof updateResourceHUD === 'function') updateResourceHUD(); } catch (e) {}
    return true;
  }

  function invRemove(bag, key, n) {
    if (!bag || n <= 0) return 0;
    var have = invCount(bag, key);
    var take = Math.min(have, n);
    if (take <= 0) return 0;
    if (typeof bag.spendResource === 'function') {
      if (!bag.spendResource(key, take)) return 0;
    } else {
      bag.resources[key] = (bag.resources[key] || 0) - take;
    }
    try { if (typeof updateResourceHUD === 'function') updateResourceHUD(); } catch (e) {}
    return take;
  }

  function invAddRes(bag, key, n) {
    if (!bag || n <= 0) return 0;
    var before = invCount(bag, key);
    if (typeof bag.addResource === 'function') bag.addResource(key, n);
    else bag.resources[key] = (bag.resources[key] || 0) + n;
    var after = invCount(bag, key);
    return Math.max(0, after - before);
  }

  function invAddAmmoAmount(bag, type, n) {
    if (!bag || n <= 0) return 0;
    if (typeof bag.addAmmo === 'function') return bag.addAmmo(type, n) || 0;
    var before = (bag.ammo && bag.ammo[type]) || 0;
    if (bag.ammo) bag.ammo[type] = before + n;
    return n;
  }

  function slotResKey(s) {
    if (!s) return null;
    if (s.type === 'resource' || s.resourceKey) return s.resourceKey || s.id;
    if (s.id === 'wood' || s.id === 'stone' || s.id === 'metal') return s.id;
    return null;
  }

  function ensureBenchUpgradeFields(wb) {
    if (!wb) return;
    if (!wb.upgrades) wb.upgrades = { chest: false, dispenser: false };
    if (typeof wb.storageCapacity !== 'number') wb.storageCapacity = 12;
    if (typeof wb.dispenserStock !== 'number') wb.dispenserStock = 0;
    if (typeof wb.dispenserCap !== 'number') wb.dispenserCap = 240;
  }

  window.ensureBenchUpgradeFields = ensureBenchUpgradeFields;

  function linkedChestsFor(wb) {
    if (!wb || typeof worldContainers === 'undefined') return [];
    var radius = wb.claimRadius || (typeof CLAIM_RADIUS !== 'undefined' ? CLAIM_RADIUS : 14);
    return worldContainers.filter(function (c) {
      if (!c || c.mode !== 'storage') return false;
      if (!c.pos || !wb.pos) return false;
      return Math.hypot(c.pos.x - wb.pos.x, c.pos.z - wb.pos.z) <= radius + 0.5;
    });
  }

  function benchStorageTotals(wb) {
    var totals = { wood: 0, stone: 0, metal: 0 };
    if (!wb) return totals;
    function addSlots(slots) {
      if (!Array.isArray(slots)) return;
      slots.forEach(function (s) {
        var key = slotResKey(s);
        if (!key || totals[key] === undefined) return;
        totals[key] += (s.quantity || s.amount || 0);
      });
    }
    if (Array.isArray(wb.storage)) addSlots(wb.storage);
    linkedChestsFor(wb).forEach(function (ref) { addSlots(ref.slots); });
    return totals;
  }

  function benchHasStorage(wb) {
    if (!wb) return false;
    return Array.isArray(wb.storage) || linkedChestsFor(wb).length > 0;
  }

  function benchAddToStorage(wb, key, amount) {
    var left = Math.max(0, Math.floor(amount || 0));
    if (!wb || !left) return 0;
    var want = left;
    var cap = BENCH_STORAGE_STACK;
    function trySlots(slots) {
      if (!Array.isArray(slots)) return;
      var i, s, take;
      for (i = 0; i < slots.length && left > 0; i++) {
        s = slots[i];
        if (!s || slotResKey(s) !== key) continue;
        var stackCap = s.maxStack || cap;
        take = Math.min(stackCap - (s.quantity || 0), left);
        if (take > 0) { s.quantity = (s.quantity || 0) + take; left -= take; }
      }
      for (i = 0; i < slots.length && left > 0; i++) {
        if (slots[i]) continue;
        take = Math.min(cap, left);
        slots[i] = {
          id: key,
          name: resName(key),
          type: 'resource',
          resourceKey: key,
          quantity: take,
          stackable: true,
          maxStack: cap
        };
        left -= take;
      }
    }
    trySlots(wb.storage);
    linkedChestsFor(wb).forEach(function (ref) { trySlots(ref.slots); });
    return want - left;
  }

  function benchTakeFromStorage(wb, key, amount) {
    var left = Math.max(0, Math.floor(amount || 0));
    if (!wb || !left) return 0;
    var want = left;
    function takeSlots(slots) {
      if (!Array.isArray(slots)) return;
      for (var i = 0; i < slots.length && left > 0; i++) {
        var s = slots[i];
        if (!s || slotResKey(s) !== key) continue;
        var take = Math.min(s.quantity || 0, left);
        s.quantity -= take;
        left -= take;
        if ((s.quantity || 0) <= 0) slots[i] = null;
      }
    }
    takeSlots(wb.storage);
    linkedChestsFor(wb).forEach(function (ref) { takeSlots(ref.slots); });
    return want - left;
  }

  function benchConsumeBase(wb, cost) {
    if (!wb || !cost) return false;
    var totals = benchStorageTotals(wb);
    for (var k in cost) if ((totals[k] || 0) < cost[k]) return false;
    for (var k2 in cost) benchTakeFromStorage(wb, k2, cost[k2]);
    return true;
  }

  function benchDepositResource(wb, key, amount) {
    var bag = inv();
    if (!wb || !bag) return;
    if (!benchHasStorage(wb)) {
      status('Instalá el cofre de la mesa o colocá un cofre en tu base');
      return;
    }
    var want = Math.min(amount || 1, invCount(bag, key));
    if (want <= 0) { status('No tenés ' + resName(key).toLowerCase()); return; }
    var moved = benchAddToStorage(wb, key, want);
    if (moved <= 0) { status('El almacén está lleno'); return; }
    invRemove(bag, key, moved);
    status('Guardaste ' + moved + ' ' + resName(key) + ' en la base');
    try { playSound('pickup'); } catch (e) {}
    renderBenchBaseUI(wb);
    try { if (typeof refreshBenchModalLists === 'function') refreshBenchModalLists(); } catch (e) {}
    try { if (typeof updateResourceHUD === 'function') updateResourceHUD(); } catch (e) {}
  }

  function benchWithdrawResource(wb, key, amount) {
    var bag = inv();
    if (!wb || !bag) return;
    var taken = benchTakeFromStorage(wb, key, amount || 1);
    if (taken <= 0) { status('No hay ' + resName(key) + ' en la base'); return; }
    var added = invAddRes(bag, key, taken);
    if (added < taken) benchAddToStorage(wb, key, taken - added);
    status('Sacaste ' + added + ' ' + resName(key));
    try { playSound('pickup'); } catch (e) {}
    renderBenchBaseUI(wb);
    try { if (typeof refreshBenchModalLists === 'function') refreshBenchModalLists(); } catch (e) {}
    try { if (typeof updateResourceHUD === 'function') updateResourceHUD(); } catch (e) {}
  }

  function buildBenchChestModel() {
    var g = new THREE.Group();
    var wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85 });
    var trim = new THREE.MeshStandardMaterial({ color: 0xc4a574, metalness: 0.35, roughness: 0.45 });
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.32, 0.4), wood);
    body.position.y = 0.16;
    body.castShadow = true;
    g.add(body);
    var lid = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 0.44), trim);
    lid.position.y = 0.36;
    lid.castShadow = true;
    g.add(lid);
    var latch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.04), trim);
    latch.position.set(0, 0.26, 0.21);
    g.add(latch);
    return g;
  }

  function buildBenchDispenserModel() {
    var g = new THREE.Group();
    var bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4a55, metalness: 0.4, roughness: 0.5 });
    var accent = new THREE.MeshStandardMaterial({
      color: 0x4caf50, emissive: 0x1b5e20, emissiveIntensity: 0.8, roughness: 0.4
    });
    var box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.34), bodyMat);
    box.position.y = 0.25;
    box.castShadow = true;
    g.add(box);
    var slot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.03), accent);
    slot.position.set(0, 0.34, 0.18);
    g.add(slot);
    var tube = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 8), accent);
    tube.position.set(0, 0.06, 0.2);
    tube.rotation.x = Math.PI / 2;
    g.add(tube);
    return g;
  }

  function installBenchUpgrade(wb, kind, opts) {
    opts = opts || {};
    try {
      ensureBenchUpgradeFields(wb);
      if (!wb || !wb.upgrades) return false;
      if (wb.upgrades[kind]) return true;
      if (kind === 'dispenser' && !wb.upgrades.chest) {
        status('Primero instalá el cofre de la mesa');
        return false;
      }
      var cost = BENCH_UPGRADE_COSTS[kind] || {};
      var bag = inv();
      if (!opts.noCost) {
        if (!invSpendAll(bag, cost)) {
          status('Te faltan materiales para la mejora (necesitás ' +
            Object.keys(cost).map(function (k) { return cost[k] + ' ' + resName(k); }).join(' + ') + ')');
          return false;
        }
      }
      wb.upgrades[kind] = true;
      if (kind === 'chest') {
        if (!Array.isArray(wb.storage)) wb.storage = new Array(wb.storageCapacity || 12).fill(null);
        if (wb.chestMesh && wb.mesh) {
          try { wb.mesh.remove(wb.chestMesh); } catch (e) {}
        }
        var model = buildBenchChestModel();
        model.position.set(0.5, 1.05, -0.18);
        model.userData.benchUpgrade = 'chest';
        if (wb.mesh) wb.mesh.add(model);
        wb.chestMesh = model;
      } else if (kind === 'dispenser') {
        if (typeof wb.dispenserStock !== 'number') wb.dispenserStock = 0;
        if (wb.dispenserMesh && wb.mesh) {
          try { wb.mesh.remove(wb.dispenserMesh); } catch (e) {}
        }
        var model2 = buildBenchDispenserModel();
        model2.position.set(-0.5, 1.05, 0.18);
        model2.userData.benchUpgrade = 'dispenser';
        if (wb.mesh) wb.mesh.add(model2);
        wb.dispenserMesh = model2;
      }
      if (!opts.silent) {
        status(kind === 'chest' ? 'Cofre de mesa instalado: 12 espacios' : 'Dispenser de mesa instalado');
        try { playSound('health-regen'); } catch (e) {}
      }
      try { if (typeof refreshCraftUI === 'function') refreshCraftUI(); } catch (e) {}
      try { if (typeof refreshTechTreeState === 'function') refreshTechTreeState(); } catch (e) {}
      renderBenchBaseUI(wb);
      return true;
    } catch (e) {
      try { console.warn('[bench-upg] install', e); } catch (e2) {}
      return false;
    }
  }

  function installBenchChest(wb) { return installBenchUpgrade(wb, 'chest'); }
  function installBenchDispenser(wb) { return installBenchUpgrade(wb, 'dispenser'); }

  function benchProduceAmmo(wb) {
    if (!wb || !wb.upgrades || !wb.upgrades.dispenser) return;
    var cap = wb.dispenserCap || 240;
    if ((wb.dispenserStock || 0) + BENCH_AMMO_BATCH > cap) {
      status('El dispenser está lleno (máx. ' + cap + ')');
      return;
    }
    if (!benchConsumeBase(wb, BENCH_AMMO_COST)) {
      var missing = Object.keys(BENCH_AMMO_COST).filter(function (key) {
        return benchStorageTotals(wb)[key] < BENCH_AMMO_COST[key];
      })[0];
      status('Falta ' + (resName(missing) || 'material') + ' en la mesa o en los cofres asociados');
      return;
    }
    wb.dispenserStock = (wb.dispenserStock || 0) + BENCH_AMMO_BATCH;
    status('Dispenser cargado: +' + BENCH_AMMO_BATCH + ' balas');
    try { playSound('ammo-pickup'); } catch (e) {}
    renderBenchBaseUI(wb);
  }

  function benchTakeAmmo(wb) {
    var bag = inv();
    if (!wb || !bag) return;
    var stock = wb.dispenserStock || 0;
    if (stock <= 0) { status('El dispenser está vacío — cargalo con recursos'); return; }
    var n = Math.min(12, stock);
    var added = invAddAmmoAmount(bag, 'pistol', n);
    if (added <= 0) { status('Mochila llena: no entra munición'); return; }
    wb.dispenserStock = stock - added;
    status('Tomaste ' + added + ' balas');
    try { playSound('pickup'); } catch (e) {}
    try { if (typeof updateResourceHUD === 'function') updateResourceHUD(); } catch (e) {}
    renderBenchBaseUI(wb);
  }

  function renderBenchBaseUI(wb) {
    try {
      wb = wb || (typeof currentBench !== 'undefined' ? currentBench : null);
      var upEl = document.getElementById('benchUpgrades');
      var stEl = document.getElementById('benchStorage');
      var dsEl = document.getElementById('benchDispenser');
      if (!upEl || !stEl || !dsEl) return;
      if (!wb) {
        upEl.innerHTML = '';
        stEl.innerHTML = '';
        dsEl.innerHTML = '';
        return;
      }
      ensureBenchUpgradeFields(wb);
      var upg = wb.upgrades;

      var up = '<div class="bench-upg-row">';
      if (!upg.chest) {
        up += '<button type="button" class="rg-btn rg-btn-small rg-btn-primary" data-bact="chest">🧰 Instalar cofre de mesa</button>' +
          '<span class="bench-cost">' + ico('wood') + BENCH_UPGRADE_COSTS.chest.wood + ' ' +
          ico('stone') + BENCH_UPGRADE_COSTS.chest.stone + ' ' +
          ico('metal') + BENCH_UPGRADE_COSTS.chest.metal + '</span>';
      } else {
        up += '<span class="bench-ok">✓ Cofre de mesa (12 espacios)</span>';
      }
      up += '</div><div class="bench-upg-row">';
      if (!upg.dispenser) {
        up += '<button type="button" class="rg-btn rg-btn-small' + (upg.chest ? ' rg-btn-primary' : '') + '" data-bact="dispenser"' +
          (upg.chest ? '' : ' disabled') + '>📦 Instalar dispenser</button>' +
          '<span class="bench-cost">' + ico('metal') + BENCH_UPGRADE_COSTS.dispenser.metal + ' ' +
          ico('stone') + BENCH_UPGRADE_COSTS.dispenser.stone + ' ' +
          ico('wood') + BENCH_UPGRADE_COSTS.dispenser.wood + '</span>';
      } else {
        up += '<span class="bench-ok">✓ Dispenser instalado · stock ' + (wb.dispenserStock || 0) + '</span>';
      }
      up += '</div>';
      upEl.innerHTML = up;

      var bag = inv();
      var totals = benchStorageTotals(wb);
      var linked = linkedChestsFor(wb);
      var st = '';
      if (!wb.storage && !linked.length) {
        st += '<div class="rg-hint">Sin almacén: instalá el cofre de la mesa o colocá un cofre dentro del área.</div>';
      } else {
        st += '<div class="bench-store-grid">';
        ['wood', 'stone', 'metal'].forEach(function (k) {
          var base = totals[k] || 0;
          var mine = bag ? invCount(bag, k) : 0;
          st += '<div class="bench-store-row">' +
            '<span class="bench-store-name">' + ico(k) + ' ' + resName(k) + '</span>' +
            '<span class="bench-store-qty">' + base + '</span>' +
            '<span class="bench-store-mine">mochila: ' + mine + '</span>' +
            '<span class="bench-store-btns">' +
              '<button type="button" class="rg-btn rg-btn-small" data-bact="dep1" data-key="' + k + '"' + (mine <= 0 ? ' disabled' : '') + '>↓1</button>' +
              '<button type="button" class="rg-btn rg-btn-small" data-bact="dep10" data-key="' + k + '"' + (mine <= 0 ? ' disabled' : '') + '>↓10</button>' +
              '<button type="button" class="rg-btn rg-btn-small" data-bact="with1" data-key="' + k + '"' + (base <= 0 ? ' disabled' : '') + '>↑1</button>' +
              '<button type="button" class="rg-btn rg-btn-small" data-bact="with10" data-key="' + k + '"' + (base <= 0 ? ' disabled' : '') + '>↑10</button>' +
            '</span></div>';
        });
        st += '</div>';
        st += '<div class="rg-hint">' + (linked.length
          ? ('Cofres asociados dentro del área: ' + linked.length + '.')
          : 'No hay cofres colocados dentro del área de esta mesa.') + '</div>';
      }
      stEl.innerHTML = st;

      var ds = '';
      if (!upg.dispenser) {
        ds += '<div class="rg-hint">Instalá el dispenser arriba. Consume recursos del almacén de la mesa y de los cofres asociados.</div>';
      } else {
        var have = benchStorageTotals(wb);
        var can = Object.keys(BENCH_AMMO_COST).every(function (k) {
          return (have[k] || 0) >= BENCH_AMMO_COST[k];
        });
        ds += '<div class="bench-disp-row"><span>Módulo de mesa · stock: <b>' + (wb.dispenserStock || 0) + '</b> balas</span>' +
          '<button type="button" class="rg-btn rg-btn-small rg-btn-primary" data-bact="produce"' + (can ? '' : ' disabled') + '>Producir ' + BENCH_AMMO_BATCH + '</button>' +
          '<button type="button" class="rg-btn rg-btn-small" data-bact="takeammo"' + ((wb.dispenserStock || 0) > 0 ? '' : ' disabled') + '>Tomar 12</button></div>' +
          '<div class="bench-cost">Costo: ' + ico('metal') + BENCH_AMMO_COST.metal + ' ' + ico('wood') + BENCH_AMMO_COST.wood +
          ' · del almacén/cofres del claim (' + (have.metal || 0) + ' metal, ' + (have.wood || 0) + ' madera). Distinto del dispenser suelto del mundo (E · Tomar 10).</div>';
      }
      dsEl.innerHTML = ds;

      upEl.querySelectorAll('[data-bact]').forEach(function (b) {
        b.addEventListener('click', function () {
          var act = b.getAttribute('data-bact');
          if (act === 'chest') installBenchChest(wb);
          else if (act === 'dispenser') installBenchDispenser(wb);
        });
      });
      stEl.querySelectorAll('[data-bact]').forEach(function (b) {
        b.addEventListener('click', function () {
          var act = b.getAttribute('data-bact');
          var key = b.getAttribute('data-key');
          if (act === 'dep1') benchDepositResource(wb, key, 1);
          else if (act === 'dep10') benchDepositResource(wb, key, 10);
          else if (act === 'with1') benchWithdrawResource(wb, key, 1);
          else if (act === 'with10') benchWithdrawResource(wb, key, 10);
        });
      });
      dsEl.querySelectorAll('[data-bact]').forEach(function (b) {
        b.addEventListener('click', function () {
          var act = b.getAttribute('data-bact');
          if (act === 'produce') benchProduceAmmo(wb);
          else if (act === 'takeammo') benchTakeAmmo(wb);
        });
      });
    } catch (e) {
      try { console.warn('[bench-upg] render', e); } catch (e2) {}
    }
  }

  function serializedBenchUpgrades(wb) {
    if (!wb) return null;
    return {
      upgrades: wb.upgrades ? { chest: !!wb.upgrades.chest, dispenser: !!wb.upgrades.dispenser } : null,
      storage: Array.isArray(wb.storage) ? wb.storage.map(function (s) { return s ? Object.assign({}, s) : null; }) : null,
      dispenserStock: wb.dispenserStock || 0
    };
  }

  function applyBenchUpgradeData(wb, data) {
    if (!wb || !data) return;
    try {
      ensureBenchUpgradeFields(wb);
      if (data.upgrades && data.upgrades.chest) installBenchUpgrade(wb, 'chest', { noCost: true, silent: true });
      if (data.upgrades && data.upgrades.dispenser) installBenchUpgrade(wb, 'dispenser', { noCost: true, silent: true });
      if (Array.isArray(data.storage)) {
        if (!Array.isArray(wb.storage)) wb.storage = new Array(wb.storageCapacity || 12).fill(null);
        data.storage.slice(0, wb.storage.length).forEach(function (s, i) {
          wb.storage[i] = s ? Object.assign({}, s) : null;
        });
      }
      if (typeof data.dispenserStock === 'number') wb.dispenserStock = Math.max(0, data.dispenserStock);
      try { renderBenchBaseUI(wb); } catch (e) {}
    } catch (e) {
      try { console.warn('[bench-upg] apply', e); } catch (e2) {}
    }
  }

  window.BENCH_UPGRADE_COSTS = BENCH_UPGRADE_COSTS;
  window.BENCH_AMMO_COST = BENCH_AMMO_COST;
  window.BENCH_AMMO_BATCH = BENCH_AMMO_BATCH;
  window.linkedChestsFor = linkedChestsFor;
  window.benchStorageTotals = benchStorageTotals;
  window.benchDepositResource = benchDepositResource;
  window.benchWithdrawResource = benchWithdrawResource;
  window.installBenchUpgrade = installBenchUpgrade;
  window.installBenchChest = installBenchChest;
  window.installBenchDispenser = installBenchDispenser;
  window.benchProduceAmmo = benchProduceAmmo;
  window.benchTakeAmmo = benchTakeAmmo;
  window.renderBenchBaseUI = renderBenchBaseUI;
  window.serializedBenchUpgrades = serializedBenchUpgrades;
  window.applyBenchUpgradeData = applyBenchUpgradeData;
})();
