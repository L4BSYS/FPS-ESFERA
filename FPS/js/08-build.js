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

  // --- Decaimiento de la zona reclamada cuando muere la mesa ---
  var decayingBlocks = [];
  var DECAY_TOTAL_MS = 30000;
  function startZoneDecay(wb) {
      if (!wb || !Array.isArray(placedBlocks)) return;
      const cx = wb.pos.x, cz = wb.pos.z;
      const r = wb.claimRadius || (typeof CLAIM_RADIUS !== 'undefined' ? CLAIM_RADIUS : 14);
      const list = [];
      for (const b of placedBlocks) {
          const dx = b.position.x - cx, dz = b.position.z - cz;
          const d = Math.hypot(dx, dz);
          if (d <= r + 0.75) list.push({ b, d });
      }
      list.sort((a, c) => c.d - a.d); // los más lejanos primero
      const now = performance.now();
      const step = (DECAY_TOTAL_MS * 0.45) / Math.max(1, list.length);
      list.forEach((item, i) => {
          const b = item.b;
          if (!b.userData || b.userData.decay) return;
          b.userData.decay = true;
          b.userData.decayStart = now + i * step;
          b.userData.decayDur = DECAY_TOTAL_MS * 0.55;
          if (!decayingBlocks.includes(b)) decayingBlocks.push(b);
      });
      if (list.length) showPlacementMessage('¡Comenzó el decaimiento de la base!');
  }
  function cancelZoneDecay(cx, cz) {
      const r = (typeof CLAIM_RADIUS !== 'undefined' ? CLAIM_RADIUS : 14);
      for (let i = decayingBlocks.length - 1; i >= 0; i--) {
          const b = decayingBlocks[i];
          if (!b || !b.userData) { decayingBlocks.splice(i, 1); continue; }
          const dx = b.position.x - cx, dz = b.position.z - cz;
          if (dx * dx + dz * dz <= r * r) {
              b.userData.decay = false;
              b.userData.decayStart = 0;
              try {
                  b.scale.setScalar(1);
                  if (b.material) { b.material.opacity = 1; b.material.transparent = false; }
                  if (b.userData.maxHealth) {
                      b.userData.health = b.userData.maxHealth;
                      updateBlockAppearance(b);
                  }
              } catch (e) {}
              decayingBlocks.splice(i, 1);
          }
      }
  }
  function updateBlockDecay(delta) {
      if (!decayingBlocks.length) return;
      const now = performance.now();
      for (let i = decayingBlocks.length - 1; i >= 0; i--) {
          const b = decayingBlocks[i];
          if (!b || !b.userData || !placedBlocks.includes(b)) { decayingBlocks.splice(i, 1); continue; }
          if (!b.userData.decayStart || now < b.userData.decayStart) continue;
          const dur = b.userData.decayDur || DECAY_TOTAL_MS;
          const p = Math.min(1, (now - b.userData.decayStart) / dur);
          // Se degrada como si lo estuvieran atacando: pierde vida y muestra el daño
          const maxHp = b.userData.maxHealth || 1;
          b.userData.health = Math.max(0.0001, maxHp * (1 - p));
          try { updateBlockAppearance(b); } catch (e) {}
          if (p >= 1) {
              decayingBlocks.splice(i, 1);
              try { destroyBlock(b); } catch (e) {}
          }
      }
  }
  // --- Anillo de zona reclamada + HUD de zona de construcción ---
  function updateClaimRings(t) {
      if (typeof workbenches === 'undefined' || typeof player === 'undefined' || !player) return;
      const px = player.container.position.x, pz = player.container.position.z;
      const hammer = player.currentTool === TOOLS.HAMMER;
      for (const wb of workbenches) {
          if (!wb || !wb.ring) continue;
          const r = wb.claimRadius || (typeof CLAIM_RADIUS !== 'undefined' ? CLAIM_RADIUS : 14);
          const d = Math.hypot(px - wb.pos.x, pz - wb.pos.z);
          const show = hammer || d < r * 1.25 || wb.hp < wb.maxHp;
          wb.ring.visible = show;
          if (show) wb.ring.material.opacity = 0.1 + Math.abs(Math.sin((t || 0) * 2)) * 0.08;
      }
  }
  function updateBuildZoneHUD() {
      const el = document.getElementById('buildZone');
      if (!el) return;
      const hasBench = (typeof workbenches !== 'undefined') && workbenches.some(w => w && w.hp > 0);
      const inside = hasBench && typeof player !== 'undefined' && player && typeof isInAnyClaim === 'function' &&
          isInAnyClaim(player.container.position);
      if (!hasBench) { el.textContent = 'Sin mesa: crafteá una para reclamar la zona'; el.className = 'build-zone warn'; }
      else if (inside) { el.textContent = 'Dentro de tu base'; el.className = 'build-zone ok'; }
      else { el.textContent = 'Fuera del área de tu base'; el.className = 'build-zone warn'; }
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

      // 1.5 Zona reclamada: solo se construye dentro del área de una mesa de trabajo
      if (typeof isInAnyClaim === 'function' && !isInAnyClaim(snappedPos)) {
          const hasBench = (typeof workbenches !== 'undefined') && workbenches.some(w => w && w.hp > 0);
          lastInvalidReason = hasBench ? 'Fuera del área de tu base' : 'Craftéa y colocá una mesa de trabajo';
          return false;
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

      if ((typeof creatorMode === 'undefined' || !creatorMode) &&
          ((typeof player.inventory.getResourceCount === 'function')
              ? player.inventory.getResourceCount(currentBlockType)
              : player.inventory.resources[currentBlockType]) < cost) {
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
      if (typeof creatorMode === 'undefined' || !creatorMode) {
          if (typeof player.inventory.spendResource === 'function') player.inventory.spendResource(currentBlockType, cost);
          else player.inventory.resources[currentBlockType] -= cost;
      }
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
      playSoundAt(`block_break_${type}`, position, { gain: 0.9, maxDist: 40 });
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
      const bar = document.getElementById('buildMats');
      if (!bar || !player) return;

      const matNames = { wood: 'Madera', stone: 'Piedra', metal: 'Metal' };
      const matKeys = { wood: 'Z', stone: 'X', metal: 'C' };
      bar.innerHTML = Object.entries(BLOCK_MATERIALS).map(([type, data]) => {
          const isActive = currentBlockType === type;
          const color = '#' + data.material.color.getHexString();
          const count = (typeof player.inventory.getResourceCount === 'function')
              ? player.inventory.getResourceCount(type)
              : (player.inventory.resources[type] || 0);
          const empty = count <= 0;
          return `
              <button class="build-mat ${isActive ? 'active' : ''} ${empty ? 'empty' : ''}"
                      data-type="${type}"
                      title="${matNames[type] || type} (${matKeys[type] || ''}) — te quedan ${count}">
                  <span class="bm-swatch" style="background:${color};"></span>
                  <span class="bm-name">${matNames[type] || type}</span>
                  <span class="bm-count">${count}</span>
              </button>
          `;
      }).join('');

      bar.querySelectorAll('.build-mat').forEach(btn => {
          btn.addEventListener('click', () => {
              if (!btn.classList.contains('empty')) setBlockType(btn.dataset.type);
          });
      });

      refreshBuildBarVisibility();
  }
  // Muestra la barra de construcción solo con el martillo en mano (fuera del modo creador)
  function refreshBuildBarVisibility() {
      const bar = document.getElementById('buildBar');
      if (!bar) return;
      const show = !isGamePaused && !(typeof creatorMode !== 'undefined' && creatorMode) &&
          typeof player !== 'undefined' && player && player.currentTool === TOOLS.HAMMER;
      bar.style.display = show ? 'flex' : 'none';
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
  function buildResourceNodeModel(type) {
      // Modelo con la base apoyada en y=0 para que se asiente en el suelo
      const g = new THREE.Group();
      const useShadow = (m) => { m.receiveShadow = true; return m; };
      if (type === 'wood') {
          const bark = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9, metalness: 0.0 });
          const cutWood = new THREE.MeshStandardMaterial({ color: 0x9a6a35, roughness: 0.85, metalness: 0.0 });
          const leaf = new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.9, metalness: 0.0 });
          const stump = useShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.9, 10), bark));
          stump.castShadow = true;
          stump.position.y = 0.45; g.add(stump);
          const cut = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 10), cutWood);
          cut.position.y = 0.92; g.add(cut);
          [[-0.62, 0.18, 0.22], [0.58, 0.16, -0.28]].forEach(([x, y, z], i) => {
              const log = useShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.05, 8), i ? cutWood : bark));
              log.rotation.set(Math.PI / 2, 0, i ? 0.5 : -0.4);
              log.position.set(x, y, z); g.add(log);
          });
          [[-0.35, 1.0, 0.18], [0.3, 1.18, -0.15], [0.0, 1.32, 0.0]].forEach(([x, y, z]) => {
              const puff = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), leaf);
              puff.position.set(x, y, z); g.add(puff);
          });
      } else if (type === 'stone') {
          const rock = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.95, metalness: 0.0 });
          const rockDark = new THREE.MeshStandardMaterial({ color: 0x6f6f6f, roughness: 0.95, metalness: 0.0 });
          const rocks = [[0, 0.42, 0, 0.62], [0.55, 0.28, 0.3, 0.42], [-0.5, 0.3, -0.25, 0.46], [0.1, 0.24, -0.55, 0.36]];
          rocks.forEach(([x, y, z, r], i) => {
              const m = useShadow(new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), i % 2 ? rockDark : rock));
              m.position.set(x, y, z); m.rotation.set(Math.random(), Math.random(), Math.random());
              if (i === 0) m.castShadow = true;
              g.add(m);
          });
      } else {
          const rock = new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.85, metalness: 0.3 });
          const ore = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.3, metalness: 0.95 });
          const rocks = [[0, 0.45, 0, 0.6], [0.55, 0.3, 0.28, 0.42], [-0.5, 0.32, -0.22, 0.44]];
          rocks.forEach(([x, y, z, r], i) => {
              const m = useShadow(new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rock));
              m.position.set(x, y, z); m.rotation.set(Math.random(), Math.random(), Math.random());
              if (i === 0) m.castShadow = true;
              g.add(m);
          });
          [[0.05, 0.85, 0.05, 0.16], [0.4, 0.55, 0.1, 0.12], [-0.3, 0.6, -0.1, 0.13]].forEach(([x, y, z, r]) => {
              const c = new THREE.Mesh(new THREE.OctahedronGeometry(r, 0), ore);
              c.position.set(x, y, z); c.rotation.set(Math.random(), Math.random(), Math.random());
              g.add(c);
          });
      }
      return g;
  }
  function createResourceNode(type, position) {
      // Get the material definition from BLOCK_MATERIALS
      const materialDef = BLOCK_MATERIALS[type];
      if (!materialDef) {
          console.error(`No material definition found for type: ${type}`);
          return null;
      }

      // Create the node using the unified material
      const node = buildResourceNodeModel(type);

      node.position.copy(position);
      node.type = type;
      node.isResourceNode = true;
      node.health = materialDef.resourceHealth || 50; // Fallback to 50 if not defined
      node.isHarvested = false;
      // Collider: el nodo es sólido para jugador y enemigos
      node.userData.solid = true;
      node.isStatic = true;
      try {
          node.updateMatrixWorld(true);
          const b = new THREE.Box3().setFromObject(node, true);
          // Recortamos la altura del follaje para un collider más natural
          b.max.y = Math.min(b.max.y, b.min.y + 1.3);
          node.userData.worldBoundingBox = b;
      } catch (e) {}

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
      // Si el nodo fue eliminado del mundo (teardown / regeneración), no revivirlo
      if (!node.parent) return;
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
  function spawnResourceCluster(type, cx, cz, count) {
      count = count || 4;
      const placed = [];
      let spawnCount = 0;
      for (let i = 0; i < count; i++) {
          let x = cx, z = cz, ok = false;
          for (let t = 0; t < 14; t++) {
              const a = Math.random() * Math.PI * 2;
              const r = 1.4 + Math.random() * 4.5;
              x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r;
              if (placed.every(q => Math.hypot(q.x - x, q.z - z) > 1.7)) { ok = true; break; }
          }
          if (!ok) continue;
          const y = (typeof groundTopY === 'function') ? groundTopY(x, z) : 0;
          const node = createResourceNode(type, new THREE.Vector3(x, y, z));
          if (!node) continue;
          scene.add(node);
          if (typeof collidableObjects !== 'undefined' && collidableObjects.indexOf(node) === -1) {
              collidableObjects.push(node);
          }
          placed.push({ x, z });
          spawnCount++;
      }
      return spawnCount;
  }

  // ------------------------------------------------------------
  //  Generación procedural de recursos (dispersión + clusters mixtos)
  // ------------------------------------------------------------
  const RESOURCE_LEVELS = {
      none:     { label: 'Sin recursos',  density: 0 },
      low:      { label: 'Pocos',         density: 0.0011 },
      normal:   { label: 'Normal',        density: 0.0018 },
      high:     { label: 'Abundantes',    density: 0.0028 },
      abundant: { label: 'Exuberantes',   density: 0.0040 }
  };
  const RESOURCE_MAX_NODES = 120;

  function resourceDensityFor(level) {
      const d = RESOURCE_LEVELS[level];
      return d ? d.density : 0;
  }
  function resourceLevelLabel(level) {
      return (RESOURCE_LEVELS[level] && RESOURCE_LEVELS[level].label) || 'Sin recursos';
  }
  function resourceTargetCount(size, level) {
      const d = resourceDensityFor(level);
      if (d <= 0) return 0;
      const area = Math.max(1600, size * size);
      return Math.max(4, Math.min(RESOURCE_MAX_NODES, Math.round(area * d)));
  }
  function clearAutoResources() {
      let removed = 0;
      if (typeof resourceNodes !== 'undefined') {
          resourceNodes.slice().forEach(function (node) {
              if (!node || !node.userData || !node.userData.autoResource) return;
              try { scene.remove(node); } catch (e) {}
              const ci = collidableObjects.indexOf(node);
              if (ci > -1) collidableObjects.splice(ci, 1);
              const ri = resourceNodes.indexOf(node);
              if (ri > -1) resourceNodes.splice(ri, 1);
              removed++;
          });
      }
      if (typeof worldItems !== 'undefined') {
          worldItems.slice().forEach(function (item) {
              if (!item || !item.userData || !item.userData.autoResource) return;
              try { scene.remove(item); } catch (e) {}
              const ci = collidableObjects.indexOf(item);
              if (ci > -1) collidableObjects.splice(ci, 1);
              const wi = worldItems.indexOf(item);
              if (wi > -1) worldItems.splice(wi, 1);
              removed++;
          });
      }
      return removed;
  }
  function resourceTypeBag() {
      // Bolsa con proporciones estables: 3 madera, 3 piedra, 2 metal, mezclada.
      const bag = ['wood', 'wood', 'wood', 'stone', 'stone', 'stone', 'metal', 'metal'];
      for (let i = bag.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
      }
      return bag;
  }
  function resourceSatelliteType(dominant) {
      const r = Math.random();
      if (r < 0.72) return dominant;
      if (dominant === 'wood') return r < 0.86 ? 'stone' : 'metal';
      if (dominant === 'stone') return r < 0.88 ? 'wood' : 'metal';
      return r < 0.9 ? 'stone' : 'wood';
  }
  function looseKeyFor(type) {
      if (type === 'wood') return 'branch';
      if (type === 'stone') return 'pebble';
      return 'scrap';
  }
  function pickLooseKey(dominant) {
      const r = Math.random();
      if (r < 0.75) return looseKeyFor(dominant);
      const others = ['wood', 'stone', 'metal'].filter(function (t) { return t !== dominant; });
      return looseKeyFor(others[(Math.random() * others.length) | 0]);
  }

  // Genera clusters alrededor de una grilla dispersa (estratificada + jitter),
  // con un cluster inicial cerca del spawn y mezcla de tipos en cada cluster.
  function generateWorldResources(def, opts) {
      opts = opts || {};
      if (opts.clear) clearAutoResources();
      if (typeof createResourceNode !== 'function' || typeof scene === 'undefined') return { nodes: 0, loose: 0 };

      const size = Math.max(40, (def && def.size) || 120);
      const level = (def && def.resourceLevel) || 'normal';
      const target = resourceTargetCount(size, level);
      if (!target) return { nodes: 0, loose: 0 };

      const margin = Math.max(8, size * 0.06);
      const b = Math.max(10, size / 2 - margin);
      const spawn = (def && def.spawn) || { x: 0, z: 0 };
      const sx0 = typeof spawn.x === 'number' ? spawn.x : 0;
      const sz0 = typeof spawn.z === 'number' ? spawn.z : 0;
      const placed = [];
      const centers = [];
      let made = 0;
      let looseMade = 0;

      function canPlace(x, z) {
          if (Math.abs(x) > b || Math.abs(z) > b) return false;
          if (Math.hypot(x - sx0, z - sz0) < 5.5) return false;
          for (let i = 0; i < placed.length; i++) {
              if (Math.hypot(placed[i].x - x, placed[i].z - z) < 1.7) return false;
          }
          return true;
      }
      function addNode(type, x, z) {
          if (!canPlace(x, z)) return false;
          const y = (typeof groundTopY === 'function') ? groundTopY(x, z) : 0;
          const node = createResourceNode(type, new THREE.Vector3(x, y, z));
          if (!node) return false;
          node.userData.autoResource = true;
          scene.add(node);
          if (typeof collidableObjects !== 'undefined' && collidableObjects.indexOf(node) === -1) {
              collidableObjects.push(node);
          }
          placed.push({ x: x, z: z, type: type });
          made++;
          return true;
      }
      function placeLoose(key, x, z) {
          if (!canPlace(x, z)) return false;
          if (typeof placeWorldItem !== 'function') return false;
          const item = placeWorldItem(key, new THREE.Vector3(x, 0.35, z));
          if (!item) return false;
          item.userData.autoResource = true;
          item.userData.autoLoose = true;
          placed.push({ x: x, z: z, type: key });
          looseMade++;
          return true;
      }
      // Reparte elementos sueltos (rama/piedra/chatarra) alrededor de un punto.
      function scatterLoose(counts, cx, cz, minR, maxR) {
          Object.keys(counts).forEach(function (key) {
              for (let i = 0; i < counts[key]; i++) {
                  for (let t = 0; t < 40; t++) {
                      const a = Math.random() * Math.PI * 2;
                      const r = minR + Math.random() * (maxR - minR);
                      if (placeLoose(key, cx + Math.cos(a) * r, cz + Math.sin(a) * r)) break;
                  }
              }
          });
      }
      function placeCluster(cx, cz, dominant, count) {
          const radiusMax = 2.0 + Math.random() * 3.6;
          let attempts = 0;
          for (let i = 0; i < count && attempts < count * 24; attempts++) {
              const a = Math.random() * Math.PI * 2;
              const r = 0.9 + Math.random() * radiusMax;
              if (addNode(resourceSatelliteType(dominant), cx + Math.cos(a) * r, cz + Math.sin(a) * r)) i++;
          }
          // Elementos sueltos junto a los nodos, para arrancar sin herramientas.
          const looseCount = 1 + (Math.random() < 0.35 ? 1 : 0);
          for (let j = 0; j < looseCount; j++) {
              for (let t = 0; t < 20; t++) {
                  const a = Math.random() * Math.PI * 2;
                  const r = 1.0 + Math.random() * 4.0;
                  if (placeLoose(pickLooseKey(dominant), cx + Math.cos(a) * r, cz + Math.sin(a) * r)) break;
              }
          }
      }

      // Kit inicial alrededor del spawn: alcanza para martillo + mesa + hacha.
      // (rama = 2 madera, piedra suelta = 2 piedra, chatarra = 2 metal)
      scatterLoose({ branch: 7, pebble: 5, scrap: 2 }, sx0, sz0, 6, 12);

      // Cluster inicial: siempre hacia adentro del mapa, a 13-18 del spawn.
      let starter = 0;
      if (target >= 10) {
          let dx = -sx0, dz = -sz0;
          if (Math.hypot(dx, dz) < 1) {
              const a = Math.random() * Math.PI * 2;
              dx = Math.cos(a); dz = Math.sin(a);
          }
          const len = Math.hypot(dx, dz) || 1;
          const dist = 13 + Math.random() * 5;
          let cx = Math.max(-b, Math.min(b, sx0 + (dx / len) * dist));
          let cz = Math.max(-b, Math.min(b, sz0 + (dz / len) * dist));
          if (Math.hypot(cx - sx0, cz - sz0) >= 7) {
              starter = 5;
              placeCluster(cx, cz, 'wood', starter);
              centers.push({ x: cx, z: cz });
          }
      }

      // Grilla estratificada: celdas barajadas para dispersar los clusters.
      const remaining = Math.max(0, target - made);
      const clusterCount = Math.max(1, Math.min(26, Math.round(remaining / 5.4)));
      const grid = Math.max(1, Math.ceil(Math.sqrt(clusterCount)));
      const cell = (b * 2) / grid;
      const cells = [];
      for (let gz = 0; gz < grid; gz++) {
          for (let gx = 0; gx < grid; gx++) cells.push({ gx: gx, gz: gz });
      }
      for (let i = cells.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          const t = cells[i]; cells[i] = cells[j]; cells[j] = t;
      }
      const bag = resourceTypeBag();
      for (let i = 0; i < clusterCount; i++) {
          const c = cells[i % cells.length];
          let cx = -b + (c.gx + 0.5) * cell + (Math.random() - 0.5) * cell * 0.55;
          let cz = -b + (c.gz + 0.5) * cell + (Math.random() - 0.5) * cell * 0.55;
          if (Math.hypot(cx - sx0, cz - sz0) < 9) {
              const a = Math.atan2(cz - sz0, cx - sx0) || 0;
              cx = sx0 + Math.cos(a) * 9;
              cz = sz0 + Math.sin(a) * 9;
          }
          cx = Math.max(-b, Math.min(b, cx));
          cz = Math.max(-b, Math.min(b, cz));
          const left = Math.max(0, target - made);
          const leftClusters = clusterCount - i;
          const base = Math.round(left / Math.max(1, leftClusters));
          let count = Math.max(3, Math.min(9, base + ((Math.random() * 3) | 0) - 1));
          count = Math.max(1, Math.min(count, left));
          placeCluster(cx, cz, bag[i % bag.length], count);
          centers.push({ x: cx, z: cz });
      }

      // Relleno: nodos sueltos alrededor de clusters existentes.
      let guard = 0;
      while (made < target && guard++ < target * 8 && centers.length) {
          const c = centers[(Math.random() * centers.length) | 0];
          const a = Math.random() * Math.PI * 2;
          const r = 4 + Math.random() * 7;
          addNode(resourceSatelliteType('wood'), c.x + Math.cos(a) * r, c.z + Math.sin(a) * r);
      }
      return { nodes: made, loose: looseMade };
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
