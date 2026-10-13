(function () {
  window.Game = window.Game || {};

  let modal = null;
  let pickCb = null;
  let onTool = null;
  let onRespawn = null;
  let onResume = null;
  let creatorHooks = null;
  let flashTimer = 0;
  let prevHp = 100;
  let paused = false;
  let rebindAction = null;
  let pauseTab = 'status';

  const ICONS = {
    hands: '✋',
    axe: '🪓',
    pickaxe: '⛏',
    hammer: '🔨',
    pistol: '🔫',
    torch: '🔥',
  };

  const els = {};

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function closeModal() {
    modal = null;
    pickCb = null;
    els.panel.hidden = true;
    els.list.textContent = '';
  }

  window.Game.HUD = {
    init() {
      const root = el('div', 'hud');
      els.health = el('div', 'hud-health');
      els.tool = el('div', 'hud-tool');
      els.res = el('div', 'hud-res');
      els.stacks = el('div', 'hud-stacks');
      els.key = el('div', 'hud-key');
      els.ammo = el('div', 'hud-ammo');
      root.append(els.health, els.tool, els.res, els.stacks, els.key, els.ammo);

      els.cross = el('div', 'crosshair');
      els.prompt = el('div', 'hud-prompt');
      els.flash = el('div', 'hud-flash');
      els.hurt = el('div', 'hurt');

      els.panel = el('div', 'craft-panel');
      els.panel.hidden = true;
      els.title = el('h2');
      els.title.textContent = 'Mesa de trabajo';
      els.list = el('div', 'craft-list');
      els.hint = el('p', 'craft-hint');
      const interactKey = window.Game.Settings ? window.Game.Settings.label('interact') : 'E';
      els.hint.textContent = 'Números 1 a 8 craftean. ' + interactKey + ' cierra.';
      els.panel.append(els.title, els.list, els.hint);

      els.belt = el('div', 'belt');

      els.death = el('div', 'sheet death-sheet');
      els.death.hidden = true;
      const deathCard = el('div', 'sheet-card');
      const deathTitle = el('h2', 'death-title');
      deathTitle.textContent = 'MORISTE';
      els.deathStats = el('p', 'death-stats');
      const deathRow = el('div', 'sheet-row');
      const respawnBtn = document.createElement('button');
      respawnBtn.type = 'button';
      respawnBtn.className = 'sheet-btn primary';
      respawnBtn.textContent = 'Reaparecer';
      respawnBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (onRespawn) onRespawn();
      });
      const restartBtn = document.createElement('button');
      restartBtn.type = 'button';
      restartBtn.className = 'sheet-btn';
      restartBtn.textContent = 'Reiniciar';
      restartBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.location.reload();
      });
      deathRow.append(respawnBtn, restartBtn);
      const deathHint = el('p', 'craft-hint');
      deathHint.textContent = 'Reaparecer conserva el patio, la mochila y la oleada. Reiniciar borra todo.';
      deathCard.append(deathTitle, els.deathStats, deathRow, deathHint);
      els.death.appendChild(deathCard);

      els.pause = el('div', 'sheet pause-sheet');
      els.pause.hidden = true;
      const pauseCard = el('div', 'sheet-card');
      const pauseTitle = el('h2');
      pauseTitle.textContent = 'Pausa';
      const tabRow = el('div', 'sheet-row');
      const tabStatus = document.createElement('button');
      tabStatus.type = 'button';
      tabStatus.className = 'sheet-btn small';
      tabStatus.textContent = 'Estado';
      const tabSettings = document.createElement('button');
      tabSettings.type = 'button';
      tabSettings.className = 'sheet-btn small';
      tabSettings.textContent = 'Ajustes';
      const tabCreator = document.createElement('button');
      tabCreator.type = 'button';
      tabCreator.className = 'sheet-btn small';
      tabCreator.textContent = 'Creador';
      tabStatus.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        pauseTab = 'status';
        paintPause();
      });
      tabSettings.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        pauseTab = 'settings';
        paintPause();
      });
      tabCreator.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        pauseTab = 'creator';
        paintPause();
      });
      tabRow.append(tabStatus, tabSettings, tabCreator);
      els.pauseStats = el('p', 'craft-copy');
      els.pauseBody = el('div', 'pause-body');
      const resumeBtn = document.createElement('button');
      resumeBtn.type = 'button';
      resumeBtn.className = 'sheet-btn primary';
      resumeBtn.textContent = 'Seguir';
      resumeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closePause();
        if (onResume) onResume();
      });
      const pauseHint = el('p', 'craft-hint');
      pauseHint.textContent = 'Esc sigue. WASD, espacio, shift y 1-6 quedan fijos. G creador, B paleta.';
      pauseCard.append(pauseTitle, tabRow, els.pauseStats, els.pauseBody, resumeBtn, pauseHint);
      els.pause.appendChild(pauseCard);

      document.body.append(
        root, els.cross, els.prompt, els.flash, els.hurt, els.panel, els.belt, els.death, els.pause
      );
    },

    setToolHandler(fn) { onTool = fn; },

    setResumeHandler(fn) { onResume = fn; },

    setCreatorHandlers(hooks) { creatorHooks = hooks || null; },

    setBeltVisible(v) {
      try {
        if (els.belt) els.belt.style.display = v ? '' : 'none';
      } catch (e) {}
    },

    sync(state) {
      els.health.textContent = 'Vida ' + Math.round(state.hp) + ' / ' + state.maxHp;
      els.health.classList.toggle('low', state.hp <= state.maxHp * 0.3);
      els.tool.textContent = 'Herramienta: ' + state.toolName;
      els.res.textContent = 'Madera ' + state.wood + '    Piedra ' + state.stone + '    Metal ' + state.metal;
      els.stacks.textContent = 'Antorchas ' + (state.torch || 0) + '/' + (state.torchMax || 0);
      els.key.textContent = state.hasKey ? 'Llave dorada: sí' : 'Llave dorada: no';
      els.ammo.textContent = state.showAmmo
        ? (state.reloading ? 'Recargando…' : ('Balas ' + state.mag + ' / ' + state.reserve))
        : '';
      els.prompt.textContent = state.prompt || '';
      paintBelt(state.tools || [], state.active);
      if (state.hp < prevHp) {
        els.hurt.classList.add('on');
        setTimeout(() => els.hurt.classList.remove('on'), 160);
      }
      prevHp = state.hp;
    },

    flash(text) {
      els.flash.textContent = text;
      els.flash.classList.add('show');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => els.flash.classList.remove('show'), 1700);
    },

    isModalOpen() { return modal !== null; },
    isCraftOpen() { return modal === 'craft'; },
    isPackOpen() { return modal === 'pack'; },
    isTotemOpen() { return modal === 'totem'; },

    openCraft(rows, onPick, titleText) {
      modal = 'craft';
      pickCb = onPick;
      els.panel.hidden = false;
      els.title.textContent = titleText || 'Mesa de trabajo';
      const interactKey = window.Game.Settings ? window.Game.Settings.label('interact') : 'E';
      els.hint.textContent = 'Números 1 a ' + rows.length + ' craftean. Clic o toque también vale. ' + interactKey + ' cierra.';
      els.list.textContent = '';
      rows.forEach((row) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = (row.index + 1) + '   ' + row.label + (row.reason ? ' — ' + row.reason : '');
        button.disabled = !row.enabled;
        const pick = (event) => {
          if (event) {
            event.preventDefault();
            event.stopPropagation();
          }
          if (button.disabled) return;
          onPick(row.index);
        };
        button.addEventListener('click', pick);
        button.addEventListener('touchstart', pick, { passive: false });
        els.list.appendChild(button);
      });
    },

    openPack(state, actions) {
      modal = 'pack';
      pickCb = null;
      els.panel.hidden = false;
      els.title.textContent = 'Mochila';
      const packKey = window.Game.Settings ? window.Game.Settings.label('pack') : 'Q';
      const interact = window.Game.Settings ? window.Game.Settings.label('interact') : 'E';
      els.hint.textContent = '1-5 craftea lo básico. Clic o toque también vale. ' + packKey + ' o ' + interact + ' cierra.';
      els.list.textContent = '';
      const mats = el('p', 'craft-copy');
      mats.textContent = 'Madera ' + state.wood + '   Piedra ' + state.stone + '   Metal ' + state.metal;
      els.list.appendChild(mats);
      if (state.basic && state.basic.length) {
        const basicTitle = el('p', 'craft-copy');
        basicTitle.textContent = 'Crafteo básico (sin mesa)';
        els.list.appendChild(basicTitle);
        state.basic.forEach((row, i) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = (i + 1) + '   ' + row.label + (row.reason ? ' — ' + row.reason : '');
          button.disabled = !row.enabled;
          const craftIt = (event) => {
            if (event) {
              event.preventDefault();
              event.stopPropagation();
            }
            if (button.disabled) return;
            actions.craftBasic(row.index);
          };
          button.addEventListener('click', craftIt);
          button.addEventListener('touchstart', craftIt, { passive: false });
          els.list.appendChild(button);
        });
      }
      function line(label, buttons) {
        const row = el('div', 'sheet-line');
        const name = el('span');
        name.textContent = label;
        row.appendChild(name);
        buttons.forEach((button) => {
          const node = document.createElement('button');
          node.type = 'button';
          node.className = 'sheet-btn small';
          node.textContent = button.label;
          node.addEventListener('click', (event) => {
            event.preventDefault();
            button.run();
          });
          row.appendChild(node);
        });
        els.list.appendChild(row);
      }
      line('Balas de reserva ' + (state.reserve || 0), [
        { label: 'Soltar', run: () => actions.drop('ammo') },
      ]);
      if (state.torchMax) {
        line('Antorchas ' + (state.torch || 0) + ' / ' + state.torchMax, []);
      }
      if (state.hasKey) {
        line('Llave dorada', [{ label: 'Soltar', run: () => actions.drop('key') }]);
      }
      (state.tools || []).forEach((tool) => {
        // La antorcha es un desbloqueo permanente: no se suelta.
        if (!tool.owned || tool.id === 'hands' || tool.id === 'torch') return;
        line(tool.name, [{ label: 'Soltar', run: () => actions.drop(tool.id) }]);
      });
    },

    openTotem(lines) {
      modal = 'totem';
      pickCb = null;
      els.panel.hidden = false;
      els.title.textContent = 'Tótem';
      const interactKey = window.Game.Settings ? window.Game.Settings.label('interact') : 'E';
      els.hint.textContent = interactKey + ' cierra. El patio queda en pausa.';
      els.list.textContent = '';
      (lines || []).forEach((line) => {
        const p = el('p', 'craft-copy');
        p.textContent = line;
        els.list.appendChild(p);
      });
    },

    closeModal: closeModal,
    closeCraft: closeModal,

    setRespawn(fn) { onRespawn = fn; },

    showDeath(stats) {
      closeModal();
      closePause();
      els.deathStats.textContent = 'Sobreviviste ' + stats.time +
        ' · Bajas ' + stats.kills +
        ' · Oleada ' + stats.wave +
        ' · Bloques ' + stats.blocks;
      els.death.hidden = false;
    },

    closeDeath() {
      if (els.death) els.death.hidden = true;
    },

    isDeathOpen() { return !!(els.death && !els.death.hidden); },

    isPaused() { return paused; },

    togglePause() {
      if (els.death && !els.death.hidden) return;
      if (paused) closePause();
      else {
        paused = true;
        pauseTab = 'status';
        rebindAction = null;
        els.pause.hidden = false;
        paintPause();
      }
    },

    closePause: closePause,

    setPauseStats(text) {
      if (els.pauseStats) els.pauseStats.textContent = text;
    },

    isRebinding() { return !!rebindAction; },

    captureKey(event) {
      if (!rebindAction) return false;
      event.preventDefault();
      if (event.code === 'Escape') {
        rebindAction = null;
        paintPause();
        return true;
      }
      const result = window.Game.Settings.setKey(rebindAction, event.code);
      if (!result.ok) {
        window.Game.HUD.flash(result.text);
      } else {
        rebindAction = null;
      }
      paintPause();
      return true;
    },

    pickCraft(index) {
      if (modal === 'craft' && pickCb) pickCb(index);
    },
  };

  function closePause() {
    paused = false;
    rebindAction = null;
    if (els.pause) els.pause.hidden = true;
  }

  function paintPause() {
    if (!els.pauseBody) return;
    const Settings = window.Game.Settings;
    els.pauseBody.textContent = '';
    if (pauseTab === 'creator') {
      paintCreatorTab();
      return;
    }
    if (pauseTab !== 'settings') {
      const note = el('p', 'craft-copy');
      note.textContent = 'El patio queda quieto. Seguir vuelve al juego.';
      els.pauseBody.appendChild(note);
      // Controles antes en el overlay inicial: ahora viven acá.
      const controls = el('div', 'pause-controls');
      const rows = [
        ['W A S D', 'Moverse'],
        ['Mouse / Clic', 'Mirar / Puño derecho, cosechar, disparar o poner'],
        ['E / Q', 'Tótem, mesa, puerta / Mochila y crafteo'],
        ['Mesa en mano', 'Clic la pone · Esc la guarda'],
        ['Mantener clic', 'Paredes rápidas con martillo (y en creador)'],
        ['Anillo ámbar', 'Spawn: se arranca, no se construye'],
        ['C / V', 'Material / Escalera'],
        ['Der', 'Puño izquierdo, o borrar (creador: abre el menú)'],
        ['F (antorcha en mano)', 'Plantar antorcha (gasta 1)'],
        ['1-6', 'Cinturón, números o rueda'],
        ['G / B', 'Creador / Menú'],
        ['Shift / Espacio', 'Correr / Saltar (en creador: volar)'],
        ['Esc', 'Pausa'],
      ];
      rows.forEach(([keys, action]) => {
        const line = el('p', 'craft-copy');
        line.textContent = keys + ' — ' + action;
        controls.appendChild(line);
      });
      els.pauseBody.appendChild(controls);
      return;
    }

    function addToggle(label, on, run) {
      const row = el('div', 'sheet-line');
      const name = el('span');
      name.textContent = label;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sheet-btn small';
      button.textContent = on ? 'Sí' : 'No';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        run();
        paintPause();
      });
      row.append(name, button);
      els.pauseBody.appendChild(row);
    }

    function addSlider(label, min, max, step, value, run) {
      const row = el('div', 'sheet-line');
      const name = el('span');
      name.textContent = label;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String(step);
      slider.value = String(value);
      slider.addEventListener('click', (event) => event.stopPropagation());
      slider.addEventListener('input', () => run(parseFloat(slider.value)));
      row.append(name, slider);
      els.pauseBody.appendChild(row);
    }

    addToggle('Música', Settings.music, () => Settings.setMusic(!Settings.music));
    addSlider('Volumen', 0, 100, 1, Math.round(Settings.musicVolume * 100), (value) => {
      Settings.setMusicVolume(value / 100);
    });
    addToggle('Efectos', Settings.sfx, () => Settings.setSfx(!Settings.sfx));
    addSlider('Sensibilidad', 0.0005, 0.01, 0.0005, Settings.sensitivity, (value) => {
      Settings.setSensitivity(value);
    });

    const keysTitle = el('p', 'craft-copy');
    keysTitle.textContent = 'Teclas. Apretá el botón y después una letra.';
    els.pauseBody.appendChild(keysTitle);
    Settings.ACTIONS.forEach((action) => {
      const row = el('div', 'sheet-line');
      const name = el('span');
      name.textContent = Settings.NAMES[action];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sheet-btn small';
      button.textContent = rebindAction === action ? '…' : Settings.label(action);
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        rebindAction = action;
        paintPause();
      });
      row.append(name, button);
      els.pauseBody.appendChild(row);
    });
  }

  function paintCreatorTab() {
    const hooks = creatorHooks || {};
    const info = el('p', 'craft-copy');
    info.textContent = typeof hooks.status === 'function'
      ? hooks.status()
      : 'El creador construye gratis alrededor de tu mesa.';
    els.pauseBody.appendChild(info);
    const flow = el('p', 'craft-copy');
    flow.textContent = 'Clic derecho abre el menú, elegí el item y hacé clic para ponerlo. Con ❌ el clic saca.';
    els.pauseBody.appendChild(flow);
    function action(label, run) {
      const row = el('div', 'sheet-line');
      const name = el('span');
      name.textContent = label;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sheet-btn small';
      button.textContent = 'Hacer';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          run();
        } catch (e) {}
        paintPause();
      });
      row.append(name, button);
      els.pauseBody.appendChild(row);
    }
    function toggle(label, isOn, run) {
      const row = el('div', 'sheet-line');
      const name = el('span');
      name.textContent = label;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sheet-btn small';
      button.textContent = isOn ? 'SÍ' : 'NO';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          run();
        } catch (e) {}
        paintPause();
      });
      row.append(name, button);
      els.pauseBody.appendChild(row);
    }
    const isOn = typeof hooks.isOn === 'function' ? hooks.isOn() : false;
    const isFly = typeof hooks.isFly === 'function' ? hooks.isFly() : false;
    toggle('Modo creador (G)', isOn, () => hooks.toggle && hooks.toggle());
    if (isOn) {
      toggle('Volar (Espacio/Shift)', isFly, () => hooks.fly && hooks.fly());
      action('Abrir menú (clic derecho)', () => hooks.palette && hooks.palette());
      action('Vaciar lo construido', () => hooks.clear && hooks.clear());
      action('Guardar mundo', () => hooks.save && hooks.save());
    }
  }

  function paintBelt(tools, active) {
    if (!els.belt) return;
    if (els.belt.childElementCount !== tools.length) {
      els.belt.textContent = '';
      tools.forEach((tool) => {
        const slot = el('button', 'belt-slot');
        slot.type = 'button';
        slot.dataset.tool = tool.id;
        const icon = el('span', 'belt-icon');
        const key = el('span', 'belt-key');
        key.textContent = tool.key;
        slot.append(icon, key);
        const choose = (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (onTool) onTool(tool.id);
        };
        slot.addEventListener('click', choose);
        slot.addEventListener('touchstart', choose, { passive: false });
        els.belt.appendChild(slot);
      });
    }
    const slots = els.belt.children;
    for (let i = 0; i < slots.length; i++) {
      const tool = tools[i];
      const slot = slots[i];
      slot.classList.toggle('owned', !!tool.owned);
      slot.classList.toggle('empty', !tool.owned);
      slot.classList.toggle('active', tool.id === active);
      slot.querySelector('.belt-icon').textContent = tool.owned ? (ICONS[tool.id] || '❔') : '＋';
    }
  }
})();
