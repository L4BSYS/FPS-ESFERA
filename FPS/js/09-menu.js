// js/09-menu.js (part 9/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Pause Menu ---
  let pauseMenu;
  const pauseUI = {};
  function createPauseMenu() {
      const pauseDiv = document.createElement('div');
      pauseDiv.id = 'pauseMenu';
      pauseDiv.className = 'rg-overlay rg-cinema-center';
      pauseDiv.style.display = 'none';

      const card = document.createElement('div');
      card.className = 'rg-cinema-card rg-cinema-card--pause';
      pauseDiv.appendChild(card);

      const title = document.createElement('h2');
      title.textContent = 'JUEGO EN PAUSA';
      title.className = 'rg-home-title';
      card.appendChild(title);

      const resumeBtn = document.createElement('button');
      resumeBtn.textContent = 'Seguir (ESC)';
      resumeBtn.className = 'rg-btn rg-btn-primary rg-home-cta';

      resumeBtn.addEventListener('click', togglePause);
      card.appendChild(resumeBtn);

      const tabBar = document.createElement('div');
      tabBar.className = 'rg-tabs';
      pauseUI.tabs = {};
      [['play', 'Jugar'], ['craft', 'Craftear'], ['build', 'Construir'], ['account', 'Cuenta'], ['settings', 'Ajustes']].forEach(([key, label]) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = 'rg-tab';
        b.addEventListener('click', () => showPauseTab(key));
        tabBar.appendChild(b);
        pauseUI.tabs[key] = b;
      });
      card.appendChild(tabBar);

      const pauseBody = document.createElement('div');
      pauseBody.className = 'rg-pause-body';
      card.appendChild(pauseBody);
      pauseUI.body = pauseBody;

      // Session stats line
      const statsDiv = document.createElement('div');
      statsDiv.id = 'pauseStats';
      statsDiv.className = 'rg-stats';
      pauseBody.appendChild(statsDiv);
      pauseUI.stats = statsDiv;

      // --- Account section ---
      const authDiv = document.createElement('div');
      authDiv.className = 'rg-section';
      const authTitle = document.createElement('h4');
      authTitle.className = 'rg-h';
      authTitle.textContent = 'Cuenta';
      authDiv.appendChild(authTitle);
      const userInfo = document.createElement('div');
      userInfo.className = 'rg-userinfo';
      userInfo.id = 'pauseUserInfo';
      userInfo.textContent = 'Sin sesión';
      authDiv.appendChild(userInfo);
      const loginBtn = document.createElement('button');
      loginBtn.className = 'rg-btn';
      loginBtn.textContent = 'Ingresar con Google';
      loginBtn.addEventListener('click', () => {
        if (!window.firebase || !firebase.auth) { setPauseStatus('El login se está cargando, probá de nuevo'); return; }
        const provider = new firebase.auth.GoogleAuthProvider();
        setPauseStatus('Abriendo el login de Google...');
        firebase.auth().signInWithPopup(provider).catch((e) => {
          console.error('Popup login failed, trying redirect:', e);
          try { firebase.auth().signInWithRedirect(provider); }
          catch (err) { setPauseStatus('Falló el ingreso'); }
        });
      });
      authDiv.appendChild(loginBtn);
      pauseUI.loginBtn = loginBtn;
      const logoutBtn = document.createElement('button');
      logoutBtn.className = 'rg-btn';
      logoutBtn.textContent = 'Salir';
      logoutBtn.style.display = 'none';
      logoutBtn.addEventListener('click', () => {
        if (window.firebase && firebase.auth) firebase.auth().signOut().catch((e) => console.error(e));
      });
      authDiv.appendChild(logoutBtn);
      pauseUI.logoutBtn = logoutBtn;
      pauseBody.appendChild(authDiv);
      pauseUI.userInfo = userInfo;

      // --- Scene section (needs sign-in) ---
      const sceneDiv = document.createElement('div');
      sceneDiv.className = 'rg-section';
      sceneDiv.style.display = 'none';
      const sceneTitle = document.createElement('h4');
      sceneTitle.className = 'rg-h';
      sceneTitle.textContent = 'Mis escenas (ingresá para guardar)';
      sceneDiv.appendChild(sceneTitle);
      const sceneHint = document.createElement('div');
      sceneHint.className = 'rg-hint';
      sceneHint.textContent = 'Ingresá en la pestaña Cuenta para guardar y cargar escenas.';
      sceneDiv.appendChild(sceneHint);
      pauseUI.sceneHint = sceneHint;
      const sceneName = document.createElement('input');
      sceneName.className = 'rg-input';
      sceneName.placeholder = 'nombre de escena';
      sceneDiv.appendChild(sceneName);
      pauseUI.sceneName = sceneName;
      const sceneSelect = document.createElement('select');
      sceneSelect.className = 'rg-select';
      sceneSelect.title = 'Your saved scenes';
      sceneSelect.addEventListener('change', () => { if (sceneSelect.value) sceneName.value = sceneSelect.value; });
      sceneDiv.appendChild(sceneSelect);
      pauseUI.sceneSelect = sceneSelect;
      const saveBtn = document.createElement('button');
      saveBtn.className = 'rg-btn rg-btn-primary';
      saveBtn.textContent = 'Guardar';
      saveBtn.addEventListener('click', () => saveSceneToFirestore());
      sceneDiv.appendChild(saveBtn);
      const loadBtn = document.createElement('button');
      loadBtn.className = 'rg-btn';
      loadBtn.textContent = 'Cargar';
      loadBtn.addEventListener('click', () => loadSceneFromFirestore());
      sceneDiv.appendChild(loadBtn);
      pauseBody.appendChild(sceneDiv);
      pauseUI.sceneSection = sceneDiv;
      const trialDiv = document.createElement('div');
      trialDiv.className = 'rg-section';
      trialDiv.style.display = 'none'; // legado: ya no se muestra (los mundos lo reemplazan)
      const trialTitle = document.createElement('h4');
      trialTitle.textContent = 'Trial';
      trialTitle.className = 'rg-h';
      trialDiv.appendChild(trialTitle);
      const trialBox = document.createElement('div');
      trialBox.id = 'trialBox';
      trialDiv.appendChild(trialBox);
      pauseBody.appendChild(trialDiv);

      // --- Mundos (gestor de niveles/portales) ---
      const levelsDiv = document.createElement('div');
      levelsDiv.className = 'rg-section';
      const levelsTitle = document.createElement('h4');
      levelsTitle.className = 'rg-h';
      levelsTitle.textContent = 'Mundos';
      levelsDiv.appendChild(levelsTitle);
      const levelsPanel = document.createElement('div');
      levelsPanel.id = 'levelsPanel';
      levelsDiv.appendChild(levelsPanel);
      pauseBody.appendChild(levelsDiv);

      // --- Creator section (works offline, no sign-in needed) ---
      const creatorDiv = document.createElement('div');
      creatorDiv.className = 'rg-section';
      const creatorTitle = document.createElement('h4');
      creatorTitle.className = 'rg-h';
      creatorTitle.textContent = 'Construir libre';
      creatorDiv.appendChild(creatorTitle);
      const creatorBtn = document.createElement('button');
      creatorBtn.className = 'rg-btn';
      creatorBtn.textContent = 'Creador: NO';
      creatorBtn.addEventListener('click', () => setCreatorMode(!creatorMode));
      creatorDiv.appendChild(creatorBtn);
      pauseUI.creatorBtn = creatorBtn;
      const flyBtn = document.createElement('button');
      flyBtn.className = 'rg-btn';
      flyBtn.textContent = 'Volar: SÍ';
      flyBtn.style.display = 'none';
      flyBtn.addEventListener('click', () => {
        if (typeof player !== 'undefined' && player) {
          player.creatorFly = !player.creatorFly;
          flyBtn.textContent = 'Volar: ' + (player.creatorFly ? 'SÍ' : 'NO');
        }
      });
      creatorDiv.appendChild(flyBtn);
      pauseUI.flyBtn = flyBtn;
      const palette = document.createElement('div');
      palette.style.display = 'none';
      palette.style.marginTop = '6px';
      const paletteLabel = document.createElement('div');
      paletteLabel.className = 'rg-hint';
      paletteLabel.textContent = 'Poné bloques con clic del martillo (objetos/nodos con lo que sea). Clic derecho saca.';
      palette.appendChild(paletteLabel);
      const paletteHint = document.createElement('div');
      paletteHint.className = 'rg-hint';
      paletteHint.id = 'creatorKeysHint';
      paletteHint.innerHTML = '1) Apretá <b>B</b> o <b>mantené clic derecho</b> para la barra (el juego sigue).<br>' +
          '2) Pasá el mouse para elegir qué poner (bloques, objetos, nodos, mesa, escalera, puerta, plataforma, cubo, muro, spawn).<br>' +
          '3) Soltá para volver y hacé <b>clic para ponerlo</b> (bloques: con el martillo). Para sacar, elegí ❌ y hacé clic.<br>' +
          'Volá con Espacio/Shift. En creador los enemigos no atacan. Todo lo que pongas se guarda en Mundo.';

      creatorDiv.appendChild(palette);
      pauseUI.creatorPalette = palette;
      const clearBtn = document.createElement('button');
      clearBtn.className = 'rg-btn rg-btn-danger';
      clearBtn.textContent = '�Y�� Vaciar mundo (solo piso y paredes)';
      clearBtn.addEventListener('click', () => {
          if (confirm('¿Vaciar todo (bloques, objetos, base, enemigos)? Quedan piso y paredes.')) clearWorld();
      });
      creatorDiv.appendChild(clearBtn);
      pauseBody.appendChild(creatorDiv);

      // --- Crafting section (any mode, uses harvested resources) ---
      const craftDiv = document.createElement('div');
      craftDiv.className = 'rg-section';

      const craftTitle = document.createElement('h4');
      craftTitle.className = 'rg-h';
      craftTitle.textContent = 'Craftear';
      craftDiv.appendChild(craftTitle);
      renderCraftButtons(craftDiv, 'hand');
      pauseBody.appendChild(craftDiv);

      // --- Online (multijugador: presencia + chat, por mundo) ---
      const onlineDiv = document.createElement('div');
      onlineDiv.className = 'rg-section';
      const onlineTitle = document.createElement('h4');
      onlineTitle.textContent = 'Jugadores en este mundo';
      onlineTitle.className = 'rg-h';
      onlineDiv.appendChild(onlineTitle);
      const onlineStatus = document.createElement('div');
      onlineStatus.id = 'onlineStatus';
      onlineStatus.className = 'rg-stats';
      onlineDiv.appendChild(onlineStatus);
      const onlinePlayers = document.createElement('div');
      onlinePlayers.id = 'onlinePlayers';
      onlinePlayers.className = 'rg-hint';
      onlineDiv.appendChild(onlinePlayers);
      const btnRefresh = document.createElement('button');
      btnRefresh.textContent = 'Actualizar';
      btnRefresh.className = 'rg-btn rg-btn-small';
      btnRefresh.addEventListener('click', () => refreshOnlineTab());
      onlineDiv.appendChild(btnRefresh);
      const btnChat = document.createElement('button');
      btnChat.textContent = 'Abrir chat';
      btnChat.className = 'rg-btn rg-btn-small rg-btn-primary';
      btnChat.addEventListener('click', () => {
          try { togglePause(); } catch (e) {}
          try { toggleNetChat(true); } catch (e) {}
      });
      onlineDiv.appendChild(btnChat);
      const ghostRow = document.createElement('div');
      ghostRow.style.marginTop = '6px';
      const ghostChk = document.createElement('input');
      ghostChk.type = 'checkbox';
      let ghostsOn = true;
      try { ghostsOn = localStorage.getItem('lagrieta_ghosts') !== '0'; } catch (e) {}
      ghostChk.checked = ghostsOn;
      ghostChk.addEventListener('change', () => {
          try {
              netGhostsVisible = ghostChk.checked;
              localStorage.setItem('lagrieta_ghosts', ghostChk.checked ? '1' : '0');
          } catch (e) {}
      });
      const ghostLab = document.createElement('span');
      ghostLab.textContent = ' Ver jugadores';
      ghostLab.style.fontSize = '18px';
      ghostRow.appendChild(ghostChk);
      ghostRow.appendChild(ghostLab);
      onlineDiv.appendChild(ghostRow);
      pauseBody.appendChild(onlineDiv);

      // --- Ajustes: sonido ---
      const audioDiv = document.createElement('div');
      audioDiv.className = 'rg-section';
      const audioTitle = document.createElement('h4');
      audioTitle.className = 'rg-h';
      audioTitle.textContent = 'Sonido';
      audioDiv.appendChild(audioTitle);
      const musicRow = document.createElement('div');
      musicRow.className = 'rg-setting-row';
      const musicLab = document.createElement('span');
      musicLab.className = 'rg-setting-label';
      musicLab.textContent = 'Música';
      musicRow.appendChild(musicLab);
      const musicBtn = document.createElement('button');
      musicBtn.className = 'rg-btn rg-btn-small';
      musicBtn.textContent = (typeof musicEnabled !== 'undefined' && musicEnabled) ? 'Sí' : 'No';
      musicBtn.addEventListener('click', () => {
        setMusicEnabled(!musicEnabled);
        musicBtn.textContent = musicEnabled ? 'Sí' : 'No';
      });
      musicRow.appendChild(musicBtn);
      audioDiv.appendChild(musicRow);
      const volRow = document.createElement('div');
      volRow.className = 'rg-setting-row';
      const volLab = document.createElement('span');
      volLab.className = 'rg-setting-label';
      volLab.textContent = 'Volumen';
      volRow.appendChild(volLab);
      const volSlider = document.createElement('input');
      volSlider.type = 'range';
      volSlider.min = '0';
      volSlider.max = '100';
      volSlider.value = '100';
      const volVal = document.createElement('span');
      volVal.className = 'rg-setting-val';
      volVal.textContent = '100';
      volSlider.addEventListener('input', () => {
        musicVolume = volSlider.value / 100;
        volVal.textContent = String(volSlider.value);
      });
      volRow.appendChild(volSlider);
      volRow.appendChild(volVal);
      audioDiv.appendChild(volRow);
      const sfxRow = document.createElement('div');
      sfxRow.className = 'rg-setting-row';
      const sfxLab = document.createElement('span');
      sfxLab.className = 'rg-setting-label';
      sfxLab.textContent = 'Efectos';
      sfxRow.appendChild(sfxLab);
      const sfxBtn = document.createElement('button');
      sfxBtn.className = 'rg-btn rg-btn-small';
      sfxBtn.textContent = sfxEnabled ? 'Sí' : 'No';
      sfxBtn.addEventListener('click', () => {
        if (typeof setSfxEnabled === 'function') setSfxEnabled(!sfxEnabled);
        else sfxEnabled = !sfxEnabled;
        sfxBtn.textContent = sfxEnabled ? 'Sí' : 'No';
      });
      sfxRow.appendChild(sfxBtn);
      audioDiv.appendChild(sfxRow);
      pauseBody.appendChild(audioDiv);

      // --- Ajustes: sensibilidad (sin texto tutorial) ---
      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'rg-section';
      const controlsTitle = document.createElement('h4');
      controlsTitle.className = 'rg-h';
      controlsTitle.textContent = 'Mouse';
      controlsDiv.appendChild(controlsTitle);
      const sensRow = document.createElement('div');
      sensRow.className = 'rg-setting-row';
      const sensLab = document.createElement('span');
      sensLab.className = 'rg-setting-label';
      sensLab.textContent = 'Sensibilidad';
      sensRow.appendChild(sensLab);
      const sensSlider = document.createElement('input');
      sensSlider.type = 'range';
      sensSlider.min = '0.0005';
      sensSlider.max = '0.01';
      sensSlider.step = '0.0005';
      const sens0 = (typeof PLAYER_CONFIG !== 'undefined' && PLAYER_CONFIG.sensitivity) || 0.002;
      sensSlider.value = String(sens0);
      const sensVal = document.createElement('span');
      sensVal.className = 'rg-setting-val';
      const fmtSens = function (v) { return (Math.round(v * 10000) / 10).toFixed(1); };
      sensVal.textContent = fmtSens(sens0);
      sensSlider.addEventListener('input', () => {
        const v = parseFloat(sensSlider.value);
        if (typeof PLAYER_CONFIG !== 'undefined') PLAYER_CONFIG.sensitivity = v;
        if (typeof player !== 'undefined' && player && player.config) player.config.sensitivity = v;
        sensVal.textContent = fmtSens(v);
      });
      sensRow.appendChild(sensSlider);
      sensRow.appendChild(sensVal);
      controlsDiv.appendChild(sensRow);
      pauseBody.appendChild(controlsDiv);

      // --- Ajustes: teclas rebind ---
      const keysDiv = document.createElement('div');
      keysDiv.className = 'rg-section';
      const keysTitle = document.createElement('h4');
      keysTitle.className = 'rg-h';
      keysTitle.textContent = 'Teclas';
      keysDiv.appendChild(keysTitle);
      const keysBox = document.createElement('div');
      keysBox.id = 'keyRows';
      keysDiv.appendChild(keysBox);
      pauseBody.appendChild(keysDiv);
      renderKeyRows();

      const status = document.createElement('div');
      status.className = 'rg-status';
      status.id = 'pauseStatus';
      card.appendChild(status);
      pauseUI.panels = {
        play: [levelsDiv],
        craft: [craftDiv],
        build: [creatorDiv],
        account: [statsDiv, authDiv, sceneDiv, onlineDiv],
        settings: [audioDiv, controlsDiv, keysDiv]
      };
      showPauseTab('play');
      document.body.appendChild(pauseDiv);
      try { renderKeyRows(); } catch (e) {}
      wirePauseAuth();
      return pauseDiv;
  }
  window.addEventListener('mouseup', (e) => {
      if (e.button === 2 && typeof paletteHold !== 'undefined' && paletteHold) {
          paletteHold = false;
          if (typeof togglePalette === 'function') togglePalette(false);
      }
  });
  var lastPointerUnlockTs = 0;
  var _lockRetryTimer = null;
  var _lookBridgeOn = false;
  var _bridgeLastX = null;
  var _bridgeLastY = null;
  function clearLockRetries() {
      if (_lockRetryTimer) { clearTimeout(_lockRetryTimer); _lockRetryTimer = null; }
  }
  // Chrome/Edge no tratan ESC como gesto válido para requestPointerLock.
  // Mientras tanto, puentear la mira con deltas de clientX/Y (cursor oculto).
  function onLookBridgeMove(e) {
      if (isGamePaused || document.pointerLockElement) return;
      if (_bridgeLastX == null) {
          _bridgeLastX = e.clientX;
          _bridgeLastY = e.clientY;
          return;
      }
      const dx = e.clientX - _bridgeLastX;
      const dy = e.clientY - _bridgeLastY;
      _bridgeLastX = e.clientX;
      _bridgeLastY = e.clientY;
      if ((!dx && !dy) || !player || isGamePaused) return;
      player.handleMouseMove({ movementX: dx, movementY: dy }, player.config.sensitivity);
  }
  function onLookBridgeGesture(e) {
      if (isGamePaused || document.pointerLockElement) return;
      if (typeof LEVEL !== 'undefined' && LEVEL.menuOpen) return;
      if (e.type === 'keydown') {
          const k = e.key;
          if (k === 'Escape' || k === 'Esc') return;
          if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'Tab') return;
      }
      // Gesto válido (click / WASD / etc.): pedir lock en este mismo turno
      try {
          const canvas = renderer && renderer.domElement;
          if (!canvas) return;
          pointerLockPending = true;
          try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (err) {}
          const r = canvas.requestPointerLock();
          if (r && typeof r.catch === 'function') r.catch(function () {});
      } catch (err) {}
  }
  function startLookBridge() {
      if (_lookBridgeOn) {
          _bridgeLastX = null;
          _bridgeLastY = null;
          return;
      }
      _lookBridgeOn = true;
      _bridgeLastX = null;
      _bridgeLastY = null;
      document.addEventListener('mousemove', onLookBridgeMove, true);
      document.addEventListener('pointerdown', onLookBridgeGesture, true);
      document.addEventListener('keydown', onLookBridgeGesture, true);
  }
  function stopLookBridge() {
      if (!_lookBridgeOn) return;
      _lookBridgeOn = false;
      _bridgeLastX = null;
      _bridgeLastY = null;
      document.removeEventListener('mousemove', onLookBridgeMove, true);
      document.removeEventListener('pointerdown', onLookBridgeGesture, true);
      document.removeEventListener('keydown', onLookBridgeGesture, true);
  }
  function lockPointer() {
      try {
          const canvas = renderer && renderer.domElement;
          if (!canvas || document.pointerLockElement === canvas || isGamePaused) return;
          pointerLockPending = true;
          startLookBridge();
          try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (e) {}
          clearLockRetries();

          let attempts = 0;
          const maxAttempts = 12;
          const attempt = () => {
              if (isGamePaused) {
                  pointerLockPending = false;
                  clearLockRetries();
                  stopLookBridge();
                  try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (e) {}
                  return;
              }
              if (document.pointerLockElement === canvas) {
                  pointerLockPending = false;
                  clearLockRetries();
                  stopLookBridge();
                  return;
              }
              attempts++;
              try {
                  const r = canvas.requestPointerLock();
                  if (r && typeof r.catch === 'function') {
                      r.catch(function () { scheduleRetry(); });
                  } else {
                      _lockRetryTimer = setTimeout(function () {
                          if (document.pointerLockElement !== canvas) scheduleRetry();
                          else {
                              pointerLockPending = false;
                              stopLookBridge();
                          }
                      }, 80);
                  }
              } catch (e) {
                  scheduleRetry();
              }
          };
          const scheduleRetry = () => {
              if (isGamePaused || document.pointerLockElement === canvas) {
                  pointerLockPending = false;
                  clearLockRetries();
                  if (document.pointerLockElement === canvas) stopLookBridge();
                  return;
              }
              if (attempts >= maxAttempts) {
                  // Seguir con puente de mira; el próximo click/tecla reengancha el lock
                  pointerLockPending = true;
                  clearLockRetries();
                  startLookBridge();
                  try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (e) {}
                  return;
              }
              const sinceUnlock = Date.now() - lastPointerUnlockTs;
              const cooldownLeft = sinceUnlock < 700 ? (700 - sinceUnlock) : 0;
              const delay = Math.max(cooldownLeft, 30 + attempts * 50);
              clearLockRetries();
              _lockRetryTimer = setTimeout(attempt, delay);
          };

          attempt();
          const sinceUnlock = Date.now() - lastPointerUnlockTs;
          if (sinceUnlock < 700) {
              clearLockRetries();
              _lockRetryTimer = setTimeout(attempt, 700 - sinceUnlock);
          }
      } catch (e) {
          pointerLockPending = true;
          startLookBridge();
          console.warn('Pointer lock unavailable:', (e && e.message) || e);
          try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (err) {}
      }
  }
  function togglePause() {
      isGamePaused = !isGamePaused;
      console.log("Game Paused:", isGamePaused);
      if (isGamePaused) {
          pointerLockPending = false;
          clearLockRetries();
          stopLookBridge();
          document.exitPointerLock();
          pauseMenu.style.display = 'flex';
          refreshPauseStats();
          try { refreshCraftUI(); } catch (e) {}
          // Si estás creando un mundo, abrir directo "Jugar" (tiene el botón Guardar)
          try { if (typeof LEVEL !== 'undefined' && LEVEL.working && typeof showPauseTab === 'function') showPauseTab('play'); } catch (e) {}
          try {
            if (window.firebase && firebase.auth && firebase.apps.length && firebase.auth().currentUser) {
                updatePauseAuthUI(firebase.auth().currentUser);
            }
          } catch (e) {}
          try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (e) {}
      } else {
          pauseMenu.style.display = 'none';
          setPauseStatus('');
          // ESC no sirve como gesto de lock en Chrome: puente de mira al toque + retries
          pointerLockPending = true;
          startLookBridge();
          try { if (typeof syncCursorMode === 'function') syncCursorMode(); } catch (e) {}
          if (document.hasFocus()) {
              lockPointer();
          }
      }
  }
