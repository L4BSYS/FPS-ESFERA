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
  let pauseTab = 'play';
  let menuMode = 'pause';
  let introDone = null;
  let introPage = 0;

  const INTRO_STORE = 'esfera-intro-v1';

  const INTRO_PAGES = [
    ['Un sol pálido sobre un planeta esférico.', 'Tu mesa, tus herramientas y tu ingenio: eso es todo lo que traés.'],
    ['Los robots cuidan la puerta de las antípodas.', 'Juntá recursos, crafteá un arma y abrite paso.'],
    ['Encontrá la llave dorada, abrí la puerta', 'y cruzá al próximo mundo. Buena travesía.'],
  ];

  const ICONS = {
    hands: '✋',
    axe: '🪓',
    pickaxe: '⛏',
    hammer: '🔨',
    pistol: '🔫',
    torch: '🔥',
  };

  const RES_ICONS = { wood: '🪵', stone: '🪨', metal: '🔩' };

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
      els.pauseTitle = el('h2');
      els.pauseTitle.textContent = 'Pausa';
      const tabRow = el('div', 'sheet-row');
      const tabs = [
        ['play', 'Jugar'],
        ['scenes', 'Escenas'],
        ['user', 'Usuario'],
        ['settings', 'Ajustes'],
        ['creator', 'Creador'],
      ];
      tabs.forEach(([id, label]) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'sheet-btn small';
        tab.textContent = label;
        tab.dataset.tab = id;
        tab.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          pauseTab = id;
          paintPause();
        });
        tabRow.appendChild(tab);
      });
      els.pauseStats = el('p', 'craft-copy');
      els.pauseTabs = tabRow;
      els.pauseBody = el('div', 'pause-body');
      els.resumeBtn = document.createElement('button');
      els.resumeBtn.type = 'button';
      els.resumeBtn.className = 'sheet-btn primary';
      els.resumeBtn.textContent = 'Seguir';
      els.resumeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closePause();
        if (onResume) onResume();
      });
      const pauseHint = el('p', 'craft-hint');
      pauseHint.textContent = 'Esc sigue. El creador vive en su solapa (G lo prende).';
      pauseCard.append(els.pauseTitle, tabRow, els.pauseStats, els.pauseBody, els.resumeBtn, pauseHint);
      els.pause.appendChild(pauseCard);

      // Intro: la primera vez cuenta la historia, después entra directo.
      els.intro = el('div', 'sheet intro-sheet');
      els.intro.hidden = true;
      const introCard = el('div', 'sheet-card');
      const introKicker = el('p', 'intro-kicker');
      introKicker.textContent = 'ESFERA · LA GRIETA';
      els.introTitle = el('h2');
      els.introTitle.textContent = 'Un sol pálido';
      els.introLines = el('div', 'intro-lines');
      els.introDots = el('p', 'intro-dots');
      const introRow = el('div', 'sheet-row');
      const introNext = document.createElement('button');
      introNext.type = 'button';
      introNext.className = 'sheet-btn primary';
      introNext.textContent = 'Siguiente';
      introNext.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        stepIntro(1);
      });
      const introSkip = document.createElement('button');
      introSkip.type = 'button';
      introSkip.className = 'sheet-btn';
      introSkip.textContent = 'Saltar';
      introSkip.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        finishIntro();
      });
      introRow.append(introSkip, introNext);
      els.introNext = introNext;
      introCard.append(introKicker, els.introTitle, els.introLines, els.introDots, introRow);
      els.intro.appendChild(introCard);

      document.body.append(
        root, els.cross, els.prompt, els.flash, els.hurt, els.panel, els.belt, els.death, els.pause, els.intro
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
      // UI compacta con iconos: una sola fila de estado, sin textos largos.
      els.health.textContent = '♥ ' + Math.round(state.hp);
      els.health.classList.toggle('low', state.hp <= state.maxHp * 0.3);
      els.tool.textContent = (ICONS[state.active] || '✋') + ' ' + state.toolName;
      els.res.textContent =
        (RES_ICONS.wood + ' ' + state.wood + '  ' +
         RES_ICONS.stone + ' ' + state.stone + '  ' +
         RES_ICONS.metal + ' ' + state.metal);
      els.stacks.textContent = '🔥 ' + (state.torch || 0) + '/' + (state.torchMax || 0);
      els.key.textContent = state.hasKey ? '🔑' : '';
      els.ammo.textContent = state.showAmmo
        ? (state.reloading ? '⟳…' : ('🔫 ' + state.mag + '/' + state.reserve))
        : '';
      // Pistas: se achican por CSS y se pueden apagar en Ajustes.
      const Settings = window.Game.Settings;
      const showHints = !Settings || Settings.hints !== false;
      els.prompt.textContent = showHints ? (state.prompt || '') : '';
      els.prompt.style.display = showHints ? '' : 'none';
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
      mats.textContent = '🪵 ' + state.wood + '   🪨 ' + state.stone + '   🔩 ' + state.metal;
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

    // El menú inicial y la pausa son el mismo menú: `mode` es 'start' (título
    // del juego + Entrar) o 'pause' (Pausa + Seguir).
    openMenu(mode) {
      if (els.death && !els.death.hidden) return;
      menuMode = (mode === 'start') ? 'start' : 'pause';
      paused = true;
      pauseTab = 'play';
      rebindAction = null;
      if (els.pauseTitle) {
        els.pauseTitle.textContent = menuMode === 'start' ? 'ESFERA' : 'Pausa';
      }
      if (els.resumeBtn) {
        els.resumeBtn.textContent = menuMode === 'start' ? '▶ Entrar al mundo' : 'Seguir';
      }
      els.pause.hidden = false;
      paintPause();
    },

    menuMode() { return menuMode; },

    togglePause() {
      if (els.death && !els.death.hidden) return;
      if (paused) closePause();
      else window.Game.HUD.openMenu('pause');
    },

    hasSeenIntro() {
      try {
        return localStorage.getItem(INTRO_STORE) === '1';
      } catch (e) {
        return true;
      }
    },

    openIntro() {
      introPage = 0;
      els.intro.hidden = false;
      paintIntro();
    },

    setIntroDone(fn) { introDone = (typeof fn === 'function') ? fn : null; },

    replayIntro() {
      try { localStorage.removeItem(INTRO_STORE); } catch (e) {}
      window.Game.HUD.openIntro();
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

  function paintIntro() {
    if (!els.introLines) return;
    els.introLines.textContent = '';
    const page = INTRO_PAGES[Math.min(introPage, INTRO_PAGES.length - 1)];
    page.forEach((line) => {
      const p = el('p', 'craft-copy');
      p.textContent = line;
      els.introLines.appendChild(p);
    });
    if (els.introDots) {
      let dots = '';
      for (let i = 0; i < INTRO_PAGES.length; i++) {
        dots += (i === introPage) ? '● ' : '○ ';
      }
      els.introDots.textContent = dots.trim();
    }
    if (els.introNext) {
      els.introNext.textContent = introPage >= INTRO_PAGES.length - 1 ? '▶ Entrar' : 'Siguiente';
    }
  }

  function stepIntro(delta) {
    introPage += delta;
    if (introPage >= INTRO_PAGES.length) {
      finishIntro();
      return;
    }
    paintIntro();
  }

  function finishIntro() {
    try { localStorage.setItem(INTRO_STORE, '1'); } catch (e) {}
    if (els.intro) els.intro.hidden = true;
    if (introDone) {
      const done = introDone;
      introDone = null;
      done();
    }
  }

  function paintPause() {
    if (!els.pauseBody) return;
    const Settings = window.Game.Settings;
    els.pauseBody.textContent = '';
    // Marca la solapa activa.
    try {
      const tabs = els.pauseTabs ? els.pauseTabs.children : [];
      for (let i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', tabs[i].dataset.tab === pauseTab);
      }
    } catch (e) {}
    if (pauseTab === 'creator') {
      paintCreatorTab();
      return;
    }
    if (pauseTab === 'scenes') {
      paintScenesTab();
      return;
    }
    if (pauseTab === 'user') {
      paintUserTab();
      return;
    }
    if (pauseTab === 'play') {
      paintPlayTab();
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
    addToggle('Pistas en pantalla', Settings.hints, () => Settings.setHints(!Settings.hints));
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

  function paintPlayTab() {
    const Levels = window.Game.Levels;
    const User = window.Game.User;
    const note = el('p', 'craft-copy');
    let mission = '';
    try {
      if (Levels) {
        const def = Levels.current();
        mission = def ? (def.name + ': ' + def.mission) : '';
      }
    } catch (e) {}
    const who = (User && User.name) ? User.name : 'Jugador';
    note.textContent = (menuMode === 'start' ? ('Hola ' + who + '. ') : 'El mundo queda quieto. ') + mission;
    els.pauseBody.appendChild(note);
    const introRow = el('div', 'sheet-line');
    const introName = el('span');
    introName.textContent = 'Ver la intro de nuevo';
    const introBtn = document.createElement('button');
    introBtn.type = 'button';
    introBtn.className = 'sheet-btn small';
    introBtn.textContent = 'Ver';
    introBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.Game.HUD.replayIntro();
    });
    introRow.append(introName, introBtn);
    els.pauseBody.appendChild(introRow);
    // Controles compactos (el detalle vive en Ajustes).
    const controls = el('div', 'pause-controls');
    const rows = [
      ['WASD + mouse', 'Moverse y mirar'],
      ['Clic / Der', 'Usar herramienta / alterno'],
      ['E / Q', 'Interactuar / Mochila'],
      ['C / V / F', 'Material / Escalera / Antorcha'],
      ['1-6 · Shift · Espacio', 'Cinturón · Correr · Saltar'],
      ['G / B / Esc', 'Creador / Menú / Pausa'],
    ];
    rows.forEach(([keys, action]) => {
      const line = el('p', 'craft-copy');
      line.textContent = keys + ' — ' + action;
      controls.appendChild(line);
    });
    els.pauseBody.appendChild(controls);
  }

  function paintScenesTab() {
    const Levels = window.Game.Levels;
    if (!Levels) {
      const none = el('p', 'craft-copy');
      none.textContent = 'Sin escenas.';
      els.pauseBody.appendChild(none);
      return;
    }
    const info = el('p', 'craft-copy');
    info.textContent = 'Cada escena es un planeta. Abrir la puerta con la llave desbloquea la siguiente. Se arranca con la mochila vacía.';
    els.pauseBody.appendChild(info);
    Levels.list().forEach((def) => {
      const row = el('div', 'sheet-line');
      const name = el('span');
      const locked = !Levels.isUnlocked(def.id);
      name.textContent = (locked ? '🔒 ' : '🌍 ') + def.name + ' — ' + def.mission;
      row.appendChild(name);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sheet-btn small';
      button.textContent = locked ? 'Bloqueada' : 'Viajar';
      button.disabled = locked;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (locked) return;
        if (def.id === Levels.current().id) {
          closePause();
          if (onResume) onResume();
          return;
        }
        if (window.confirm('¿Viajar a ' + def.name + '? Se arranca con la mochila vacía.')) {
          Levels.portalTo(def.id);
        }
      });
      row.appendChild(button);
      els.pauseBody.appendChild(row);
    });
  }

  function paintUserTab() {
    const User = window.Game.User;
    if (!User) {
      const none = el('p', 'craft-copy');
      none.textContent = 'Sin usuario.';
      els.pauseBody.appendChild(none);
      return;
    }
    const info = el('p', 'craft-copy');
    info.textContent = 'Tu identidad en el planeta. Mañana: tu avatar en el multijugador.';
    els.pauseBody.appendChild(info);
    const nameRow = el('div', 'sheet-line');
    const nameLabel = el('span');
    nameLabel.textContent = 'Nombre';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 16;
    nameInput.value = User.name;
    nameInput.className = 'sheet-input';
    nameInput.addEventListener('click', (event) => event.stopPropagation());
    nameInput.addEventListener('change', () => {
      nameInput.value = User.setName(nameInput.value);
      paintPause();
    });
    nameRow.append(nameLabel, nameInput);
    els.pauseBody.appendChild(nameRow);
    const colorRow = el('div', 'sheet-line');
    const colorLabel = el('span');
    colorLabel.textContent = 'Color';
    colorRow.appendChild(colorLabel);
    User.colors().forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch' + (User.color === color ? ' active' : '');
      swatch.style.backgroundColor = color;
      swatch.title = color;
      swatch.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        User.setColor(color);
        paintPause();
      });
      colorRow.appendChild(swatch);
    });
    els.pauseBody.appendChild(colorRow);
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
