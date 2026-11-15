// js/09-menu.js (part 9/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Pause Menu ---
  let pauseMenu;
  const pauseUI = {};
  function createPauseMenu() {
      const pauseDiv = document.createElement('div');
      pauseDiv.id = 'pauseMenu';
      pauseDiv.className = 'rg-panel rg-shell rg-pause';
      pauseDiv.style.display = 'none';

      // ---- Barra lateral ----
      const rail = document.createElement('aside');
      rail.className = 'rg-rail';
      const brand = document.createElement('div');
      brand.className = 'rg-rail-brand';
      brand.textContent = 'LA GRIETA';
      rail.appendChild(brand);
      const sub = document.createElement('div');
      sub.className = 'rg-rail-sub';
      sub.textContent = 'PAUSA';
      rail.appendChild(sub);

      const nav = document.createElement('nav');
      nav.className = 'rg-rail-nav';
      pauseUI.tabs = {};
      [['play', '🗺', 'Mundo'], ['craft', '🧪', 'Tecnología'], ['build', '🧱', 'Crear'], ['account', '👥', 'Online'], ['settings', '⚙️', 'Ajustes']].forEach(([key, icon, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rg-rail-btn';
        b.innerHTML = '<span class="rg-rail-ico">' + icon + '</span><span>' + label + '</span>';
        b.addEventListener('click', () => showPauseTab(key));
        nav.appendChild(b);
        pauseUI.tabs[key] = b;
      });
      rail.appendChild(nav);

      const railFoot = document.createElement('div');
      railFoot.className = 'rg-rail-foot';
      const resumeBtn = document.createElement('button');
      resumeBtn.type = 'button';
      resumeBtn.className = 'rg-rail-btn rg-rail-primary';
      resumeBtn.innerHTML = '<span class="rg-rail-ico">▶</span><span>Seguir (ESC)</span>';
      resumeBtn.addEventListener('click', togglePause);
      railFoot.appendChild(resumeBtn);
      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'rg-rail-btn';
      menuBtn.innerHTML = '<span class="rg-rail-ico">🏠</span><span>Menú principal</span>';
      menuBtn.addEventListener('click', () => {
        if (pauseMenu) pauseMenu.style.display = 'none';
        isGamePaused = true;
        try { document.exitPointerLock(); } catch (e) {}
        if (typeof showMainMenu === 'function') showMainMenu('home');
      });
      railFoot.appendChild(menuBtn);
      rail.appendChild(railFoot);
      pauseDiv.appendChild(rail);

      // ---- Contenido ----
      const main = document.createElement('main');
      main.className = 'rg-shell-main';
      const head = document.createElement('div');
      head.className = 'rg-shell-head';
      const title = document.createElement('h2');
      title.className = 'rg-title';
      title.textContent = 'MUNDO';
      head.appendChild(title);
      pauseUI.title = title;
      const statsDiv = document.createElement('div');
      statsDiv.id = 'pauseStats';
      statsDiv.className = 'rg-hint';
      head.appendChild(statsDiv);
      pauseUI.stats = statsDiv;
      main.appendChild(head);

      const body = document.createElement('div');
      body.className = 'rg-shell-body';
      main.appendChild(body);
      pauseDiv.appendChild(main);

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
      body.appendChild(authDiv);
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
      body.appendChild(sceneDiv);
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
      body.appendChild(trialDiv);

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
      body.appendChild(levelsDiv);

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
      clearBtn.textContent = '🧹 Vaciar mundo (solo piso y paredes)';
      clearBtn.addEventListener('click', () => {
          if (confirm('¿Vaciar todo (bloques, objetos, base, enemigos)? Quedan piso y paredes.')) clearWorld();
      });
      creatorDiv.appendChild(clearBtn);
      body.appendChild(creatorDiv);

      // --- Árbol de tecnología (reemplaza la vieja solapa de crafteo) ---
      const craftDiv = document.createElement('div');
      craftDiv.className = 'rg-section rg-tech-section';

      const craftTitle = document.createElement('h4');
      craftTitle.className = 'rg-h';
      craftTitle.textContent = 'Árbol de tecnología';
      craftDiv.appendChild(craftTitle);
      const craftHint = document.createElement('div');
      craftHint.className = 'rg-hint';
      craftHint.style.marginBottom = '6px';
      craftHint.textContent = 'Seguí los pasos: herramientas → base → combate → expedición. Los nodos en la mesa se fabrican/instalan con E en tu mesa de trabajo.';
      craftDiv.appendChild(craftHint);
      const techWrap = document.createElement('div');
      techWrap.id = 'techTree';
      techWrap.className = 'rg-tech-wrap';
      craftDiv.appendChild(techWrap);
      const techFoot = document.createElement('div');
      techFoot.id = 'techFoot';
      techFoot.className = 'rg-matbar';
      craftDiv.appendChild(techFoot);
      body.appendChild(craftDiv);

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
      btnRefresh.addEventListener('click', () => refreshOnlineTab(true));
      onlineDiv.appendChild(btnRefresh);
      const btnChat = document.createElement('button');
      btnChat.textContent = 'Abrir chat';
      btnChat.className = 'rg-btn rg-btn-small rg-btn-primary';
      btnChat.addEventListener('click', () => {
          try { togglePause(); } catch (e) {}
          try { toggleNetChat(true); } catch (e) {}
      });
      onlineDiv.appendChild(btnChat);

      // --- Salas coop (Fase 1) ---
      const roomSetup = document.createElement('div');
      roomSetup.id = 'onlineRoomSetup';
      roomSetup.style.marginTop = '10px';
      const roomHint = document.createElement('div');
      roomHint.className = 'rg-hint';
      roomHint.innerHTML = 'Sala coop de 2 a 5 jugadores. El host simula enemigos y base. ' +
        'Para crear o unirte, abrí el menú <b>Con amigos</b>.';
      roomSetup.appendChild(roomHint);
      const btnHub = document.createElement('button');
      btnHub.id = 'onlineMenuBtn';
      btnHub.textContent = 'Crear o unirme a una sala';
      btnHub.className = 'rg-btn rg-btn-small rg-btn-primary';
      btnHub.style.marginTop = '6px';
      btnHub.addEventListener('click', () => {
          try {
              if (typeof onlineOpenMenu === 'function') onlineOpenMenu();
              else if (typeof showMainMenu === 'function') showMainMenu('online');
          } catch (e) {}
      });
      roomSetup.appendChild(btnHub);
      onlineDiv.appendChild(roomSetup);

      const roomPanel = document.createElement('div');
      roomPanel.id = 'onlineRoomPanel';
      roomPanel.style.display = 'none';
      roomPanel.style.marginTop = '10px';
      roomPanel.style.padding = '8px';
      roomPanel.style.border = '1px solid rgba(120,255,170,.35)';
      roomPanel.style.borderRadius = '6px';
      const roomTitle = document.createElement('div');
      roomTitle.className = 'rg-stats';
      roomTitle.innerHTML = 'Sala <b id="onlineRoomCode">—</b> ';
      const btnCopy = document.createElement('button');
      btnCopy.textContent = 'Copiar código';
      btnCopy.className = 'rg-btn rg-btn-small';
      btnCopy.addEventListener('click', () => { try { onlineCopyCode(); } catch (e) {} });
      roomTitle.appendChild(btnCopy);
      const btnInvite = document.createElement('button');
      btnInvite.id = 'onlineInviteBtn';
      btnInvite.textContent = 'Copiar link';
      btnInvite.className = 'rg-btn rg-btn-small rg-btn-primary';
      btnInvite.addEventListener('click', () => { try { onlineCopyInvite(); } catch (e) {} });
      roomTitle.appendChild(btnInvite);
      roomPanel.appendChild(roomTitle);
      const roomRole = document.createElement('div');
      roomRole.id = 'onlineRoomRole';
      roomRole.className = 'rg-hint';
      roomPanel.appendChild(roomRole);
      const roomState = document.createElement('div');
      roomState.id = 'onlineRoomState';
      roomState.className = 'rg-stats';
      roomPanel.appendChild(roomState);
      const roomPlayers = document.createElement('div');
      roomPlayers.id = 'onlineRoomPlayers';
      roomPlayers.className = 'rg-hint';
      roomPanel.appendChild(roomPlayers);
      const roomActions = document.createElement('div');
      roomActions.style.display = 'flex';
      roomActions.style.gap = '6px';
      roomActions.style.flexWrap = 'wrap';
      roomActions.style.marginTop = '6px';
      const btnReady = document.createElement('button');
      btnReady.id = 'onlineReadyBtn';
      btnReady.textContent = 'Estoy listo';
      btnReady.className = 'rg-btn rg-btn-small';
      btnReady.addEventListener('click', () => { try { onlineSetReady(); } catch (e) {} });
      const btnStart = document.createElement('button');
      btnStart.id = 'onlineStartBtn';
      btnStart.textContent = 'Iniciar partida';
      btnStart.className = 'rg-btn rg-btn-small rg-btn-primary';
      btnStart.style.display = 'none';
      btnStart.addEventListener('click', () => { try { onlineStartGame(); } catch (e) {} });
      const btnLeave = document.createElement('button');
      btnLeave.id = 'onlineLeaveBtn';
      btnLeave.textContent = 'Salir de la sala';
      btnLeave.className = 'rg-btn rg-btn-small';
      btnLeave.addEventListener('click', () => { try { onlineLeaveRoom(); } catch (e) {} });
      roomActions.appendChild(btnReady);
      roomActions.appendChild(btnStart);
      roomActions.appendChild(btnLeave);
      roomPanel.appendChild(roomActions);
      onlineDiv.appendChild(roomPanel);
      try { onlineRefreshUI(); } catch (e) {}

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
      body.appendChild(onlineDiv);

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
      sfxBtn.textContent = sfxEnabled ? 'Efectos: Sí' : 'Efectos: No';
      sfxBtn.addEventListener('click', () => {
        if (typeof setSfxEnabled === 'function') setSfxEnabled(!sfxEnabled);
        else sfxEnabled = !sfxEnabled;
        sfxBtn.textContent = sfxEnabled ? 'Efectos: Sí' : 'Efectos: No';
      });
      audioDiv.appendChild(sfxBtn);
      body.appendChild(audioDiv);
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
      body.appendChild(keysDiv);
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
      body.appendChild(controlsDiv);

      const status = document.createElement('div');
      status.className = 'rg-status';
      status.id = 'pauseStatus';
      body.appendChild(status);
      pauseUI.panels = {
        play: [levelsDiv],
        craft: [craftDiv],
        build: [creatorDiv],
        account: [authDiv, onlineDiv],
        settings: [audioDiv, keysDiv, controlsDiv]
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
            } else {
          pauseMenu.style.display = 'none';
          setPauseStatus('');
          if (document.hasFocus()) {
               lockPointer();
          }
      }
  }
