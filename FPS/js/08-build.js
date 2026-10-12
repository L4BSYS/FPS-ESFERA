// js/08-build.js (part 8/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Construction Functions ---
  function updateSpatialPartition() {
      blockGrid.clear();
      placedBlocks.forEach(block => {
          const key = getGridKey(block.position.x, block.position.y, block.position.z);
          blockGrid.set(key, block);
      });
  }
  function getGridKey(x, y, z) {
      return `${Math.round(x*2)/2}|${Math.round(y*2)/2}|${Math.round(z*2)/2}`;
  }
  function snapToGrid(position) {
      return new THREE.Vector3(
          Math.round(position.x * 2) / 2,
          Math.round(position.y * 2) / 2,
          Math.round(position.z * 2) / 2
      );
  }

  function isPositionValid(position) {
      const snappedPos = snapToGrid(position);
      const positionKey = getGridKey(snappedPos.x, snappedPos.y, snappedPos.z);
      
      // 1. Check if position is occupied
      if (blockGrid.has(positionKey)) {
          lastInvalidReason = "Lugar ocupado";
          return false;
      }

      // 1b. Real overlap test: grid keys round to 0.5, so half-cell
      // overlaps between 1x1x1 blocks slip through the key check
      const EPS = 0.02;
      for (const b of placedBlocks) {
          if (Math.abs(b.position.x - snappedPos.x) < 1 - EPS &&
              Math.abs(b.position.y - snappedPos.y) < 1 - EPS &&
              Math.abs(b.position.z - snappedPos.z) < 1 - EPS) {
              lastInvalidReason = "Lugar ocupado";
              return false;
          }
      }

      // 1.2 Check if block would trap player/NPCs
      if (checkForCharacter(snappedPos)) {
          lastInvalidReason = "Atraparía a alguien";
          return false;
      }

      // Creator mode: free placement (still no overlaps, no trapping)
      if (typeof creatorMode !== 'undefined' && creatorMode) {
          lastInvalidReason = "";
          return true;
      }

      // 2. Ground-level blocks (foundations)
      if (snappedPos.y === 0.5) {
          // Verify it's actually on the ground
          const groundCheck = new THREE.Raycaster(
              new THREE.Vector3(snappedPos.x, 0.25, snappedPos.z), // Start at middle of bottom half
              new THREE.Vector3(0, -1, 0), // Shoot downward
              0, 0.6 // Check from y=0.25 to y=-0.35 (ground is at y=0)
          );
          
          const hits = groundCheck.intersectObject(groundMesh);
          if (hits.length > 0) {
              lastInvalidReason = "";
              return true;
          } else {
              lastInvalidReason = "La base va sobre el suelo";
              return false;
          }
      }

      // 3. Check for supporting block (0.5 units below)
      const belowKey = getGridKey(snappedPos.x, snappedPos.y - 1, snappedPos.z);
      if (blockGrid.has(belowKey)) {
          lastInvalidReason = "";
          return true;
      }

      lastInvalidReason = "Falta un bloque abajo que lo sostenga";
      return false;
  }

  function placeBlock() {
      if (!blockPreview || !blockPreview.userData.canPlace) {
          showPlacementMessage(`No se puede poner: ${lastInvalidReason}`);
          return;
      }

      const cost = {
        wood: 2,
        stone: 3,
        metal: 5
      }[currentBlockType];

      if ((typeof creatorMode === 'undefined' || !creatorMode) && player.inventory.resources[currentBlockType] < cost) {
        showPlacementMessage(`¡Te falta ${currentBlockType}! Necesitás ${cost}`);
        return;
      }


      const blockPos = snapToGrid(blockPreview.position);
      const isFoundation = blockPos.y === 0.5;

      // Initialize new block
      const block = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          BLOCK_MATERIALS[currentBlockType].material.clone()
      );
      
      block.position.copy(blockPos);
      block.userData = {
          type: currentBlockType,
          isFoundation: isFoundation,
          allowBuildingOnTop: true,
          isClimbable: true,
          supportedBlocks: [], 
          supportingBlocks: [], 
          health: BLOCK_MATERIALS[currentBlockType].health,
          maxHealth: BLOCK_MATERIALS[currentBlockType].health
      };

      // For non-foundation blocks, establish support relationship
      if (!isFoundation) {
          const belowKey = getGridKey(blockPos.x, blockPos.y - 1, blockPos.z);
          const belowBlock = blockGrid.get(belowKey);
          
          if (belowBlock) {
              // Link this block to its supporter
              block.userData.supportingBlocks = [belowBlock]; // Reset array
              // Link supporter to this new block
              belowBlock.userData.supportedBlocks.push(block);
          } else {
              console.error("Supporting block not found despite validation!");
              return;
          }
      }

      // Add to scene and systems
      scene.add(block);
      placedBlocks.push(block);
      blockGrid.set(getGridKey(blockPos.x, blockPos.y, blockPos.z), block);
      
      // Proceed block cost with placement
      if (typeof creatorMode === 'undefined' || !creatorMode) player.inventory.resources[currentBlockType] -= cost;
      updateResourceHUD();

      showPlacementMessage(`Bloque puesto en ${blockPos.x.toFixed(1)}, ${blockPos.y.toFixed(1)}, ${blockPos.z.toFixed(1)}`);
      updateDebugVisuals();
      updateDebugInfo(blockPos);
  }
  function updateBlockPhysics(delta) {
      // Process blocks in order from bottom to top
      const sortedBlocks = [...gravityBlocks].sort((a, b) => a.position.y - b.position.y);
      
      for (let i = sortedBlocks.length - 1; i >= 0; i--) {
          const block = sortedBlocks[i];
          
          if (!block.userData.isFalling) continue;

          // Apply gravity
          block.userData.vy += GRAVITY * delta;
          block.position.y += block.userData.vy * delta;

          // Check for landing on ground
          if (block.position.y <= 0.5) {
              block.position.y = 0.5;
              block.userData.isFalling = false;
              block.userData.groundConnection = (block.position.y === 0.5);
              gravityBlocks.splice(gravityBlocks.indexOf(block), 1);
              updateSpatialPartition();
              continue;
          }

          // Check for landing on other blocks
          const checkPos = new THREE.Vector3(
              Math.round(block.position.x * 2) / 2,
              Math.round((block.position.y - 0.5) * 2) / 2,
              Math.round(block.position.z * 2) / 2
          );

          const supportingBlock = placedBlocks.find(b => 
              !b.userData.isFalling &&
              Math.abs(b.position.x - checkPos.x) < 0.1 &&
              Math.abs(b.position.y - checkPos.y) < 0.1 &&
              Math.abs(b.position.z - checkPos.z) < 0.1
          );

          if (supportingBlock) {
              block.position.y = supportingBlock.position.y + 0.5;
              block.userData.isFalling = false;
              block.userData.supportingBlocks = [supportingBlock];
              supportingBlock.userData.supportedBlocks.push(block);
              gravityBlocks.splice(gravityBlocks.indexOf(block), 1);
          }
      }
  }
  function destroyBlock(block) {
      // Notify supported blocks
      block.userData.supportedBlocks.forEach(supported => {
          supported.userData.supportingBlocks = supported.userData.supportingBlocks.filter(
              b => b !== block
          );
          
          if (supported.userData.supportingBlocks.length === 0) {
              collapseBlock(supported);
          }
      });

      // Remove from scene
      const index = placedBlocks.indexOf(block);
      if (index > -1) placedBlocks.splice(index, 1);
      scene.remove(block);
      updateSpatialPartition();
      
      createBlockDestructionEffect(block.position, block.userData.type);
      showPlacementMessage(`Bloque destruido en ${block.position.toArray().map(n => n.toFixed(1))}`);
  }
  function collapseBlock(block) {
      if (!block.userData.isFalling) {
          block.userData.isFalling = true;
          block.userData.vy = 0;
          gravityBlocks.push(block);
          showPlacementMessage(`Se cae el bloque en ${block.position.toArray().map(n => n.toFixed(1))}`);
      }
  }

  function setPreviewColor(hex) {
      if (!blockPreview) return;
      blockPreview.material.color.setHex(hex);
      if (blockPreview.userData.edgeMat) blockPreview.userData.edgeMat.color.setHex(hex);
  }

  // ==== Updated Block Preview System ====
  function updateBlockPreview() {
      if (!blockPreview || !player || player.currentTool !== TOOLS.HAMMER) {
          if (blockPreview) blockPreview.visible = false;
          return;
      }

      const rayOrigin = new THREE.Vector3();
      camera.getWorldPosition(rayOrigin);
      const rayDirection = camera.getWorldDirection(new THREE.Vector3());
      const ray = new THREE.Raycaster(rayOrigin, rayDirection, 0.1, PLAYER_CONFIG.blockReach);

      const hits = ray.intersectObjects([groundMesh, ...placedBlocks], true);

      if (hits.length > 0) {
          const hit = hits[0];
          const normal = hit.face.normal.clone();
          let placePosition = hit.point.clone().add(normal.multiplyScalar(0.5));
          placePosition = snapToGrid(placePosition);

          // Ground handling
          if (hit.object === groundMesh) placePosition.y = 0.5;

          // Update preview
          blockPreview.position.copy(placePosition);
          blockPreview.visible = true;
          blockPreview.userData.canPlace = isPositionValid(placePosition);
          setPreviewColor(blockPreview.userData.canPlace ? 0x00ff00 : 0xff0000);
          
          // Show real-time placement info
          if (!blockPreview.userData.canPlace) {
              setPreviewColor(0xff0000);
              showPlacementMessage(`No se puede poner: ${lastInvalidReason}`);
          }
      } else {
          blockPreview.visible = false;
      }
  }

  // ==== Block states and types
  function setBlockType(type) {
      if(BLOCK_MATERIALS[type] && player.inventory.resources[type] > 0) {
          currentBlockType = type;
          console.log(`Block type set to: ${type}`);
          updateResourceHUD(); // Update the buttons
          
          // Show visual feedback
          showMessage(`Elegido: ${type}`);
          playSound('ui_click'); // Add this sound effect
      } else {
          console.warn(`Attempted to set unknown block type: ${type}`);
      }
  }

  function updateBlockAppearance(block) {
      if (!block.userData?.type || !block.material) return;

      const materialInfo = BLOCK_MATERIALS[block.userData.type];
      if (!materialInfo || !block.material.isMeshStandardMaterial) { // Ensure it's a compatible material
           // Use MeshBasicMaterial or Phong if needed, adjust property names accordingly
          if (!block.material.isMeshBasicMaterial){
             console.warn("Unsupported material type for damage effect on block:", block.userData.type);
          }
          return;
      }


      // Calculate damage ratio (0 = undamaged, 1 = fully damaged/destroyed)
      const damageRatio = Math.max(0, 1 - (block.userData.health / block.userData.maxHealth));

      // --- Apply visual effects by modifying properties ---
      // Make sure the *original* material properties are known (store them or use defaults)
      const baseColor = materialInfo.material.color.clone(); // Get base color from definition
      const baseRoughness = materialInfo.material.roughness !== undefined ? materialInfo.material.roughness : 0.7;
      const baseMetalness = materialInfo.material.metalness !== undefined ? materialInfo.material.metalness : (block.userData.type === 'metal' ? 0.8 : 0);

      if (block.userData.type === 'wood') {
          block.material.roughness = THREE.MathUtils.lerp(baseRoughness, 0.95, damageRatio);
          // Maybe slightly darken wood color
          block.material.color.lerpColors(baseColor, new THREE.Color(0x5c300a), damageRatio * 0.5);
      } else if (block.userData.type === 'metal') {
          block.material.metalness = THREE.MathUtils.lerp(baseMetalness, 0.4, damageRatio);
          block.material.roughness = THREE.MathUtils.lerp(baseRoughness, 0.8, damageRatio);
          // Add a 'dented' color tint
          block.material.color.lerpColors(baseColor, new THREE.Color(0x555555), damageRatio * 0.4);
      } else if (block.userData.type === 'stone') {
           block.material.roughness = THREE.MathUtils.lerp(baseRoughness, 0.9, damageRatio);
           // Darken stone, make it look 'cracked'
           block.material.color.lerpColors(baseColor, new THREE.Color(0x444444), damageRatio * 0.6);
      }

      // Tell Three.js the material needs updating in the next frame
      block.material.needsUpdate = true;
  }
  function createBlockDestructionEffect(position, type) {
      const particleCount = 10; // More particles for better effect
      const particles = new THREE.Group();
      particles.userData = { type: 'destructionEffect', time: 0, duration: 1.5 }; // Track effect lifetime

      let particleSize, particleColor, particleMetalness, particleRoughness;
      const materialInfo = BLOCK_MATERIALS[type] || {};
      const baseColor = materialInfo.material?.color || new THREE.Color(0xaaaaaa);

      switch (type) {
          case 'stone':
              particleSize = 0.12; particleColor = baseColor; particleMetalness = 0.1; particleRoughness = 0.8;
              break;
          case 'metal':
              particleSize = 0.1; particleColor = baseColor; particleMetalness = 0.7; particleRoughness = 0.6;
              break;
          default: // wood
              particleSize = 0.15; particleColor = baseColor; particleMetalness = 0.0; particleRoughness = 0.9;
      }

      // OPTIMIZATION: Use one geometry and one material if possible, clone only if necessary
      const particleGeometry = new THREE.BoxGeometry(1, 1, 1); // Will be scaled
      const particleMaterial = new THREE.MeshStandardMaterial({
          color: particleColor,
          metalness: particleMetalness,
          roughness: particleRoughness,
          transparent: true, // Needed for fade out
          opacity: 1.0
      });

      for (let i = 0; i < particleCount; i++) {
          const pSize = particleSize * (0.6 + Math.random() * 0.8);
          // Clone material only if you need variations per particle, otherwise reuse particleMaterial
          const pMat = particleMaterial; //.clone();
          const particle = new THREE.Mesh(particleGeometry, pMat);
          particle.scale.set(pSize, pSize, pSize); // Scale instead of new geometry
          particle.castShadow = true;

          particle.position.copy(position).add(
              new THREE.Vector3(
                  (Math.random() - 0.5) * 0.9, // Slightly within block bounds
                  (Math.random() - 0.5) * 0.9,
                  (Math.random() - 0.5) * 0.9
              )
          );

          particle.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);

          // Store physics data per particle
          particle.userData = {
              velocity: new THREE.Vector3(
                  (Math.random() - 0.5) * 4, // Increased velocity range
                  Math.random() * 4 + 1,      // More upward initial velocity
                  (Math.random() - 0.5) * 4
              ),
              rotationSpeed: new THREE.Vector3(
                  (Math.random() - 0.5) * 8, // Faster rotation
                  (Math.random() - 0.5) * 8,
                  (Math.random() - 0.5) * 8
              ),
              initialLifetime: 0.8 + Math.random() * 0.7, // Slightly shorter lifetime
              currentLifetime: 0 // Will be set below
          };
          particle.userData.currentLifetime = particle.userData.initialLifetime;

          particles.add(particle);
      }

      scene.add(particles);
      activeParticleSystems.push(particles); // Add to central list for updates
      playSound(`block_break_${type}`);
  }
  function updateActiveParticleSystems(delta) {
      const gravityEffect = GRAVITY * 0.5; // Particles less affected by gravity maybe
      for (let i = activeParticleSystems.length - 1; i >= 0; i--) {
          const system = activeParticleSystems[i];
          let allParticlesDead = true;

          system.children.forEach(particle => {
              if (particle.userData.currentLifetime > 0) {
                  allParticlesDead = false;
                  particle.userData.currentLifetime -= delta;

                  // Update physics
                  particle.userData.velocity.y += gravityEffect * delta;
                  particle.position.add(particle.userData.velocity.clone().multiplyScalar(delta));

                  // Update rotation
                  particle.rotation.x += particle.userData.rotationSpeed.x * delta;
                  particle.rotation.y += particle.userData.rotationSpeed.y * delta;
                  particle.rotation.z += particle.userData.rotationSpeed.z * delta;

                  // Fade out based on lifetime
                  if (particle.material.isMaterial) { // Check if material exists
                       particle.material.opacity = Math.max(0, particle.userData.currentLifetime / particle.userData.initialLifetime);
                       particle.material.needsUpdate = true;
                  }


                  // Simple ground collision
                  if (particle.position.y < 0) {
                       particle.position.y = 0;
                       particle.userData.velocity.y *= -0.3; // Bounce slightly
                       particle.userData.velocity.x *= 0.8; // Friction
                       particle.userData.velocity.z *= 0.8;
                  }
              } else {
                   // Hide particle immediately when lifetime ends
                   particle.visible = false;
              }
          });

          // Remove the system if all particles are effectively dead
          if (allParticlesDead || system.userData.time > system.userData.duration) {
               // Dispose of geometries/materials if they were cloned per particle
              system.children.forEach(particle => {
                  if (particle.geometry) particle.geometry.dispose();
                   // Only dispose material if it was cloned per particle, otherwise Three handles the shared one
                   // if (particle.material) particle.material.dispose();
              });
              if (system.children[0]?.material && !system.children[0].material.userData?.isShared) {
                  // Dispose shared material if not marked as shared and exists
                   system.children[0].material.dispose();
              }

              scene.remove(system);
              activeParticleSystems.splice(i, 1);
          } else {
              system.userData.time += delta; // Track system time for overall duration
          }
      }
  }

  // ==== Init Updated Construction System ====
  function initConstructionMode() {
      
      // Initialize blockGrid with any existing ground-level blocks
      placedBlocks.forEach(block => {
          if (block.position.y === 0.5) {
              block.userData.isFoundation = true;
              blockGrid.set(getGridKey(block.position.x, block.position.y, block.position.z), block);
          }
      });

      const previewMat = new THREE.MeshBasicMaterial({
          color: 0x00ff00,
          transparent: true,
          opacity: 0.18,
          depthWrite: false
      });

      // Thick visible edges (real 3D beams: wireframe lines are always 1px)
      function makeThickBoxEdges(size, thickness, material) {
          const g = new THREE.Group();
          const h = size / 2;
          const mk = (w, hh, d, x, y, z) => {
              const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), material);
              m.position.set(x, y, z);
              g.add(m);
          };
          [[-h, -h], [h, -h], [-h, h], [h, h]].forEach(([y, z]) => mk(size + thickness, thickness, thickness, 0, y, z));
          [[-h, -h], [h, -h], [-h, h], [h, h]].forEach(([x, z]) => mk(thickness, size + thickness, thickness, x, 0, z));
          [[-h, -h], [h, -h], [-h, h], [h, h]].forEach(([x, y]) => mk(thickness, thickness, size + thickness, x, y, 0));
          return g;
      }

      blockPreview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), previewMat);
      blockPreview.visible = false;
      blockPreview.name = "BlockPreview";
      const previewEdgeMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
      previewEdgeMat.toneMapped = false;
      blockPreview.add(makeThickBoxEdges(1, 0.07, previewEdgeMat));
      blockPreview.userData.edgeMat = previewEdgeMat;
      scene.add(blockPreview);

      // Add debug hotkey
      window.addEventListener('keydown', (e) => {
          if (e.key === ';') toggleDebugGrid();
      });
  }
  function showPlacementMessage(text) {
      const msgElement = document.getElementById('constructionMessage');
      
      // Create the element if it doesn't exist
      if (!msgElement) {
          const newMsgElement = document.createElement('div');
          newMsgElement.id = 'constructionMessage';
          newMsgElement.style.position = 'fixed';
          newMsgElement.style.bottom = '20px';
          newMsgElement.style.left = '50%';
          newMsgElement.style.transform = 'translateX(-50%)';
          newMsgElement.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
          newMsgElement.style.color = 'white';
          newMsgElement.style.padding = '10px 20px';
          newMsgElement.style.borderRadius = '5px';
          newMsgElement.style.fontFamily = 'Arial, sans-serif';
          newMsgElement.style.zIndex = '1000';
          newMsgElement.style.transition = 'opacity 0.3s ease';
          newMsgElement.style.opacity = '0';
          document.body.appendChild(newMsgElement);
      }

      const elementToUse = msgElement || document.getElementById('constructionMessage');
      
      // Clear any pending timeout
      if (placementMessageTimeout) {
          clearTimeout(placementMessageTimeout);
      }

      // Update and show message
      elementToUse.textContent = text;
      elementToUse.style.opacity = '1';

      // Auto-hide after delay
      placementMessageTimeout = setTimeout(() => {
          elementToUse.style.opacity = '0';
      }, 1000);
  }
  function checkForCharacter(blockPos) {
      // Create test block geometry (slightly larger than actual block)
      const testGeo = new THREE.BoxGeometry(1.1, 1.1, 1.1); 
      const testMat = new THREE.MeshBasicMaterial({ visible: false });
      const testBlock = new THREE.Mesh(testGeo, testMat);
      testBlock.position.copy(blockPos);
      
      // Check player collision
      if (player) {
          player.updateColliderBox();
          const playerBox = player.colliderBox.clone();
          playerBox.expandByScalar(0.1); // Small buffer
          
          testBlock.updateMatrixWorld();
          const blockBox = new THREE.Box3().setFromObject(testBlock);
          
          if (playerBox.intersectsBox(blockBox)) {
              return true;
          }
      }
      
      // Check NPC collisions
      for (const npc of npcs) {
          npc.updateColliderBox();
          const npcBox = npc.colliderBox.clone();
          npcBox.expandByScalar(0.1); // Small buffer
          
          testBlock.updateMatrixWorld();
          const blockBox = new THREE.Box3().setFromObject(testBlock);
          
          if (npcBox.intersectsBox(blockBox)) {
              return true;
          }
      }
      
      return false;
  }

  // Debug 
  function updateDebugInfo(position) {
      if (!showDebugGrid) return;

      // Clear old markers
      scene.children.filter(obj => obj.name === "debugMarker").forEach(m => scene.remove(m));

      // Show support connections
      placedBlocks.forEach(block => {
          if (block.userData.isFoundation) {
              const marker = new THREE.Mesh(
                  new THREE.SphereGeometry(0.2),
                  new THREE.MeshBasicMaterial({ color: 0x00ff00 })
              );
              marker.position.copy(block.position);
              marker.name = "debugMarker";
              scene.add(marker);
          }

          block.userData.supportingBlocks.forEach(supporting => {
              const lineGeometry = new THREE.BufferGeometry().setFromPoints([
                  supporting.position,
                  block.position
              ]);
              const line = new THREE.Line(
                  lineGeometry,
                  new THREE.LineBasicMaterial({ color: 0xff0000 })
              );
              line.name = "debugMarker";
              scene.add(line);
          });
      });
  }
  function showSupportRelations() {
      // Clear old debug markers
      scene.children.filter(obj => obj.name === "supportDebug").forEach(m => scene.remove(m));

      // Visualize all support relationships
      placedBlocks.forEach(block => {
          // Show supporting blocks
          block.userData.supportingBlocks.forEach(support => {
              const points = [
                  new THREE.Vector3().copy(support.position),
                  new THREE.Vector3().copy(block.position)
              ];
              const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
              const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
              const line = new THREE.Line(lineGeometry, lineMaterial);
              line.name = "supportDebug";
              scene.add(line);
          });

          // Mark foundation blocks
          if (block.userData.isFoundation) {
              const markerGeo = new THREE.SphereGeometry(0.2);
              const markerMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
              const marker = new THREE.Mesh(markerGeo, markerMat);
              marker.position.copy(block.position);
              marker.name = "supportDebug";
              scene.add(marker);
          }
      });
  }
  function updateDebugVisuals() {
      if (!showDebugGrid) return;

      // Clear old debug objects
      scene.children.filter(obj => obj.name === "debugVisual").forEach(m => scene.remove(m));

      // Visualize support relationships
      placedBlocks.forEach(block => {
          // Show foundation blocks with red spheres
          if (block.userData.isFoundation) {
              const marker = new THREE.Mesh(
                  new THREE.SphereGeometry(0.2),
                  new THREE.MeshBasicMaterial({ color: 0xff0000 })
              );
              marker.position.copy(block.position);
              marker.name = "debugVisual";
              scene.add(marker);
          }

          // Draw support lines (green for valid supports)
          block.userData.supportingBlocks?.forEach(support => {
              const points = [
                  new THREE.Vector3().copy(support.position),
                  new THREE.Vector3().copy(block.position)
              ];
              const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
              const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
              const line = new THREE.Line(lineGeometry, lineMaterial);
              line.name = "debugVisual";
              scene.add(line);
          });
      });
  }
  function toggleDebugGrid() {
      showDebugGrid = !showDebugGrid;
      if (showDebugGrid) {
          updateDebugVisuals();
          showSupportRelations();
          console.log("Construction debug ON");
      } else {
          scene.children.filter(obj => obj.name === "debugVisual").forEach(m => scene.remove(m));
          console.log("Construction debug OFF");
      }
  }
// --- Resources
  function updateResourceHUD() {
      const resDiv = document.getElementById('resources');
      if(!resDiv || !player) return;
      
      // Create buttons for each material type
      const buttonsHTML = Object.entries(BLOCK_MATERIALS).map(([type, data]) => {
          const isActive = currentBlockType === type;
          const color = data.material.color.getHexString();
          const hasResources = player.inventory.resources[type] > 0;
          
          return `
              <button class="material-btn ${isActive ? 'active' : ''} ${!hasResources ? 'disabled' : ''}" 
                      data-type="${type}" 
                      style="background-color:#${color};"
                      title="[${type.toUpperCase().charAt(0)}] ${type.charAt(0).toUpperCase() + type.slice(1)}">
                      ${player.inventory.resources[type]}
              </button>
          `;
      }).join('');

      resDiv.innerHTML = `
          <h3>Resources</h3>
          <div class="material-buttons">
              ${buttonsHTML}
          </div>
      `;

      // Add event listeners to new buttons
      document.querySelectorAll('.material-btn').forEach(btn => {
          btn.addEventListener('click', () => {
              if(!btn.classList.contains('disabled')) {
                  setBlockType(btn.dataset.type);
              }
          });
      });
  }
  function createHarvestEffect(position) {
      const spark = new THREE.Mesh(
          new THREE.SphereGeometry(0.1),
          new THREE.MeshBasicMaterial({ color: 0xffff00 })
      );
      spark.position.copy(position);
      scene.add(spark);
      setTimeout(() => scene.remove(spark), 300);
  }
  function createResourceNode(type, position) {
      // Get the material definition from BLOCK_MATERIALS
      const materialDef = BLOCK_MATERIALS[type];
      if (!materialDef) {
          console.error(`No material definition found for type: ${type}`);
          return null;
      }

      // Create the node using the unified material
      const node = new THREE.Mesh(
          materialDef.geometry.clone(), // Clone the geometry
          materialDef.material.clone() // Clone the material so each node has its own instance
      );
      
      node.position.copy(position);
      node.type = type;
      node.isResourceNode = true;
      node.health = materialDef.resourceHealth || 50; // Fallback to 50 if not defined
      node.isHarvested = false;

      node.harvest = function (efficiency) {
          if (this.isHarvested) return 0;
          this.health -= efficiency;
          if (this.health <= 0) {
              this.visible = false;
              this.isHarvested = true;
              const ci = collidableObjects.indexOf(this);
              if (ci !== -1) collidableObjects.splice(ci, 1);
              const self = this;
              setTimeout(() => respawnNode(self), 10000);
              return 1;
          }
          return 1;
      };

      if (typeof resourceNodes !== 'undefined' && resourceNodes.indexOf(node) === -1) resourceNodes.push(node);
      return node;
  }
  function respawnNode(node) {
      if (!node) return;
      // If a player-built block now occupies the spot, retry later instead of overlapping
      try {
          const taken = placedBlocks.some(b =>
              Math.abs(b.position.x - node.position.x) < 1 &&
              Math.abs(b.position.y - node.position.y) < 1 &&
              Math.abs(b.position.z - node.position.z) < 1);
          if (taken) {
              setTimeout(() => respawnNode(node), 10000);
              return;
          }
      } catch (e) {}
      const def = BLOCK_MATERIALS[node.type];
      node.health = (def && def.resourceHealth) || 50;
      node.isHarvested = false;
      node.visible = true;
      if (typeof collidableObjects !== 'undefined' && collidableObjects.indexOf(node) === -1) {
          collidableObjects.push(node);
      }
  }
// --- World Building Methods
  function createLockedDoor(position) {
      const door = new THREE.Mesh(
          new THREE.BoxGeometry(2, 4, 0.2),
          new THREE.MeshStandardMaterial({ color: 0x8B4513 })
      );
      door.position.copy(position);
      door.castShadow = true;
      door.name = "Door";

      door.isInteractable = true; // So it shows the prompt
      door.isPickupable = false;  // Just in case
      door.userData = {
          isDoor: true,
          locked: true,
          requiredKey: 'golden_key',
          open: false
      };

      door.geometry.computeBoundingBox();
      door.updateMatrixWorld(true);

      scene.add(door);
      collidableObjects.push(door);
      return door;
  }
  function createStaircase(options) {
      // Default configuration
      const config = {
          stepCount: 5,
          width: 4,
          height: 0.5,  // Height of each step
          depth: 2,     // Depth (z-axis) of each step
          rise: 0.4,    // Vertical rise between steps
          spacing: 2,   // Horizontal spacing (x-axis)
          material: new THREE.MeshStandardMaterial({ color: 0xaaaaaa }),
          anchorToGround: true, // New option to anchor to ground
          ...options
      };

      const stairsGroup = new THREE.Group();
      stairsGroup.position.copy(config.position);

      // Calculate vertical offset if anchoring to ground
      const groundOffset = -0.5;
      const rampAngle = Math.atan2(config.rise, config.spacing);

      // Create each step
      for (let i = 0; i < config.stepCount; i++) {
          const step = new THREE.Mesh(
              new THREE.BoxGeometry(config.width, config.height, config.depth),
              config.material.clone()
          );
          
          // Position steps with consistent rise and spacing
          step.position.set(
              i * config.spacing,               // X position
              groundOffset + i * config.rise,   // Y position (anchored to ground)
              0                                // Z position
          );
          
          //if (i == 0) {step.rotation.z = rampAngle;}
          // Physics and rendering properties
          step.isStatic = true;
          step.receiveShadow = true;
          step.castShadow = true;
          step.name = "Stair step";
          step.userData = {
              allowBuildingOnTop: true,
              isStair: true,
              stepHeight: config.height,
              stepRise: config.rise
          };
          
          // Properly compute collisions
          step.geometry.computeBoundingBox();
          step.updateMatrixWorld(true);
          
          // Add to group and collidables
          stairsGroup.add(step);
          collidableObjects.push(step);
      }

      stairsGroup.updateMatrixWorld(true);
      return stairsGroup;
  }
