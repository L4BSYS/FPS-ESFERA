// js/27-tech.js — Árbol de tecnología adaptado al craft ficha (28-craft / bandeja).
// Fail-safe: nodos sin receta o sin UI se marcan "Próximamente" y no rompen el juego.
// Depende en runtime de: CRAFT_RECIPES (28-craft), inventory, setCraftStatus/resIcon (15-ui).

(function () {
  'use strict';

  // ============================================================
  // Compat helpers (API Sebastian → ficha)
  // ============================================================
  function getPlayerInv() {
    try {
      return (typeof player !== 'undefined' && player && player.inventory) ? player.inventory : null;
    } catch (e) { return null; }
  }

  function recipeById(id) {
    try {
      if (typeof CRAFT_RECIPES === 'undefined' || !id) return null;
      for (var i = 0; i < CRAFT_RECIPES.length; i++) {
        if (CRAFT_RECIPES[i] && CRAFT_RECIPES[i].id === id) return CRAFT_RECIPES[i];
      }
    } catch (e) {}
    return null;
  }

  function recipeIndexById(id) {
    try {
      if (typeof CRAFT_RECIPES === 'undefined' || !id) return -1;
      for (var i = 0; i < CRAFT_RECIPES.length; i++) {
        if (CRAFT_RECIPES[i] && CRAFT_RECIPES[i].id === id) return i;
      }
    } catch (e) {}
    return -1;
  }

  function recipeOwned(r, inv) {
    inv = inv || getPlayerInv();
    if (!r) return false;
    try {
      if (r.id === 'bench') {
        return (typeof workbenches !== 'undefined') && workbenches.some(function (w) {
          return w && w.hp > 0;
        });
      }
      if (r.kind === 'tool' && r.defKey && typeof ITEM_DEFINITIONS !== 'undefined' && ITEM_DEFINITIONS[r.defKey]) {
        var tt = ITEM_DEFINITIONS[r.defKey].toolType;
        if (inv && typeof inv.ownsToolType === 'function') return inv.ownsToolType(tt);
        if (inv && inv.items) return inv.items.some(function (it) { return it && it.toolType === tt; });
      }
      if (r.kind === 'item' && r.defKey && inv) {
        if (typeof inv.findItemEverywhere === 'function') {
          var hit = inv.findItemEverywhere(function (it) { return it && (it.id === r.defKey || it.defKey === r.defKey); });
          if (hit && hit.item) return true;
        }
        if (inv.items && inv.items.some(function (it) { return it && it.id === r.defKey; })) return true;
      }
      if (r.kind === 'ammo' && inv && inv.ammo) {
        // "owned" = ya fabricaste al menos una vez (recetario) o tenés balas
        if (typeof isRecipeUnlocked === 'function' && isRecipeUnlocked(r.id)) return true;
        return (inv.ammo.pistol || 0) > 0;
      }
      if (typeof isRecipeUnlocked === 'function' && isRecipeUnlocked(r.id)) return true;
    } catch (e) {}
    return false;
  }

  function recipeStatus(r) {
    var inv = getPlayerInv();
    var out = { ok: false, missing: [], hasReq: true };
    if (!r) return out;
    try {
      if (r.requires && inv) {
        out.hasReq = (typeof inv.ownsToolType === 'function')
          ? inv.ownsToolType(r.requires)
          : !!(inv.items && inv.items.some(function (it) { return it && it.toolType === r.requires; }));
      } else if (r.requires && !inv) {
        out.hasReq = false;
      }
      if (!inv || !r.cost) {
        out.ok = false;
        return out;
      }
      Object.keys(r.cost).forEach(function (k) {
        var have = (typeof inv.getResourceCount === 'function') ? inv.getResourceCount(k) : (inv.resources[k] || 0);
        if (have < r.cost[k]) out.missing.push(k);
      });
      out.ok = out.hasReq && out.missing.length === 0;
    } catch (e) {}
    return out;
  }

  // Expose for console / other modules
  window.getPlayerInv = getPlayerInv;
  window.recipeById = recipeById;
  window.recipeIndexById = recipeIndexById;
  window.recipeOwned = recipeOwned;
  window.recipeStatus = recipeStatus;

  // ============================================================
  // TECH_NODES — solo craft ficha activo; el resto = soon
  // ============================================================
  // status: undefined = activo si hay receta; 'soon' = placeholder a prueba de fallos
  var TECH_NODES = [
    { id: 'hammer',  recipe: 'hammer',  tier: 0, parents: [],            icon: '🔨', title: 'Martillo',        desc: 'Piedra + piedra en la bandeja (Q). Abre construcción y mesa.' },
    { id: 'torch',   recipe: 'torch',   tier: 0, parents: [],            icon: '🔥', title: 'Antorcha',        desc: 'Madera + madera. Luz portátil.' },

    { id: 'axe',     recipe: 'axe',     tier: 1, parents: ['hammer'],    icon: '🪓', title: 'Hacha',           desc: 'Madera + piedra. Corta árboles más rápido.' },
    { id: 'bench',   recipe: 'bench',   tier: 1, parents: ['hammer'],    icon: '🛠️', title: 'Mesa de trabajo', desc: 'Madera + metal. Reclama base y craft avanzado.' },

    { id: 'pickaxe', recipe: 'pickaxe', tier: 2, parents: ['axe'],       icon: '⛏️', title: 'Pico',            desc: 'Piedra + metal. Mina piedra y metal.' },
    { id: 'dressing',recipe: 'dressing',tier: 2, parents: ['bench'],     icon: '🩹', title: 'Venda',           desc: 'En la mesa: madera + piedra. Cura 30.' },
    { id: 'backpack1', recipe: 'backpack1', tier: 2, parents: ['hammer'], icon: '🎒', title: 'Mochila de lona', desc: 'Ampliación de mochila.', status: 'soon' },
    { id: 'chest',   recipe: 'chest',   tier: 2, parents: ['bench', 'pickaxe'], icon: '🧰', title: 'Cofre craft', desc: 'Cofre fabricable (hoy se coloca en el mundo).', status: 'soon' },

    { id: 'pistol',  recipe: 'pistol',  tier: 3, parents: ['pickaxe'],   icon: '🔫', title: 'Pistola',         desc: 'En la mesa: metal + metal.' },
    { id: 'ammo',    recipe: 'ammo',    tier: 3, parents: ['pistol'],    icon: '📦', title: 'Balas x12',       desc: 'En la mesa: madera + metal.' },
    { id: 'backpack2', recipe: 'backpack2', tier: 3, parents: ['backpack1', 'bench'], icon: '🎒', title: 'Mochila reforzada', desc: 'Más espacios.', status: 'soon' },
    { id: 'bench_chest', kind: 'benchUpgrade', upgrade: 'chest', tier: 3, parents: ['bench'], icon: '🏗️', title: 'Cofre de mesa', desc: 'Mejora de mesa (pendiente de port).', status: 'soon' },

    { id: 'backpack3', recipe: 'backpack3', tier: 4, parents: ['backpack2', 'pistol'], icon: '🎒', title: 'Mochila explorador', desc: 'Capacidad máxima.', status: 'soon' },
    { id: 'bench_dispenser', kind: 'benchUpgrade', upgrade: 'dispenser', tier: 4, parents: ['bench_chest', 'pistol'], icon: '📦', title: 'Dispenser de mesa', desc: 'Mejora de mesa (pendiente de port).', status: 'soon' },
    { id: 'dispenser', recipe: 'dispenser', tier: 4, parents: ['bench_dispenser'], icon: '🏭', title: 'Dispenser craft', desc: 'Dispenser fabricable.', status: 'soon' }
  ];

  var TECH_COLUMNS = ['Básicos', 'Herramientas', 'Base', 'Combate', 'Expedición'];

  function techNodeById(id) {
    for (var i = 0; i < TECH_NODES.length; i++) {
      if (TECH_NODES[i].id === id) return TECH_NODES[i];
    }
    return null;
  }

  function techNodeIsSoon(node) {
    if (!node) return true;
    if (node.status === 'soon') return true;
    if (node.kind === 'benchUpgrade') return true; // upgrades aún no cableados a mesa ficha
    if (node.recipe && !recipeById(node.recipe)) return true;
    return false;
  }

  function techNodeOwned(node) {
    if (!node || techNodeIsSoon(node)) return false;
    try {
      if (node.kind === 'benchUpgrade') {
        return (typeof workbenches !== 'undefined') &&
          workbenches.some(function (w) {
            return w && w.hp > 0 && w.upgrades && w.upgrades[node.upgrade];
          });
      }
      var r = recipeById(node.recipe);
      return !!r && recipeOwned(r, getPlayerInv());
    } catch (e) { return false; }
  }

  function techNodeReady(node) {
    if (!node) return false;
    if (techNodeIsSoon(node)) return false;
    return (node.parents || []).every(function (pid) {
      var p = techNodeById(pid);
      if (!p) return true;
      if (techNodeIsSoon(p)) return false;
      return techNodeOwned(p);
    });
  }

  function techNodeState(node) {
    var owned = false;
    var ready = false;
    var affordable = false;
    var reason = '';
    var cls = 'locked';
    try {
      if (techNodeIsSoon(node)) {
        return { owned: false, ready: false, affordable: false, reason: 'Próximamente', cls: 'locked soon' };
      }
      owned = techNodeOwned(node);
      ready = techNodeReady(node);
      var r = recipeById(node.recipe);
      if (r) {
        var st = recipeStatus(r);
        affordable = st.ok;
        if (!ready) reason = 'Bloqueado';
        else if (r.station === 'bench') reason = 'En la mesa (E)';
        else if (owned && r.kind === 'tool') reason = 'Listo';
        else if (!affordable) reason = 'Faltan materiales';
        else reason = 'Craftear (Q / pausa)';
      }
      cls = owned ? 'done' : (!ready ? 'locked' : (affordable || r.station === 'bench' ? 'ready' : 'open'));
    } catch (e) {
      reason = 'Error';
      cls = 'locked';
    }
    return { owned: owned, ready: ready, affordable: affordable, reason: reason, cls: cls };
  }

  function ensureTechTreeDOM() {
    return document.getElementById('techTree');
  }

  function renderTechTree() {
    try {
      var wrap = ensureTechTreeDOM();
      if (!wrap) return;
      wrap.innerHTML = '';
      TECH_COLUMNS.forEach(function (label, tier) {
        var col = document.createElement('div');
        col.className = 'rg-tech-col';
        col.dataset.tier = String(tier);
        var head = document.createElement('div');
        head.className = 'rg-tech-col-h';
        head.textContent = label;
        col.appendChild(head);
        TECH_NODES.filter(function (n) { return n.tier === tier; }).forEach(function (node) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tech-node';
          btn.dataset.tech = node.id;
          btn.innerHTML =
            '<span class="tech-ico">' + node.icon + '</span>' +
            '<span class="tech-body">' +
              '<span class="tech-name">' + node.title + '</span>' +
              '<span class="tech-sub"></span>' +
            '</span>' +
            '<span class="tech-mark"></span>';
          btn.title = node.desc;
          btn.addEventListener('click', function () { activateTechNode(node.id); });
          col.appendChild(btn);
        });
        wrap.appendChild(col);
      });
      refreshTechTreeState();
      try { drawTechTreeLines(); } catch (e) {}
      requestAnimationFrame(function () { try { drawTechTreeLines(); } catch (e) {} });
      setTimeout(function () { try { drawTechTreeLines(); } catch (e) {} }, 80);
    } catch (e) {
      try { console.warn('[tech] renderTechTree', e); } catch (e2) {}
    }
  }

  function refreshTechTreeState() {
    try {
      var wrap = document.getElementById('techTree');
      if (!wrap) return;
      if (typeof pauseUI !== 'undefined' && pauseUI.activeTab && pauseUI.activeTab !== 'craft') return;
      wrap.querySelectorAll('.tech-node').forEach(function (btn) {
        var node = techNodeById(btn.dataset.tech);
        if (!node) return;
        var st = techNodeState(node);
        btn.classList.remove('done', 'locked', 'ready', 'open', 'soon');
        String(st.cls || '').split(/\s+/).forEach(function (c) { if (c) btn.classList.add(c); });
        var sub = node.desc;
        var mark = '•';
        if (techNodeIsSoon(node)) {
          sub = 'Próximamente';
          mark = '…';
        } else {
          var r = recipeById(node.recipe);
          if (r) {
            var costTxt = Object.keys(r.cost || {}).map(function (k) {
              return ((typeof resIcon === 'function') ? resIcon(k) : k) + r.cost[k];
            }).join(' ');
            sub = costTxt + (r.station === 'bench' ? ' · 🛠 mesa' : ' · ✋ mano');
            if (r.pair && r.pair.length) {
              sub += ' · gesto ' + r.pair.map(function (k) {
                return (typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[k]) ? RESOURCE_ES[k] : k;
              }).join('+');
            }
            if (st.owned && r.kind === 'tool') { sub = 'Completado'; mark = '✓'; }
            else if (!st.ready) mark = '🔒';
            else if (r.station === 'bench') mark = '🛠';
            else mark = st.affordable ? '▶' : '·';
          }
        }
        var subEl = btn.querySelector('.tech-sub');
        if (subEl) subEl.textContent = sub;
        var markEl = btn.querySelector('.tech-mark');
        if (markEl) markEl.textContent = mark;
        btn.title = node.title + ' — ' + node.desc + (st.reason ? '\n(' + st.reason + ')' : '');
      });
      try { drawTechTreeLines(); } catch (e) {}
      requestAnimationFrame(function () { try { drawTechTreeLines(); } catch (e) {} });
    } catch (e) {
      try { console.warn('[tech] refreshTechTreeState', e); } catch (e2) {}
    }
  }

  function drawTechTreeLines() {
    var wrap = document.getElementById('techTree');
    if (!wrap) return;
    var old = wrap.querySelector('svg.rg-tech-lines');
    if (old) old.remove();
    var wrapRect = wrap.getBoundingClientRect();
    var w = Math.max(wrap.scrollWidth, wrapRect.width);
    var h = Math.max(wrap.scrollHeight, wrapRect.height);
    if (!w || !h) return;
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'rg-tech-lines');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    wrap.insertBefore(svg, wrap.firstChild);
    TECH_NODES.forEach(function (node) {
      (node.parents || []).forEach(function (pid) {
        var a = wrap.querySelector('[data-tech="' + pid + '"]');
        var b = wrap.querySelector('[data-tech="' + node.id + '"]');
        if (!a || !b) return;
        var ar = a.getBoundingClientRect();
        var br = b.getBoundingClientRect();
        var x1 = ar.right - wrapRect.left + wrap.scrollLeft;
        var y1 = ar.top - wrapRect.top + ar.height / 2 + wrap.scrollTop;
        var x2 = br.left - wrapRect.left + wrap.scrollLeft;
        var y2 = br.top - wrapRect.top + br.height / 2 + wrap.scrollTop;
        if (x2 <= x1) return;
        var mx = (x1 + x2) / 2;
        var p = document.createElementNS(NS, 'path');
        p.setAttribute('d', 'M' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2);
        var st = techNodeState(node);
        p.setAttribute('class', 'tech-line ' + (st.owned ? 'done' : (st.ready ? 'ready' : 'locked')));
        svg.appendChild(p);
      });
    });
  }

  function setTechStatus(msg) {
    try {
      var foot = document.getElementById('techFoot');
      if (foot) foot.textContent = msg || '';
    } catch (e) {}
    try {
      if (typeof setCraftStatus === 'function') setCraftStatus(msg);
      else if (typeof setPauseStatus === 'function') setPauseStatus(msg);
    } catch (e) {}
  }

  function activateTechNode(id) {
    try {
      var node = techNodeById(id);
      if (!node) return;
      if (techNodeIsSoon(node)) {
        setTechStatus('Próximamente: ' + node.title);
        return;
      }
      if (!techNodeReady(node)) {
        setTechStatus('Primero completá los pasos anteriores del árbol');
        return;
      }
      if (node.kind === 'benchUpgrade') {
        setTechStatus('Mejora de mesa aún no portada — usá cofre/dispenser del mundo');
        return;
      }
      var r = recipeById(node.recipe);
      if (!r) {
        setTechStatus('Receta no disponible');
        return;
      }
      if (r.station === 'bench') {
        setTechStatus('Se fabrica en la mesa (E): gesto ' +
          (r.pair ? r.pair.join(' + ') : 'bandeja') + ' · ' + (r.name || r.label));
        return;
      }
      // Mano: craft directo desde pausa (paga del pool; mismo craftItem que la bandeja)
      var idx = recipeIndexById(r.id);
      if (idx < 0 || typeof craftItem !== 'function') {
        setTechStatus('Abrí la mochila (Q) y usá la bandeja A+B');
        return;
      }
      var st = recipeStatus(r);
      if (!st.ok) {
        setTechStatus(st.hasReq
          ? ('Te faltan materiales para ' + (r.name || r.label))
          : ('Primero crafteá: ' + ((typeof TOOL_REQUIRE_NAMES !== 'undefined' && TOOL_REQUIRE_NAMES[r.requires]) || r.requires)));
        return;
      }
      craftItem(idx);
      refreshTechTreeState();
    } catch (e) {
      try { console.warn('[tech] activateTechNode', e); } catch (e2) {}
      setTechStatus('No se pudo craftear — probá con Q / bandeja');
    }
  }

  window.TECH_NODES = TECH_NODES;
  window.TECH_COLUMNS = TECH_COLUMNS;
  window.techNodeById = techNodeById;
  window.renderTechTree = renderTechTree;
  window.refreshTechTreeState = refreshTechTreeState;
  window.activateTechNode = activateTechNode;
  window.drawTechTreeLines = drawTechTreeLines;

  window.addEventListener('resize', function () {
    try { if (document.getElementById('techTree')) drawTechTreeLines(); } catch (e) {}
  });

  // Hook refreshCraftUI sin romper si aún no existe
  function hookRefreshCraftUI() {
    try {
      if (typeof refreshCraftUI !== 'function' || refreshCraftUI._techHooked) return;
      var prev = refreshCraftUI;
      function wrapped() {
        var ret;
        try { ret = prev.apply(this, arguments); } catch (e) { throw e; }
        try { refreshTechTreeState(); } catch (e) {}
        return ret;
      }
      wrapped._techHooked = true;
      window.refreshCraftUI = wrapped;
      // también el binding libre si quedó en scope global clásico
      try { refreshCraftUI = wrapped; } catch (e) {}
    } catch (e) {}
  }
  hookRefreshCraftUI();
  setTimeout(hookRefreshCraftUI, 0);
  setTimeout(hookRefreshCraftUI, 500);
})();
