// js/09-menu.js (part 9/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Pause Menu ---
  let pauseMenu;
  const pauseUI = {};
  function createPauseMenu() {
      const pauseDiv = document.createElement('div');
      pauseDiv.id = 'pauseMenu';
      pauseDiv.className = 'rg-panel rg-pause';
      pauseDiv.style.display = 'none';

      const title = document.createElement('h2');
      title.textContent = 'JUEGO EN PAUSA';
      title.className = 'rg-title';
      pauseDiv.appendChild(title);

      const resumeBtn = document.createElement('button');
      resumeBtn.textContent = 'Seguir (ESC)';
      resumeBtn.className = 'rg-btn rg-btn-primary';

      resumeBtn.addEventListener('click', togglePause);
      pauseDiv.appendChild(resumeBtn);

      const tabBar = document.createElement('div');
      tabBar.className = 'rg-tabs';
      pauseUI.tabs = {};
      [['status', 'Estado'], ['account', 'Cuenta'], ['world', 'Mundo'], ['create', 'Crear'], ['craft', 'Crafteo'], ['online', 'Online'], ['settings', 'Ajustes']].forEach(([key, label]) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = 'rg-tab';
        b.addEventListener('click', () => showPauseTab(key));
        tabBar.appendChild(b);
        pauseUI.tabs[key] = b;
      });
      pauseDiv.appendChild(tabBar);

      // Session stats line
      const statsDiv = document.createElement('div');
      statsDiv.id = 'pauseStats';
      statsDiv.className = 'rg-stats';
      pauseDiv.appendChild(statsDiv);
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
      loginBtn.textContent = 'Entrar con Google';
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
      pauseDiv.appendChild(authDiv);
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
      pauseDiv.appendChild(sceneDiv);
      pauseUI.sceneSection = sceneDiv;
      const trialDiv = document.createElement('div');
      trialDiv.className = 'rg-section';
      const trialTitle = document.createElement('h4');
      trialTitle.textContent = 'Trial';
      trialTitle.className = 'rg-h';
      trialDiv.appendChild(trialTitle);
      const trialBox = document.createElement('div');
      trialBox.id = 'trialBox';
      trialDiv.appendChild(trialBox);
      pauseDiv.appendChild(trialDiv);

      // --- Creator section (works offline, no sign-in needed) ---
      const creatorDiv = document.createElement('div');
      creatorDiv.className = 'rg-section';
      const creatorTitle = document.createElement('h4');
      creatorTitle.className = 'rg-h';
      creatorTitle.textContent = 'Modo Creador';
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
      clearBtn.textContent = '🧹 Vaciar mundo (solo piso y paredes)';
      clearBtn.addEventListener('click', () => {
          if (confirm('¿Vaciar todo (bloques, objetos, base, enemigos)? Quedan piso y paredes.')) clearWorld();
      });
      creatorDiv.appendChild(clearBtn);
      pauseDiv.appendChild(creatorDiv);

      // --- Crafting section (any mode, uses harvested resources) ---
      const craftDiv = document.createElement('div');
      craftDiv.className = 'rg-section';

      const craftTitle = document.createElement('h4');
      craftTitle.className = 'rg-h';
      craftTitle.textContent = 'Crafting';
      craftDiv.appendChild(craftTitle);
      renderCraftButtons(craftDiv);
      pauseDiv.appendChild(craftDiv);

      // --- Online section (multijugador Fase 1) ---
      const onlineDiv = document.createElement('div');
      onlineDiv.className = 'rg-section';
      const onlineTitle = document.createElement('h4');
      onlineTitle.textContent = 'Online';
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
      const sharedInfo = document.createElement('div');
      sharedInfo.id = 'sharedInfo';
      sharedInfo.className = 'rg-hint';
      onlineDiv.appendChild(sharedInfo);
      const btnRefresh = document.createElement('button');
      btnRefresh.textContent = 'Actualizar';
      btnRefresh.className = 'rg-btn rg-btn-small';
      btnRefresh.addEventListener('click', () => refreshOnlineTab());
      onlineDiv.appendChild(btnRefresh);
      const btnDown = document.createElement('button');
      btnDown.textContent = 'Bajar escena compartida';
      btnDown.className = 'rg-btn rg-btn-small rg-btn-primary';
      btnDown.addEventListener('click', () => loadSharedScene());
      onlineDiv.appendChild(btnDown);
      const btnUp = document.createElement('button');
      btnUp.textContent = 'Publicar la mía';
      btnUp.className = 'rg-btn rg-btn-small rg-btn-warn';
      btnUp.addEventListener('click', () => publishSharedScene());
      onlineDiv.appendChild(btnUp);
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
      ghostLab.textContent = ' Ver fantasmas';
      ghostLab.style.fontSize = '18px';
      ghostRow.appendChild(ghostChk);
      ghostRow.appendChild(ghostLab);
      onlineDiv.appendChild(ghostRow);
      pauseDiv.appendChild(onlineDiv);
      // --- Audio section ---
      const audioDiv = document.createElement('div');
      audioDiv.className = 'rg-section';
      const audioTitle = document.createElement('h4');
      audioTitle.className = 'rg-h';
      audioTitle.textContent = 'Sonido';
      audioDiv.appendChild(audioTitle);
      const musicBtn = document.createElement('button');
      musicBtn.className = 'rg-btn';
      musicBtn.textContent = 'Música: Sí';
      musicBtn.addEventListener('click', () => {
        setMusicEnabled(!musicEnabled);
        musicBtn.textContent = musicEnabled ? 'Música: Sí' : 'Música: No';
      });
      audioDiv.appendChild(musicBtn);
      const volLabel = document.createElement('span');
      volLabel.textContent = ' Volumen ';
      audioDiv.appendChild(volLabel);
      const volSlider = document.createElement('input');
      volSlider.type = 'range';
      volSlider.min = '0';
      volSlider.max = '100';
      volSlider.value = '100';
      volSlider.addEventListener('input', () => { musicVolume = volSlider.value / 100; });
      audioDiv.appendChild(volSlider);
      const sfxBtn = document.createElement('button');
      sfxBtn.className = 'rg-btn';
      sfxBtn.textContent = 'Efectos: Sí';
      sfxBtn.addEventListener('click', () => {
        sfxEnabled = !sfxEnabled;
        sfxBtn.textContent = sfxEnabled ? 'Efectos: Sí' : 'Efectos: No';
      });
      audioDiv.appendChild(sfxBtn);
      pauseDiv.appendChild(audioDiv);
      const keysDiv = document.createElement('div');
      keysDiv.className = 'rg-section';
      const keysTitle = document.createElement('h4');
      keysTitle.className = 'rg-h';
      keysTitle.textContent = 'Teclas';
      keysDiv.appendChild(keysTitle);
      const keysBox = document.createElement('div');
      keysBox.id = 'keyRows';
      keysDiv.appendChild(keysBox);
      const keysHint = document.createElement('div');
      keysHint.className = 'rg-hint';
      keysHint.textContent = 'WASD, espacio, shift y 1-5 son fijos. El resto se guarda en este navegador.';
      keysDiv.appendChild(keysHint);
      audioDiv.appendChild(keysDiv);
      renderKeyRows();

      // --- Controls section ---
      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'rg-section';
      controlsDiv.style.textAlign = 'left';
      const controlsTitle = document.createElement('h4');
      controlsTitle.className = 'rg-h';
      controlsTitle.textContent = 'Controles';
      controlsTitle.style.textAlign = 'center';
      controlsDiv.appendChild(controlsTitle);
      const sensRow = document.createElement('div');
      sensRow.style.textAlign = 'center';
      sensRow.style.marginBottom = '6px';
      sensRow.textContent = 'Sensibilidad ';
      const sensSlider = document.createElement('input');
      sensSlider.type = 'range';
      sensSlider.min = '0.0005';
      sensSlider.max = '0.01';
      sensSlider.step = '0.0005';
      sensSlider.value = (typeof PLAYER_CONFIG !== 'undefined' && PLAYER_CONFIG.sensitivity) || 0.002;
      sensSlider.addEventListener('input', () => {
        const v = parseFloat(sensSlider.value);
        if (typeof PLAYER_CONFIG !== 'undefined') PLAYER_CONFIG.sensitivity = v;
        if (typeof player !== 'undefined' && player && player.config) player.config.sensitivity = v;
      });
      sensRow.appendChild(sensSlider);
      controlsDiv.appendChild(sensRow);
      const keysList = document.createElement('div');
      keysList.innerHTML = 'WASD moverse &middot; Mouse mirar &middot; Clic disparar / poner<br>' +
        'Q mochila &middot; E usar &middot; B barra creador &middot; Rueda atajos &middot; T chat<br>' +
        'Clic derecho destruir (martillo) &middot; E agarrar / usar<br>' +
        'Z/X/C tipo de bloque (martillo) &middot; soltar objetos desde la mochila<br>' +
        'Shift correr &middot; Espacio saltar &middot; ESC pausa/seguir' +
        '<br>Vuelo creador: Espacio subir &middot; Shift bajar';
      controlsDiv.appendChild(keysList);
      pauseDiv.appendChild(controlsDiv);

      const status = document.createElement('div');
      status.className = 'rg-status';
      status.id = 'pauseStatus';
      pauseDiv.appendChild(status);
      pauseUI.panels = {
        status: [statsDiv, controlsDiv],
        account: [authDiv],
        world: [sceneDiv, trialDiv],
        create: [creatorDiv],
        craft: [craftDiv],
        online: [onlineDiv],
        settings: [audioDiv]
      };
      showPauseTab('status');
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
  function lockPointer() {
      try {
          const canvas = renderer.domElement;
          if (!canvas || document.pointerLockElement === canvas) return;
          const sinceUnlock = Date.now() - lastPointerUnlockTs;
          // Chrome rejects lock requests made right after exiting the lock; wait out the cooldown
          const wait = sinceUnlock < 1500 ? (1500 - sinceUnlock) : 0;
          const doLock = () => {
              if (isGamePaused) return;
              if (document.pointerLockElement === canvas) return;
              try {
                  const r = canvas.requestPointerLock();
                  if (r && typeof r.catch === 'function') {
                      r.catch((e) => {
                          console.warn('Pointer lock deferred, click the game to capture mouse:', (e && e.message) || e);
                      });
                  }
              } catch (e) {
                  console.warn('Pointer lock unavailable:', (e && e.message) || e);
              }
          };
          if (wait > 0) setTimeout(doLock, wait);
          else doLock();
      } catch (e) {
          console.warn('Pointer lock unavailable:', (e && e.message) || e);
      }
  }
  function togglePause() {
      isGamePaused = !isGamePaused;
      console.log("Game Paused:", isGamePaused);
      if (isGamePaused) {
          document.exitPointerLock();
          pauseMenu.style.display = 'block';
          refreshPauseStats();
          try { refreshCraftUI(); } catch (e) {}
          try {
            if (window.firebase && firebase.auth && firebase.apps.length && firebase.auth().currentUser) {
                updatePauseAuthUI(firebase.auth().currentUser);
            }
          } catch (e) {}
            } else {
          pauseMenu.style.display = 'none';
          setPauseStatus('');
          if (document.hasFocus()) {
               lockPointer();
          }
      }
  }
