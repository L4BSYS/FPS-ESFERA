// js/12-loop.js (part 12/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Shooting Logic ---
  function shoot() {
      if (shootCooldown > 0 || isGamePaused || !player || !player.inventory.equippedItem || player.heldItem) return;

      const weapon = player.inventory.equippedItem;
      if (weapon.ammoType && player.inventory.ammo[weapon.ammoType] <= 0) {
          // Sin balas: usar el arma como objeto de golpe (melee)
          const hit = (typeof player.meleeAttack === 'function') ? player.meleeAttack() : false;
          if (!hit) playSound('weapon_empty');
          shootCooldown = 0.4;
          return;
      }

      if (weapon.ammoType && !player.inventory.useAmmo(weapon.ammoType, 1)) return;

      const model = weapon.model;
      const muzzle = model.getObjectByName('muzzlePoint');
      if (!muzzle) {
          console.warn("No muzzlePoint found on weapon model.");
          return;
      }

      // Bullet creation
      const bulletOrigin = new THREE.Vector3();
      muzzle.getWorldPosition(bulletOrigin);
      const bulletDirection = new THREE.Vector3();
      player.camera.getWorldDirection(bulletDirection);
      
      // Add spread
      const spreadAngle = 0.005;
      bulletDirection.add(new THREE.Vector3(
          (Math.random() - 0.5) * spreadAngle,
          (Math.random() - 0.5) * spreadAngle,
          (Math.random() - 0.5) * spreadAngle
      )).normalize();

      // Create bullet
      const bullet = new Bullet(bulletOrigin, bulletDirection);
      bullets.push(bullet);
      scene.add(bullet.mesh);

      // Effects
      playSound('gunshot');
      player.applyRecoil();

      // Muzzle flash
      if (!muzzleFlash) {
          muzzleFlash = new THREE.PointLight(0xFFA500, 1, 0.5);
          muzzleFlash.distance = 0.5;
          muzzleFlash.decay = 2;
          scene.add(muzzleFlash);
      }
      muzzleFlash.position.copy(bulletOrigin);
      muzzleFlash.intensity = 1;
      setTimeout(() => {
          muzzleFlash.intensity = 0;
      }, 50);

      // Weapon kickback
      if (model.userData.originalPosition === undefined) {
          model.userData.originalPosition = model.position.clone();
      }
      model.position.z += 0.05;
      model.position.y -= 0.01;

      // Set cooldown
      shootCooldown = 0.12;
  }
// --- Antorcha: parpadeo de llama/luz cuando está equipada ---
  var torchFlickerT = 0;
  function updateTorchFlame(delta) {
      try {
          const inv = (typeof player !== 'undefined' && player) ? player.inventory : null;
          const eq = inv && inv.equippedItem;
          if (!eq || !eq.model || eq.toolType !== TOOLS.TORCH) return;
          torchFlickerT += delta;
          const ud = eq.model.userData || {};
          if (ud.light) ud.light.intensity = 1.4 + Math.sin(torchFlickerT * 18) * 0.18 + Math.random() * 0.12;
          if (ud.flame) {
              const s = 1 + Math.sin(torchFlickerT * 22) * 0.12;
              ud.flame.scale.set(s, s, s);
          }
      } catch (e) {}
  }
// --- Animation Loop ---
  function animate() {      requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05); // Clamp delta time to prevent large jumps

      // --- Updates only when NOT paused ---
      if (!isGamePaused) {
          shootCooldown = Math.max(0, shootCooldown - delta);

          // Update Player
          if (player) {
              player.update(delta, keys, collidableObjects);
          }

          // Update NPCs
          npcs.forEach(npc => {
              if (npc.health > 0 && npc.container.parent) { // Only update living NPCs in scene
                  npc.update(delta, collidableObjects, player);
              }
          });


          updateWaveManager();
          try { if (typeof trialUpdate === 'function') trialUpdate(); } catch (e) {}

          // Update Bullets (iterate backwards for safe removal)
          for (let i = bullets.length - 1; i >= 0; i--) {
              bullets[i].update(delta, collidableObjects);
          }

          // Update Collectible Animations (Bobbing/Spinning)
          collidableObjects.forEach(obj => {
              if (obj.isCollectible && obj.userData.update) {
                  obj.userData.update(delta);
              }
          });

          // Update Construction Mode stuff (if active tool is hammer)
          if (player?.currentTool === TOOLS.HAMMER) {
               updateBlockPreview();
          } else if (blockPreview?.visible) {
               blockPreview.visible = false; // Hide preview if hammer not active
          }

          updateCreatorGhost();

          updatePlacementGhost();

          updateTorchFlame(delta);

          try { if (typeof updateBlockDecay === 'function') updateBlockDecay(delta); } catch (e) {}
          try { if (typeof updateClaimRings === 'function') updateClaimRings(clock.elapsedTime); } catch (e) {}
          try { if (typeof updateBuildZoneHUD === 'function') updateBuildZoneHUD(); } catch (e) {}

          updateBlockPhysics(delta); // Update falling blocks regardless of tool
          updateActiveParticleSystems(delta);

          // Update Debug Helpers (if active)
          // if (player?.colliderBoxHelper) player.colliderBoxHelper.update();
          // npcs.forEach(npc => npc.colliderBoxHelper?.update());

      } else {
          // Handle paused state updates if any (e.g., menu animations)
      }

      // Red siempre (pausado o no): presencia viva y vecinos interpolados
      try { if (typeof netUpdate === 'function') netUpdate(delta); } catch (e) {}

      // HUD de base/objetivo/barra de construcción (se auto-ocultan en pausa)
      try { updateBaseHUD(); } catch (e) {}
      try { updateObjectiveHUD(); } catch (e) {}
      try { refreshBuildBarVisibility(); } catch (e) {}

      // --- Always Render ---
      // Ensure camera has a position even if player hasn't updated (e.g., first frame)
      if (camera && scene) {
          renderer.render(scene, camera);
      } else {
           console.error("Render Aborted: Missing Scene or Camera");
      }
  }
// --- Helper Methods --- 
  function setupQuickSlotControls() {
    const quickSlots = document.querySelectorAll('.quick-slot');
    
    // Mouse/touch click handlers
    quickSlots.forEach(slot => {
        slot.addEventListener('click', (e) => {
            const slotIndex = parseInt(slot.getAttribute('data-slot'));
            player.inventory.quickSelect(slotIndex);
        });
        
        // Touch support
        slot.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const slotIndex = parseInt(slot.getAttribute('data-slot'));
            player.inventory.quickSelect(slotIndex);
        });
    });
    
    // Keyboard number keys (1-5)
    document.addEventListener('keydown', (e) => {
        if (isGamePaused) return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;

        const key = e.key;
        if (key >= '1' && key <= '5') {
            const slotIndex = parseInt(key) - 1;
            try { if (player && player.inventory) player.inventory.quickSelect(slotIndex); } catch (err) {}
        }
    });
    // Mouse wheel cycles quick slots (only filled ones)
    window.addEventListener('wheel', (e) => {
        if (isGamePaused) return;
        try { if (player && player.inventory) cycleQuickSlot(e.deltaY > 0 ? 1 : -1); } catch (err) {}
    }, { passive: true });
  }
  function cycleQuickSlot(dir) {
      // Rueda del mouse: rota por los atajos con algo equipado (como las teclas 1-5)
      try {
          if (typeof player === 'undefined' || !player || !player.inventory) return;
          const inv = player.inventory;
          const slots = inv.quickSlots;
          const n = slots.length;
          let cur = -1;
          for (let st = 0; st < n; st++) { if (slots[st] && slots[st] === inv.equippedItem) { cur = st; break; } }
          if (cur < 0) cur = dir > 0 ? n - 1 : 0;
          for (let k = 1; k <= n; k++) {
              const idx = (((cur + dir * k) % n) + n) % n;
              if (slots[idx]) {
                  inv.quickSelect(idx);
                  try { playSound('ui_click'); } catch (e2) {}
                  return;
              }
          }
      } catch (e) {}
  }
  function showMessage(text) {
      // Add to your UI system
      const msg = document.createElement('div');
      msg.className = 'hud-message';
      msg.textContent = text;
      document.getElementById('hud').appendChild(msg);
      setTimeout(() => msg.remove(), 2000);
  }
  function showParticles(position, type) {
      // Your particle system
      console.log(`Showing ${type} particles at`, position);
  }
// --- Resize Listener ---
  function initScreenDevice () {
      if (!renderer || !camera) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        document.getElementById('mobileControls').style.display = 'block';
        document.getElementById('mobileControls').style.position = 'static';
        setupMobileControls();
      } else {
        document.getElementById('mobileControls').style.display = 'none';
        document.getElementById('mobileControls').style.position = 'absolute';      
      }
  }

  window.addEventListener('resize', () => {
      if (!renderer || !camera) return;
      initScreenDevice();
  });
// --- Debug Controls ---
  function addDebugControls() { 
      if (typeof dat === 'undefined') { console.warn("dat.GUI not found."); return; }
      if (!player) return;

      const gui = new dat.GUI();
      const params = {
          // --- Player Debug ---
          showPlayerCollider: false,
          showPlayerAABB: false,
          // --- NPC Debug ---
          showNPCColliders: false,
          showNPCAABBs: false,
          // --- Player Config (Existing) ---
          isOnGround: player.isOnGround,
          isSprinting: player.isSprinting,
          canJump: player.canJump,
          sensitivity: PLAYER_CONFIG.sensitivity,
          mobileSensitivity: PLAYER_CONFIG.mobileSensitivity,
          speed: PLAYER_CONFIG.speed,
          sprintMultiplier: PLAYER_CONFIG.sprintMultiplier,
          friction: PLAYER_CONFIG.friction,
          acceleration: PLAYER_CONFIG.acceleration,
          airControl: PLAYER_CONFIG.airControl,
          gravity: PLAYER_CONFIG.gravity,
          jumpSpeed: PLAYER_CONFIG.jumpSpeed,
          groundCheckDistance: PLAYER_CONFIG.groundCheckDistance,
          maxSlopeAngle: PLAYER_CONFIG.maxSlopeAngle * (180/Math.PI), // Convert to degrees
          basePosX: player.weaponBasePosition.x,
          basePosY: player.weaponBasePosition.y,
          basePosZ: player.weaponBasePosition.z,
          headBobFrequency: PLAYER_CONFIG.headBobFrequency,
          headBobAmount: PLAYER_CONFIG.headBobAmount,
          recoilAmount: PLAYER_CONFIG.recoilAmount,
          bulletSpeed: PLAYER_CONFIG.bulletSpeed,
          bulletLifetime: PLAYER_CONFIG.bulletLifetime
      };

      const debugFolder = gui.addFolder('Debug Visuals');
      debugFolder.add(params, 'showPlayerCollider').onChange(v => {
          if (player.collider) player.collider.visible = v;
      });
      debugFolder.add(params, 'showPlayerAABB').onChange(v => {
          if (player.colliderBoxHelper) player.colliderBoxHelper.visible = v;
      });
       debugFolder.add(params, 'showNPCColliders').onChange(v => {
           npcs.forEach(npc => { if (npc.collider) npc.collider.visible = v; });
       });
       debugFolder.add(params, 'showNPCAABBs').onChange(v => {
           npcs.forEach(npc => { if (npc.colliderBoxHelper) npc.colliderBoxHelper.visible = v; });
       });
      //debugFolder.open();


      const weaponFolder = gui.addFolder('Weapon');
      weaponFolder.add(params, 'basePosX', -1, 1, 0.01).onChange(v => player.weaponBasePosition.x = v);
      weaponFolder.add(params, 'basePosY', -1, 1, 0.01).onChange(v => player.weaponBasePosition.y = v);
      weaponFolder.add(params, 'basePosZ', -1, 1, 0.01).onChange(v => player.weaponBasePosition.z = v);    
      weaponFolder.add(params, 'recoilAmount', 0, 0.1, 0.001).onChange(v => PLAYER_CONFIG.recoilAmount = v);
      
      const movementFolder = gui.addFolder('Movement');
      movementFolder.add(params, 'isOnGround', false).onChange(v => player.isOnGround = v);
      movementFolder.add(params, 'isSprinting', false).onChange(v => player.isSprinting = v);
      movementFolder.add(params, 'canJump', false).onChange(v => player.canJump = v);
      movementFolder.add(params, 'sensitivity', 0.0001, 0.01, 0.0001).onChange(v => PLAYER_CONFIG.sensitivity = v);
      movementFolder.add(params, 'mobileSensitivity', 0.0001, 0.01, 0.0001).onChange(v => PLAYER_CONFIG.mobileSensitivity = v);
      movementFolder.add(params, 'speed', 1, 20, 0.1).onChange(v => PLAYER_CONFIG.speed = v);
      movementFolder.add(params, 'sprintMultiplier', 1, 3, 0.1).onChange(v => PLAYER_CONFIG.sprintMultiplier = v);
      movementFolder.add(params, 'friction', 0.8, 0.99, 0.005).onChange(v => PLAYER_CONFIG.friction = v);
      movementFolder.add(params, 'acceleration', 10, 200, 1).onChange(v => PLAYER_CONFIG.acceleration = v);
      movementFolder.add(params, 'airControl', 0, 1, 0.01).onChange(v => PLAYER_CONFIG.airControl = v);
      
      const physicsFolder = gui.addFolder('Physics');
      physicsFolder.add(params, 'gravity', -50, -5, 0.5).onChange(v => PLAYER_CONFIG.gravity = v);
      physicsFolder.add(params, 'jumpSpeed', 1, 15, 0.1).onChange(v => PLAYER_CONFIG.jumpSpeed = v);
      physicsFolder.add(params, 'groundCheckDistance', 0.1, 1, 0.01).onChange(v => PLAYER_CONFIG.groundCheckDistance = v);
      physicsFolder.add(params, 'maxSlopeAngle', 0, 60, 1).onChange(v => PLAYER_CONFIG.maxSlopeAngle = v * (Math.PI/180));
      
      const effectsFolder = gui.addFolder('Effects');
      effectsFolder.add(params, 'headBobFrequency', 0, 5, 0.1).onChange(v => PLAYER_CONFIG.headBobFrequency = v);
      effectsFolder.add(params, 'headBobAmount', 0, 0.2, 0.001).onChange(v => PLAYER_CONFIG.headBobAmount = v);
      
      const combatFolder = gui.addFolder('Combat');
      combatFolder.add(params, 'bulletSpeed', 1, 100, 1).onChange(v => PLAYER_CONFIG.bulletSpeed = v);
      combatFolder.add(params, 'bulletLifetime', 0.5, 10, 0.1).onChange(v => PLAYER_CONFIG.bulletLifetime = v);
  }
