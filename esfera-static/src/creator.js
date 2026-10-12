// Modo Creador de La Grieta, portado a la esfera.
// Flujo FPS: clic derecho abre el menú, se elige el item, clic pone.
// En creador el cinturón se oculta y borrar es un modo (❌) + clic.
(function () {
  window.Game = window.Game || {};

  const STORE = 'esfera-creator-v1';
  const LONG_REACH = 14;

  window.Game.createCreator = function (opts) {
    const build = opts.build;
    const courtyard = opts.courtyard;
    const enemies = opts.enemies;
    const player = opts.player;
    const canvas = opts.canvas || null;
    const scene = opts.scene || null;
    const Inventory = window.Game.Inventory;
    const HUD = window.Game.HUD;

    let on = false;
    let fly = true;
    let placeMode = { kind: 'block', id: 'wood' };
    let paletteOpen = false;
    let bar = null;
    let toggleBtn = null;
    let flyBtn = null;
    let btns = [];
    let hintEl = null;
    let saveTimer = 0;
    let aimCamera = opts.camera || null;
    let marker = null;

    function flash(text) {
      if (HUD && HUD.flash) HUD.flash(text);
    }

    function relock() {
      try {
        if (canvas && !document.pointerLockElement) canvas.requestPointerLock();
      } catch (e) {}
    }

    function flash(text) {
      if (HUD && HUD.flash) HUD.flash(text);
    }

    function modeKey() {
      return placeMode.kind + ':' + placeMode.id;
    }

    function ensureHammer() {
      try {
        Inventory.giveTool('hammer');
        Inventory.setTool('hammer');
      } catch (e) {}
    }

    function applyMode() {
      if (build && build.setCreator) build.setCreator(on, LONG_REACH);
      if (enemies && enemies.setPassive) enemies.setPassive(on);
      if (player) player.creatorFly = !!(on && fly);
      // Como el FPS: en creador el cinturón se oculta, el menú manda.
      try {
        if (HUD && HUD.setBeltVisible) HUD.setBeltVisible(!on);
      } catch (e) {}
      if (!on && marker) marker.visible = false;
      refreshBar();
      refreshFloaters();
    }

    function set(next) {
      on = !!next;
      if (on) {
        ensureHammer();
        renderBar();
        renderMarker();
        flash('Creador: clic derecho abre el menú, elegí y hacé clic para poner.');
      } else {
        paletteOpen = false;
        if (bar) bar.style.display = 'none';
        if (marker) marker.visible = false;
        flash('Modo creador apagado');
      }
      applyMode();
      refreshFloaters();
    }

    function toggle() {
      set(!on);
    }

    function setFly(next) {
      fly = !!next;
      if (player) player.creatorFly = !!(on && fly);
      refreshFloaters();
      if (on) flash(fly ? 'Vuelo: SÍ (Espacio sube, Shift baja)' : 'Vuelo: NO');
    }

    function setPlaceMode(kind, id) {
      placeMode = { kind: kind, id: id };
      refreshBar();
      saveSoon();
    }

    function inTerritoryOrBench(ix, iz, kind) {
      // La mesa reclama la zona: siempre se puede poner una mesa nueva.
      if (kind === 'bench') return { ok: true };
      try {
        if (courtyard && courtyard.isInTerritory) {
          if (courtyard.isInTerritory(ix, iz)) return { ok: true };
          const st = courtyard.territoryStatus ? courtyard.territoryStatus() : null;
          if (st && !st.active) {
            return { ok: false, text: 'Sin mesa: poné un workbench para reclamar la zona' };
          }
          return { ok: false, text: 'Fuera de tu zona: construí cerca de tu mesa' };
        }
      } catch (e) {}
      return { ok: true };
    }

    function creatorPlace(playerPos) {
      if (!on) return null;
      if (placeMode.kind === 'erase') return creatorErase(playerPos);
      const cell = build.aimCell(playerPos);
      if (!cell) return { ok: false, text: 'No hay donde poner' };
      const terr = inTerritoryOrBench(cell.ix, cell.iz, placeMode.kind);
      if (!terr.ok) return terr;
      let res = null;
      if (placeMode.kind === 'block') {
        res = build.placeCell(cell.ix, cell.iz, cell.level, placeMode.id, playerPos);
      } else if (placeMode.kind === 'stairs') {
        if (cell.level !== 0) return { ok: false, text: 'La escalera va en el piso' };
        res = build.tryStairs(playerPos);
      } else if (placeMode.kind === 'bench') {
        if (cell.level !== 0) return { ok: false, text: 'La mesa va en el piso' };
        if (build.occupies(cell.ix, cell.iz, 0)) return { ok: false, text: 'Ese lugar está ocupado' };
        res = courtyard.placeBenchAt(cell.ix, cell.iz, true);
      } else if (placeMode.kind === 'item') {
        if (cell.level !== 0) return { ok: false, text: 'Eso va en el piso' };
        res = courtyard.placeCreatorPickup(placeMode.id, cell.ix, cell.iz);
      } else if (placeMode.kind === 'enemy') {
        if (Math.hypot(cell.ix, cell.iz) > 16) return { ok: false, text: 'Fuera del patio' };
        if (enemies.canSpawnAt && !enemies.canSpawnAt(cell.ix, cell.iz)) {
          return { ok: false, text: 'Ese lugar está ocupado' };
        }
        const foe = enemies.spawnOne(cell.ix, cell.iz, true);
        res = foe ? { ok: true, text: 'Robot puesto' } : { ok: false, text: 'No se pudo poner' };
      } else {
        return { ok: false, text: 'Elegí qué poner con B' };
      }
      if (res && res.ok) saveSoon();
      return res;
    }

    function creatorErase(playerPos) {
      let res = null;
      try {
        if (build.tryErase) res = build.tryErase();
        else if (build.tryDelete) res = build.tryDelete();
      } catch (e) { res = null; }
      if (res && res.ok) {
        try { build.dropUnsupported(); } catch (e) {}
        saveSoon();
        return res;
      }
      try {
        const bench = courtyard.tryDeleteBench();
        if (bench && bench.ok) {
          saveSoon();
          return bench;
        }
      } catch (e) {}
      try {
        const cell = build.aimCell ? build.aimCell(playerPos || null) : null;
        if (cell && courtyard.tryDeleteCreatorPickupAt) {
          const pick = courtyard.tryDeleteCreatorPickupAt(cell.ix, cell.iz);
          if (pick && pick.ok) {
            saveSoon();
            return pick;
          }
        }
      } catch (e) {}
      try {
        if (enemies.tryDeleteAimed) {
          const foe = enemies.tryDeleteAimed(aimCamera);
          if (foe && foe.ok) {
            saveSoon();
            return foe;
          }
        }
      } catch (e) {}
      return { ok: false, text: 'No hay nada para sacar' };
    }

    function clearWorld() {
      try {
        if (build.clearAll) build.clearAll();
        if (courtyard.clearCreatorBenches) courtyard.clearCreatorBenches();
        if (courtyard.clearCreatorPickups) courtyard.clearCreatorPickups();
        if (enemies.clearCreatorEnemies) enemies.clearCreatorEnemies();
      } catch (e) {}
      saveSoon();
      return { ok: true, text: 'Mundo vaciado (el patio fijo queda)' };
    }

    function snapshotWorld() {
      return {
        v: 2,
        build: build.snapshot ? build.snapshot() : null,
        benches: courtyard.snapshotBenches ? courtyard.snapshotBenches() : [],
        pickups: courtyard.snapshotCreatorPickups ? courtyard.snapshotCreatorPickups() : [],
        foes: enemies.snapshotCreatorEnemies ? enemies.snapshotCreatorEnemies() : [],
        placeMode: { kind: placeMode.kind, id: placeMode.id },
      };
    }

    function save() {
      try {
        localStorage.setItem(STORE, JSON.stringify(snapshotWorld()));
        return true;
      } catch (e) {
        return false;
      }
    }

    function saveSoon() {
      if (!on && !build.blockCount()) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 400);
    }

    function load() {
      let raw = null;
      try {
        raw = localStorage.getItem(STORE);
      } catch (e) { return 0; }
      if (!raw) return 0;
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (e) { return 0; }
      if (!data) return 0;
      let n = 0;
      try {
        if (data.build && build.restore) n += build.restore(data.build);
        if (data.benches && courtyard.restoreBenches) n += courtyard.restoreBenches(data.benches);
        if (data.pickups && courtyard.restoreCreatorPickups) n += courtyard.restoreCreatorPickups(data.pickups);
        if (data.foes && enemies.restoreCreatorEnemies) n += enemies.restoreCreatorEnemies(data.foes);
        if (data.placeMode && data.placeMode.kind) {
          placeMode = { kind: data.placeMode.kind, id: data.placeMode.id };
        }
      } catch (e) {}
      return n;
    }

    function pickButton(kind, id, icon, title) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'creator-pick';
      b.textContent = icon;
      b.title = title;
      b.dataset.pick = kind + ':' + id;
      b.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        // Elegir cierra el menú y habilita el clic para posicionar.
        setPlaceMode(kind, id);
        togglePalette(false);
        relock();
        const found = btns.filter((x) => x.dataset.pick === kind + ':' + id)[0];
        flash(found ? ('Elegido: ' + found.title + '. Clic para poner, derecho para cambiar.') : 'Elegido.');
      });
      return b;
    }

    function actionButton(icon, title, run) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'creator-pick creator-action';
      b.textContent = icon;
      b.title = title;
      b.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
      return b;
    }

    function renderBar() {
      if (bar) return;
      bar = document.createElement('div');
      bar.id = 'creatorBar';
      bar.style.display = 'none';
      const groups = [
        ['Bloques', [
          pickButton('block', 'wood', '🟫', 'Madera'),
          pickButton('block', 'stone', '⬜', 'Piedra'),
          pickButton('block', 'metal', '⬛', 'Metal'),
        ]],
        ['Base', [
          pickButton('stairs', 'stairs', '🪜', 'Escalera'),
          pickButton('bench', 'bench', '🛠', 'Mesa'),
        ]],
        ['Cosas', [
          pickButton('item', 'axe', '🪓', 'Hacha'),
          pickButton('item', 'pickaxe', '⛏', 'Pico'),
          pickButton('item', 'pistol', '🔫', 'Pistola'),
          pickButton('item', 'ammo', '📦', 'Balas'),
          pickButton('item', 'food', '🍎', 'Comida'),
          pickButton('item', 'toxin', '☠', 'Toxina'),
          pickButton('item', 'medkit', '➕', 'Botiquín'),
          pickButton('item', 'key', '🔑', 'Llave'),
        ]],
        ['Bichos', [
          pickButton('enemy', 'robot', '👾', 'Robot'),
        ]],
        ['Borrar', [
          pickButton('erase', 'erase', '❌', 'Sacar'),
        ]],
      ];
      groups.forEach(([label, buttons]) => {
        const wrap = document.createElement('span');
        wrap.className = 'creator-group';
        const lab = document.createElement('span');
        lab.className = 'creator-label';
        lab.textContent = label;
        wrap.appendChild(lab);
        buttons.forEach((b) => {
          wrap.appendChild(b);
          btns.push(b);
        });
        bar.appendChild(wrap);
      });
      const actions = document.createElement('span');
      actions.className = 'creator-group';
      actions.appendChild(actionButton('🧹', 'Vaciar mundo (queda el patio)', () => {
        if (window.confirm('¿Vaciar lo construido (bloques, escaleras, mesas, cosas, robots)? El patio fijo queda.')) {
          const r = clearWorld();
          flash(r.text);
        }
      }));
      actions.appendChild(actionButton('💾', 'Guardar mundo', () => {
        flash(save() ? 'Mundo guardado' : 'No se pudo guardar');
      }));
      bar.appendChild(actions);
      hintEl = document.createElement('div');
      hintEl.id = 'creatorHint';
      bar.appendChild(hintEl);
      document.body.appendChild(bar);
      refreshBar();
    }

    function refreshBar() {
      if (!bar) return;
      const cur = modeKey();
      btns.forEach((b) => b.classList.toggle('on', b.dataset.pick === cur));
      if (hintEl) {
        const found = btns.filter((b) => b.dataset.pick === cur)[0];
        const name = found ? found.title : 'nada';
        hintEl.textContent = cur === 'erase:erase'
          ? 'Modo sacar: clic sobre lo construido. Derecho vuelve al menú.'
          : 'Clic pone ' + name + ' · Derecho cambia · B menú';
      }
      const show = on && paletteOpen;
      bar.style.display = show ? 'flex' : 'none';
    }

    function refreshFloaters() {
      if (toggleBtn) {
        toggleBtn.textContent = on ? '🧱 Creador: SÍ' : '🧱 Creador: NO';
        toggleBtn.classList.toggle('on', on);
      }
      if (flyBtn) {
        flyBtn.style.display = on ? 'block' : 'none';
        flyBtn.textContent = fly ? '🕊 Volar: SÍ' : '🕊 Volar: NO';
        flyBtn.classList.toggle('on', fly);
      }
    }

    function renderFloaters() {
      if (!toggleBtn) {
        toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.id = 'creatorToggle';
        toggleBtn.title = 'Modo creador (G). Gratis + volar + paleta B.';
        toggleBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggle();
        });
        document.body.appendChild(toggleBtn);
      }
      if (!flyBtn) {
        flyBtn = document.createElement('button');
        flyBtn.type = 'button';
        flyBtn.id = 'creatorFly';
        flyBtn.title = 'Volar con Espacio/Shift';
        flyBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          setFly(!fly);
        });
        document.body.appendChild(flyBtn);
      }
      refreshFloaters();
    }

    function togglePalette(force) {
      if (!on) return false;
      paletteOpen = (typeof force === 'boolean') ? force : !paletteOpen;
      refreshBar();
      // Como el FPS: al abrir el menú se suelta el mouse para elegir;
      // al cerrar se vuelve a apuntar.
      try {
        if (paletteOpen) {
          if (marker) marker.visible = false;
          document.exitPointerLock();
        } else {
          relock();
        }
      } catch (e) {}
      return paletteOpen;
    }

    function renderMarker() {
      if (marker || !scene || !courtyard || !courtyard.frame) return;
      try {
        marker = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.3),
          new THREE.MeshBasicMaterial({ color: 0x33ff66, transparent: true, opacity: 0.75, depthWrite: false })
        );
        marker.raycast = function () {};
        marker.visible = false;
        scene.add(marker);
      } catch (e) {
        marker = null;
      }
    }

    // Fantasma dinámico para modos sin preview propio (mesa, cosas, bicho,
    // borrar): verde si se puede, rojo si no.
    function update(dt, tool, playerPos) {
      if (!on || !marker || !marker.parent) {
        if (marker) marker.visible = false;
        return;
      }
      const paused = HUD && (HUD.isPaused() || HUD.isModalOpen());
      if (paused || paletteOpen || placeMode.kind === 'block' || placeMode.kind === 'stairs') {
        marker.visible = false;
        return;
      }
      let cell = null;
      try {
        cell = build.aimCell(playerPos);
      } catch (e) {
        cell = null;
      }
      if (!cell) {
        marker.visible = false;
        return;
      }
      try {
        const frame = courtyard.frame;
        const h = 0.6;
        marker.position.copy(frame.localToWorld(cell.ix, cell.iz, h));
        let ok = true;
        if (placeMode.kind === 'erase') {
          ok = true;
        } else {
          const terr = inTerritoryOrBench(cell.ix, cell.iz, placeMode.kind);
          ok = terr.ok;
        }
        marker.material.color.setHex(ok ? 0x33ff66 : 0xff4444);
        marker.rotation.y += (dt || 0.016) * 2;
        marker.visible = true;
      } catch (e) {
        marker.visible = false;
      }
    }

    renderBar();
    renderFloaters();
    applyMode();

    return {
      isOn() { return on; },
      isFly() { return fly; },
      toggle: toggle,
      set: set,
      setFly: setFly,
      setCamera(camera) { aimCamera = camera; },
      setPlaceMode: setPlaceMode,
      getPlaceMode() { return { kind: placeMode.kind, id: placeMode.id }; },
      togglePalette: togglePalette,
      isPaletteOpen() { return paletteOpen; },
      place: creatorPlace,
      erase: creatorErase,
      clearWorld: clearWorld,
      save: save,
      load: load,
      update: update,
    };
  };
})();
