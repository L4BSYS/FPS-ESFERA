// js/30-station-drag.js — Un solo DnD para cinturón / Cosas / bandeja / cofre.
// Reemplaza _beltDrag (15-ui) y _chestDrag (23-world-container).

var _stationDrag = null;

function _sdGhost(label, x, y) {
  let g = document.getElementById('stationDragGhost');
  if (!g) {
    g = document.createElement('div');
    g.id = 'stationDragGhost';
    g.className = 'rg-drag-ghost';
    document.body.appendChild(g);
  }
  g.textContent = label;
  g.style.left = x + 'px';
  g.style.top = y + 'px';
  return g;
}

function _sdPointIn(el, x, y) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function _sdBeltSlotUnder(x, y) {
  const els = document.querySelectorAll('#invBelt .quick-slot, #benchBelt .quick-slot');
  for (let i = 0; i < els.length; i++) {
    if (_sdPointIn(els[i], x, y)) return parseInt(els[i].getAttribute('data-slot'), 10);
  }
  return -1;
}

function _sdTraySlotUnder(x, y) {
  const st = (typeof activeTrayStation === 'function') ? activeTrayStation() : null;
  if (!st) return null;
  const pairs = [[st.ids.a, 'a'], [st.ids.b, 'b']];
  for (let i = 0; i < pairs.length; i++) {
    const el = document.getElementById(pairs[i][0]);
    if (_sdPointIn(el, x, y)) return pairs[i][1];
  }
  return null;
}

function _sdChestIdxUnder(x, y) {
  const cells = document.querySelectorAll('#containerSlots .rg-inv-slot-cell[data-chest-idx]');
  for (let i = 0; i < cells.length; i++) {
    if (_sdPointIn(cells[i], x, y)) return parseInt(cells[i].getAttribute('data-chest-idx'), 10);
  }
  return -1;
}

function _sdBagGridUnder(x, y) {
  const ids = [];
  if (typeof invOpen !== 'undefined' && invOpen) ids.push('invItems');
  if (typeof benchOpen !== 'undefined' && benchOpen) ids.push('benchItems');
  if (typeof containerOpen !== 'undefined' && containerOpen) {
    ids.push('containerInvItems');
    ids.push('containerDispItems');
  }
  for (let i = 0; i < ids.length; i++) {
    if (_sdPointIn(document.getElementById(ids[i]), x, y)) return true;
  }
  return false;
}

function _sdRefreshOpen() {
  if (typeof refreshOpenStation === 'function') {
    refreshOpenStation();
    return;
  }
  if (typeof containerOpen !== 'undefined' && containerOpen && typeof refreshContainerModal === 'function') {
    refreshContainerModal();
    return;
  }
  if (typeof benchOpen !== 'undefined' && benchOpen && typeof refreshBenchModalLists === 'function') {
    refreshBenchModalLists();
    return;
  }
  if (typeof refreshInvModal === 'function') refreshInvModal();
}

function startStationDrag(opts) {
  _stationDrag = {
    kind: opts.kind, // 'bag' | 'belt' | 'chest'
    item: opts.item || null,
    fromBag: (typeof opts.fromBag === 'number') ? opts.fromBag : -1,
    fromSlot: (typeof opts.fromSlot === 'number') ? opts.fromSlot : -1,
    fromChest: (typeof opts.fromChest === 'number') ? opts.fromChest : -1,
    label: opts.label || '·',
    moved: false,
    x: opts.x,
    y: opts.y
  };
  _sdGhost(_stationDrag.label, opts.x, opts.y);
}

function moveStationDrag(x, y) {
  if (!_stationDrag) return;
  if (Math.abs(x - _stationDrag.x) + Math.abs(y - _stationDrag.y) > 6) _stationDrag.moved = true;
  const g = document.getElementById('stationDragGhost');
  if (g) { g.style.left = x + 'px'; g.style.top = y + 'px'; }
}

function endStationDrag(x, y) {
  if (!_stationDrag) return;
  const drag = _stationDrag;
  _stationDrag = null;
  const g = document.getElementById('stationDragGhost');
  if (g) g.remove();

  const inv = (typeof player !== 'undefined' && player) ? player.inventory : null;
  const chestMode = typeof containerOpen !== 'undefined' && containerOpen &&
    currentContainer && currentContainer.mode === 'storage';
  const craftMode = (typeof invOpen !== 'undefined' && invOpen) ||
    (typeof benchOpen !== 'undefined' && benchOpen);

  // Click sin mover
  if (!drag.moved) {
    if (drag.kind === 'belt' && drag.fromSlot >= 0 && inv) {
      try { inv.quickSelect(drag.fromSlot); } catch (e) {}
      _sdRefreshOpen();
      return;
    }
    if (drag.kind === 'bag' && drag.fromBag >= 0 && inv) {
      if (chestMode && typeof containerDepositInv === 'function') {
        containerDepositInv(drag.fromBag);
        return;
      }
      const it = inv.items[drag.fromBag];
      if (it && (it.toolType || it.healAmount > 0) && typeof invUseItem === 'function') invUseItem(drag.fromBag);
      return;
    }
    if (drag.kind === 'chest' && drag.fromChest >= 0 && typeof containerWithdrawSlot === 'function') {
      containerWithdrawSlot(drag.fromChest);
      return;
    }
    return;
  }

  if (!inv) return;

  // Bag → tray
  if (drag.kind === 'bag' && craftMode) {
    const traySlot = _sdTraySlotUnder(x, y);
    if (traySlot != null) {
      const st = activeTrayStation();
      if (st) {
        if (!canPlaceInTray(drag.item)) {
          try { setCraftStatus('La bandeja solo acepta recursos (madera/piedra/metal)'); } catch (e) {}
          _sdRefreshOpen();
          return;
        }
        st.putItem(traySlot, drag.item);
      }
      return;
    }
  }

  // Bag → chest
  if (drag.kind === 'bag' && chestMode && _sdPointIn(document.getElementById('containerSlots'), x, y)) {
    if (typeof containerDepositInv === 'function') containerDepositInv(drag.fromBag);
    return;
  }

  // Chest → bag / reorder
  if (drag.kind === 'chest' && chestMode) {
    if (_sdPointIn(document.getElementById('containerInvItems'), x, y)) {
      if (typeof containerWithdrawSlot === 'function') containerWithdrawSlot(drag.fromChest);
      return;
    }
    const target = _sdChestIdxUnder(x, y);
    if (target >= 0 && target !== drag.fromChest && currentContainer) {
      const slots = currentContainer.slots;
      const tmp = slots[target];
      slots[target] = slots[drag.fromChest];
      slots[drag.fromChest] = tmp;
      refreshContainerModal();
    }
    return;
  }

  // Belt / bag ↔ belt (solo craft modes)
  if (!craftMode) return;

  const target = _sdBeltSlotUnder(x, y);
  if (target >= 0) {
    if (!inv.canPlaceOnBelt(drag.item)) {
      try { setCraftStatus('Eso no va en el cinturón (solo herramientas/armas)'); } catch (e) {}
      _sdRefreshOpen();
      return;
    }
    if (drag.fromSlot >= 0) {
      const tmp = inv.quickSlots[target];
      inv.quickSlots[target] = inv.quickSlots[drag.fromSlot];
      inv.quickSlots[drag.fromSlot] = tmp;
      inv.updateQuickSlotUI();
    } else if (drag.item) {
      if (!inv.assignToQuickSlot(drag.item, target)) {
        try { setCraftStatus('No se pudo poner en el cinturón'); } catch (e) {}
      }
    }
    _sdRefreshOpen();
    return;
  }

  if (drag.fromSlot >= 0 && (_sdBagGridUnder(x, y) || true)) {
    // Soltar fuera del cinturón = bajar a mochila
    inv.clearQuickSlot(drag.fromSlot);
    _sdRefreshOpen();
  }
}

document.addEventListener('pointerdown', function (e) {
  if (e.target && e.target.closest && e.target.closest('button')) return;
  const inv = (typeof player !== 'undefined' && player) ? player.inventory : null;
  if (!inv) return;

  const craftMode = (typeof invOpen !== 'undefined' && invOpen) ||
    (typeof benchOpen !== 'undefined' && benchOpen);
  const chestMode = typeof containerOpen !== 'undefined' && containerOpen &&
    currentContainer && currentContainer.mode === 'storage';
  if (!craftMode && !chestMode) return;

  // Cosas (mochila / mesa / cofre)
  const bagSel = craftMode
    ? '#invItems .rg-drag-handle, #benchItems .rg-drag-handle'
    : '#containerInvItems .rg-drag-handle';
  const bagCell = e.target && e.target.closest ? e.target.closest(bagSel) : null;
  if (bagCell) {
    const idx = parseInt(bagCell.getAttribute('data-idx'), 10);
    const it = inv.items[idx];
    if (!it) return;
    e.preventDefault();
    startStationDrag({
      kind: 'bag',
      item: it,
      fromBag: idx,
      label: ((typeof itemIcon === 'function' ? itemIcon(it) : '') + ' ' + (it.name || '')).trim(),
      x: e.clientX,
      y: e.clientY
    });
    return;
  }

  if (craftMode) {
    const slotEl = e.target && e.target.closest
      ? e.target.closest('#invBelt .quick-slot, #benchBelt .quick-slot')
      : null;
    if (slotEl) {
      const idx = parseInt(slotEl.getAttribute('data-slot'), 10);
      const it = inv.quickSlots[idx];
      if (!it) return;
      e.preventDefault();
      startStationDrag({
        kind: 'belt',
        item: it,
        fromSlot: idx,
        label: ((typeof itemIcon === 'function' ? itemIcon(it) : '') + ' ' + (it.name || '')).trim(),
        x: e.clientX,
        y: e.clientY
      });
      return;
    }
  }

  if (chestMode) {
    const chestCell = e.target && e.target.closest
      ? e.target.closest('#containerSlots .rg-drag-handle')
      : null;
    if (chestCell) {
      const idx = parseInt(chestCell.getAttribute('data-chest-drag'), 10);
      const slot = currentContainer.slots[idx];
      if (!slot) return;
      e.preventDefault();
      const ico = (typeof chestSlotIcon === 'function' ? chestSlotIcon(slot) : '▫️');
      startStationDrag({
        kind: 'chest',
        item: slot,
        fromChest: idx,
        label: (ico + ' ' + (slot.name || '')).trim(),
        x: e.clientX,
        y: e.clientY
      });
    }
  }
});

document.addEventListener('pointermove', function (e) {
  if (_stationDrag) moveStationDrag(e.clientX, e.clientY);
});
document.addEventListener('pointerup', function (e) {
  if (_stationDrag) endStationDrag(e.clientX, e.clientY);
});
document.addEventListener('pointercancel', function (e) {
  if (_stationDrag) endStationDrag(e.clientX, e.clientY);
});
