// js/07-spawns.js (part 7/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Collectibles ---
  function createCollectible(pos, type, name = "Collectible", pickupable = false) {
      let geometry, material;
      
      switch(type) {
          case 'health':
             geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4); // Green cross shape? Too complex for now. Box.
             material = new THREE.MeshStandardMaterial({
                color: 0x00ff00, emissive: 0x00cc00, emissiveIntensity: 0.4, roughness: 0.7
             });
             name = name === "Collectible" ? "Health Pack" : name;
             break;
              
          case 'ammo':
              geometry = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 6);
              material = new THREE.MeshStandardMaterial({ 
                  color: 0xFFD700, 
                  metalness: 0.7,
                  roughness: 0.3
              });
              name = name === "Collectible" ? "Ammo Crate" : name;
              break;
              
          case 'key':
              geometry = new THREE.TorusGeometry(0.15, 0.05, 8, 16);
              material = new THREE.MeshStandardMaterial({ 
                  color: 0xAA00FF,
                  metalness: 0.8
              });
              name = name === "Collectible" ? "Key" : name;
              break;
              
          default:
              // Generic item
              geometry = new THREE.BoxGeometry(0.3, 0.5, 0.2);
              material = new THREE.MeshStandardMaterial({ color: 0xcccccc });
      }
      
      const item = new THREE.Mesh(geometry, material);
      item.position.copy(pos);
      item.castShadow = true;
      item.name = name;
      item.type = type; // Store type for passive effects
      item.isCollectible = true;
      item.isPickupable = pickupable; // Can this be put in player's hands?
      item.userData = { collected: false }; // State

      // Add pulsing/spinning animation
      item.userData.update = (delta) => {
          item.rotation.y += delta * 0.5; // Spin slowly
          item.position.y = pos.y + Math.sin(clock.elapsedTime * 1.5) * 0.1; // Bob up/down
      };

          // Add specific properties
      if (type === 'ammo') {
          item.userData.ammoType = 'pistol'; // or determine based on name
          item.userData.amount = 10;
      } else if (type === 'key') {
          item.userData.keyId = name.toLowerCase().replace(/\s+/g, '_');
      }
      
      return item;
  }
// --- Robot NPC Spawner ---
  function spawnRobot(pos = null, minX = -20, maxX = 20, minZ = -20, maxZ = 20) {
      const robotGroup = new THREE.Group();
      robotGroup.name = "RobotNPC_VisualGroup"; // More descriptive name

      // Config for this robot visual
      const robotRadius = 0.4;
      const robotBodyHeight = 0.8; // Cylinder part height
      const robotHeadRadius = 0.3;
      const robotTotalHeight = robotBodyHeight + 2 * robotRadius; // Capsule height

      // Body
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xCCCCCC, roughness: 0.3, metalness: 0.6 });
      const bodyGeo = new THREE.CapsuleGeometry(robotRadius, robotBodyHeight, 4, 12);
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.name = "NPC_Body";
      body.castShadow = true;
      body.receiveShadow = true;
      // *** CHANGE: Body is centered vertically at the group's origin ***
      body.position.y = 0;
      robotGroup.add(body);

      // Head (simple sphere)
      const headMat = new THREE.MeshStandardMaterial({ color: 0xC0C0C0, roughness: 0.3, metalness: 0.8 });
      const headGeo = new THREE.SphereGeometry(robotHeadRadius, 12, 8);
      const head = new THREE.Mesh(headGeo, headMat);
      // *** CHANGE: Position head relative to the center (top of body capsule) ***
      head.position.y = (robotBodyHeight / 2) + robotHeadRadius * 0.8; // Place slightly overlapping capsule top
      head.castShadow = true;
      head.receiveShadow = true;
      robotGroup.add(head);

      // Eye (single glowing slit)
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0xFF0000, roughness: 0.3, metalness: 0.2 });
      const eyeGeo = new THREE.BoxGeometry(0.3, 0.05, 0.05);
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      // *** CHANGE: Position eye relative to head center ***
      eye.position.set(0, head.position.y + 0.05, robotHeadRadius - 0.02); // On the front surface of head sphere
      robotGroup.add(eye);

      // --- NPC Character Setup ---
      const npcConfig = {
          // *** CHANGE: Use visual dimensions for collider ***
          height: robotTotalHeight, // Match visual capsule height
          radius: robotRadius,      // Match visual radius
          speed: 2.5,
          detectionRange: 18,
          attackRange: 2.5,
          attackDamage: 8,
          gravity: PLAYER_CONFIG.gravity, // Use player gravity or define specific
      };
      const npc = new NPC(scene, npcConfig, robotGroup); // Pass the created group as visual

      const bodyMesh = robotGroup.getObjectByName("NPC_Body");
      if (bodyMesh) {
        bodyMesh.isEnemy = true;
        bodyMesh.userData.parentCharacter = npc;
        bodyMesh.userData.health = npc.health;

        // Add to collidables only if bullets are supposed to hit this
        collidableObjects.push(bodyMesh);
      }

      // --- Initial Position ---
      // halfHeight is now calculated based on npcConfig.height
      const spawnY = 0 + npc.halfHeight + 0.1; // Ground level + halfHeight + buffer
      if (pos) {
          npc.container.position.copy(pos);
          npc.container.position.y = spawnY; // Set Y based on center position logic
      } else {
          const x = THREE.MathUtils.randFloat(minX, maxX);
          const z = THREE.MathUtils.randFloat(minZ, maxZ);
          npc.container.position.set(x, spawnY, z); // Set Y based on center position logic
      }

      // No need for checkGround here, first update loop will handle it.
      // Update collider to initial position AFTER setting container position
      npc.updateColliderPosition();
      npc.updateColliderBox();

      npcs.push(npc);
      // Ensure the visual mesh is added to collidables IF bullets should hit it directly
      // If bullets hit the character collider, no need to add robotGroup here.
      // collidableObjects.push(robotGroup); // Removed this - let bullets hit the NPC collider/character logic
      // Add the NPC object itself or its collider to collidables if needed for interactions?
      // Typically, NPC vs Player collision uses their respective Character colliders.
      // NPC vs Static World collision is handled by the NPC's Character physics.
      return npc;
  }
