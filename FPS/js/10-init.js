// js/10-init.js (part 10/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Initialization ---

  /* */
  function init() {

      clock = new THREE.Clock();
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x87CEEB);
      scene.fog = new THREE.Fog(0x87CEEB, 50, 150); // Adjust fog distances

      // Create ground system
      const ground = new GroundTerrain(scene, collidableObjects, {
        debug: true,
        size: 200,
        color: 0x558855
      });
      groundMesh = ground.collider;
      
      // --- Camera ---
      camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      // Player is created AFTER camera, and camera is added to player container
      player = new Player(camera, scene);
      const spawnY = 0 + player.halfHeight + 2; // Ground level + halfHeight + buffer
      if (player.container.position) {
          player.container.position.copy(player.container.position);
          player.container.position.y = spawnY; // Set Y based on center position logic
      } else {
          const x = THREE.MathUtils.randFloat(minX, maxX);
          const z = THREE.MathUtils.randFloat(minZ, maxZ);
          player.container.position.set(x, spawnY, z); // Set Y based on center position logic
      }
      player.updateColliderPosition();
      player.updateColliderBox();
      player.container.rotation.y = Math.PI; // face the tutorial courtyard (+Z)

      // --- Lights
        const ambientLight = new THREE.AmbientLight(0xAAAAAA, 0.8); // Slightly dimmer ambient
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5); // Slightly stronger directional
        directionalLight.position.set(25, 35, 15);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 80; // Extend shadow range
        directionalLight.shadow.camera.left = -40; // Widen shadow frustum
        directionalLight.shadow.camera.right = 40;
        directionalLight.shadow.camera.top = 40;
        directionalLight.shadow.camera.bottom = -40;
        directionalLight.shadow.bias = -0.0008; // Adjust bias carefully
        scene.add(directionalLight);
        scene.add(directionalLight.target); // Optional: Move target if needed
        // const shadowCamHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
        // scene.add(shadowCamHelper); 
      
      // --- Construction
        placedBlocks = [];
        blockGrid.clear(); 
      
      // --- Static World Objects
        const wallHeight = 6;
        const wallThickness = 1.0;
        const playAreaSize = 100;
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.8, metalness: 0.2 });

        const createStaticObject = (geo, pos, rotY = 0, name = "Wall") => {
            const mesh = new THREE.Mesh(geo, wallMat.clone()); // Clone material
            mesh.position.copy(pos);
            mesh.rotation.y = rotY;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.name = name;
            mesh.userData.worldBoundingBox = new THREE.Box3().setFromObject(mesh); // Calculate and store world bbox
            mesh.userData.allowBuildingOnTop = true;
            mesh.isStatic = true; // Mark as static for optimized collision
            mesh.geometry.computeBoundingBox(); // Compute local bbox once
            mesh.updateMatrixWorld(); // Update matrix BEFORE calculating world bbox
            scene.add(mesh);
            collidableObjects.push(mesh); // Static objects are collidable
            return mesh;
        };

        const wallGeo = new THREE.BoxGeometry(playAreaSize + wallThickness * 2, wallHeight, wallThickness); // Extend to cover corners
        const wallGeoSide = new THREE.BoxGeometry(wallThickness, wallHeight, playAreaSize);
        createStaticObject(wallGeo, new THREE.Vector3(0, wallHeight / 2, -playAreaSize / 2 - wallThickness / 2), 0, "Wall_Back");
        createStaticObject(wallGeo, new THREE.Vector3(0, wallHeight / 2, playAreaSize / 2 + wallThickness / 2), 0, "Wall_Front");
        createStaticObject(wallGeoSide, new THREE.Vector3(-playAreaSize / 2 - wallThickness / 2, wallHeight / 2, 0), 0, "Wall_Left");
        createStaticObject(wallGeoSide, new THREE.Vector3(playAreaSize / 2 + wallThickness / 2, wallHeight / 2, 0), 0, "Wall_Right");
      // (Obstáculos de prueba eliminados: el tutorial trae lo necesario)

      // --- Enhanced Testing Structures
        
        // (La puerta del tutorial está junto a la base)


        // (Plataforma y escaleras de prueba eliminadas: el tutorial trae lo suyo)



        // (Muro de prueba eliminado)

      // --- Resources Wood stone metal
        let woodnode = createResourceNode('wood', new THREE.Vector3(-4, groundTopY(-4, 14), 14), 100);
        collidableObjects.push(woodnode);
        scene.add(woodnode);
        let stonenode = createResourceNode('stone', new THREE.Vector3(4, groundTopY(4, 14), 14), 100);
        collidableObjects.push(stonenode);
        scene.add(stonenode);
        let metalnode = createResourceNode('metal', new THREE.Vector3(0, groundTopY(0, 18), 18), 100);
        collidableObjects.push(metalnode);
        scene.add(metalnode);

      // --- Clusteres de recursos repartidos por el mapa ---
        try {
            const clusters = [
                ['wood', -22, 8, 5], ['wood', 26, -10, 4], ['wood', -32, -22, 5],
                ['stone', 22, 14, 5], ['stone', -16, 28, 4], ['stone', 8, -28, 4],
                ['metal', 32, 8, 4], ['metal', -26, -8, 4], ['metal', 6, 32, 3]
            ];
            clusters.forEach(([t, x, z, n]) => {
                if (typeof spawnResourceCluster === 'function') spawnResourceCluster(t, x, z, n);
            });
        } catch (e) { console.warn('No se pudieron crear clusteres de recursos', e); }

      // --- Recursos sueltos (se juntan apretando E, sin herramienta) ---
        [[-3, 11], [-2.2, 12], [3.5, 11], [5.5, 19]].forEach(([x, z]) => {
            placeWorldItem('branch', new THREE.Vector3(x, 0.35, z));
        });
        [[3, 13], [3.7, 14], [2.5, 20]].forEach(([x, z]) => {
            placeWorldItem('pebble', new THREE.Vector3(x, 0.35, z));
        });
        [[-3, 20], [-4, 21], [6, 16]].forEach(([x, z]) => {
            placeWorldItem('scrap', new THREE.Vector3(x, 0.35, z));
        });

      // --- NPCs ---
        spawnRobot(new THREE.Vector3(20, 0, 30)); // Spawn one at specific location
        spawnRobot(new THREE.Vector3(25, 0, 25)); // Spawn one at specific location
        spawnRobot(new THREE.Vector3(30, 0, 20)); // Spawn one at specific location
        addEnemySpawn(20, 30, false);
        addEnemySpawn(25, 25, false);
        addEnemySpawn(30, 20, false);
      // --- Collectibles
        // Create test weapons in the world
        const createWorldItem = (itemDef, position) => {
            const item = {...itemDef};
            // Create model if definition has creator
            if(itemDef.createModel) {
                item.model = itemDef.createModel();
                item.model.position.copy(position);
                item.model.rotation.y = Math.PI/4; // Make items face player
                item.model.scale.set(0.5, 0.5, 0.5); // Smaller than held version
                item.model.isPickupable = true;
                item.model.name = itemDef.id;
                item.model.userData = {
                    collected: false,
                    itemData: item,
                    healAmount: itemDef.healAmount,
                    damageAmount: itemDef.damageAmount
                };
                if (itemDef.type === 'consumable') {
                  item.model.isCollectible = true;
                  item.model.inContact = true;          // pickup automático al tocarlo
                  item.model.type = itemDef.id;       // e.g. 'health' or 'damage'
                }            
                scene.add(item.model);
                collidableObjects.push(item.model);
            }
        };

        // Tutorial: arranque guiado (el martillo y la pistola se craftean, no se regalan)
        placeTotem(['¡Bienvenido!', 'Agarrá tus herramientas', 'con la E'], 0, 7);
        createWorldItem(ITEM_DEFINITIONS.axe, new THREE.Vector3(-1.8, 1, 9));
        createWorldItem(ITEM_DEFINITIONS.pickaxe, new THREE.Vector3(-0.6, 1, 9));
        createWorldItem(ITEM_DEFINITIONS.hammer, new THREE.Vector3(0.6, 1, 9));
        createWorldItem(ITEM_DEFINITIONS.pistol, new THREE.Vector3(1.8, 1, 9));
        createWorldItem(ITEM_DEFINITIONS.toxin, new THREE.Vector3(1.5, 1, 22));
        createWorldItem(ITEM_DEFINITIONS.pistolAmmo, new THREE.Vector3(0, 1, 12));
        placeTotem(['Cosechá nodos:', 'hacha: madera', 'pico: piedra/metal'], 0, 12.5);
        createWorldItem(ITEM_DEFINITIONS.food, new THREE.Vector3(-1.5, 1, 22));
        createWorldItem(ITEM_DEFINITIONS.key_golden, new THREE.Vector3(1.5, 1, 25));
        // Pickups automáticos repartidos: la comida cura y la toxina daña a quien la toca
        [[-18, 6], [18, -6], [24, 14], [-22, -10], [10, -20]].forEach(([x, z]) => {
            createWorldItem(ITEM_DEFINITIONS.toxin, new THREE.Vector3(x, groundTopY(x, z) + 0.5, z));
        });
        [[16, 8], [-16, -4], [22, -14], [-20, 18], [-8, -22]].forEach(([x, z]) => {
            createWorldItem(ITEM_DEFINITIONS.food, new THREE.Vector3(x, groundTopY(x, z) + 0.5, z));
        });
        // Mini-base demo: mesa + pared + puerta con llave + escalera
        placeTotem(['E en la mesa:', 'crafteá herramientas', 'y defendé tu base'], 0, 23);
        placeWorkbench(new THREE.Vector3(0, 0, 26));
        rebuildBlock('wood', -3, 0.5, 27, 0);
        rebuildBlock('wood', -4, 0.5, 27, 0);
        rebuildBlock('wood', -4, 0.5, 28, 0);
        placedDoors.push(createLockedDoor(new THREE.Vector3(3, 2, 27)));
        const stairsDemo = createStaircase({
          position: new THREE.Vector3(-8, 0.5, 26),
          stepCount: 4, width: 2, height: 0.5, rise: 0.4, spacing: 1,
          material: new THREE.MeshStandardMaterial({ color: 0x8B4513 })
        });
        scene.add(stairsDemo);
        placedStairs.push(stairsDemo);
        placeTotem(['Martillo + clic:', 'construí', 'E repara la mesa'], 5.5, 26);
        placeTotem(['Pausa (ESC):', 'Mundo = guardar', 'B = creador · Q = mochila'], -5.5, 26);
      // --- Player Initial Setup
        // Initialize player with empty hands
        player.currentTool = TOOLS.HANDS;
        player.heldItem = null;


        // --- Final Player Setup ---
        setupQuickSlotControls();
        player.updateToolModelVisibility();
        player.updateToolHUD();
        player.autoAssignQuickSlots();
        player.inventory.updateQuickSlotUI(); // Initial render
        try { updateResourceHUD(); } catch (e) {}

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

      // --- Pause Menu ---
      pauseMenu = createPauseMenu();

      // --- Controls ---
      setupControls(); // Setup keyboard/mouse/pointerlock
      initConstructionMode(); // Initialize block preview etc.
      try { registerExistingProps(); } catch (e) {}
      console.log("Initial block count:", placedBlocks.length);
      try { showMessage('¡Bienvenido a La Grieta! Seguí los carteles.'); } catch (e) {}
      runStartTs = Date.now();
      try { playerSpawnPos = player.container.position.clone(); } catch (e) {}
      try { renderInvFab(); } catch (e) {}

      // --- Start Animation Loop ---
      animate();
  }
