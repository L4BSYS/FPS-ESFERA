// js/10-init.js (part 10/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Initialization ---

  /* */
  function init() {

      clock = new THREE.Clock();
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x87CEEB);
      scene.fog = new THREE.Fog(0x87CEEB, 60, 220); // Adjust fog distances

      // El piso, los muros y el contenido del mundo los construye el
      // gestor de niveles (19-levels.js: loadLevel -> buildRoom).

      // --- Camera ---
      camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      // Player is created AFTER camera, and camera is added to player container
      player = new Player(camera, scene);
      player.container.position.set(0, player.halfHeight + 2, 0);
      player.updateColliderPosition();
      player.updateColliderBox();
      player.container.rotation.y = Math.PI; // face the tutorial courtyard (+Z)

      // --- Lights
        const ambientLight = new THREE.AmbientLight(0xAAAAAA, 0.8); // Slightly dimmer ambient
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        directionalLight.position.set(25, 35, 15);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 240;
        directionalLight.shadow.camera.left = -70;
        directionalLight.shadow.camera.right = 70;
        directionalLight.shadow.camera.top = 70;
        directionalLight.shadow.camera.bottom = -70;
        directionalLight.shadow.bias = -0.0008;
        scene.add(directionalLight);
        scene.add(directionalLight.target);
        // Referencias para el sistema de ambientes (21-ambience.js)
        try { scene.userData.ambientLight = ambientLight; scene.userData.sunLight = directionalLight; } catch (e) {}

      // --- Construction state
        placedBlocks = [];
        blockGrid.clear();

      // --- Renderer ---
      renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas'), antialias: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows
      // --- New Color Management (post r152) ---
      THREE.ColorManagement.enabled = true;
      renderer.outputColorSpace = THREE.SRGBColorSpace; // For correct display colors
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;

      initScreenDevice();

      // --- Ambientes / cielo surreal ---
      try { if (typeof initAmbience === 'function') initAmbience(); } catch (e) { console.warn('initAmbience', e); }

      // --- Pause Menu ---
      pauseMenu = createPauseMenu();

      // --- Controls ---
      setupControls(); // Setup keyboard/mouse/pointerlock
      initConstructionMode(); // Initialize block preview etc.
      try { registerExistingProps(); } catch (e) {}

      // --- Player Initial Setup
        player.currentTool = TOOLS.HANDS;
        player.heldItem = null;
        setupQuickSlotControls();
        player.updateToolModelVisibility();
        player.updateToolHUD();

      // --- Levels: registra built-ins y carga el playground bajo el menú ---
      try { if (typeof initLevels === 'function') initLevels(); } catch (e) { console.error('initLevels', e); }
      try { if (typeof loadLevel === 'function') loadLevel('playground'); } catch (e) { console.error('loadLevel', e); }
      try { if (typeof showMainMenu === 'function') showMainMenu('start'); } catch (e) { console.error('showMainMenu', e); }

      console.log("Initial block count:", placedBlocks.length);
      runStartTs = Date.now();
      try { renderInvFab(); } catch (e) {}

      // --- Start Animation Loop ---
      animate();
  }
